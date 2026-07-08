const express = require('express');
const router = express.Router();
const { AuditLog, Document, StudyMaterial, Workspace } = require('../models');
const authenticateToken = require('../middleware/auth');
const { isValidObjectId, isNonEmptyString, normalizeString } = require('../utils/validation');
const {
  canEditWorkspaceContent,
  canManageWorkspace,
  canViewWorkspace
} = require('../utils/permissions');
const LearningMemoryService = require('../services/LearningMemoryService');

const VALID_TYPES = new Set(['summary', 'quiz', 'flashcards', 'important_questions', 'explanation']);
const MAX_TITLE_LENGTH = 160;
const MAX_CONTENT_BYTES = 500_000;

const cleanMaterial = (material) => ({
  _id: material._id,
  workspaceId: material.workspace,
  documentId: material.document,
  type: material.type,
  title: material.title,
  content: material.content,
  metadata: material.metadata || {},
  quizProgress: material.quizProgress || {},
  flashcardProgress: material.flashcardProgress || {},
  createdBy: material.createdBy,
  updatedBy: material.updatedBy,
  createdAt: material.createdAt,
  updatedAt: material.updatedAt
});

const getJsonSize = (value) => Buffer.byteLength(JSON.stringify(value || {}), 'utf8');

const getWorkspaceDocumentAccess = async ({ workspaceId, documentId, userId }) => {
  if (!isValidObjectId(workspaceId) || !isValidObjectId(documentId)) return {};

  const [workspace, document] = await Promise.all([
    Workspace.findOne({ _id: workspaceId, 'members.user': userId }),
    Document.findOne({ _id: documentId, workspace: workspaceId, deletedAt: null }).select('_id workspace deletedAt')
  ]);

  return { workspace, document };
};

const getMaterialAccess = async ({ materialId, userId }) => {
  if (!isValidObjectId(materialId)) return {};

  const material = await StudyMaterial.findById(materialId);
  if (!material) return {};

  const workspace = await Workspace.findOne({ _id: material.workspace, 'members.user': userId });
  return { workspace, material };
};

const writeStudyMaterialAudit = (payload) => AuditLog.create(payload).catch(() => {});

const parseMaterialPayload = (body = {}) => {
  const workspaceId = normalizeString(body.workspaceId);
  const documentId = normalizeString(body.documentId);
  const type = normalizeString(body.type);
  const title = normalizeString(body.title);

  if (!isValidObjectId(workspaceId)) return { error: 'A valid workspace ID is required' };
  if (!isValidObjectId(documentId)) return { error: 'A valid document ID is required' };
  if (!VALID_TYPES.has(type)) return { error: 'Invalid study material type' };
  if (!isNonEmptyString(title)) return { error: 'Study material title is required' };
  if (title.length > MAX_TITLE_LENGTH) return { error: `Title cannot exceed ${MAX_TITLE_LENGTH} characters` };
  if (body.content === undefined || body.content === null) return { error: 'Study material content is required' };
  if (getJsonSize(body.content) > MAX_CONTENT_BYTES) {
    return { error: 'Study material is too large to save', status: 413 };
  }

  return {
    payload: {
      workspaceId,
      documentId,
      type,
      title,
      content: body.content,
      metadata: typeof body.metadata === 'object' && body.metadata !== null ? body.metadata : {}
    }
  };
};

const parseQuizProgress = (progress = {}) => {
  const patch = {};
  if (progress.lastScore !== undefined) {
    const lastScore = Number(progress.lastScore);
    if (Number.isNaN(lastScore) || lastScore < 0 || lastScore > 100) return { error: 'Quiz score must be between 0 and 100' };
    patch['quizProgress.lastScore'] = lastScore;
  }
  if (progress.totalQuestions !== undefined) {
    const totalQuestions = Number(progress.totalQuestions);
    if (!Number.isInteger(totalQuestions) || totalQuestions < 0 || totalQuestions > 200) return { error: 'Invalid quiz question count' };
    patch['quizProgress.totalQuestions'] = totalQuestions;
  }
  if (progress.correctCount !== undefined) {
    const correctCount = Number(progress.correctCount);
    if (!Number.isInteger(correctCount) || correctCount < 0 || correctCount > 200) return { error: 'Invalid quiz correct count' };
    patch['quizProgress.correctCount'] = correctCount;
  }
  if (progress.weakTopics !== undefined) {
    if (!Array.isArray(progress.weakTopics)) return { error: 'Weak topics must be an array' };
    patch['quizProgress.weakTopics'] = progress.weakTopics
      .map((topic) => normalizeString(topic))
      .filter(Boolean)
      .slice(0, 12);
  }
  patch['quizProgress.lastAttemptAt'] = new Date();
  return { patch, incrementAttempts: true };
};

