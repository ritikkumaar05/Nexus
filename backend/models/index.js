/**
 * ============================================================================
 * MONGOOSE SCHEMAS & MODELS
 * ============================================================================
 * Defines the structural blueprints for all collections in our database.
 */

const mongoose = require('mongoose');

// --- USER SCHEMA ---
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, minlength: 3 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  emailVerifiedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

// --- SESSION SCHEMA ---
const SessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tokenVersion: { type: Number, default: 0 },
  revokedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });
SessionSchema.index({ user: 1, revokedAt: 1 });

// --- ACCOUNT TOKEN SCHEMA ---
const AccountTokenSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['email-verification', 'password-reset'], required: true },
  tokenHash: { type: String, required: true, unique: true },
  usedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });
AccountTokenSchema.index({ user: 1, type: 1, usedAt: 1 });

// --- WORKSPACE SCHEMA ---
const WorkspaceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: { type: String, enum: ['admin', 'member', 'viewer'], default: 'member' }
  }]
}, { timestamps: true });
WorkspaceSchema.index({ "members.user": 1 });

// --- CHANNEL SCHEMA ---
const ChannelSchema = new mongoose.Schema({
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, trim: true, lowercase: true },
  description: { type: String, default: '', trim: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  archivedAt: { type: Date, default: null }
}, { timestamps: true });
ChannelSchema.index({ workspace: 1, slug: 1 }, { unique: true });

// --- WORKSPACE INVITATION SCHEMA ---
const WorkspaceInvitationSchema = new mongoose.Schema({
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  email: { type: String, default: '', lowercase: true, trim: true },
  role: { type: String, enum: ['admin', 'member', 'viewer'], default: 'member' },
  tokenHash: { type: String, required: true, unique: true },
  codeHash: { type: String, unique: true, sparse: true },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  expiresAt: { type: Date, required: true },
  acceptedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null }
}, { timestamps: true });
WorkspaceInvitationSchema.index({ workspace: 1, email: 1, acceptedAt: 1, revokedAt: 1 });

