# Architecture & Design

## Project Overview

**Unified Workspace** is a collaborative study platform that enables teams to:
- Create shared workspaces with role-based access control
- Build hierarchical document structures (like Notion)
- Communicate via channels and direct messages
- Manage tasks and due dates
- Generate AI-powered study materials (summaries, quizzes, flashcards)
- Edit documents in real-time with live collaboration features

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     FRONTEND (Vite SPA)                         │
│                  (localhost:5173)                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  React Components (Workspaces, Documents, Chat, Tasks)   │  │
│  │  Socket.IO Client (Real-time updates, Presence)          │  │
│  │  Yjs Client (Local collaborative editing)                │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────┬──────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        │ HTTP (REST)       │ WebSocket         │
        │                   │ (Socket.IO)       │
        ▼                   ▼                   ▼
┌──────────────────────────────────────────────────────┐
│            BACKEND (Express + Node.js)               │
│          (localhost:5000)                            │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │  MIDDLEWARE LAYER                             │ │
│  │  ├─ Auth (JWT verification)                   │ │
│  │  ├─ Validation (Input sanitization)           │ │
│  │  ├─ Rate Limiting                             │ │
│  │  ├─ Permission Checks (RBAC)                  │ │
│  │  └─ Error Handling                            │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │  ROUTE HANDLERS                               │ │
│  │  ├─ /auth (register, login, logout)           │ │
│  │  ├─ /workspaces (CRUD, members)               │ │
│  │  ├─ /documents (CRUD, hierarchy)              │ │
│  │  ├─ /channels (CRUD)                          │ │
│  │  ├─ /messages (chat)                          │ │
│  │  ├─ /tasks (todo management)                  │ │
│  │  ├─ /study-materials (AI generation)          │ │
│  │  ├─ /search (full-text)                       │ │
│  │  ├─ /audit (activity logs)                    │ │
│  │  └─ /invites (workspace invitations)          │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │  SERVICE LAYER (to be refactored)             │ │
│  │  ├─ DocumentService (CRUD, hierarchy, sync)   │ │
│  │  ├─ WorkspaceService (members, roles)         │ │
│  │  ├─ AuthService (register, login, tokens)     │ │
│  │  ├─ TaskService (CRUD, assignment)            │ │
│  │  └─ AIService (Gemini API integration)        │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │  SOCKET.IO HANDLERS (Real-time)               │ │
│  │  ├─ Document Editing (Yjs sync)               │ │
│  │  ├─ Presence (Cursors, selections)            │ │
│  │  ├─ Chat (Live messages)                      │ │
│  │  └─ Notifications                             │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │  UTILITIES                                     │ │
│  │  ├─ validation.js (Input sanitization)        │ │
│  │  ├─ permissions.js (RBAC logic)               │ │
│  │  ├─ audit.js (Activity logging)               │ │
│  │  └─ constants.js (Magic numbers)              │ │
│  └────────────────────────────────────────────────┘ │
└──────────────────────────┬───────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────┐
        │   MONGODB (Database)             │
        │   ├─ Users                       │
        │   ├─ Workspaces                  │
        │   ├─ Documents + DocumentVersion │
        │   ├─ Channels                    │
        │   ├─ Messages                    │
        │   ├─ Tasks                       │
        │   ├─ StudyMaterials             │
        │   ├─ Comments                    │
        │   ├─ WorkspaceInvitations       │
        │   ├─ AuditLogs                   │
        │   ├─ Sessions                    │
        │   └─ AccountTokens              │
        └──────────────────────────────────┘
```

---

## Data Model

### Entity-Relationship Diagram

```
User
├── owns: Workspace (1:M)
├── memberOf: Workspace (M:M via members array)
├── creates: Document (1:M)
├── sends: Message (1:M)
├── creates: Channel (1:M)
├── assigned: Task (1:M)
└── sessions: Session (1:M)

Workspace
├── owner: User
├── members: User[] (with roles: admin, member, viewer)
├── documents: Document[] (1:M)
├── channels: Channel[] (1:M)
├── messages: Message[] (1:M)
├── tasks: Task[] (1:M)
├── studyMaterials: StudyMaterial[] (1:M)
└── invitations: WorkspaceInvitation[] (1:M)

