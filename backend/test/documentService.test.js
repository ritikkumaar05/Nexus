const test = require('node:test');
const assert = require('node:assert/strict');
const DocumentService = require('../services/DocumentService');
const { AuditLog, Document, DocumentVersion, Workspace } = require('../models');
const { AuthorizationError } = require('../utils/AppError');

const originalMethods = {
  auditCreate: AuditLog.create,
  documentFindOne: Document.findOne,
  documentFindByIdAndUpdate: Document.findByIdAndUpdate,
  documentVersionCreate: DocumentVersion.create,
  workspaceFindOne: Workspace.findOne
};

const restoreModelMethods = () => {
  AuditLog.create = originalMethods.auditCreate;
  Document.findOne = originalMethods.documentFindOne;
  Document.findByIdAndUpdate = originalMethods.documentFindByIdAndUpdate;
  DocumentVersion.create = originalMethods.documentVersionCreate;
  Workspace.findOne = originalMethods.workspaceFindOne;
};

test.afterEach(restoreModelMethods);

test('DocumentService.update persists plainTextContent from REST saves', async () => {
  const userId = '507f1f77bcf86cd799439011';
  const workspaceId = '507f1f77bcf86cd799439012';
  const documentId = '507f1f77bcf86cd799439013';
  const nextContent = 'Saved body even when Socket.IO is offline';
  let updatePatch = null;

  AuditLog.create = async () => ({});
  Document.findOne = async () => ({
    _id: documentId,
    workspace: workspaceId,
    title: 'Old title',
    plainTextContent: '',
    contentHtml: '',
    binaryUpdate: null
  });
  Workspace.findOne = async () => ({
    _id: workspaceId,
    members: [{ user: userId, role: 'member' }]
  });
  Document.findByIdAndUpdate = async (_id, patch) => {
    updatePatch = patch;
    return {
      _id,
      workspace: workspaceId,
      title: patch.$set.title,
      plainTextContent: patch.$set.plainTextContent,
      contentHtml: '',
      binaryUpdate: null
    };
  };
  DocumentVersion.create = async (snapshot) => snapshot;

  const updated = await DocumentService.update(documentId, {
    title: 'REST saved',
    plainTextContent: nextContent
  }, userId);

  assert.equal(updatePatch.$set.plainTextContent, nextContent);
  assert.equal(updatePatch.$set.lastEditedBy, userId);
  assert.equal(updated.plainTextContent, nextContent);
});

test('DocumentService.update blocks viewers from editing documents', async () => {
  const userId = '507f1f77bcf86cd799439011';
  const workspaceId = '507f1f77bcf86cd799439012';
  const documentId = '507f1f77bcf86cd799439013';

  Document.findOne = async () => ({ _id: documentId, workspace: workspaceId });
  Workspace.findOne = async () => ({
    _id: workspaceId,
    members: [{ user: userId, role: 'viewer' }]
  });

  await assert.rejects(
    () => DocumentService.update(documentId, { plainTextContent: 'blocked' }, userId),
    AuthorizationError
  );
});
