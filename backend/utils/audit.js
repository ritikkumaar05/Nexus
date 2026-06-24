const { AuditLog } = require('../models');

const writeAuditLog = async ({
  workspace = null,
  actor = null,
  action,
  targetType = '',
  targetId = null,
  metadata = {}
}) => {
  if (!action) return null;

  try {
    return await AuditLog.create({
      workspace,
      actor,
      action,
      targetType,
      targetId,
      metadata
    });
  } catch (err) {
    console.error('Audit log write failed:', err.message);
    return null;
  }
};

module.exports = {
  writeAuditLog
};