Document
├── workspace: Workspace
├── createdBy: User
├── parent: Document (self-referential, can be null for root docs)
├── children: Document[] (self-referential)
├── comments: Comment[] (on text ranges)
├── tasks: Task[] (1:M)
├── versions: DocumentVersion[] (1:M)
├── studyMaterials: StudyMaterial[] (1:M)
└── content: Yjs encoded binary

Channel
├── workspace: Workspace
├── createdBy: User
├── messages: Message[] (1:M)
└── archived: boolean

Message
├── workspace: Workspace
├── channelId: string (slug)
├── sender: User
└── attachments: Attachment[]

Task
├── workspace: Workspace
├── document: Document
├── createdBy: User
├── assignedTo: User (optional)
└── status: enum (todo, in_progress, done)

StudyMaterial
├── workspace: Workspace
├── document: Document
├── type: enum (summary, quiz, flashcards, important_questions, explanation)
├── createdBy: User
└── content: string (generated by AI)

Comment
├── document: Document
├── author: User
├── textRange: { start: number, end: number }
└── thread: Comment[]

WorkspaceInvitation
├── workspace: Workspace
├── invitedBy: User
├── email: string
├── role: enum (admin, member, viewer)
└── token: hashed, expiresAt

AuditLog
├── workspace: Workspace
├── userId: User
├── action: enum (document_created, member_added, etc.)
├── resourceType: enum (document, channel, task, etc.)
├── resourceId: ObjectId
└── timestamp: Date
```

### Collections & Indexes

```javascript
// User
db.users.createIndex({ email: 1 }, { unique: true })
db.users.createIndex({ username: 1 })

// Workspace
db.workspaces.createIndex({ owner: 1 })
db.workspaces.createIndex({ "members.user": 1 })

// Document
db.documents.createIndex({ workspace: 1 })
db.documents.createIndex({ parentDocument: 1 })
db.documents.createIndex({ workspace: 1, parentDocument: 1 })
db.documents.createIndex({ "plainTextContent": "text", title: "text" })

// Channel
db.channels.createIndex({ workspace: 1 })
db.channels.createIndex({ workspace: 1, slug: 1 }, { unique: true })

// Message
db.messages.createIndex({ workspace: 1, channelId: 1 })
db.messages.createIndex({ "content": "text" })

// Task
db.tasks.createIndex({ workspace: 1 })
db.tasks.createIndex({ document: 1 })
db.tasks.createIndex({ assignedTo: 1 })

// StudyMaterial
db.studyMaterials.createIndex({ workspace: 1 })
db.studyMaterials.createIndex({ document: 1 })
db.studyMaterials.createIndex({ type: 1 })

// AuditLog
db.auditlogs.createIndex({ workspace: 1 })
db.auditlogs.createIndex({ userId: 1 })
db.auditlogs.createIndex({ timestamp: -1 })

// Session
db.sessions.createIndex({ user: 1 })
db.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
```

---

## Permission Model (RBAC)

### Workspace Roles

```
┌─────────────────────────────────────────────────┐
│               ROLE HIERARCHY                    │
│                                                 │
│  ADMIN (Level 3)                               │
│    ├─ Create/read/update/delete documents     │
│    ├─ Create/delete channels                  │
│    ├─ Manage members (add, remove, change role)│
│    ├─ Create workspace invitations            │
│    ├─ Create/view audit logs                  │
│    ├─ Create tasks and assign to others       │
│    └─ Delete workspace                        │
│                                                │
│  MEMBER (Level 2)                             │
│    ├─ Create/read/update/delete own documents│
│    ├─ Create/delete own channels              │
│    ├─ Read other members' documents           │
│    ├─ Chat in channels                        │
│    ├─ Create tasks and assign to self         │
│    └─ Create/view study materials             │
│                                                │
│  VIEWER (Level 1)                             │
│    ├─ Read-only access to documents           │
│    ├─ Read channels (cannot post)             │
│    ├─ Cannot create tasks or documents        │
│    └─ Cannot create study materials           │
│                                                │
└─────────────────────────────────────────────────┘
```

### Permission Checks

```javascript
// Check user role in workspace
canManageWorkspace(workspace, userId) {
  const member = workspace.members.find(m => m.user.equals(userId))
  return member?.role === 'admin'
}

