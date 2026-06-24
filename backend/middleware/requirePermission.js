/**
 * ============================================================================
 * PERMISSION MIDDLEWARE
 * ============================================================================
 * Provides middleware factories for enforcing role-based access control (RBAC)
 * and permission checks.
 * 
 * Usage:
 *   router.post('/',
 *     authenticateToken,
 *     requireRole('admin'),
 *     handler
 *   )
 */

const { Workspace, Document } = require('../models');
const { isValidObjectId } = require('../utils/validation');
const {
  canManageWorkspace,
  canEditWorkspaceContent,
  canViewWorkspace,
  canChatInWorkspace
} = require('../utils/permissions');

// ============================================================================
// PERMISSION MIDDLEWARE FACTORIES
// ============================================================================

/**
 * Require a specific workspace role
 * Checks that user has the specified role in the workspace (from params or body)
 * 
 * @param {string} requiredRole - Role to require: 'admin', 'member', 'viewer'
 * @param {string} workspaceSource - Where to find workspaceId: 'params' (default), 'body', 'query'
 * @returns {Function} Express middleware
 * 
 * Usage:
 *   router.post('/:workspaceId', requireRole('admin', 'params'), handler)
 *   router.post('/', requireRole('member', 'body'), handler)
 */
const requireRole = (requiredRole, workspaceSource = 'params') => {
  const roleHierarchy = { admin: 3, member: 2, viewer: 1 };
  const requiredLevel = roleHierarchy[requiredRole];

  return async (req, res, next) => {
    try {
      // Get workspace ID from specified source
      const workspaceId = req[workspaceSource].workspaceId;

      if (!workspaceId || !isValidObjectId(workspaceId)) {
        return res.status(400).json({ error: 'Valid workspace ID is required' });
      }

      // Find user's role in workspace
      const workspace = await Workspace.findOne(
        { _id: workspaceId, 'members.user': req.user.id },
        { 'members.$': 1 }
      );

      if (!workspace || !workspace.members[0]) {
        return res.status(403).json({ error: 'Access denied: Not a member of this workspace' });
      }

      const userRole = workspace.members[0].role;
      const userLevel = roleHierarchy[userRole];

      // Check if user's role is at or above required level
      if (!userLevel || userLevel < requiredLevel) {
        return res.status(403).json({
          error: `Access denied: ${requiredRole} role required, you have ${userRole}`
        });
      }

      // Attach workspace to request for use in handler
      req.workspace = workspace;
      next();
    } catch (err) {
      console.error('Permission check error:', err);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
};

/**
 * Require workspace member role (viewer, member, or admin)
 * Allows any member to access, useful for read operations
 * 
 * @param {string} workspaceSource - Where to find workspaceId: 'params' (default), 'body', 'query'
 * @returns {Function} Express middleware
 * 
 * Usage:
 *   router.get('/:workspaceId', requireMembership('params'), handler)
 */
const requireMembership = (workspaceSource = 'params') => {
  return async (req, res, next) => {
    try {
      const workspaceId = req[workspaceSource].workspaceId;

      if (!workspaceId || !isValidObjectId(workspaceId)) {
        return res.status(400).json({ error: 'Valid workspace ID is required' });
      }

      const workspace = await Workspace.findOne({
        _id: workspaceId,
        'members.user': req.user.id
      });

      if (!workspace) {
        return res.status(403).json({ error: 'Access denied: Not a member of this workspace' });
      }

      if (!canViewWorkspace(workspace, req.user.id)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      req.workspace = workspace;
      next();
    } catch (err) {
      console.error('Membership check error:', err);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
};

/**
 * Require edit access to workspace (member or admin, not viewer)
 * Prevents viewers from modifying content
 * 
 * @param {string} workspaceSource - Where to find workspaceId: 'params' (default), 'body', 'query'
 * @returns {Function} Express middleware
 * 
 * Usage:
 *   router.post('/:workspaceId/documents', requireEditAccess('params'), handler)
 */
const requireEditAccess = (workspaceSource = 'params') => {
  return async (req, res, next) => {
    try {
      const workspaceId = req[workspaceSource].workspaceId;

      if (!workspaceId || !isValidObjectId(workspaceId)) {
        return res.status(400).json({ error: 'Valid workspace ID is required' });
      }

      const workspace = await Workspace.findOne({
        _id: workspaceId,
        'members.user': req.user.id
      });

      if (!workspace) {
        return res.status(403).json({ error: 'Access denied: Not a member of this workspace' });
      }

      if (!canEditWorkspaceContent(workspace, req.user.id)) {
        return res.status(403).json({
          error: 'Access denied: Edit access required (viewer role cannot edit)'
        });
      }

      req.workspace = workspace;
      next();
    } catch (err) {
      console.error('Edit access check error:', err);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
};

/**
 * Require chat access to workspace (member or admin)
 * Similar to editAccess but specifically for messaging
 * 
 * @param {string} workspaceSource - Where to find workspaceId: 'params' (default), 'body', 'query'
 * @returns {Function} Express middleware
 * 
 * Usage:
 *   router.post('/:workspaceId/messages', requireChatAccess('params'), handler)
 */
const requireChatAccess = (workspaceSource = 'params') => {
  return async (req, res, next) => {
    try {
      const workspaceId = req[workspaceSource].workspaceId;

      if (!workspaceId || !isValidObjectId(workspaceId)) {
        return res.status(400).json({ error: 'Valid workspace ID is required' });
      }

      const workspace = await Workspace.findOne({
        _id: workspaceId,
        'members.user': req.user.id
      });

      if (!workspace) {
        return res.status(403).json({ error: 'Access denied: Not a member of this workspace' });
      }

      if (!canChatInWorkspace(workspace, req.user.id)) {
        return res.status(403).json({
          error: 'Access denied: Viewers cannot post messages'
        });
      }

      req.workspace = workspace;
      next();
    } catch (err) {
      console.error('Chat access check error:', err);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
};

/**
 * Require access to a specific document
 * Checks that user is a member of the document's workspace and meets minimum permission level
 * 
 * @param {string} requiredLevel - 'view' (default), 'edit', or 'admin'
 * @returns {Function} Express middleware
 * 
 * Usage:
 *   router.get('/:documentId', requireDocumentAccess('view'), handler)
 *   router.put('/:documentId', requireDocumentAccess('edit'), handler)
 */
const requireDocumentAccess = (requiredLevel = 'view') => {
  const levelMap = { view: 'view', edit: 'edit', admin: 'admin' };
  const level = levelMap[requiredLevel] || 'view';

  return async (req, res, next) => {
    try {
      const { documentId } = req.params;

      if (!documentId || !isValidObjectId(documentId)) {
        return res.status(400).json({ error: 'Valid document ID is required' });
      }

      // Get document and check workspace membership
      const document = await Document.findById(documentId).select('workspace');

      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }

      const workspace = await Workspace.findOne({
        _id: document.workspace,
        'members.user': req.user.id
      });

      if (!workspace) {
        return res.status(403).json({ error: 'Access denied: Not a member of workspace' });
      }

      // Check specific permission level
      if (level === 'edit' && !canEditWorkspaceContent(workspace, req.user.id)) {
        return res.status(403).json({
          error: 'Access denied: Edit permission required'
        });
      }

      if (level === 'admin' && !canManageWorkspace(workspace, req.user.id)) {
        return res.status(403).json({
          error: 'Access denied: Admin permission required'
        });
      }

      // Attach document and workspace to request
      req.document = document;
      req.workspace = workspace;
      next();
    } catch (err) {
      console.error('Document access check error:', err);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
};

/**
 * Check if user is owner of a resource
 * Typically used with other permission checks
 * 
 * @param {string} ownerField - The field containing owner ID (e.g., 'createdBy', 'sender')
 * @param {string} resourceSource - Where to find resource: 'doc' (req.document), 'message', etc.
 * @returns {Function} Express middleware
 * 
 * Usage:
 *   router.delete('/:messageId', requireOwnership('sender'), handler)
 */
const requireOwnership = (ownerField = 'createdBy', resourceSource = 'resource') => {
  return (req, res, next) => {
    // Expect previous middleware to attach the resource
    const resource = req[resourceSource];

    if (!resource) {
      return res.status(500).json({ error: 'Internal error: Resource not found in request' });
    }

    const ownerId = resource[ownerField];

    if (!ownerId || ownerId.toString() !== req.user.id) {
      return res.status(403).json({
        error: 'Access denied: You do not own this resource'
      });
    }

    next();
  };
};

/**
 * Wrapper for combining multiple permission checks
 * Returns middleware that passes if any of the checks pass (OR logic)
 * Useful for operations that multiple roles can perform
 * 
 * @param {...Function} checks - Middleware functions to check
 * @returns {Function} Express middleware
 * 
 * Usage:
 *   router.delete('/:documentId',
 *     anyOf(
 *       requireOwnership('createdBy'),
 *       requireRole('admin')
 *     ),
 *     handler
 *   )
 */
const anyOf = (...checks) => {
  return (req, res, next) => {
    const errors = [];

    // Try each check
    const checkRecursively = (index) => {
      if (index >= checks.length) {
        // All checks failed
        return res.status(403).json({
          error: 'Access denied: None of the permission checks passed',
          details: errors
        });
      }

      const check = checks[index];
      let checkPassed = false;

      // Create a mock response to intercept rejections
      const mockRes = {
        status: (code) => ({
          json: (data) => {
            errors.push(data.error);
            checkRecursively(index + 1);
          }
        }),
        statusCode: null
      };

      // Try the check
      try {
        check(req, mockRes, () => {
          // Check passed
          checkPassed = true;
          next();
        });
      } catch (err) {
        errors.push(err.message);
        checkRecursively(index + 1);
      }
    };

    checkRecursively(0);
  };
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  requireRole,
  requireMembership,
  requireEditAccess,
  requireChatAccess,
  requireDocumentAccess,
  requireOwnership,
  anyOf
};
