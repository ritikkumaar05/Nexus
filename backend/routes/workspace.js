/**
 * ============================================================================
 * WORKSPACE ROUTER (REFACTORED)
 * ============================================================================
 * Manages virtual spaces where collaborative channels and documents reside.
 * Now uses WorkspaceService and permission middleware.
 */

const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const { validateInput, schemas } = require('../middleware/validateInput');
const { requireRole, requireMembership } = require('../middleware/requirePermission');
const { asyncHandler } = require('../utils/AppError');
const WorkspaceService = require('../services/WorkspaceService');
const { Document, DocumentMessage, Workspace } = require('../models');
const { isValidObjectId } = require('../utils/validation');
const { canViewWorkspace } = require('../utils/permissions');

const workspaceSelect = 'name owner members createdAt updatedAt';
const MAX_THREAD_SUMMARY_PAGE_SIZE = 100;
const traceWorkspaceDelete = (message, payload = {}) => {
  if (process.env.WORKSPACE_DELETE_DEBUG === 'true') {
    console.info(`[workspace-delete] ${message}`, payload);
  }
};

const cleanWorkspaceThreadMessage = (message) => ({
  _id: message._id,
  workspaceId: message.workspace,
  documentId: message.document,
  parentMessageId: message.parentMessage,
  sender: message.sender,
  body: message.body,
  linkedText: message.linkedText,
  status: message.status,
  resolvedAt: message.resolvedAt,
  resolvedBy: message.resolvedBy,
  mentions: message.mentions,
  reactions: message.reactions,
  editedAt: message.editedAt,
  deletedAt: message.deletedAt,
  createdAt: message.createdAt,
  updatedAt: message.updatedAt,
  replies: message.replies || []
});

const groupDocumentThreads = (messages = []) => {
  const byParent = new Map();
  const roots = [];
  messages.reverse().forEach((message) => {
    const cleaned = cleanWorkspaceThreadMessage(message);
    const parentId = cleaned.parentMessageId?.toString();
    if (parentId) {
      if (!byParent.has(parentId)) byParent.set(parentId, []);
      byParent.get(parentId).push(cleaned);
    } else {
      roots.push(cleaned);
    }
  });

  roots.forEach((message) => {
    message.replies = byParent.get(message._id.toString()) || [];
  });
  return roots;
};

/**
 * POST /api/workspaces
 * Create a new workspace
 */
router.post(
  '/',
  authenticateToken,
  validateInput(schemas.createWorkspace),
  asyncHandler(async (req, res) => {
    const { name } = req.body;
    const workspace = await WorkspaceService.create(name, req.user.id);

    res.status(201).json(workspace);
  })
);

/**
 * GET /api/workspaces
 * Get all workspaces user is member of
 */
router.get(
  '/',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const workspaces = await WorkspaceService.getByUser(req.user.id);
    res.json(workspaces);
  })
);

/**
 * GET /api/workspaces/:workspaceId
 * Get single workspace
 */
router.get(
  '/:workspaceId',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const workspace = await WorkspaceService.getById(workspaceId, req.user.id);

    res.json(workspace);
  })
);

/**
 * PATCH /api/workspaces/:workspaceId
 * Update workspace name (admin only)
 */
router.patch(
  '/:workspaceId',
  authenticateToken,
  validateInput(schemas.updateWorkspace),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const { name } = req.body;

    const workspace = await WorkspaceService.update(workspaceId, name, req.user.id);

    res.json(workspace);
  })
);

/**
 * GET /api/workspaces/:workspaceId/thread-summaries
 * Batch-load linked document message threads for the workspace.
 */
router.get(
  '/:workspaceId/thread-summaries',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const documentIds = String(req.query.documentIds || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const requestedLimit = Number(req.query.limit) || 80;
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_THREAD_SUMMARY_PAGE_SIZE);

    if (!isValidObjectId(workspaceId) || !documentIds.length || documentIds.some((id) => !isValidObjectId(id))) {
      return res.status(400).json({ error: 'Valid workspace and document IDs are required' });
    }

    const workspace = await Workspace.findOne({ _id: workspaceId, 'members.user': req.user.id });
    if (!workspace || !canViewWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const documents = await Document.find({
      _id: { $in: documentIds },
      workspace: workspaceId,
      deletedAt: null
    }).select('_id title');

    const messageGroups = await Promise.all(documents.map(async (document) => {
      const messages = await DocumentMessage.find({
        workspace: workspaceId,
        document: document._id,
        deletedAt: null
      })
        .sort({ _id: -1 })
        .limit(limit)
        .populate('sender', 'username email')
        .populate('mentions', 'username email')
        .populate('resolvedBy', 'username email');

      return groupDocumentThreads(messages).map((thread) => ({
        ...thread,
        documentId: document._id,
        documentTitle: document.title || 'Untitled Lecture'
      }));
    }));

    const threads = messageGroups
      .flat()
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));

    res.json(threads);
  })
);

/**
 * DELETE /api/workspaces/:workspaceId
 * Delete workspace and associated workspace data (admin only)
 */
router.delete(
  '/:workspaceId',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    traceWorkspaceDelete('route hit', {
      workspaceId,
      userId: req.user.id
    });
    const deletedWorkspace = await WorkspaceService.delete(workspaceId, req.user.id);
    traceWorkspaceDelete('route response', {
      workspaceId,
      deletedWorkspaceId: deletedWorkspace._id
    });

    res.json({ message: 'Workspace deleted', workspace: deletedWorkspace });
  })
);

/**
 * POST /api/workspaces/:workspaceId/members
 * Add member to workspace (admin only)
 */
router.post(
  '/:workspaceId/members',
  authenticateToken,
  validateInput(schemas.addWorkspaceMember),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const { userId, email, role } = req.body;

    let newUserId = userId;
    if (!userId && email) {
      // TODO: Implement email-based invite with WorkspaceInvitationService
      // For now, find existing user by email
      const { User } = require('../models');
      const user = await User.findOne({ email }).select('_id');
      if (!user) {
        const { NotFoundError } = require('../utils/AppError');
        throw new NotFoundError('User', email);
      }
      newUserId = user._id;
    }

    const workspace = await WorkspaceService.addMember(
      workspaceId,
      newUserId,
      role,
      req.user.id
    );

    res.status(201).json(workspace);
  })
);

/**
 * PATCH /api/workspaces/:workspaceId/members/:memberId
 * Update member role (admin only)
 */
router.patch(
  '/:workspaceId/members/:userId',
  authenticateToken,
  validateInput(schemas.updateMemberRole),
  asyncHandler(async (req, res) => {
    const { workspaceId, userId } = req.params;
    const { role } = req.body;

    const workspace = await WorkspaceService.updateMemberRole(
      workspaceId,
      userId,
      role,
      req.user.id
    );

    res.json(workspace);
  })
);

/**
 * DELETE /api/workspaces/:workspaceId/members/:memberId
 * Remove member from workspace (admin or self)
 */
router.delete(
  '/:workspaceId/members/:userId',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { workspaceId, userId } = req.params;

    const workspace = await WorkspaceService.removeMember(
      workspaceId,
      userId,
      req.user.id
    );

    res.json(workspace);
  })
);

/**
 * GET /api/workspaces/:workspaceId/me
 * Get current user's role in workspace
 */
router.get(
  '/:workspaceId/me',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const role = await WorkspaceService.getMemberRole(workspaceId, req.user.id);

    if (!role) {
      const { NotFoundError } = require('../utils/AppError');
      throw new NotFoundError('Workspace', workspaceId);
    }

    res.json({ role });
  })
);

module.exports = router;
