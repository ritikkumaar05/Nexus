/**
 * ============================================================================
 * WORKSPACE INVITE ROUTER
 * ============================================================================
 * Creates, revokes, and accepts workspace invitations.
 */

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { User, Workspace, WorkspaceInvitation } = require('../models');
const authenticateToken = require('../middleware/auth');
const { isValidObjectId, normalizeString, isNonEmptyString } = require('../utils/validation');
const { canManageWorkspace } = require('../utils/permissions');

const allowedRoles = new Set(['admin', 'member', 'viewer']);
const INVITE_TTL_DAYS = Number(process.env.INVITE_TTL_DAYS || 7);

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const createInviteToken = () => crypto.randomBytes(32).toString('base64url');
const createInviteCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let suffix = '';
  for (const byte of bytes) suffix += alphabet[byte % alphabet.length];
  return `STUDY-${suffix}`;
};

const getWorkspace = (workspaceId, userId) => Workspace.findOne({
  _id: workspaceId,
  'members.user': userId
});

const normalizeInviteCode = (value) => normalizeString(value).toUpperCase();

const credentialFromRequest = (source = {}) => {
  const token = normalizeString(source.token);
  const code = normalizeInviteCode(source.code);
  if (isNonEmptyString(code)) return { code, query: { codeHash: hashToken(code) } };
  if (isNonEmptyString(token)) return { token, query: { tokenHash: hashToken(token) } };
  return { query: null };
};

const findInviteByCredential = ({ token, code } = {}) => {
  const credential = credentialFromRequest({ token, code });
  if (!credential.query) return null;
  return WorkspaceInvitation.findOne(credential.query)
    .populate('workspace', 'name')
    .populate('invitedBy', 'username email');
};

const publicInvitePayload = (invitation) => ({
  workspaceName: invitation.workspace?.name || 'Workspace',
  workspace: invitation.workspace ? { _id: invitation.workspace._id, name: invitation.workspace.name } : null,
  role: invitation.role,
  expiresAt: invitation.expiresAt,
  valid: true
});

const inviteError = (res, status, error) => res.status(status).json({ error });

const createInvitationWithUniqueCode = async (payload, token) => {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = createInviteCode();
    try {
      const invitation = await WorkspaceInvitation.create({
        ...payload,
        tokenHash: hashToken(token),
        codeHash: hashToken(code)
      });
      return { invitation, code };
    } catch (err) {
      if (err.code !== 11000) throw err;
      lastError = err;
    }
  }
  throw lastError || new Error('Creating invite code failed');
};

// GET /api/invites/workspace/:workspaceId
router.get('/workspace/:workspaceId', authenticateToken, async (req, res) => {
  try {
    const { workspaceId } = req.params;
    if (!isValidObjectId(workspaceId)) {
      return res.status(400).json({ error: 'A valid workspace ID is required' });
    }

    const workspace = await getWorkspace(workspaceId, req.user.id);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    if (!canManageWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Only workspace admins can view invites' });
    }

    const invitations = await WorkspaceInvitation.find({
      workspace: workspaceId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { $gt: new Date() }
    })
      .select('email role invitedBy expiresAt createdAt')
      .sort({ createdAt: -1 })
      .populate('invitedBy', 'username email');

    res.json(invitations);
  } catch (err) {
    res.status(500).json({ error: 'Fetching invites failed' });
  }
});

// GET /api/invites/preview?token=... OR ?code=...
router.get('/preview', async (req, res) => {
  try {
    const invitation = await findInviteByCredential({
      token: req.query.token,
      code: req.query.code
    });

    if (!invitation || invitation.revokedAt || invitation.acceptedAt) {
      return inviteError(res, 404, 'This invite link is invalid.');
    }
    if (invitation.expiresAt <= new Date()) {
      return inviteError(res, 410, 'This invite has expired. Ask the workspace owner for a new invite.');
    }

    res.json(publicInvitePayload(invitation));
  } catch (err) {
    res.status(500).json({ error: 'Fetching invite failed' });
  }
});

// POST /api/invites/accept
router.post('/accept', authenticateToken, async (req, res) => {
  try {
    const credential = credentialFromRequest(req.body);
    if (!credential.query) {
      return inviteError(res, 400, 'Invite token or code is required');
    }

    const invitation = await WorkspaceInvitation.findOne(credential.query).populate('workspace', 'name');
    if (!invitation || invitation.revokedAt) {
      return inviteError(res, 404, 'This invite link is invalid.');
    }

    const workspace = await Workspace.findById(invitation.workspace?._id || invitation.workspace);
    if (!workspace) {
      return inviteError(res, 404, 'Workspace not found');
    }

    const alreadyMember = workspace.members.some((member) => member.user && member.user.toString() === req.user.id.toString());
    if (alreadyMember) {
      return inviteError(res, 409, 'You are already a member of this workspace.');
    }
    if (invitation.acceptedAt) {
      return inviteError(res, 404, 'This invite link is invalid.');
    }
    if (invitation.expiresAt <= new Date()) {
      return inviteError(res, 410, 'This invite has expired. Ask the workspace owner for a new invite.');
    }
    if (invitation.email && invitation.email !== req.user.email) {
      return inviteError(res, 403, 'You do not have permission to use this invite.');
    }

    workspace.members.push({ user: req.user.id, role: invitation.role });
    await workspace.save();

    invitation.acceptedAt = new Date();
    await invitation.save();
    await workspace.populate('owner', 'username email');
    await workspace.populate('members.user', 'username email');

    res.json({
      workspace,
      message: 'Joined workspace'
    });
  } catch (err) {
    res.status(500).json({ error: 'Accepting invite failed' });
  }
});

