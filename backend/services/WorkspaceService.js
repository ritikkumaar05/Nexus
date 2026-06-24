/**
 * ============================================================================
 * WORKSPACE SERVICE
 * ============================================================================
 * Business logic for workspace management including CRUD operations,
 * member management, and role-based access control.
 * 
 * Extracted from routes/workspace.js to be reusable across routes.
 */

const {
  Attachment,
  Channel,
  Comment,
  Document,
  DocumentMessage,
  DocumentTask,
  DocumentVersion,
  Message,
  StudyMaterial,
  User,
  Workspace,
  WorkspaceInvitation
} = require('../models');
const { isValidObjectId } = require('../utils/validation');
const { writeAuditLog } = require('../utils/audit');
const {
  NotFoundError,
  AuthorizationError,
  ValidationError,
  ConflictError
} = require('../utils/AppError');
const { WORKSPACE_LIMITS, WORKSPACE_ROLES } = require('../config/constants');
const { canManageWorkspace } = require('../utils/permissions');

const VALID_ROLES = new Set([WORKSPACE_ROLES.ADMIN, WORKSPACE_ROLES.MEMBER, WORKSPACE_ROLES.VIEWER]);
const traceWorkspaceDelete = (message, payload = {}) => {
  if (process.env.WORKSPACE_DELETE_DEBUG === 'true') {
    console.info(`[workspace-delete] ${message}`, payload);
  }
};
const isWorkspaceOwner = (workspace, userId) => (
  Boolean(workspace?.owner && userId && workspace.owner.toString() === userId.toString())
);

