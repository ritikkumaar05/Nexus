const ROLE_RANK = {
  viewer: 1,
  member: 2,
  admin: 3
};

const WORKSPACE_ROLES = Object.freeze(Object.keys(ROLE_RANK));

const getMemberEntry = (workspace, userId) => {
  if (!workspace || !userId) return null;
  return workspace.members.find((entry) => entry.user && entry.user.toString() === userId.toString()) || null;
};

const getWorkspaceRole = (workspace, userId) => getMemberEntry(workspace, userId)?.role || null;

const hasWorkspaceRole = (workspace, userId, minimumRole) => {
  const role = getWorkspaceRole(workspace, userId);
  if (!role || !ROLE_RANK[minimumRole]) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minimumRole];
};

const canViewWorkspace = (workspace, userId) => hasWorkspaceRole(workspace, userId, 'viewer');
const canChatInWorkspace = (workspace, userId) => hasWorkspaceRole(workspace, userId, 'member');
const canEditWorkspaceContent = (workspace, userId) => hasWorkspaceRole(workspace, userId, 'member');
const canManageWorkspace = (workspace, userId) => hasWorkspaceRole(workspace, userId, 'admin');

module.exports = {
  WORKSPACE_ROLES,
  canChatInWorkspace,
  canEditWorkspaceContent,
  canManageWorkspace,
  canViewWorkspace,
  getWorkspaceRole,
  hasWorkspaceRole
};
