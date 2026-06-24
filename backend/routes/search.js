const express = require('express');
const router = express.Router();
const { Document, Message, Workspace } = require('../models');
const authenticateToken = require('../middleware/auth');
const { isValidObjectId, normalizeString, isNonEmptyString } = require('../utils/validation');
const { canViewWorkspace } = require('../utils/permissions');

const ensureWorkspaceAccess = async (workspaceId, userId) => {
  if (!isValidObjectId(workspaceId)) return null;
  const workspace = await Workspace.findOne({ _id: workspaceId, 'members.user': userId });
  return workspace && canViewWorkspace(workspace, userId) ? workspace : null;
};

router.get('/:workspaceId', authenticateToken, async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const query = normalizeString(req.query.q);

    if (!isValidObjectId(workspaceId) || !isNonEmptyString(query)) {
      return res.status(400).json({ error: 'Valid workspace ID and query are required' });
    }

    const workspace = await ensureWorkspaceAccess(workspaceId, req.user.id);
    if (!workspace) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const [documents, messages] = await Promise.all([
      Document.find({
        workspace: workspaceId,
        deletedAt: null,
        $or: [{ title: regex }, { plainTextContent: regex }]
      })
        .select('title plainTextContent updatedAt')
        .limit(20),
      Message.find({
        workspace: workspaceId,
        deletedAt: null,
        content: regex
      })
        .select('channelId content sender createdAt')
        .populate('sender', 'username email')
        .limit(20)
    ]);

    res.json({ documents, messages });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