// Check document edit access
canEditWorkspaceContent(workspace, userId) {
  const member = workspace.members.find(m => m.user.equals(userId))
  return ['admin', 'member'].includes(member?.role)
}

// Check chat access
canChatInWorkspace(workspace, userId) {
  const member = workspace.members.find(m => m.user.equals(userId))
  return member?.role && member.role !== 'viewer'
}

// Check view access
canViewWorkspace(workspace, userId) {
  return workspace.members.some(m => m.user.equals(userId))
}
```

### Inherited Permissions

- **Document permissions** inherit from workspace
- **Channel permissions** inherit from workspace
- **Comment/Task permissions** inherit from document
- **Study material access** requires document access

---

## Real-Time Collaboration Flow

### 1. Document Editing (Yjs + Socket.IO)

```
┌──────────────────────────────────────────────────────────┐
│               COLLABORATIVE EDITING FLOW                 │
│                                                          │
│  User A's Client              Server                    User B's Client
│         │                        │                             │
│         ├─ Join Room ─────────>  │  <─────── Join Room ────────┤
│         │                        │                             │
│         ├─ Yjs Update ─────────> │ Merge & Broadcast ─────────>│
│         │  (char inserted       │                             │
│         │   at position 50)     │   Yjs Update               │
│         │                        │  (same position)           │
│         ├─ Presence Update ───> │  <────────────────────────│
│         │  (cursor: 52)         │                             │
│         │                        │   Presence Update           │
│         │                        │  (cursor: 100)             │
│         │                        ├─ Persist to DB             │
│         │  Update Event         │                             │
│         │  <─────────────────────┤                             │
│         │                        │                             │
│         └─ Disconnect ────────>  │  <─ Wait for Reconnect ────┐
│            (auto-saves locally)  │                             │
│                                  │  Reconnect after 5s         │
│         ┌─ Reconnect ───────────>│ <────────────────────────┘
│         │                        │                             │
│         │  Recover Pending Ops   │                             │
│         │  <─────────────────────┤                             │
│         │                        │                             │
└──────────────────────────────────────────────────────────┘
```

### 2. Real-Time Event Flow

```javascript
// Client Connect
socket.emit('auth', { token: 'JWT_TOKEN' })
socket.on('authenticated', () => {
  // User verified, now join document rooms
  socket.emit('join-editor', { documentId: 'doc123' })
})

// Document Update
socket.on('document-update', (update) => {
  // Yjs binary update
  Y.applyUpdate(ydoc, update)
  // Merge into local document state
})

// Presence (Cursor Position)
socket.emit('presence', {
  documentId: 'doc123',
  userId: 'user456',
  cursorPosition: 150,
  selection: { start: 120, end: 180 }
})

socket.on('presence-update', (presence) => {
  // Update UI with other users' cursor positions
  renderCursor(presence.userId, presence.cursorPosition)
})

// Chat Message
socket.emit('chat-message', { 
  workspaceId: 'ws123',
  channelId: 'general',
  content: 'Hello team!'
})

socket.on('chat-message', (message) => {
  // Add to chat history
  addMessageToUI(message)
})

// Disconnect & Reconnect
socket.on('disconnect', () => {
  // Client attempts reconnect with exponential backoff
  // Server maintains room subscriptions for 30s grace period
})

socket.on('reconnect', () => {
  // Recover pending updates from server
  socket.emit('recover-ops', { documentId: 'doc123', lastVersion: 5 })
})
```

---

## Service Layer (Current & Planned)

### Existing Services

#### AuthService (Planned)
```javascript
// Location: backend/services/AuthService.js
class AuthService {
  async register(email, password, username)
  async login(email, password)
  async refreshToken(refreshToken)
  async validatePassword(plaintext, hash)
  async hashPassword(plaintext)
  async logout(sessionId)
}
```

#### AIService (Existing)
```javascript
// Location: backend/services/aiService.js
class AIService {
  async generateSummary(text)
  async generateQuiz(text)
  async generateFlashcards(text)
  async generateExplanation(text)
  async generateImportantQuestions(text)
  // Retry logic with exponential backoff (up to 5 attempts)
}
```

### Services to Extract

#### DocumentService (Planned)
```javascript
class DocumentService {
  // CRUD
  async create(workspaceId, title, parentId, userId)
  async getById(documentId, userId) // with permission check
  async update(documentId, title, content, userId)
  async delete(documentId, userId) // soft delete, recursive
  
