/**
 * ============================================================================
 * MESSAGE ROUTER
 * ============================================================================
 * Provides REST access to chat history so clients can load channel messages
 * before live Socket.IO updates arrive.
 */

const express = require('express');
const router = express.Router();
const { Channel, Message, Workspace } = require('../models');
const authenticateToken = require('../middleware/auth');
const { isValidObjectId, normalizeString, isNonEmptyString } = require('../utils/validation');
const { canChatInWorkspace, canViewWorkspace } = require('../utils/permissions');

const MAX_CHAT_MESSAGE_CHARS = 4000;
const MAX_PAGE_SIZE = 100;

const getWorkspace = async (workspaceId, userId) => {
  if (!isValidObjectId(workspaceId)) return false;
  return Workspace.findOne({ _id: workspaceId, 'members.user': userId });
};

const getActiveChannel = (workspaceId, channelId) => Channel.findOne({
  workspace: workspaceId,
  slug: channelId,
  archivedAt: null
});

// --- GET CHANNEL HISTORY ---
// GET /api/messages/:workspaceId/:channelId?limit=50&before=<messageId>
router.get('/:workspaceId/:channelId', authenticateToken, async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const channelId = normalizeString(req.params.channelId);
    const requestedLimit = Number(req.query.limit) || 50;
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE);

    if (!isValidObjectId(workspaceId) || !isNonEmptyString(channelId)) {
      return res.status(400).json({ error: 'Valid workspace and channel IDs are required' });
    }
    if (req.query.before && !isValidObjectId(req.query.before)) {
      return res.status(400).json({ error: 'before must be a valid message ID' });
    }

    const workspace = await getWorkspace(workspaceId, req.user.id);
    if (!workspace || !canViewWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const channel = await getActiveChannel(workspaceId, channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const filter = { workspace: workspaceId, channelId };
    if (req.query.before) {
      filter._id = { $lt: req.query.before };
    }

    const messages = await Message.find(filter)
      .sort({ _id: -1 })
      .limit(limit)
      .populate('sender', 'username email');

    res.json(messages.reverse());
  } catch (err) {
    res.status(500).json({ error: 'Fetching messages failed' });
  }
});

// --- SEND MESSAGE OVER REST ---
// POST /api/messages/:workspaceId/:channelId
router.post('/:workspaceId/:channelId', authenticateToken, async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const channelId = normalizeString(req.params.channelId);
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';

    if (!isValidObjectId(workspaceId) || !isNonEmptyString(channelId)) {
      return res.status(400).json({ error: 'Valid workspace and channel IDs are required' });
    }
    if (!isNonEmptyString(content)) {
      return res.status(400).json({ error: 'Message content is required' });
    }
    if (content.length > MAX_CHAT_MESSAGE_CHARS) {
      return res.status(413).json({ error: 'Message content is too large' });
    }

    const workspace = await getWorkspace(workspaceId, req.user.id);
    if (!workspace || !canChatInWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const channel = await getActiveChannel(workspaceId, channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const message = await Message.create({
      workspace: workspaceId,
      channelId,
      sender: req.user.id,
      content
    });
    await message.populate('sender', 'username email');

    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ error: 'Sending message failed' });
  }
});

module.exports = router;