const ensureGeneralChannel = (workspaceId, userId) => Channel.findOneAndUpdate(
  { workspace: workspaceId, slug: 'general' },
  {
    $setOnInsert: {
      workspace: workspaceId,
      name: 'General',
      slug: 'general',
      description: 'Workspace chat for everyday updates.',
      createdBy: userId
    },
    $set: { archivedAt: null }
  },
  { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
);

class WorkspaceService {
  /**
   * Create a new workspace
   * @param {string} name - Workspace name
   * @param {string} userId - Owner/creator user ID
   * @returns {Promise<Object>} Created workspace
   * @throws {ValidationError} If name is invalid
   */
  async create(name, userId) {
    if (!name || typeof name !== 'string') {
      throw new ValidationError('Workspace name is required');
    }

    const normalizedName = name.trim();
    if (normalizedName.length === 0) {
      throw new ValidationError('Workspace name cannot be empty');
    }

    if (normalizedName.length > WORKSPACE_LIMITS.NAME_MAX_LENGTH) {
      throw new ValidationError(
        `Workspace name cannot exceed ${WORKSPACE_LIMITS.NAME_MAX_LENGTH} characters`
      );
    }

    const workspace = new Workspace({
      name: normalizedName,
      owner: userId,
      members: [{ user: userId, role: 'admin' }]
    });

    const savedWorkspace = await workspace.save();
    await ensureGeneralChannel(savedWorkspace._id, userId);

    // Audit log
    await writeAuditLog({
      workspace: savedWorkspace._id,
      actor: userId,
      action: 'workspace.created',
      targetType: 'Workspace',
      targetId: savedWorkspace._id,
      changes: { name: savedWorkspace.name }
    });

    return savedWorkspace;
  }

  /**
   * Get workspace by ID with membership check
   * @param {string} workspaceId - Workspace ID
   * @param {string} userId - User ID (for permission check)
   * @returns {Promise<Object>} Workspace object
   * @throws {ValidationError} If workspace ID is invalid
   * @throws {NotFoundError} If workspace doesn't exist
   * @throws {AuthorizationError} If user is not a member
   */
  async getById(workspaceId, userId) {
    if (!isValidObjectId(workspaceId)) {
      throw new ValidationError('Valid workspace ID is required');
    }

    const workspace = await Workspace.findOne({
      _id: workspaceId,
      'members.user': userId
    })
      .populate('owner', 'username email')
      .populate('members.user', 'username email');

    if (!workspace) {
      throw new NotFoundError('Workspace', workspaceId);
    }

    return workspace;
  }

  /**
   * Get all workspaces the user is a member of
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Array of workspace objects
   */
  async getByUser(userId) {
    return Workspace.find({ 'members.user': userId })
      .select('name owner members createdAt updatedAt')
      .populate('owner', 'username email')
      .populate('members.user', 'username email')
      .sort({ updatedAt: -1 });
  }

  /**
   * Update workspace name
   * @param {string} workspaceId - Workspace ID
   * @param {string} name - New name
   * @param {string} userId - User ID (for permission and audit)
   * @returns {Promise<Object>} Updated workspace
   * @throws {ValidationError} If input is invalid
   * @throws {NotFoundError} If workspace doesn't exist
   * @throws {AuthorizationError} If user is not admin
   */
  async update(workspaceId, name, userId) {
    if (!isValidObjectId(workspaceId)) {
      throw new ValidationError('Valid workspace ID is required');
    }

    const workspace = await Workspace.findById(workspaceId);

    if (!workspace) {
      throw new NotFoundError('Workspace', workspaceId);
    }

    if (!isWorkspaceOwner(workspace, userId)) {
      throw new AuthorizationError('Only workspace owners can update workspace settings');
    }

    if (!name || typeof name !== 'string') {
      throw new ValidationError('Workspace name is required');
    }

    const normalizedName = name.trim();
    if (normalizedName.length === 0) {
      throw new ValidationError('Workspace name cannot be empty');
    }

    if (normalizedName.length > WORKSPACE_LIMITS.NAME_MAX_LENGTH) {
      throw new ValidationError(
        `Workspace name cannot exceed ${WORKSPACE_LIMITS.NAME_MAX_LENGTH} characters`
      );
    }

    const oldName = workspace.name;
    workspace.name = normalizedName;
    const savedWorkspace = await workspace.save();

    // Audit log
    await writeAuditLog({
      workspace: workspaceId,
      actor: userId,
      action: 'workspace.updated',
      targetType: 'Workspace',
      targetId: workspaceId,
      changes: { nameOld: oldName, nameNew: normalizedName }
    });

    return savedWorkspace;
  }

  /**
   * Delete a workspace and its associated workspace-scoped data.
   * @param {string} workspaceId - Workspace ID
   * @param {string} userId - User ID (must be workspace admin)
   * @returns {Promise<Object>} Deleted workspace metadata
   */
  async delete(workspaceId, userId) {
    traceWorkspaceDelete('service started', { workspaceId, userId });
    if (!isValidObjectId(workspaceId)) {
      throw new ValidationError('Valid workspace ID is required');
    }

    const workspace = await Workspace.findById(workspaceId);
    traceWorkspaceDelete('workspace lookup result', {
      workspaceId,
      found: Boolean(workspace),
      owner: workspace?.owner?.toString(),
      members: workspace?.members?.map((member) => ({
        user: member.user?.toString(),
        role: member.role
      }))
    });

    if (!workspace) {
      throw new NotFoundError('Workspace', workspaceId);
    }

    const canDelete = isWorkspaceOwner(workspace, userId);
    traceWorkspaceDelete('permission check', {
      workspaceId,
      userId,
      canDelete
    });

    if (!canDelete) {
      throw new AuthorizationError('Only workspace owners can delete workspaces');
    }

    const userWorkspaceCount = await Workspace.countDocuments({ 'members.user': userId });
    traceWorkspaceDelete('user workspace count', {
      userId,
      userWorkspaceCount
    });
    if (userWorkspaceCount <= 1) {
      throw new ValidationError('Create or join another workspace before deleting this one');
    }

    const deletedWorkspace = {
      _id: workspace._id,
      name: workspace.name
    };

    const deleteResults = await Promise.all([
      Attachment.deleteMany({ workspace: workspaceId }),
      Channel.deleteMany({ workspace: workspaceId }),
      Comment.deleteMany({ workspace: workspaceId }),
      Document.deleteMany({ workspace: workspaceId }),
      DocumentMessage.deleteMany({ workspace: workspaceId }),
      DocumentTask.deleteMany({ workspace: workspaceId }),
      DocumentVersion.deleteMany({ workspace: workspaceId }),
      Message.deleteMany({ workspace: workspaceId }),
      StudyMaterial.deleteMany({ workspace: workspaceId }),
      WorkspaceInvitation.deleteMany({ workspace: workspaceId })
    ]);
    traceWorkspaceDelete('related data delete results', {
      workspaceId,
      deletedCounts: deleteResults.map((result) => result.deletedCount)
    });

    await writeAuditLog({
      workspace: workspaceId,
      actor: userId,
      action: 'workspace.deleted',
      targetType: 'Workspace',
      targetId: workspaceId,
      changes: { name: workspace.name }
    });

    const workspaceDeleteResult = await workspace.deleteOne();
    const stillExists = await Workspace.exists({ _id: workspaceId });
    traceWorkspaceDelete('workspace delete result', {
      workspaceId,
      deletedCount: workspaceDeleteResult?.deletedCount,
      stillExists: Boolean(stillExists)
    });

    return deletedWorkspace;
  }

  /**
   * Add a member to workspace (by existing user ID)
   * @param {string} workspaceId - Workspace ID
   * @param {string} newUserId - User ID to add
   * @param {string} role - Role (admin, member, viewer)
   * @param {string} requestingUserId - User making the request (must be admin)
   * @returns {Promise<Object>} Updated workspace
   * @throws {ValidationError} If input is invalid
   * @throws {NotFoundError} If workspace or user doesn't exist
   * @throws {AuthorizationError} If requester is not admin
   * @throws {ConflictError} If user is already a member
   */
  async addMember(workspaceId, newUserId, role, requestingUserId) {
    if (!isValidObjectId(workspaceId)) {
      throw new ValidationError('Valid workspace ID is required');
    }

    if (!isValidObjectId(newUserId)) {
      throw new ValidationError('Valid user ID is required');
    }

    if (!this._isValidRole(role)) {
      throw new ValidationError(`Role must be one of: ${this._validRolesList()}`);
    }

    // Get workspace
    const workspace = await Workspace.findById(workspaceId);

    if (!workspace) {
      throw new NotFoundError('Workspace', workspaceId);
    }

    // Check requester is admin
    if (!canManageWorkspace(workspace, requestingUserId)) {
      throw new AuthorizationError('Only workspace admins can add members');
    }

    // Check new user exists
    const user = await User.findById(newUserId).select('_id username email');

    if (!user) {
      throw new NotFoundError('User', newUserId);
    }

    // Check not already a member
    const isAlreadyMember = workspace.members.some((member) =>
      member.user && member.user.toString() === newUserId.toString()
    );

    if (isAlreadyMember) {
      throw new ConflictError('User is already a member of this workspace');
    }

    // Add member
    workspace.members.push({ user: newUserId, role });
    const savedWorkspace = await workspace.save();

    // Audit log
    await writeAuditLog({
      workspace: workspaceId,
      actor: requestingUserId,
      action: 'member.added',
      targetType: 'User',
      targetId: newUserId,
      changes: { role, addedBy: requestingUserId }
    });

    return savedWorkspace;
  }

  /**
   * Update a member's role
   * @param {string} workspaceId - Workspace ID
   * @param {string} memberId - Member (user) ID
   * @param {string} newRole - New role
   * @param {string} requestingUserId - User making the request (must be admin)
   * @returns {Promise<Object>} Updated workspace
   * @throws {ValidationError} If input is invalid
   * @throws {NotFoundError} If workspace or member doesn't exist
   * @throws {AuthorizationError} If requester is not admin
   * @throws {ValidationError} If trying to change owner's role
   */
  async updateMemberRole(workspaceId, memberId, newRole, requestingUserId) {
    if (!isValidObjectId(workspaceId)) {
      throw new ValidationError('Valid workspace ID is required');
    }

    if (!isValidObjectId(memberId)) {
      throw new ValidationError('Valid member ID is required');
    }

    if (!this._isValidRole(newRole)) {
      throw new ValidationError(`Role must be one of: ${this._validRolesList()}`);
    }

    // Get workspace
    const workspace = await Workspace.findById(workspaceId);

    if (!workspace) {
      throw new NotFoundError('Workspace', workspaceId);
    }

    if (!isWorkspaceOwner(workspace, requestingUserId)) {
      throw new AuthorizationError('Only workspace owners can change member roles');
    }

    // Find member
    const member = workspace.members.find((m) => m.user && m.user.toString() === memberId.toString());

    if (!member) {
      throw new NotFoundError('Workspace member', memberId);
    }

    // Prevent changing owner's role
    if (workspace.owner && workspace.owner.toString() === memberId.toString() && newRole !== 'admin') {
      throw new ValidationError('Workspace owner must remain an admin');
    }

    const oldRole = member.role;
    member.role = newRole;
    const savedWorkspace = await workspace.save();

    // Audit log
    await writeAuditLog({
      workspace: workspaceId,
      actor: requestingUserId,
      action: 'member.role_updated',
      targetType: 'User',
      targetId: memberId,
      changes: { roleOld: oldRole, roleNew: newRole }
    });

    return savedWorkspace;
  }

  /**
   * Remove a member from workspace
   * @param {string} workspaceId - Workspace ID
   * @param {string} memberId - Member (user) ID to remove
   * @param {string} requestingUserId - User making the request (must be admin or removing self)
   * @returns {Promise<Object>} Updated workspace
   * @throws {ValidationError} If input is invalid
   * @throws {NotFoundError} If workspace or member doesn't exist
   * @throws {AuthorizationError} If requester is not admin (and not removing self)
   * @throws {ValidationError} If trying to remove owner
   */
  async removeMember(workspaceId, memberId, requestingUserId) {
    if (!isValidObjectId(workspaceId)) {
      throw new ValidationError('Valid workspace ID is required');
    }

    if (!isValidObjectId(memberId)) {
      throw new ValidationError('Valid member ID is required');
    }

    // Get workspace
    const workspace = await Workspace.findById(workspaceId);

    if (!workspace) {
      throw new NotFoundError('Workspace', workspaceId);
    }

    const requesterId = String(requestingUserId);
    const targetId = String(memberId);
    const isRemovingSelf = requesterId === targetId;
    const requesterIsOwner = isWorkspaceOwner(workspace, requestingUserId);
    const requesterMember = workspace.members.find((m) => m.user && m.user.toString() === requesterId);
    const targetMember = workspace.members.find((m) => m.user && m.user.toString() === targetId);
    const targetIsOwner = isWorkspaceOwner(workspace, memberId);
    const targetIsAdmin = targetMember?.role === WORKSPACE_ROLES.ADMIN;
    const adminCount = workspace.members.filter((m) => (
      m.role === WORKSPACE_ROLES.ADMIN || isWorkspaceOwner(workspace, m.user)
    )).length;

    if (isRemovingSelf) {
      throw new ValidationError('You cannot remove yourself from this workspace here');
    }

    if (!targetMember) {
      throw new NotFoundError('Workspace member', memberId);
    }

    if (!canManageWorkspace(workspace, requestingUserId)) {
      throw new AuthorizationError('Only workspace admins can remove other members');
    }

    if (targetIsOwner) {
      throw new ValidationError('Workspace owner cannot be removed');
    }

    if (targetIsAdmin && !requesterIsOwner) {
      throw new AuthorizationError('Only workspace owners can remove admins');
    }

    if (targetIsAdmin && adminCount <= 1) {
      throw new ValidationError('At least one admin must remain');
    }

    if (requesterMember?.role !== WORKSPACE_ROLES.ADMIN && !requesterIsOwner) {
      throw new AuthorizationError('Only workspace admins can remove members');
    }

    // Find and remove member
    const initialCount = workspace.members.length;
    workspace.members = workspace.members.filter((m) => m.user && m.user.toString() !== memberId.toString());

    if (workspace.members.length === initialCount) {
      throw new NotFoundError('Workspace member', memberId);
    }

    const savedWorkspace = await workspace.save();

    // Audit log
    await writeAuditLog({
      workspace: workspaceId,
      actor: requestingUserId,
      action: 'member.removed',
      targetType: 'User',
      targetId: memberId,
      changes: { removedBy: requestingUserId }
    });

    return savedWorkspace;
  }

  /**
   * Get member's role in workspace
   * @param {string} workspaceId - Workspace ID
   * @param {string} userId - User ID
   * @returns {Promise<string|null>} Role string or null if not a member
   */
  async getMemberRole(workspaceId, userId) {
    const workspace = await Workspace.findOne({
      _id: workspaceId,
      'members.user': userId
    }).select('members');

    if (!workspace) {
      return null;
    }

    const member = workspace.members.find((m) => m.user && m.user.toString() === userId.toString());
    return member?.role || null;
  }

  /**
   * Get all members of a workspace
   * @param {string} workspaceId - Workspace ID
   * @returns {Promise<Array>} Array of member objects with user details
   * @throws {ValidationError} If workspace ID is invalid
   * @throws {NotFoundError} If workspace doesn't exist
   */
  async getMembers(workspaceId) {
    if (!isValidObjectId(workspaceId)) {
      throw new ValidationError('Valid workspace ID is required');
    }

    const workspace = await Workspace.findById(workspaceId)
      .populate('members.user', 'username email _id')
      .select('members');

    if (!workspace) {
      throw new NotFoundError('Workspace', workspaceId);
    }

    return workspace.members;
  }

  /**
   * Check if a role is valid
   * @param {string} role - Role to check
   * @returns {boolean}
   * @private
   */
  _isValidRole(role) {
    return ['admin', 'member', 'viewer'].includes(role);
  }

  /**
   * Get formatted list of valid roles
   * @returns {string}
   * @private
   */
  _validRolesList() {
    return 'admin, member, viewer';
  }
}

module.exports = new WorkspaceService();