  // Hierarchy
  async getHierarchy(workspaceId, userId)
  async detectCycle(parentId, childId)
  async getNestedChildren(documentId)
  
  // Sync
  async saveVersion(documentId, content, userId)
  async getVersionHistory(documentId, userId)
}
```

#### WorkspaceService (Planned)
```javascript
class WorkspaceService {
  // CRUD
  async create(name, ownerId)
  async getById(workspaceId, userId) // with permission check
  async update(workspaceId, updates, userId)
  async delete(workspaceId, userId)
  
  // Members
  async addMember(workspaceId, userId, role)
  async removeMember(workspaceId, userId)
  async updateMemberRole(workspaceId, memberId, newRole)
  async getMembers(workspaceId)
  
  // Invitations
  async createInvitation(workspaceId, email, role, userId)
  async acceptInvitation(token)
  async revokeInvitation(invitationId)
}
```

#### TaskService (Planned)
```javascript
class TaskService {
  async create(workspaceId, documentId, title, userId)
  async getByDocument(documentId)
  async getByWorkspace(workspaceId, filters)
  async update(taskId, updates, userId)
  async assign(taskId, assigneeId)
  async changeStatus(taskId, status)
  async delete(taskId, userId)
}
```

#### SearchService (Planned)
```javascript
class SearchService {
  async searchDocuments(workspaceId, query, userId)
  async searchMessages(workspaceId, query, userId)
  async searchTasks(workspaceId, query, userId)
  async fullTextSearch(workspaceId, query, userId)
}
```

---

## Middleware Architecture

### Current Middleware

```
Request Flow:
  1. Helmet (security headers)
  2. CORS (cross-origin requests)
  3. Body Parser (JSON)
  4. Rate Limiting (global)
  5. Logging
  6. Route Handler ← may include auth, validation, permission checks
  7. Error Handler
```

### Planned Middleware

```
Request Flow (After Refactoring):
  1. Helmet (security headers)
  2. CORS
  3. Body Parser
  4. Logging
  5. Global Rate Limiting
  6. Route (e.g., POST /documents)
     a. authenticateToken (JWT verification)
     b. validateInput ({ workspaceId, title, ... })
     c. checkPermission ('member')
     d. Route Handler (business logic only)
  7. Error Handler (catch & format errors)
```

### Middleware Composition Example

```javascript
// Before refactoring:
router.post('/:workspaceId', authenticateToken, async (req, res) => {
  // 50 lines: validation, permission checks, business logic
})

// After refactoring:
router.post(
  '/:workspaceId',
  authenticateToken,
  validateInput({ workspaceId: 'objectId', name: 'string:1-80' }),
  requirePermission('member'),
  async (req, res) => {
    // 10 lines: call service, respond
  }
)
```

---

## Error Handling Architecture

### Error Hierarchy (Planned)

```javascript
// Base error class
class AppError extends Error {
  constructor(message, statusCode, code) {
    this.statusCode = statusCode
    this.code = code
  }
}

// Specific error types
class AuthenticationError extends AppError { statusCode = 401 }
class AuthorizationError extends AppError { statusCode = 403 }
class ValidationError extends AppError { statusCode = 400 }
class NotFoundError extends AppError { statusCode = 404 }
class ConflictError extends AppError { statusCode = 409 }
class InternalError extends AppError { statusCode = 500 }
class RateLimitError extends AppError { statusCode = 429 }
```

### Error Response Format

```javascript
{
  error: "Human-readable message",
  code: "VALIDATION_ERROR",
  statusCode: 400,
  timestamp: "2026-06-19T10:00:00Z",
  details: { field: "email", reason: "Invalid format" } // optional
}
```

---

## Database Transactions

### Critical Operations (should be atomic)

1. **Member invitation → acceptance** (remove invitation, add member)
2. **Document deletion** (mark as deleted, cascade to comments/tasks)
3. **Workspace removal** (remove all documents, channels, tasks, members)
4. **Document move/reparent** (update parent, check cycle)

### Soft Delete Strategy

- All deletions are soft deletes (mark with `deletedAt` timestamp)
- Queries filter out deleted records: `.find({ deletedAt: null })`
- Enables recovery and audit trails
- Hard delete only on user request with retention period

---

## Caching Strategy (Future)

```
// Query caching with Redis (future)
┌─ Workspace members (TTL: 5 min)
├─ Document hierarchy (TTL: 1 min)
├─ Channel list (TTL: 2 min)
└─ User permissions (TTL: 30 min)