const parseFlashcardProgress = (progress = {}) => {
  const knownCardIds = Array.isArray(progress.knownCardIds)
    ? progress.knownCardIds.map((id) => normalizeString(id)).filter(Boolean).slice(0, 500)
    : [];
  const hardCardIds = Array.isArray(progress.hardCardIds)
    ? progress.hardCardIds.map((id) => normalizeString(id)).filter(Boolean).slice(0, 500)
    : [];

  return {
    patch: {
      'flashcardProgress.knownCardIds': knownCardIds,
      'flashcardProgress.hardCardIds': hardCardIds,
      'flashcardProgress.knownCount': knownCardIds.length,
      'flashcardProgress.hardCount': hardCardIds.length,
      'flashcardProgress.lastStudiedAt': new Date()
    }
  };
};

router.use(authenticateToken);

router.post('/', async (req, res) => {
  try {
    const { payload, error, status } = parseMaterialPayload(req.body);
    if (error) return res.status(status || 400).json({ error });

    const { workspace, document } = await getWorkspaceDocumentAccess({
      workspaceId: payload.workspaceId,
      documentId: payload.documentId,
      userId: req.user.id
    });

    if (!workspace || !document || !canEditWorkspaceContent(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const material = await StudyMaterial.create({
      workspace: payload.workspaceId,
      document: payload.documentId,
      type: payload.type,
      title: payload.title,
      content: payload.content,
      metadata: payload.metadata,
      createdBy: req.user.id,
      updatedBy: req.user.id
    });

    await writeStudyMaterialAudit({
      workspace: payload.workspaceId,
      actor: req.user.id,
      action: 'study_material.created',
      targetType: 'StudyMaterial',
      targetId: material._id,
      metadata: { documentId: payload.documentId, type: payload.type }
    });
    LearningMemoryService.safeRecord(() => LearningMemoryService.recordStudyMaterial({
      userId: req.user.id,
      material
    }));

    res.status(201).json(cleanMaterial(material));
  } catch (err) {
    res.status(500).json({ error: 'Saving study material failed' });
  }
});

router.get('/document/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    if (!isValidObjectId(documentId)) return res.status(400).json({ error: 'A valid document ID is required' });

    const document = await Document.findOne({ _id: documentId, deletedAt: null }).select('_id workspace');
    if (!document) return res.status(404).json({ error: 'Document not found' });

    const workspace = await Workspace.findOne({ _id: document.workspace, 'members.user': req.user.id });
    if (!workspace || !canViewWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const materials = await StudyMaterial.find({ workspace: document.workspace, document: documentId })
      .sort({ updatedAt: -1 });

    res.json(materials.map(cleanMaterial));
  } catch (err) {
    res.status(500).json({ error: 'Fetching study material failed' });
  }
});

router.patch('/:id/progress', async (req, res) => {
  try {
    const { workspace, material } = await getMaterialAccess({ materialId: req.params.id, userId: req.user.id });
    if (!workspace || !material || !canViewWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const setPatch = { updatedBy: req.user.id };
    const incPatch = {};

    if (req.body.quizProgress !== undefined) {
      const { patch, error, incrementAttempts } = parseQuizProgress(req.body.quizProgress);
      if (error) return res.status(400).json({ error });
      Object.assign(setPatch, patch);
      if (incrementAttempts) incPatch['quizProgress.attempts'] = 1;
    }

    if (req.body.flashcardProgress !== undefined) {
      const { patch } = parseFlashcardProgress(req.body.flashcardProgress);
      Object.assign(setPatch, patch);
    }

    if (Object.keys(setPatch).length === 1 && Object.keys(incPatch).length === 0) {
      return res.status(400).json({ error: 'No progress fields provided' });
    }

    const update = { $set: setPatch };
    if (Object.keys(incPatch).length) update.$inc = incPatch;

    const updated = await StudyMaterial.findByIdAndUpdate(material._id, update, { returnDocument: 'after' });

    await writeStudyMaterialAudit({
      workspace: material.workspace,
      actor: req.user.id,
      action: 'study_material.progress_updated',
      targetType: 'StudyMaterial',
      targetId: material._id,
      metadata: { type: material.type }
    });
    LearningMemoryService.safeRecord(() => LearningMemoryService.recordStudyProgress({
      userId: req.user.id,
      material,
      progress: req.body
    }));

    res.json(cleanMaterial(updated));
  } catch (err) {
    res.status(500).json({ error: 'Updating study progress failed' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { workspace, material } = await getMaterialAccess({ materialId: req.params.id, userId: req.user.id });
    if (!workspace || !material || !canViewWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const isCreator = material.createdBy?.toString() === req.user.id.toString();
    if (!isCreator && !canManageWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Only creator or workspace admin can delete this study material' });
    }

    await material.deleteOne();
    await writeStudyMaterialAudit({
      workspace: material.workspace,
      actor: req.user.id,
      action: 'study_material.deleted',
      targetType: 'StudyMaterial',
      targetId: material._id,
      metadata: { documentId: material.document, type: material.type }
    });

    res.json({ message: 'Study material deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Deleting study material failed' });
  }
});

module.exports = router;
