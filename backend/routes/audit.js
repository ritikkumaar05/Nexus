const express = require('express');
const router = express.Router();
const { AuditLog, Workspace } = require('../models');
const authenticateToken = require('../middleware/auth');
const { isValidObjectId } = require('../utils/validation');
const { canManageWorkspace } = require('../utils/permissions');

router.get('/:workspaceId', authenticateToken, async (req, res) => {
  try {
    const { workspaceId } = req.params;
    if (!isValidObjectId(workspaceId)) {
      return res.status(400).json({ error: 'A valid workspace ID is required' });
    }

    const workspace = await Workspace.findOne({ _id: workspaceId, 'members.user': req.user.id });
    if (!workspace || !canManageWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Only workspace admins can view audit logs' });
    }

    const logs = await AuditLog.find({ workspace: workspaceId })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('actor', 'username email');

    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Fetching audit logs failed' });
  }
});

module.exports = router;