// --- DOCUMENT SCHEMA (Pages / Tree Nodes) ---
const DocumentSchema = new mongoose.Schema({
  title: { type: String, default: 'Untitled Page' },
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  parentDocument: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null }, // Allows nested children pages
  binaryUpdate: { type: Buffer, default: null }, // Stores Yjs collaborative editing sync data
  plainTextContent: { type: String, default: '' }, // Cached text for easy full-text searches
  contentHtml: { type: String, default: '' },
  deletedAt: { type: Date, default: null },
  lastEditedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
DocumentSchema.index({ workspace: 1, parentDocument: 1 });
DocumentSchema.index({ title: 'text', plainTextContent: 'text' });

// --- DOCUMENT VERSION SCHEMA ---
const DocumentVersionSchema = new mongoose.Schema({
  document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  title: { type: String, default: 'Untitled Page' },
  plainTextContent: { type: String, default: '' },
  contentHtml: { type: String, default: '' },
  savedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
DocumentVersionSchema.index({ document: 1, createdAt: -1 });

// --- COMMENT SCHEMA ---
const CommentSchema = new mongoose.Schema({
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, required: true, trim: true },
  rangeStart: { type: Number, default: 0 },
  rangeEnd: { type: Number, default: 0 },
  resolvedAt: { type: Date, default: null }
}, { timestamps: true });
CommentSchema.index({ document: 1, resolvedAt: 1, createdAt: -1 });

// --- DOCUMENT TASK SCHEMA ---
const DocumentTaskSchema = new mongoose.Schema({
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  status: { type: String, enum: ['todo', 'in_progress', 'done'], default: 'todo' },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  dueDate: { type: Date, default: null },
  assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  completedAt: { type: Date, default: null }
}, { timestamps: true });
DocumentTaskSchema.index({ workspace: 1, document: 1, createdAt: -1 });
DocumentTaskSchema.index({ assignee: 1 });
DocumentTaskSchema.index({ status: 1 });
DocumentTaskSchema.index({ dueDate: 1 });

// --- STUDY MATERIAL SCHEMA ---
const StudyMaterialSchema = new mongoose.Schema({
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
  type: {
    type: String,
    enum: ['summary', 'quiz', 'flashcards', 'important_questions', 'explanation'],
    required: true
  },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  content: { type: mongoose.Schema.Types.Mixed, required: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  quizProgress: {
    lastScore: { type: Number, default: null },
    totalQuestions: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    weakTopics: [{ type: String, trim: true }],
    lastAttemptAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 }
  },
  flashcardProgress: {
    knownCardIds: [{ type: String, trim: true }],
    hardCardIds: [{ type: String, trim: true }],
    knownCount: { type: Number, default: 0 },
    hardCount: { type: Number, default: 0 },
    lastStudiedAt: { type: Date, default: null }
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
StudyMaterialSchema.index({ workspace: 1, document: 1, updatedAt: -1 });
StudyMaterialSchema.index({ workspace: 1, type: 1, updatedAt: -1 });
StudyMaterialSchema.index({ createdBy: 1, updatedAt: -1 });

// --- ATTACHMENT SCHEMA ---
const AttachmentSchema = new mongoose.Schema({
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  filename: { type: String, required: true, trim: true },
  mimeType: { type: String, default: 'application/octet-stream' },
  size: { type: Number, required: true },
  data: { type: Buffer, required: true },
  deletedAt: { type: Date, default: null }
}, { timestamps: true });
AttachmentSchema.index({ workspace: 1, document: 1, createdAt: -1 });

// --- MESSAGE SCHEMA (WhatsApp-like Chats) ---
const MessageSchema = new mongoose.Schema({
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  channelId: { type: String, required: true }, // Channel groupings (e.g., 'marketing', 'general')
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true, trim: true },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });
MessageSchema.index({ workspace: 1, channelId: 1, createdAt: -1 }); // Multi-key index for fast history retrieval
MessageSchema.index({ content: 'text' });

// --- DOCUMENT MESSAGE SCHEMA ---
const DocumentMessageSchema = new mongoose.Schema({
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  parentMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentMessage', default: null },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, required: true, trim: true },
  linkedText: { type: String, default: '', trim: true },
  status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  reactions: [{
    emoji: { type: String, required: true, trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  editedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null }
}, { timestamps: true });
DocumentMessageSchema.index({ workspace: 1, document: 1, createdAt: -1 });
DocumentMessageSchema.index({ workspace: 1, document: 1, status: 1, createdAt: -1 });
DocumentMessageSchema.index({ parentMessage: 1, createdAt: 1 });
DocumentMessageSchema.index({ sender: 1 });
DocumentMessageSchema.index({ body: 'text' });

// --- AUDIT LOG SCHEMA ---
const AuditLogSchema = new mongoose.Schema({
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  action: { type: String, required: true },
  targetType: { type: String, default: '' },
  targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
  metadata: { type: Object, default: {} }
}, { timestamps: true });
AuditLogSchema.index({ workspace: 1, createdAt: -1 });

module.exports = {
  AccountToken: mongoose.model('AccountToken', AccountTokenSchema),
  Attachment: mongoose.model('Attachment', AttachmentSchema),
  AuditLog: mongoose.model('AuditLog', AuditLogSchema),
  Comment: mongoose.model('Comment', CommentSchema),
  DocumentVersion: mongoose.model('DocumentVersion', DocumentVersionSchema),
  Session: mongoose.model('Session', SessionSchema),
  User: mongoose.model('User', UserSchema),
  Workspace: mongoose.model('Workspace', WorkspaceSchema),
  Channel: mongoose.model('Channel', ChannelSchema),
  WorkspaceInvitation: mongoose.model('WorkspaceInvitation', WorkspaceInvitationSchema),
  Document: mongoose.model('Document', DocumentSchema),
  DocumentMessage: mongoose.model('DocumentMessage', DocumentMessageSchema),
  DocumentTask: mongoose.model('DocumentTask', DocumentTaskSchema),
  StudyMaterial: mongoose.model('StudyMaterial', StudyMaterialSchema),
  Message: mongoose.model('Message', MessageSchema)
};
