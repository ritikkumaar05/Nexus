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

const workspaceSelect = 'name owner members createdAt updatedAt';
const traceWorkspaceDelete = (message, payload = {}) => {
  if (process.env.WORKSPACE_DELETE_DEBUG === 'true') {
    console.info(`[workspace-delete] ${message}`, payload);
  }
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
