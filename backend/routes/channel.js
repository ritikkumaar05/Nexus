/**
 * ============================================================================
 * CHANNEL ROUTER
 * ============================================================================
 * Manages named chat channels inside a workspace.
 */

const express = require('express');
const router = express.Router();
const { Channel, Workspace } = require('../models');
const authenticateToken = require('../middleware/auth');
const { isValidObjectId, normalizeString, isNonEmptyString } = require('../utils/validation');
const {
  canManageWorkspace,
  canViewWorkspace,
  canChatInWorkspace
} = require('../utils/permissions');

const slugify = (value) => normalizeString(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60);

const getWorkspace = (workspaceId, userId) => Workspace.findOne({
  _id: workspaceId,
  'members.user': userId
});

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

// GET /api/channels/:workspaceId
router.get('/:workspaceId', authenticateToken, async (req, res) => {
  try {
    const { workspaceId } = req.params;
    if (!isValidObjectId(workspaceId)) {
      return res.status(400).json({ error: 'A valid workspace ID is required' });
    }

    const workspace = await getWorkspace(workspaceId, req.user.id);
    if (!workspace || !canViewWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await ensureGeneralChannel(workspaceId, workspace.owner || req.user.id);

    const includeArchived = req.query.includeArchived === 'true';
    const filter = { workspace: workspaceId };
    if (!includeArchived) filter.archivedAt = null;

    const channels = await Channel.find(filter)
      .sort({ archivedAt: 1, createdAt: 1 })
      .populate('createdBy', 'username email');

    res.json(channels);
  } catch (err) {
    res.status(500).json({ error: 'Fetching channels failed' });
  }
});

// POST /api/channels/:workspaceId
router.post('/:workspaceId', authenticateToken, async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const name = normalizeString(req.body.name);
    const description = normalizeString(req.body.description);
    const slug = slugify(req.body.slug || name);

    if (!isValidObjectId(workspaceId)) {
      return res.status(400).json({ error: 'A valid workspace ID is required' });
    }
    if (!isNonEmptyString(name)) {
      return res.status(400).json({ error: 'Channel name is required' });
    }
    if (name.length > 80 || description.length > 240) {
      return res.status(400).json({ error: 'Channel name or description is too long' });
    }
    if (!isNonEmptyString(slug)) {
      return res.status(400).json({ error: 'Channel slug is invalid' });
    }

    const workspace = await getWorkspace(workspaceId, req.user.id);
    if (!workspace || !canChatInWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Only workspace members can create channels' });
    }

    const channel = await Channel.create({
      workspace: workspaceId,
      name,
      slug,
      description,
      createdBy: req.user.id
    });

    res.status(201).json(channel);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A channel with this slug already exists' });
    }
    res.status(500).json({ error: 'Creating channel failed' });
  }
});

// PATCH /api/channels/:workspaceId/:channelId
router.patch('/:workspaceId/:channelId', authenticateToken, async (req, res) => {
  try {
    const { workspaceId, channelId } = req.params;
    if (!isValidObjectId(workspaceId) || !isValidObjectId(channelId)) {
      return res.status(400).json({ error: 'Valid workspace and channel IDs are required' });
    }

    const workspace = await getWorkspace(workspaceId, req.user.id);
    if (!workspace || !canManageWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Only workspace admins can update channels' });
    }

    const updateData = {};
    if (req.body.name !== undefined) {
      const name = normalizeString(req.body.name);
      if (!isNonEmptyString(name) || name.length > 80) {
        return res.status(400).json({ error: 'Valid channel name is required' });
      }
      updateData.name = name;
    }
    if (req.body.description !== undefined) {
      const description = normalizeString(req.body.description);
      if (description.length > 240) {
        return res.status(400).json({ error: 'Channel description is too long' });
      }
      updateData.description = description;
    }
    if (req.body.slug !== undefined) {
      const slug = slugify(req.body.slug);
      if (!isNonEmptyString(slug)) {
        return res.status(400).json({ error: 'Channel slug is invalid' });
      }
      updateData.slug = slug;
    }

    const channel = await Channel.findOneAndUpdate(
      { _id: channelId, workspace: workspaceId },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    res.json(channel);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A channel with this slug already exists' });
    }
    res.status(500).json({ error: 'Updating channel failed' });
  }
});

// DELETE /api/channels/:workspaceId/:channelId
router.delete('/:workspaceId/:channelId', authenticateToken, async (req, res) => {
  try {
    const { workspaceId, channelId } = req.params;
    if (!isValidObjectId(workspaceId) || !isValidObjectId(channelId)) {
      return res.status(400).json({ error: 'Valid workspace and channel IDs are required' });
    }

    const workspace = await getWorkspace(workspaceId, req.user.id);
    if (!workspace || !canManageWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Only workspace admins can archive channels' });
    }

    const channel = await Channel.findOneAndUpdate(
      { _id: channelId, workspace: workspaceId },
      { $set: { archivedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    res.json(channel);
  } catch (err) {
    res.status(500).json({ error: 'Archiving channel failed' });
  }
});

module.exports = router;
