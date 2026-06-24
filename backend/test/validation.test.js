const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isNonEmptyString,
  isValidBase64,
  normalizeString
} = require('../utils/validation');
const { schemas } = require('../middleware/validateInput');

test('normalizeString trims strings and treats non-strings as empty', () => {
  assert.equal(normalizeString('  hello  '), 'hello');
  assert.equal(normalizeString(null), '');
  assert.equal(normalizeString(42), '');
});

test('isNonEmptyString requires trimmed content', () => {
  assert.equal(isNonEmptyString('value'), true);
  assert.equal(isNonEmptyString('   '), false);
  assert.equal(isNonEmptyString(undefined), false);
});

test('isValidBase64 accepts exact base64 encoded payloads', () => {
  const encoded = Buffer.from('hello').toString('base64');

  assert.equal(isValidBase64(encoded), true);
  assert.equal(isValidBase64('not base64'), false);
  assert.equal(isValidBase64(''), false);
});

test('document update schema accepts frontend REST save payloads', () => {
  const parsed = schemas.updateDocument.parse({
    title: 'Lecture notes',
    plainTextContent: 'Saved without socket transport'
  });

  assert.deepEqual(parsed, {
    title: 'Lecture notes',
    plainTextContent: 'Saved without socket transport'
  });
});

test('document update schema accepts Yjs binary updates and reparenting', () => {
  const binaryUpdateBase64 = Buffer.from('hello').toString('base64');
  const parentDocumentId = '507f1f77bcf86cd799439011';

  const parsed = schemas.updateDocument.parse({
    binaryUpdateBase64,
    parentDocumentId
  });

  assert.deepEqual(parsed, {
    binaryUpdateBase64,
    parentDocumentId
  });
});

test('document update schema rejects empty updates', () => {
  assert.throws(
    () => schemas.updateDocument.parse({}),
    /At least one document field must be provided/
  );
});

test('createTask schema accepts valid task creation payload', () => {
  const parsed = schemas.createTask.parse({
    title: 'Complete final year project',
    priority: 'high',
    dueDate: '2026-06-20T12:00:00.000Z',
    assignee: '507f1f77bcf86cd799439011'
  });
  assert.equal(parsed.title, 'Complete final year project');
  assert.equal(parsed.priority, 'high');
  assert.equal(parsed.assignee, '507f1f77bcf86cd799439011');
});

test('createTask schema accepts task creation with empty dueDate and null assignee', () => {
  const parsed = schemas.createTask.parse({
    title: 'Sync with supervisor',
    dueDate: '',
    assignee: null
  });
  assert.equal(parsed.title, 'Sync with supervisor');
  assert.equal(parsed.dueDate, '');
  assert.equal(parsed.assignee, null);
});

test('createInvitation schema accepts invitation without workspaceId', () => {
  const parsed = schemas.createInvitation.parse({
    email: 'test@example.com',
    role: 'member'
  });
  assert.equal(parsed.email, 'test@example.com');
  assert.equal(parsed.role, 'member');
});

test('updateStudyMaterialProgress schema accepts quiz and flashcard progress update payload', () => {
  const parsed = schemas.updateStudyMaterialProgress.parse({
    quizProgress: {
      lastScore: 85,
      totalQuestions: 10,
      correctCount: 8,
      weakTopics: ['CAP Theorem', 'Paxos']
    },
    flashcardProgress: {
      knownCardIds: ['card-1', 'card-2'],
      hardCardIds: ['card-3']
    }
  });
  assert.equal(parsed.quizProgress.lastScore, 85);
  assert.deepEqual(parsed.flashcardProgress.knownCardIds, ['card-1', 'card-2']);
});

test('normalizeError converts ZodError to ValidationError', () => {
  const { normalizeError, ValidationError } = require('../utils/AppError');
  const { z } = require('zod');
  const schema = z.object({ age: z.number() });
  const result = schema.safeParse({ age: 'not a number' });
  
  const normalized = normalizeError(result.error);
  assert.equal(normalized instanceof ValidationError, true);
  assert.equal(normalized.statusCode, 400);
});

test('createComment schema validates body and range bounds', () => {
  const parsed = schemas.createComment.parse({
    body: 'Great lecture notes on CAP Theorem',
    rangeStart: 10,
    rangeEnd: 25
  });
  assert.equal(parsed.body, 'Great lecture notes on CAP Theorem');
  assert.equal(parsed.rangeStart, 10);
  assert.equal(parsed.rangeEnd, 25);
});

test('createComment schema rejects empty comments', () => {
  assert.throws(
    () => schemas.createComment.parse({ body: '' }),
    /Comment body is required/
  );
});


