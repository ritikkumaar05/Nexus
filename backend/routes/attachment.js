const express = require('express');
const router = express.Router();
const { Attachment, Document, Workspace } = require('../models');
const authenticateToken = require('../middleware/auth');
const { isValidObjectId, normalizeString, isNonEmptyString, isValidBase64 } = require('../utils/validation');
const { canEditWorkspaceContent, canViewWorkspace } = require('../utils/permissions');
const { writeAuditLog } = require('../utils/audit');

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

const getWorkspace = (workspaceId, userId) => Workspace.findOne({ _id: workspaceId, 'members.user': userId });

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

    const filter = { workspace: workspaceId, deletedAt: null };
    if (req.query.documentId && isValidObjectId(req.query.documentId)) {
      filter.document = req.query.documentId;
    }

    const attachments = await Attachment.find(filter)
      .select('-data')
      .sort({ createdAt: -1 })
      .populate('uploadedBy', 'username email');

    res.json(attachments);
  } catch (err) {
    res.status(500).json({ error: 'Fetching attachments failed' });
  }
});

router.post('/:workspaceId', authenticateToken, async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const filename = normalizeString(req.body.filename);
    const mimeType = normalizeString(req.body.mimeType) || 'application/octet-stream';
    const documentId = normalizeString(req.body.documentId);
    const dataBase64 = normalizeString(req.body.dataBase64);

    if (!isValidObjectId(workspaceId) || !isNonEmptyString(filename) || !isValidBase64(dataBase64)) {
      return res.status(400).json({ error: 'Valid workspace, filename, and base64 data are required' });
    }
    if (documentId && !isValidObjectId(documentId)) {
      return res.status(400).json({ error: 'Document ID is invalid' });
    }

    const workspace = await getWorkspace(workspaceId, req.user.id);
    if (!workspace || !canEditWorkspaceContent(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (documentId) {
      const doc = await Document.findOne({ _id: documentId, workspace: workspaceId, deletedAt: null }).select('_id');
      if (!doc) return res.status(404).json({ error: 'Document not found' });
    }

    const data = Buffer.from(dataBase64, 'base64');
    if (data.length > MAX_ATTACHMENT_BYTES) {
      return res.status(413).json({ error: 'Attachment is too large' });
    }

    const attachment = await Attachment.create({
      workspace: workspaceId,
      document: documentId || null,
      uploadedBy: req.user.id,
      filename,
      mimeType,
      size: data.length,
      data
    });
    await writeAuditLog({
      workspace: workspaceId,
      actor: req.user.id,
      action: 'attachment.uploaded',
      targetType: 'Attachment',
      targetId: attachment._id,
      metadata: { filename }
    });

    const response = attachment.toObject();
    delete response.data;
    res.status(201).json(response);
  } catch (err) {
    res.status(500).json({ error: 'Uploading attachment failed' });
  }
});

router.get('/:workspaceId/:attachmentId/download', authenticateToken, async (req, res) => {
  try {
    const { workspaceId, attachmentId } = req.params;
    if (!isValidObjectId(workspaceId) || !isValidObjectId(attachmentId)) {
      return res.status(400).json({ error: 'Valid workspace and attachment IDs are required' });
    }

    const workspace = await getWorkspace(workspaceId, req.user.id);
    if (!workspace || !canViewWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const attachment = await Attachment.findOne({ _id: attachmentId, workspace: workspaceId, deletedAt: null });
    if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${attachment.filename.replace(/"/g, '')}"`);
    res.send(attachment.data);
  } catch (err) {
    res.status(500).json({ error: 'Downloading attachment failed' });
  }
});

module.exports = router;
