const express = require('express');
const router = express.Router({ mergeParams: true });
const { Document, DocumentTask, Workspace } = require('../models');
const authenticateToken = require('../middleware/auth');
const { isValidObjectId, isNonEmptyString, normalizeString } = require('../utils/validation');
const {
  canEditWorkspaceContent,
  canManageWorkspace,
  canViewWorkspace
} = require('../utils/permissions');
const { writeAuditLog } = require('../utils/audit');

const VALID_STATUSES = new Set(['todo', 'in_progress', 'done']);
const VALID_PRIORITIES = new Set(['low', 'medium', 'high']);
const MAX_TITLE_LENGTH = 180;
const MAX_DESCRIPTION_LENGTH = 2000;

const getWorkspaceAndDocument = async (workspaceId, documentId, userId) => {
  if (!isValidObjectId(workspaceId) || !isValidObjectId(documentId)) return {};

  const [workspace, document] = await Promise.all([
    Workspace.findOne({ _id: workspaceId, 'members.user': userId }),
    Document.findOne({ _id: documentId, workspace: workspaceId, deletedAt: null }).select('_id workspace')
  ]);

  return { workspace, document };
};

const cleanTask = (task) => ({
  _id: task._id,
  workspaceId: task.workspace,
  documentId: task.document,
  title: task.title,
  description: task.description,
  status: task.status,
  priority: task.priority,
  dueDate: task.dueDate,
  assignee: task.assignee,
  creator: task.creator,
  completedAt: task.completedAt,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt
});

const parseTaskPayload = (body, { partial = false } = {}) => {
  const payload = {};

  if (!partial || body.title !== undefined) {
    const title = normalizeString(body.title);
    if (!isNonEmptyString(title)) return { error: 'Task title is required' };
    if (title.length > MAX_TITLE_LENGTH) return { error: `Task title cannot exceed ${MAX_TITLE_LENGTH} characters` };
    payload.title = title;
  }

  if (body.description !== undefined) {
    const description = normalizeString(body.description);
    if (description.length > MAX_DESCRIPTION_LENGTH) return { error: `Task description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters` };
    payload.description = description;
  }

  if (body.status !== undefined) {
    const status = normalizeString(body.status);
    if (!VALID_STATUSES.has(status)) return { error: 'Invalid task status' };
    payload.status = status;
    payload.completedAt = status === 'done' ? new Date() : null;
  }

  if (body.priority !== undefined) {
    const priority = normalizeString(body.priority);
    if (!VALID_PRIORITIES.has(priority)) return { error: 'Invalid task priority' };
    payload.priority = priority;
  }

  if (body.dueDate !== undefined) {
    if (!body.dueDate) {
      payload.dueDate = null;
    } else {
      const dueDate = new Date(body.dueDate);
      if (Number.isNaN(dueDate.getTime())) return { error: 'Invalid due date' };
      payload.dueDate = dueDate;
    }
  }

  if (body.assignee !== undefined) {
    if (!body.assignee) {
      payload.assignee = null;
    } else if (!isValidObjectId(body.assignee)) {
      return { error: 'Assignee must be a valid user ID' };
    } else {
      payload.assignee = body.assignee;
    }
  }

  return { payload };
};

router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const { workspaceId, documentId } = req.params;
    const { workspace, document } = await getWorkspaceAndDocument(workspaceId, documentId, req.user.id);

    if (!workspace || !document || !canViewWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const tasks = await DocumentTask.find({ workspace: workspaceId, document: documentId })
      .sort({ status: 1, dueDate: 1, createdAt: -1 })
      .populate('assignee', 'username email')
      .populate('creator', 'username email');

    res.json(tasks.map(cleanTask));
  } catch (err) {
    res.status(500).json({ error: 'Fetching document tasks failed' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { workspaceId, documentId } = req.params;
    const { workspace, document } = await getWorkspaceAndDocument(workspaceId, documentId, req.user.id);

    if (!workspace || !document || !canEditWorkspaceContent(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { payload, error } = parseTaskPayload(req.body);
    if (error) return res.status(400).json({ error });

    const task = await DocumentTask.create({
      ...payload,
      workspace: workspaceId,
      document: documentId,
      creator: req.user.id
    });
    await task.populate('assignee', 'username email');
    await task.populate('creator', 'username email');

    await writeAuditLog({
      workspace: workspaceId,
      actor: req.user.id,
      action: 'document_task.created',
      targetType: 'DocumentTask',
      targetId: task._id,
      metadata: { documentId }
    });

    res.status(201).json(cleanTask(task));
  } catch (err) {
    res.status(500).json({ error: 'Creating document task failed' });
  }
});

router.patch('/:taskId', async (req, res) => {
  try {
    const { workspaceId, documentId, taskId } = req.params;
    if (!isValidObjectId(taskId)) return res.status(400).json({ error: 'A valid task ID is required' });

    const { workspace, document } = await getWorkspaceAndDocument(workspaceId, documentId, req.user.id);
    if (!workspace || !document || !canEditWorkspaceContent(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { payload, error } = parseTaskPayload(req.body, { partial: true });
    if (error) return res.status(400).json({ error });

    const task = await DocumentTask.findOneAndUpdate(
      { _id: taskId, workspace: workspaceId, document: documentId },
      { $set: payload },
      { returnDocument: 'after' }
    )
      .populate('assignee', 'username email')
      .populate('creator', 'username email');

    if (!task) return res.status(404).json({ error: 'Task not found' });

    await writeAuditLog({
      workspace: workspaceId,
      actor: req.user.id,
      action: 'document_task.updated',
      targetType: 'DocumentTask',
      targetId: task._id,
      metadata: { documentId }
    });

    res.json(cleanTask(task));
  } catch (err) {
    res.status(500).json({ error: 'Updating document task failed' });
  }
});

router.delete('/:taskId', async (req, res) => {
  try {
    const { workspaceId, documentId, taskId } = req.params;
    if (!isValidObjectId(taskId)) return res.status(400).json({ error: 'A valid task ID is required' });

    const { workspace, document } = await getWorkspaceAndDocument(workspaceId, documentId, req.user.id);
    if (!workspace || !document || !canEditWorkspaceContent(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const task = await DocumentTask.findOne({ _id: taskId, workspace: workspaceId, document: documentId });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const ownsTask = task.creator.toString() === req.user.id.toString();
    if (!ownsTask && !canManageWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Only task creator or workspace admin can delete this task' });
    }

    await task.deleteOne();
    await writeAuditLog({
      workspace: workspaceId,
      actor: req.user.id,
      action: 'document_task.deleted',
      targetType: 'DocumentTask',
      targetId: task._id,
      metadata: { documentId }
    });

    res.json({ message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Deleting document task failed' });
  }
});

module.exports = router;