// POST /api/invites/:workspaceId
router.post('/:workspaceId', authenticateToken, async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const email = normalizeString(req.body.email).toLowerCase();
    const role = normalizeString(req.body.role) || 'member';

    if (!isValidObjectId(workspaceId)) {
      return res.status(400).json({ error: 'A valid workspace ID is required' });
    }
    if (!allowedRoles.has(role)) {
      return res.status(400).json({ error: 'Role must be viewer, member, or admin' });
    }

    const workspace = await getWorkspace(workspaceId, req.user.id);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    if (!canManageWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Only workspace admins can invite members' });
    }

    if (email) {
      const existingUser = await User.findOne({ email }).select('_id');
      if (existingUser && workspace.members.some((member) => member.user && member.user.toString() === existingUser._id.toString())) {
        return res.status(409).json({ error: 'User is already a workspace member' });
      }

      await WorkspaceInvitation.updateMany(
        { workspace: workspaceId, email, acceptedAt: null, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
    }

    const token = createInviteToken();
    const { invitation, code } = await createInvitationWithUniqueCode({
      workspace: workspaceId,
      email,
      role,
      invitedBy: req.user.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)
    }, token);
    const inviteLink = `${req.protocol}://${req.get('host')}/join?token=${encodeURIComponent(token)}`;

    res.status(201).json({
      invite: {
        _id: invitation._id,
        workspace: invitation.workspace,
        workspaceName: workspace.name,
        email: invitation.email,
        role: invitation.role,
        token,
        code,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt
      },
      invitation: {
        id: invitation._id,
        workspace: invitation.workspace,
        workspaceName: workspace.name,
        email: invitation.email,
        role: invitation.role,
        code,
        expiresAt: invitation.expiresAt
      },
      inviteLink,
      code,
      token
    });
  } catch (err) {
    res.status(500).json({ error: 'Creating invite failed' });
  }
});

// GET /api/invites/:token
router.get('/:token', async (req, res) => {
  try {
    const token = normalizeString(req.params.token);
    if (!isNonEmptyString(token)) {
      return res.status(400).json({ error: 'Invite token is required' });
    }

    const invitation = await findInviteByCredential({ token });

    if (!invitation || invitation.revokedAt || invitation.acceptedAt) {
      return res.status(404).json({ error: 'This invite link is invalid.' });
    }
    if (invitation.expiresAt <= new Date()) {
      return res.status(410).json({ error: 'This invite has expired. Ask the workspace owner for a new invite.' });
    }

    res.json({
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      workspace: invitation.workspace,
      invitedBy: invitation.invitedBy
    });
  } catch (err) {
    res.status(500).json({ error: 'Fetching invite failed' });
  }
});

// POST /api/invites/:token/accept
router.post('/:token/accept', authenticateToken, async (req, res) => {
  try {
    const token = normalizeString(req.params.token);
    if (!isNonEmptyString(token)) {
      return res.status(400).json({ error: 'Invite token is required' });
    }

    const invitation = await WorkspaceInvitation.findOne({ tokenHash: hashToken(token) });

    if (!invitation || invitation.revokedAt) {
      return res.status(404).json({ error: 'This invite link is invalid.' });
    }
    if (invitation.email && invitation.email !== req.user.email) {
      return res.status(403).json({ error: 'You do not have permission to use this invite.' });
    }
    if (invitation.expiresAt <= new Date()) {
      return res.status(410).json({ error: 'This invite has expired. Ask the workspace owner for a new invite.' });
    }

    const workspace = await Workspace.findById(invitation.workspace);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const alreadyMember = workspace.members.some((member) => member.user && member.user.toString() === req.user.id.toString());
    if (alreadyMember) {
      return res.status(409).json({ error: 'You are already a member of this workspace.' });
    }
    if (invitation.acceptedAt) {
      return res.status(404).json({ error: 'This invite link is invalid.' });
    }
    workspace.members.push({ user: req.user.id, role: invitation.role });
    await workspace.save();

    invitation.acceptedAt = new Date();
    await invitation.save();
    await workspace.populate('owner', 'username email');
    await workspace.populate('members.user', 'username email');

    res.json({ workspace, message: 'Joined workspace' });
  } catch (err) {
    res.status(500).json({ error: 'Accepting invite failed' });
  }
});

// DELETE /api/invites/:workspaceId/:inviteId
router.delete('/:workspaceId/:inviteId', authenticateToken, async (req, res) => {
  try {
    const { workspaceId, inviteId } = req.params;
    if (!isValidObjectId(workspaceId) || !isValidObjectId(inviteId)) {
      return res.status(400).json({ error: 'Valid workspace and invite IDs are required' });
    }

    const workspace = await getWorkspace(workspaceId, req.user.id);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    if (!canManageWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Only workspace admins can revoke invites' });
    }

    const invitation = await WorkspaceInvitation.findOneAndUpdate(
      { _id: inviteId, workspace: workspaceId, acceptedAt: null, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!invitation) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    res.json({ message: 'Invite revoked' });
  } catch (err) {
    res.status(500).json({ error: 'Revoking invite failed' });
  }
});

module.exports = router;
