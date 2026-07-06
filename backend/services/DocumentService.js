/**
 * ============================================================================
 * DOCUMENT SERVICE
 * ============================================================================
 * Business logic for document management including CRUD operations,
 * hierarchical relationships, cycle detection, and versioning.
 * 
 * Extracted from routes/document.js to be reusable across routes and sockets.
 */

const { Document, DocumentVersion, Workspace } = require('../models');
const { isValidObjectId } = require('../utils/validation');
const { writeAuditLog } = require('../utils/audit');
const { canEditWorkspaceContent } = require('../utils/permissions');
const {
  NotFoundError,
  AuthorizationError,
  ValidationError,
  ConflictError,
  asyncHandler
} = require('../utils/AppError');
const { DOCUMENT_LIMITS } = require('../config/constants');

const sanitizeContentHtml = (html = '') => {
  if (!html) return '';
  const allowedTags = new Set(['p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'span', 'mark', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img', 'h1', 'h2', 'h3', 'details', 'summary', 'figure', 'figcaption', 'sup', 'sub', 'input']);
  const allowedAttrs = new Set(['href', 'src', 'alt', 'title', 'style', 'class', 'target', 'rel', 'type', 'checked', 'disabled']);
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|svg|math)[\s\S]*?<\/\1>/gi, '')
    .replace(/\s(on\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<\/?([a-z0-9-]+)([^>]*)>/gi, (match, rawTag, rawAttrs = '') => {
      const tag = rawTag.toLowerCase();
      if (!allowedTags.has(tag)) return '';
      if (match.startsWith('</')) return `</${tag}>`;
      const attrs = [];
      rawAttrs.replace(/([a-zA-Z0-9-:]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g, (_, rawName, rawValue = '') => {
        const name = rawName.toLowerCase();
        if (!allowedAttrs.has(name)) return '';
        let value = String(rawValue || '').replace(/^['"]|['"]$/g, '').trim();
        if ((name === 'href' || name === 'src') && /^(javascript|data:text\/html)/i.test(value)) return '';
        if (name === 'style') {
          const safeStyles = value.split(';').map((rule) => {
            const [prop, val] = rule.split(':');
            const property = prop?.trim().toLowerCase();
            const nextValue = val?.trim();
            if (!['color', 'background-color'].includes(property) || !nextValue) return '';
            if (!/^(#[0-9a-f]{3,8}|rgb(a)?\([^)]+\)|hsl(a)?\([^)]+\)|[a-z]+)$/i.test(nextValue)) return '';
            return `${property}: ${nextValue}`;
          }).filter(Boolean).join('; ');
          if (!safeStyles) return '';
          value = safeStyles;
        }
        if (tag === 'input') {
          if (name === 'type' && value !== 'checkbox') return '';
          if (!['type', 'checked', 'disabled', 'class'].includes(name)) return '';
        }
        attrs.push(value ? `${name}="${value.replace(/"/g, '&quot;')}"` : name);
        return '';
      });
      if (tag === 'a') attrs.push('target="_blank"', 'rel="noopener noreferrer"');
      if (tag === 'input' && !attrs.some((attr) => attr.startsWith('disabled'))) attrs.push('disabled');
      return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`;
    });
};

class DocumentService {
  /**
   * Create a new document, optionally as a child of a parent document
   * @param {string} workspaceId - Workspace ID
   * @param {string} title - Document title
   * @param {string} parentDocumentId - Parent document ID (optional, for nested docs)
   * @param {string} userId - User ID (creator)
   * @returns {Promise<Object>} Created document
   * @throws {ValidationError} If input is invalid
   * @throws {AuthorizationError} If user is not a workspace member
   * @throws {NotFoundError} If parent document doesn't exist
   */
  async create(workspaceId, title, parentDocumentId, userId) {
    // Validate inputs
    if (!isValidObjectId(workspaceId)) {
      throw new ValidationError('Valid workspace ID is required');
    }

    const normalizedTitle = (title || DOCUMENT_LIMITS.DEFAULT_TITLE).trim();
    if (normalizedTitle.length > DOCUMENT_LIMITS.TITLE_MAX_LENGTH) {
      throw new ValidationError(
        `Document title cannot exceed ${DOCUMENT_LIMITS.TITLE_MAX_LENGTH} characters`
      );
    }

    // Verify user is workspace member
    const workspace = await Workspace.findOne({
      _id: workspaceId,
      'members.user': userId
    });

    if (!workspace) {
      throw new AuthorizationError('Not a member of this workspace');
    }
    if (!canEditWorkspaceContent(workspace, userId)) {
      throw new AuthorizationError('Edit access required');
    }

    // If parent specified, validate it exists and belongs to same workspace
    if (parentDocumentId) {
      if (!isValidObjectId(parentDocumentId)) {
        throw new ValidationError('Valid parent document ID is required');
      }

      const parentDoc = await Document.findOne({
        _id: parentDocumentId,
        workspace: workspaceId,
        deletedAt: null
      }).select('_id');

      if (!parentDoc) {
        throw new NotFoundError('Parent document', parentDocumentId);
      }
    }

    // Create document
    const newDoc = new Document({
      title: normalizedTitle,
      workspace: workspaceId,
      parentDocument: parentDocumentId || null,
      createdBy: userId,
      lastEditedBy: userId
    });

    const savedDoc = await newDoc.save();

    // Audit log
    await writeAuditLog({
      workspace: workspaceId,
      actor: userId,
      action: 'document.created',
      targetType: 'Document',
      targetId: savedDoc._id,
      changes: { title: savedDoc.title, parentDocument: savedDoc.parentDocument }
    });

    return savedDoc;
  }

  /**
   * Get document by ID with permission check
   * @param {string} documentId - Document ID
   * @param {string} userId - User ID (for permission check)
   * @param {string} selectFields - MongoDB select string (optional)
   * @returns {Promise<Object>} Document object
   * @throws {ValidationError} If document ID is invalid
   * @throws {NotFoundError} If document doesn't exist
   * @throws {AuthorizationError} If user is not in workspace
   */
  async getById(documentId, userId, selectFields = null) {
    if (!isValidObjectId(documentId)) {
      throw new ValidationError('Valid document ID is required');
    }

    const doc = await Document.findOne({
      _id: documentId,
      deletedAt: null
    });

    if (!doc) {
      throw new NotFoundError('Document', documentId);
    }

    // Check workspace membership
    const workspace = await Workspace.findOne({
      _id: doc.workspace,
      'members.user': userId
    });

    if (!workspace) {
      throw new AuthorizationError('Not a member of this workspace');
    }

    return doc;
  }

  /**
   * Get all documents in a workspace (flat list)
   * @param {string} workspaceId - Workspace ID
   * @param {string} userId - User ID (for permission check)
   * @returns {Promise<Array>} Array of documents
   * @throws {ValidationError} If workspace ID is invalid
   * @throws {AuthorizationError} If user is not a workspace member
   */
  async getByWorkspace(workspaceId, userId) {
    if (!isValidObjectId(workspaceId)) {
      throw new ValidationError('Valid workspace ID is required');
    }

    // Verify workspace membership
    const workspace = await Workspace.findOne({
      _id: workspaceId,
      'members.user': userId
    });

    if (!workspace) {
      throw new AuthorizationError('Not a member of this workspace');
    }

    return Document.find({
      workspace: workspaceId,
      deletedAt: null
    }).select('title parentDocument updatedAt createdBy lastEditedBy').sort({ updatedAt: -1 });
  }

  /**
   * Update document (title, content, parent, etc.)
   * @param {string} documentId - Document ID
   * @param {Object} updates - Fields to update { title?, plainTextContent?, parentDocumentId?, ... }
   * @param {string} userId - User ID (for permission and audit)
   * @returns {Promise<Object>} Updated document
   * @throws {ValidationError} If update data is invalid
   * @throws {NotFoundError} If document doesn't exist
   * @throws {AuthorizationError} If user is not a workspace member
   * @throws {ConflictError} If update would create cycle
   */
  async update(documentId, updates, userId) {
    if (!isValidObjectId(documentId)) {
      throw new ValidationError('Valid document ID is required');
    }

    const doc = await Document.findOne({
      _id: documentId,
      deletedAt: null
    });

    if (!doc) {
      throw new NotFoundError('Document', documentId);
    }

    // Verify workspace membership
    const workspace = await Workspace.findOne({
      _id: doc.workspace,
      'members.user': userId
    });

    if (!workspace) {
      throw new AuthorizationError('Not a member of this workspace');
    }
    if (!canEditWorkspaceContent(workspace, userId)) {
      throw new AuthorizationError('Edit access required');
    }

    const updateData = { lastEditedBy: userId };
    const changes = {};

    // Update title
    if (updates.title !== undefined) {
      const normalizedTitle = (updates.title || DOCUMENT_LIMITS.DEFAULT_TITLE).trim();
      if (normalizedTitle.length > DOCUMENT_LIMITS.TITLE_MAX_LENGTH) {
        throw new ValidationError(
          `Document title cannot exceed ${DOCUMENT_LIMITS.TITLE_MAX_LENGTH} characters`
        );
      }
      updateData.title = normalizedTitle;
      changes.title = normalizedTitle;
    }

    // Update plain text content
    if (updates.plainTextContent !== undefined) {
      if (typeof updates.plainTextContent !== 'string') {
        throw new ValidationError('Content must be a string');
      }
      const contentSize = Buffer.byteLength(updates.plainTextContent, 'utf8');
      if (contentSize > 5_000_000) { // 5MB limit
        throw new ValidationError('Content is too large');
      }
      updateData.plainTextContent = updates.plainTextContent;
      changes.contentSize = contentSize;
    }

    // Update HTML content
    if (updates.contentHtml !== undefined) {
      if (typeof updates.contentHtml !== 'string') {
        throw new ValidationError('HTML content must be a string');
      }
      const htmlSize = Buffer.byteLength(updates.contentHtml, 'utf8');
      if (htmlSize > 5_000_000) {
        throw new ValidationError('HTML content is too large');
      }
      updateData.contentHtml = sanitizeContentHtml(updates.contentHtml);
      changes.htmlSize = Buffer.byteLength(updateData.contentHtml, 'utf8');
    }

    // Update binary Yjs content
    if (updates.binaryUpdateBase64 !== undefined) {
      if (typeof updates.binaryUpdateBase64 !== 'string') {
        throw new ValidationError('Binary content must be base64 string');
      }
      try {
        updateData.binaryUpdate = Buffer.from(updates.binaryUpdateBase64, 'base64');
        changes.binaryUpdated = true;
      } catch (err) {
        throw new ValidationError('Invalid base64 content');
      }
    }

    // Update parent (reparent document)
    if (updates.parentDocumentId !== undefined) {
      if (updates.parentDocumentId === null || updates.parentDocumentId === '') {
        updateData.parentDocument = null;
        changes.parentDocument = null;
      } else {
        if (!isValidObjectId(updates.parentDocumentId)) {
          throw new ValidationError('Valid parent document ID is required');
        }

        // Prevent self-parenting
        if (updates.parentDocumentId === documentId) {
          throw new ValidationError('A document cannot be its own parent');
        }

        // Check parent exists in same workspace
        const parentDoc = await Document.findOne({
          _id: updates.parentDocumentId,
          workspace: doc.workspace,
          deletedAt: null
        }).select('_id parentDocument');

        if (!parentDoc) {
          throw new NotFoundError('Parent document', updates.parentDocumentId);
        }

        // Detect cycles
        if (await this.wouldCreateCycle(documentId, updates.parentDocumentId)) {
          throw new ConflictError('Moving this document would create a cycle in hierarchy');
        }

        updateData.parentDocument = updates.parentDocumentId;
        changes.parentDocument = updates.parentDocumentId;
      }
    }

    // Apply updates
    const updatedDoc = await Document.findByIdAndUpdate(
      documentId,
      { $set: updateData },
      { returnDocument: 'after' }
    );

    // Create version snapshot
    await DocumentVersion.create({
      document: updatedDoc._id,
      workspace: updatedDoc.workspace,
      title: updatedDoc.title,
      plainTextContent: updatedDoc.plainTextContent,
      contentHtml: updatedDoc.contentHtml,
      binaryUpdate: updatedDoc.binaryUpdate,
      savedBy: userId
    });

    // Audit log
    await writeAuditLog({
      workspace: doc.workspace,
      actor: userId,
      action: 'document.updated',
      targetType: 'Document',
      targetId: documentId,
      changes
    });

    return updatedDoc;
  }

  /**
   * Soft-delete a document and all its children
   * @param {string} documentId - Document ID
   * @param {string} userId - User ID (for permission and audit)
   * @returns {Promise<void>}
   * @throws {ValidationError} If document ID is invalid
   * @throws {NotFoundError} If document doesn't exist
   * @throws {AuthorizationError} If user is not a workspace member
   */
  async delete(documentId, userId) {
    if (!isValidObjectId(documentId)) {
      throw new ValidationError('Valid document ID is required');
    }

    const doc = await Document.findOne({
      _id: documentId,
      deletedAt: null
    });

    if (!doc) {
      throw new NotFoundError('Document', documentId);
    }

    // Verify workspace membership
    const workspace = await Workspace.findOne({
      _id: doc.workspace,
      'members.user': userId
    });

    if (!workspace) {
      throw new AuthorizationError('Not a member of this workspace');
    }
    if (!canEditWorkspaceContent(workspace, userId)) {
      throw new AuthorizationError('Edit access required');
    }

    // Soft delete this document and all children
    await this._deleteNestedDocuments(documentId, doc.workspace, userId);

    // Audit log
    await writeAuditLog({
      workspace: doc.workspace,
      actor: userId,
      action: 'document.deleted',
      targetType: 'Document',
      targetId: documentId
    });
  }

  /**
   * Get document hierarchy for a workspace
   * @param {string} workspaceId - Workspace ID
   * @param {string} userId - User ID (for permission check)
   * @returns {Promise<Array>} Array of root documents with children nested
   * @throws {ValidationError} If workspace ID is invalid
   * @throws {AuthorizationError} If user is not a workspace member
   */
  async getHierarchy(workspaceId, userId) {
    if (!isValidObjectId(workspaceId)) {
      throw new ValidationError('Valid workspace ID is required');
    }

    // Verify workspace membership
    const workspace = await Workspace.findOne({
      _id: workspaceId,
      'members.user': userId
    });

    if (!workspace) {
      throw new AuthorizationError('Not a member of this workspace');
    }

    // Get all non-deleted documents
    const docs = await Document.find({
      workspace: workspaceId,
      deletedAt: null
    }).select('title parentDocument createdAt updatedAt');

    // Build hierarchy
    const docMap = {};
    const roots = [];

    // Index documents
    docs.forEach((doc) => {
      docMap[doc._id] = { ...doc.toObject(), children: [] };
    });

    // Build tree
    docs.forEach((doc) => {
      if (doc.parentDocument) {
        if (docMap[doc.parentDocument]) {
          docMap[doc.parentDocument].children.push(docMap[doc._id]);
        }
      } else {
        roots.push(docMap[doc._id]);
      }
    });

    return roots;
  }

  /**
   * Check if reparenting would create a cycle
   * @param {string} documentId - Document to move
   * @param {string} parentDocumentId - Proposed parent
   * @returns {Promise<boolean>} true if cycle would be created
   * @private
   */
  async wouldCreateCycle(documentId, parentDocumentId) {
    let current = await Document.findById(parentDocumentId).select('parentDocument');

    while (current) {
      if (current._id.toString() === documentId) {
        return true;
      }

      if (!current.parentDocument) {
        return false;
      }

      current = await Document.findById(current.parentDocument).select('parentDocument');
    }

    return false;
  }

  /**
   * Recursively soft-delete a document and all children
   * @param {string} documentId - Document ID
   * @param {string} workspaceId - Workspace ID
   * @param {string} userId - User ID (for audit)
   * @returns {Promise<void>}
   * @private
   */
  async _deleteNestedDocuments(documentId, workspaceId, userId) {
    // Find all children
    const children = await Document.find({
      parentDocument: documentId,
      workspace: workspaceId,
      deletedAt: null
    });

    // Recursively delete children first
    for (const child of children) {
      await this._deleteNestedDocuments(child._id, workspaceId, userId);
    }

    // Soft delete this document
    await Document.findByIdAndUpdate(
      documentId,
      {
        $set: {
          deletedAt: new Date(),
          lastEditedBy: userId
        }
      }
    );
  }

  /**
   * Get documents in trash
   * @param {string} workspaceId - Workspace ID
   * @param {string} userId - User ID (for permission check)
   * @returns {Promise<Array>} Array of deleted documents
   * @throws {ValidationError} If workspace ID is invalid
   * @throws {AuthorizationError} If user is not a workspace member
   */
  async getTrash(workspaceId, userId) {
    if (!isValidObjectId(workspaceId)) {
      throw new ValidationError('Valid workspace ID is required');
    }

    // Verify workspace membership
    const workspace = await Workspace.findOne({
      _id: workspaceId,
      'members.user': userId
    });

    if (!workspace) {
      throw new AuthorizationError('Not a member of this workspace');
    }

    return Document.find({
      workspace: workspaceId,
      deletedAt: { $ne: null }
    }).select('title deletedAt lastEditedBy').sort({ deletedAt: -1 });
  }

  async restore(documentId, userId) {
    if (!isValidObjectId(documentId)) {
      throw new ValidationError('Valid document ID is required');
    }

    const doc = await Document.findOne({ _id: documentId });

    if (!doc) {
      throw new NotFoundError('Document', documentId);
    }

    const workspace = await Workspace.findOne({
      _id: doc.workspace,
      'members.user': userId
    });

    if (!workspace) {
      throw new AuthorizationError('Not a member of this workspace');
    }
    if (!canEditWorkspaceContent(workspace, userId)) {
      throw new AuthorizationError('Edit access required');
    }

    const restoredDoc = await Document.findByIdAndUpdate(
      documentId,
      {
        $set: {
          deletedAt: null,
          lastEditedBy: userId
        }
      },
      { returnDocument: 'after' }
    );

    await writeAuditLog({
      workspace: doc.workspace,
      actor: userId,
      action: 'document.restored',
      targetType: 'Document',
      targetId: documentId
    });

    return restoredDoc;
  }

  /**
   * Permanently delete a document (hard delete)
   * @param {string} documentId - Document ID
   * @param {string} userId - User ID (for permission and audit)
   * @returns {Promise<void>}
   * @throws {ValidationError} If document ID is invalid
   * @throws {NotFoundError} If document doesn't exist or not deleted
   * @throws {AuthorizationError} If user is not a workspace member
   */
  async permanentlyDelete(documentId, userId) {
    if (!isValidObjectId(documentId)) {
      throw new ValidationError('Valid document ID is required');
    }

    const doc = await Document.findOne({ _id: documentId });

    if (!doc) {
      throw new NotFoundError('Document', documentId);
    }

    if (!doc.deletedAt) {
      throw new ValidationError('Only deleted documents can be permanently removed');
    }

    // Verify workspace membership
    const workspace = await Workspace.findOne({
      _id: doc.workspace,
      'members.user': userId
    });

    if (!workspace) {
      throw new AuthorizationError('Not a member of this workspace');
    }

    // Permanently delete
    await Document.findByIdAndDelete(documentId);
    await DocumentVersion.deleteMany({ document: documentId });

    // Audit log
    await writeAuditLog({
      workspace: doc.workspace,
      actor: userId,
      action: 'document.permanently_deleted',
      targetType: 'Document',
      targetId: documentId
    });
  }
}

module.exports = new DocumentService();
