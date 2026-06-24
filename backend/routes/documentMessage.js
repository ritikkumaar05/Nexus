const express = require('express');
const router = express.Router({ mergeParams: true });
const { Document, DocumentMessage, Workspace } = require('../models');
const authenticateToken = require('../middleware/auth');
const { isValidObjectId, isNonEmptyString, normalizeString } = require('../utils/validation');
const {
  canChatInWorkspace,
  canManageWorkspace,
  canViewWorkspace
} = require('../utils/permissions');
const { writeAuditLog } = require('../utils/audit');

const MAX_MESSAGE_CHARS = 4000;
const MAX_LINKED_TEXT_CHARS = 1000;
const MAX_PAGE_SIZE = 100;

const getWorkspaceAndDocument = async (workspaceId, documentId, userId) => {
  if (!isValidObjectId(workspaceId) || !isValidObjectId(documentId)) return {};

  const [workspace, document] = await Promise.all([
    Workspace.findOne({ _id: workspaceId, 'members.user': userId }),
    Document.findOne({ _id: documentId, workspace: workspaceId, deletedAt: null }).select('_id workspace')
  ]);

  return { workspace, document };
};

const cleanMessage = (message) => ({
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

const parseMentions = (mentions = []) => {
  if (!Array.isArray(mentions)) return { error: 'Mentions must be an array' };
  const normalized = [];
  for (const mention of mentions) {
    if (!isValidObjectId(mention)) return { error: 'Mention IDs must be valid user IDs' };
    normalized.push(mention);
  }
  return { mentions: normalized };
};

router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const { workspaceId, documentId } = req.params;
    const requestedLimit = Number(req.query.limit) || 80;
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE);

    if (req.query.before && !isValidObjectId(req.query.before)) {
      return res.status(400).json({ error: 'before must be a valid message ID' });
    }

    const { workspace, document } = await getWorkspaceAndDocument(workspaceId, documentId, req.user.id);
    if (!workspace || !document || !canViewWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const filter = { workspace: workspaceId, document: documentId, deletedAt: null };
    if (req.query.before) filter._id = { $lt: req.query.before };

    const messages = await DocumentMessage.find(filter)
      .sort({ _id: -1 })
      .limit(limit)
      .populate('sender', 'username email')
      .populate('mentions', 'username email')
      .populate('resolvedBy', 'username email');

    const byParent = new Map();
    const roots = [];
    messages.reverse().forEach((message) => {
      const cleaned = cleanMessage(message);
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

    res.json(roots);
  } catch (err) {
    res.status(500).json({ error: 'Fetching document messages failed' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { workspaceId, documentId } = req.params;
    const body = typeof req.body.body === 'string'
      ? req.body.body.trim()
      : typeof req.body.content === 'string'
        ? req.body.content.trim()
        : '';
    const parentMessageId = req.body.parentMessageId || null;
    const linkedText = normalizeString(req.body.linkedText || '');

    if (!isNonEmptyString(body)) return res.status(400).json({ error: 'Message body is required' });
    if (body.length > MAX_MESSAGE_CHARS) return res.status(413).json({ error: 'Message body is too large' });
    if (linkedText.length > MAX_LINKED_TEXT_CHARS) return res.status(413).json({ error: 'Linked text is too large' });
    if (parentMessageId && !isValidObjectId(parentMessageId)) {
      return res.status(400).json({ error: 'Parent message ID must be valid' });
    }

    const { mentions, error } = parseMentions(req.body.mentions || []);
    if (error) return res.status(400).json({ error });

    const { workspace, document } = await getWorkspaceAndDocument(workspaceId, documentId, req.user.id);
    if (!workspace || !document || !canChatInWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (parentMessageId) {
      const parent = await DocumentMessage.findOne({
        _id: parentMessageId,
        workspace: workspaceId,
        document: documentId,
        deletedAt: null
      }).select('_id');
      if (!parent) return res.status(400).json({ error: 'Parent message must belong to this document' });
    }

    const message = await DocumentMessage.create({
      workspace: workspaceId,
      document: documentId,
      parentMessage: parentMessageId,
      sender: req.user.id,
      body,
      linkedText: parentMessageId ? '' : linkedText,
      mentions
    });
    await message.populate('sender', 'username email');
    await message.populate('mentions', 'username email');
    await message.populate('resolvedBy', 'username email');

    await writeAuditLog({
      workspace: workspaceId,
      actor: req.user.id,
      action: 'document_message.created',
      targetType: 'DocumentMessage',
      targetId: message._id,
      metadata: { documentId, parentMessageId }
    });

    res.status(201).json(cleanMessage(message));
  } catch (err) {
    res.status(500).json({ error: 'Creating document message failed' });
  }
});

router.patch('/:messageId', async (req, res) => {
  try {
    const { workspaceId, documentId, messageId } = req.params;
    const hasBody = req.body.body !== undefined || req.body.content !== undefined;
    const body = normalizeString(req.body.body ?? req.body.content);
    const status = normalizeString(req.body.status);

    if (!isValidObjectId(messageId)) return res.status(400).json({ error: 'A valid message ID is required' });
    if (!hasBody && !['open', 'resolved'].includes(status)) return res.status(400).json({ error: 'Message update is required' });
    if (hasBody && !isNonEmptyString(body)) return res.status(400).json({ error: 'Message body is required' });
    if (hasBody && body.length > MAX_MESSAGE_CHARS) return res.status(413).json({ error: 'Message body is too large' });

    const { workspace, document } = await getWorkspaceAndDocument(workspaceId, documentId, req.user.id);
    if (!workspace || !document || !canChatInWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const message = await DocumentMessage.findOne({
      _id: messageId,
      workspace: workspaceId,
      document: documentId,
      deletedAt: null
    });
    if (!message) return res.status(404).json({ error: 'Message not found' });

    const ownsMessage = message.sender.toString() === req.user.id.toString();
    const isManager = canManageWorkspace(workspace, req.user.id);
    if (!ownsMessage && !isManager) {
      return res.status(403).json({ error: 'Only sender or workspace admin can edit this message' });
    }

    if (hasBody) {
      message.body = body;
      message.editedAt = new Date();
    }
    if (['open', 'resolved'].includes(status) && !message.parentMessage) {
      message.status = status;
      message.resolvedAt = status === 'resolved' ? new Date() : null;
      message.resolvedBy = status === 'resolved' ? req.user.id : null;
    }
    await message.save();
    await message.populate('sender', 'username email');
    await message.populate('mentions', 'username email');
    await message.populate('resolvedBy', 'username email');

    await writeAuditLog({
      workspace: workspaceId,
      actor: req.user.id,
      action: 'document_message.updated',
      targetType: 'DocumentMessage',
      targetId: message._id,
      metadata: { documentId }
    });

    res.json(cleanMessage(message));
  } catch (err) {
    res.status(500).json({ error: 'Updating document message failed' });
  }
});

router.delete('/:messageId', async (req, res) => {
  try {
    const { workspaceId, documentId, messageId } = req.params;
    if (!isValidObjectId(messageId)) return res.status(400).json({ error: 'A valid message ID is required' });

    const { workspace, document } = await getWorkspaceAndDocument(workspaceId, documentId, req.user.id);
    if (!workspace || !document || !canChatInWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const message = await DocumentMessage.findOne({
      _id: messageId,
      workspace: workspaceId,
      document: documentId,
      deletedAt: null
    });
    if (!message) return res.status(404).json({ error: 'Message not found' });

    const ownsMessage = message.sender.toString() === req.user.id.toString();
    if (!ownsMessage && !canManageWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Only sender or workspace admin can delete this message' });
    }

    message.deletedAt = new Date();
    await message.save();

    await writeAuditLog({
      workspace: workspaceId,
      actor: req.user.id,
      action: 'document_message.deleted',
      targetType: 'DocumentMessage',
      targetId: message._id,
      metadata: { documentId }
    });

    res.json({ message: 'Message deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Deleting document message failed' });
  }
});

module.exports = router;
