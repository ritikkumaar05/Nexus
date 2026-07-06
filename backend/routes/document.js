/**
 * ============================================================================
 * DOCUMENT ROUTER (REFACTORED)
 * ============================================================================
 * Manages the CRUD lifecycle of collaborative documents and nested hierarchy.
 * Now uses DocumentService for business logic.
 */

const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const { validateInput, schemas } = require('../middleware/validateInput');
const { asyncHandler, ConflictError } = require('../utils/AppError');
const DocumentService = require('../services/DocumentService');
const { Comment, DocumentVersion } = require('../models');

const MAX_DOCUMENT_TEXT_CHARS = 200_000;

/**
 * POST /api/documents
 * Create a new document or sub-page
 */
router.post(
  '/',
  authenticateToken,
  validateInput(schemas.createDocument),
  asyncHandler(async (req, res) => {
    const { workspaceId, parentDocumentId, title } = req.body;

    const doc = await DocumentService.create(
      workspaceId,
      title || 'Untitled Page',
      parentDocumentId,
      req.user.id
    );

    res.status(201).json(doc);
  })
);

/**
 * GET /api/documents/workspace/:workspaceId
 * Get all documents in a workspace (flat list for tree building)
 */
router.get(
  '/workspace/:workspaceId',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;

    const docs = await DocumentService.getByWorkspace(workspaceId, req.user.id);

    res.json(docs);
  })
);

/**
 * GET /api/documents/:id
 * Get single document content
 */
router.get(
  '/:id',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const doc = await DocumentService.getById(id, req.user.id);

    res.json(doc);
  })
);

/**
 * PUT /api/documents/:id
 * Update document (title, content, parent, binary data)
 */
router.put(
  '/:id',
  authenticateToken,
  validateInput(schemas.updateDocument),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { title, plainTextContent, contentHtml, binaryUpdateBase64, parentDocumentId } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (plainTextContent !== undefined) {
      if (plainTextContent.length > MAX_DOCUMENT_TEXT_CHARS) {
        return res.status(413).json({ error: 'Document content is too large' });
      }
      updates.plainTextContent = plainTextContent;
    }
    if (contentHtml !== undefined) updates.contentHtml = contentHtml;
    if (binaryUpdateBase64 !== undefined) updates.binaryUpdateBase64 = binaryUpdateBase64;
    if (parentDocumentId !== undefined) updates.parentDocumentId = parentDocumentId;

    const doc = await DocumentService.update(id, updates, req.user.id);

    res.json(doc);
  })
);

/**
 * DELETE /api/documents/:id
 * Soft delete document and all children
 */
router.delete(
  '/:id',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    await DocumentService.delete(id, req.user.id);

    res.json({ message: 'Document moved to trash' });
  })
);

/**
 * GET /api/documents/workspace/:workspaceId/trash
 * Get deleted documents
 */
router.get(
  '/workspace/:workspaceId/trash/list',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;

    const docs = await DocumentService.getTrash(workspaceId, req.user.id);

    res.json(docs);
  })
);

/**
 * POST /api/documents/:id/restore
 * Restore soft-deleted document
 */
router.post(
  '/:id/restore',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const doc = await DocumentService.restore(id, req.user.id);

    res.json(doc);
  })
);

/**
 * GET /api/documents/:id/versions
 * Get document version history
 */
router.get(
  '/:id/versions',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Get document to verify access
    const doc = await DocumentService.getById(id, req.user.id);

    const versions = await DocumentVersion.find({ document: id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('savedBy', 'username email');

    res.json(versions);
  })
);

/**
 * GET /api/documents/:id/comments
 * Get document comments
 */
router.get(
  '/:id/comments',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Verify access via DocumentService
    await DocumentService.getById(id, req.user.id);

    const comments = await Comment.find({ document: id })
      .sort({ createdAt: -1 })
      .populate('author', 'username email');

    res.json(comments);
  })
);

/**
 * POST /api/documents/:id/comments
 * Create document comment
 */
router.post(
  '/:id/comments',
  authenticateToken,
  validateInput(schemas.createComment),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { body, rangeStart, rangeEnd } = req.body;

    // Verify access
    const doc = await DocumentService.getById(id, req.user.id);

    const comment = await Comment.create({
      workspace: doc.workspace,
      document: id,
      author: req.user.id,
      body,
      rangeStart: rangeStart || 0,
      rangeEnd: rangeEnd || 0
    });
    await comment.populate('author', 'username email');

    res.status(201).json(comment);
  })
);

module.exports = router;
