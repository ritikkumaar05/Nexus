const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canChatInWorkspace,
  canEditWorkspaceContent,
  canManageWorkspace,
  canViewWorkspace,
  getWorkspaceRole,
  hasWorkspaceRole
} = require('../utils/permissions');

const workspace = {
  members: [
    { user: 'admin-user', role: 'admin' },
    { user: 'member-user', role: 'member' },
    { user: 'viewer-user', role: 'viewer' }
  ]
};

test('getWorkspaceRole returns the matching member role', () => {
  assert.equal(getWorkspaceRole(workspace, 'admin-user'), 'admin');
  assert.equal(getWorkspaceRole(workspace, 'member-user'), 'member');
  assert.equal(getWorkspaceRole(workspace, 'missing-user'), null);
});

test('workspace role hierarchy allows higher roles to perform lower-role actions', () => {
  assert.equal(hasWorkspaceRole(workspace, 'admin-user', 'viewer'), true);
  assert.equal(hasWorkspaceRole(workspace, 'admin-user', 'member'), true);
  assert.equal(hasWorkspaceRole(workspace, 'admin-user', 'admin'), true);
  assert.equal(hasWorkspaceRole(workspace, 'member-user', 'viewer'), true);
  assert.equal(hasWorkspaceRole(workspace, 'member-user', 'admin'), false);
});

test('viewers can read but cannot chat, edit, or manage workspace resources', () => {
  assert.equal(canViewWorkspace(workspace, 'viewer-user'), true);
  assert.equal(canChatInWorkspace(workspace, 'viewer-user'), false);
  assert.equal(canEditWorkspaceContent(workspace, 'viewer-user'), false);
  assert.equal(canManageWorkspace(workspace, 'viewer-user'), false);
});

test('members can chat and edit content but cannot manage workspace settings', () => {
  assert.equal(canChatInWorkspace(workspace, 'member-user'), true);
  assert.equal(canEditWorkspaceContent(workspace, 'member-user'), true);
  assert.equal(canManageWorkspace(workspace, 'member-user'), false);
});

test('admins can manage workspace resources', () => {
  assert.equal(canManageWorkspace(workspace, 'admin-user'), true);
});