Invalidation triggers:
  - Member added/removed: clear workspace members cache
  - Document created/moved: clear workspace hierarchy cache
  - Channel created/archived: clear channel list cache
```

---

## Deployment & Environment

### Environment Variables

```bash
# Server
NODE_ENV=production
PORT=5000

# Database
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/db

# Auth
JWT_SECRET=your_secret_key
JWT_EXPIRES_IN=15m
SESSION_TTL_DAYS=14

# AI Service
GOOGLE_API_KEY=your_api_key
AI_MODEL=gemini-pro

# Invitations
INVITE_TTL_DAYS=7

# CORS
ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com

# Logging
LOG_LEVEL=info
```

### Deployment Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use strong `JWT_SECRET` (64+ chars)
- [ ] Enable HTTPS/TLS
- [ ] Set `ALLOWED_ORIGINS` to frontend domain
- [ ] Configure MongoDB with authentication
- [ ] Set up backup strategy
- [ ] Configure logging (Winston or similar)
- [ ] Set up monitoring/alerting
- [ ] Enable rate limiting
- [ ] Configure CORS properly

---

## Testing Strategy

### Unit Tests
- Validation functions
- Permission checks
- Service methods (with mocked DB)

### Integration Tests
- Full route workflows (request → response)
- Database state changes
- Permission enforcement

### Real-Time Tests
- Socket.IO authentication
- Document sync (Yjs updates)
- Presence synchronization
- Reconnection recovery

### End-to-End Tests
- User registration → workspace creation → document editing
- Multi-user collaboration
- Invite workflow

---

## Performance Considerations

### Database Queries
- Always use `.select()` to limit returned fields
- Use `.lean()` for read-only queries
- Index frequently filtered fields
- Paginate large result sets

### Real-Time Sync
- Yjs updates are binary (small payloads)
- Presence updates throttled (100ms minimum)
- Document persistence debounced (5s after last edit)

### API Response Times
- Target: <200ms for read operations
- Target: <500ms for write operations
- Monitor with APM tools

### Scaling Considerations
- Use connection pooling for MongoDB
- Implement caching layer (Redis)
- Horizontal scaling: stateless API servers + sticky sessions for Socket.IO
- Database sharding: by workspace ID (future)

---

## Security Considerations

### Authentication
- Passwords hashed with bcryptjs (10 salt rounds)
- JWT tokens signed with strong secret
- Refresh tokens stored in database (revocable)
- Session tokens rotated on refresh

### Authorization
- All endpoints check workspace membership
- Permission checks enforce role hierarchy
- Soft deletes prevent data exposure
- Audit logs track all changes

### Input Validation
- All inputs sanitized and validated
- Email validated (RFC 5322 compliance recommended)
- Document content size limits
- Rate limiting on sensitive endpoints

### Network Security
- HTTPS/TLS required in production
- CORS properly configured
- Helmet.js for security headers
- No sensitive data in logs or errors

---

## Future Enhancements

1. **Offline-First Mobile App** — Sync changes when online
2. **Activity Notifications** — Real-time alerts for mentions, assignments
3. **Document Templates** — Quick-start document structures
4. **Integration Marketplace** — Connect to Slack, Notion, Google Drive
5. **Advanced Analytics** — Usage insights, document engagement
6. **Roles & Permissions** — Custom roles with granular permissions
7. **Full-Text Search Improvements** — Elasticsearch integration
8. **Document Versioning UI** — Timeline and diff viewer
9. **Mobile App** — Native iOS/Android clients
10. **API Rate Limit Tiering** — Freemium pricing model
