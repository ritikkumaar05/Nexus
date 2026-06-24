# API Documentation

## Overview

This is a collaborative study platform with real-time editing, task management, and AI-powered study materials. The API provides REST endpoints for managing workspaces, documents, channels, messages, tasks, and study materials.

**Base URL:** `http://localhost:5000/api`  
**Real-time:** WebSocket at `ws://localhost:5000/socket.io`

---

## Authentication

All endpoints (except `/auth/register` and `/auth/login`) require a valid JWT token in the `Authorization` header:

```
Authorization: Bearer <JWT_TOKEN>
```

### Token Payload

```json
{
  "id": "user_id",
  "email": "user@example.com",
  "sessionId": "session_id",
  "tokenVersion": 1
}
```

**Token TTL:** 15 minutes (configurable via `JWT_EXPIRES_IN` env var)  
**Session TTL:** 14 days (configurable via `SESSION_TTL_DAYS` env var)

---

## Endpoints

### Authentication (`/auth`)

#### 1. Register User
```
POST /auth/register
```

**Description:** Create a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "username": "john_doe"
}
```

**Response (201 Created):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "session_id_as_refresh_token",
  "user": {
    "id": "user_id",
    "username": "john_doe",
    "email": "user@example.com",
    "createdAt": "2026-06-19T10:00:00Z"
  }
}
```

**Error Responses:**
- `400 Bad Request` — Missing fields, invalid email, password too short
- `409 Conflict` — Email already exists

**Rate Limit:** 20 requests per 15 minutes

---

#### 2. Login
```
POST /auth/login
```

**Description:** Authenticate user and receive JWT token.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response (200 OK):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "session_id",
  "user": {
    "id": "user_id",
    "username": "john_doe",
    "email": "user@example.com"
  }
}
```

**Error Responses:**
- `400 Bad Request` — Missing fields
- `401 Unauthorized` — Invalid credentials

**Rate Limit:** 20 requests per 15 minutes

---

#### 3. Refresh Token
```
POST /auth/refresh
```

**Description:** Exchange refresh token for new access token.

**Request Body:**
```json
{
  "refreshToken": "session_id"
}
```

**Response (200 OK):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "session_id"
}
```

**Error Responses:**
- `401 Unauthorized` — Invalid or expired refresh token

---

#### 4. Logout
```
POST /auth/logout
```

**Description:** Invalidate the current session.

**Response (200 OK):**
```json
{
  "message": "Logged out successfully"
}
```

**Authentication:** Required

---

### Workspaces (`/workspaces`)

#### 5. Create Workspace
```
POST /workspaces
```

**Description:** Create a new workspace. Creator becomes admin.

**Request Body:**
```json
{
  "name": "Study Group 2026"
}
```

**Response (201 Created):**
```json
{
  "_id": "workspace_id",
  "name": "Study Group 2026",
  "owner": { "id": "user_id", "username": "john_doe" },
  "members": [
    { "user": { "id": "user_id", "username": "john_doe" }, "role": "admin" }
  ],
  "createdAt": "2026-06-19T10:00:00Z",
  "updatedAt": "2026-06-19T10:00:00Z"
}
```

**Authentication:** Required

---

#### 6. Get All My Workspaces
```
GET /workspaces
```

**Description:** Retrieve all workspaces the user is a member of.

**Response (200 OK):**
```json
[
  {
    "_id": "workspace_id",
    "name": "Study Group 2026",
    "owner": { "id": "owner_id", "username": "admin_user" },
    "members": [
      { "user": { "id": "user_id", "username": "john_doe" }, "role": "member" }
    ],
    "createdAt": "2026-06-19T10:00:00Z"
  }
]
```

**Authentication:** Required

---

#### 7. Get Workspace by ID
```
GET /workspaces/:workspaceId
```

**Description:** Retrieve a specific workspace (must be a member).

**Response (200 OK):**
```json
{
  "_id": "workspace_id",
  "name": "Study Group 2026",
  "owner": { "id": "owner_id", "username": "admin_user" },
  "members": [...]
}
```

**Error Responses:**
- `404 Not Found` — Workspace doesn't exist
- `403 Forbidden` — Not a member

**Authentication:** Required

---

#### 8. Update Workspace
```
PUT /workspaces/:workspaceId
```

**Description:** Update workspace name (admin only).

**Request Body:**
```json
{
  "name": "Updated Workspace Name"
}
```

**Response (200 OK):** Updated workspace object

**Authentication:** Required (admin role)

---

#### 9. Add Member to Workspace
```
POST /workspaces/:workspaceId/members
```

**Description:** Add a user to workspace (via existing user ID or email invite).

**Request Body (by ID):**
```json
{
  "userId": "new_user_id",
  "role": "member"
}
```

**Request Body (by email invite):**
```json
{
  "email": "newuser@example.com",
  "role": "member"
}
```

**Response (201 Created):** Updated workspace or invitation

**Authentication:** Required (admin role)

---

#### 10. Update Member Role
```
PUT /workspaces/:workspaceId/members/:memberId
```

**Description:** Change member's role (admin only).

**Request Body:**
```json
{
  "role": "admin"
}
```

**Response (200 OK):** Updated member object

**Authentication:** Required (admin role)

---

#### 11. Remove Member
```
DELETE /workspaces/:workspaceId/members/:memberId
```

**Description:** Remove user from workspace (admin only).

**Response (200 OK):**
```json
{
  "message": "Member removed successfully"
}
```

**Authentication:** Required (admin role)

---

### Documents (`/documents`)

#### 12. Create Document
```
POST /documents
```

**Description:** Create a document in workspace (optionally nested under parent).

**Request Body:**
```json
{
  "workspaceId": "workspace_id",
  "title": "My Document",
  "parentDocumentId": "parent_id_or_null"
}
```

**Response (201 Created):**
```json
{
  "_id": "document_id",
  "title": "My Document",
  "workspace": "workspace_id",
  "parentDocument": null,
  "content": { "yText": "..." },
  "createdAt": "2026-06-19T10:00:00Z",
  "createdBy": "user_id"
}
```

**Error Responses:**
- `400 Bad Request` — Title too long (>120 chars), parent doesn't exist
- `409 Conflict` — Would create circular hierarchy

**Authentication:** Required (member role)

---

#### 13. Get Document
```
GET /documents/:documentId
```

**Description:** Retrieve document content.

**Response (200 OK):**
```json
{
  "_id": "document_id",
  "title": "My Document",
  "content": { "yText": "..." },
  "versions": [...]
}
```

**Authentication:** Required

---

#### 14. Update Document
```
PUT /documents/:documentId
```

**Description:** Update document title or content.

**Request Body:**
```json
{
  "title": "Updated Title",
  "content": "base64_encoded_yjs_content"
}
```

**Response (200 OK):** Updated document

**Authentication:** Required

---

#### 15. Delete Document
```
DELETE /documents/:documentId
```

**Description:** Soft-delete document (marks as deleted, recursive for children).

**Response (200 OK):**
```json
{
  "message": "Document deleted successfully"
}
```

**Authentication:** Required

---

#### 16. Get Document Hierarchy
```
GET /documents/hierarchy/:workspaceId
```

**Description:** Get all documents in workspace organized by parent-child relationships.

**Response (200 OK):**
```json
{
  "documents": [
    {
      "_id": "doc1",
      "title": "Root Doc",
      "children": [
        {
          "_id": "doc2",
          "title": "Sub-Doc",
          "children": []
        }
      ]
    }
  ]
}
```

**Authentication:** Required

---

### Channels (`/channels`)

#### 17. Create Channel
```
POST /channels/:workspaceId
```

**Description:** Create a chat channel in workspace.

**Request Body:**
```json
{
  "name": "General",
  "description": "General discussion",
  "slug": "general"
}
```

**Response (201 Created):**
```json
{
  "_id": "channel_id",
  "name": "General",
  "slug": "general",
  "workspace": "workspace_id",
  "createdBy": "user_id",
  "createdAt": "2026-06-19T10:00:00Z"
}
```

**Error Responses:**
- `400 Bad Request` — Name too long (>80 chars), invalid slug
- `409 Conflict` — Slug already exists in workspace

**Authentication:** Required (member role)

---

#### 18. Get Channels
```
GET /channels/:workspaceId?includeArchived=false
```

**Description:** List all channels in workspace.

**Response (200 OK):**
```json
[
  {
    "_id": "channel_id",
    "name": "General",
    "slug": "general",
    "createdBy": { "username": "john_doe" }
  }
]
```

**Query Parameters:**
- `includeArchived` — Include archived channels (default: false)

**Authentication:** Required

---

#### 19. Get Single Channel
```
GET /channels/:workspaceId/:channelSlug
```

**Description:** Get channel details by slug.

**Response (200 OK):** Channel object

**Authentication:** Required

---

#### 20. Update Channel
```
PUT /channels/:workspaceId/:channelSlug
```

**Description:** Update channel name or description.

**Request Body:**
```json
{
  "name": "New Name",
  "description": "New description"
}
```

**Response (200 OK):** Updated channel

**Authentication:** Required (admin role)

---

#### 21. Archive Channel
```
POST /channels/:workspaceId/:channelSlug/archive
```

**Description:** Archive a channel (soft delete).

**Response (200 OK):** Archived channel

**Authentication:** Required (admin role)

---

### Messages (`/messages`)

#### 22. Send Message
```
POST /messages/:workspaceId/:channelSlug
```

**Description:** Post a chat message (also sent via Socket.IO in real-time).

**Request Body:**
```json
{
  "content": "This is a message"
}
```

**Response (201 Created):**
```json
{
  "_id": "message_id",
  "content": "This is a message",
  "workspace": "workspace_id",
  "channelId": "channel_slug",
  "sender": { "username": "john_doe" },
  "createdAt": "2026-06-19T10:00:00Z"
}
```

**Error Responses:**
- `400 Bad Request` — Content too long (>4000 chars)
- `404 Not Found` — Channel doesn't exist

**Rate Limit:** 120 requests per minute

**Authentication:** Required

---

#### 23. Get Message History
```
GET /messages/:workspaceId/:channelSlug?limit=50&before=<messageId>
```

**Description:** Paginate through channel messages.

**Response (200 OK):**
```json
[
  {
    "_id": "message_id",
    "content": "Previous message",
    "sender": { "username": "john_doe" },
    "createdAt": "2026-06-19T09:00:00Z"
  }
]
```

**Query Parameters:**
- `limit` — Number of messages (default: 50, max: 100)
- `before` — Message ID cursor for pagination

**Authentication:** Required

---

#### 24. Update Message
```
PUT /messages/:workspaceId/:messageId
```

**Description:** Edit a message (only sender can edit).

**Request Body:**
```json
{
  "content": "Edited message content"
}
```

**Response (200 OK):** Updated message

**Authentication:** Required

---

#### 25. Delete Message
```
DELETE /messages/:workspaceId/:messageId
```

**Description:** Soft-delete a message.

**Response (200 OK):**
```json
{
  "message": "Message deleted successfully"
}
```

**Authentication:** Required

---

### Tasks (`/tasks`)

#### 26. Create Task
```
POST /tasks
```

**Description:** Create a task on a document.

**Request Body:**
```json
{
  "workspaceId": "workspace_id",
  "documentId": "document_id",
  "title": "Task title",
  "description": "Task description",
  "priority": "high",
  "dueDate": "2026-07-19T10:00:00Z",
  "assignedTo": "user_id"
}
```

**Response (201 Created):**
```json
{
  "_id": "task_id",
  "title": "Task title",
  "status": "todo",
  "priority": "high",
  "dueDate": "2026-07-19T10:00:00Z",
  "createdBy": "user_id"
}
```

**Authentication:** Required

---

#### 27. Get Tasks
```
GET /tasks/:workspaceId?documentId=<docId>&status=<status>&assignedTo=<userId>
```

**Description:** List tasks with optional filtering.

**Response (200 OK):** Array of task objects

**Query Parameters:**
- `documentId` — Filter by document
- `status` — Filter by status (todo, in_progress, done)
- `assignedTo` — Filter by assignee

**Authentication:** Required

---

#### 28. Update Task
```
PUT /tasks/:taskId
```

**Description:** Update task fields (title, status, priority, dueDate, assignedTo).

**Request Body:**
```json
{
  "status": "in_progress",
  "priority": "medium"
}
```

**Response (200 OK):** Updated task

**Authentication:** Required

---

#### 29. Delete Task
```
DELETE /tasks/:taskId
```

**Description:** Delete a task.

**Response (200 OK):**
```json
{
  "message": "Task deleted successfully"
}
```

**Authentication:** Required

---

### Study Materials (`/study-materials`)

#### 30. Create Study Material
```
POST /study-materials
```

**Description:** Generate AI-powered study material (summary, quiz, flashcards, etc.).

**Request Body:**
```json
{
  "workspaceId": "workspace_id",
  "documentId": "document_id",
  "type": "summary",
  "title": "Chapter 1 Summary"
}
```

**Response (201 Created):**
```json
{
  "_id": "material_id",
  "type": "summary",
  "title": "Chapter 1 Summary",
  "content": "Generated summary content...",
  "metadata": {}
}
```

**Error Responses:**
- `400 Bad Request` — Invalid type, title too long
- `422 Unprocessable Entity` — Content generation failed

**Rate Limit:** 20 requests per minute

**Authentication:** Required

---

#### 31. Get Study Material
```
GET /study-materials/:materialId
```

**Description:** Retrieve a specific study material.

**Response (200 OK):** Study material object

**Authentication:** Required

---

#### 32. List Study Materials
```
GET /study-materials?workspaceId=<wsId>&documentId=<docId>&type=<type>
```

**Description:** List study materials with optional filtering.

**Response (200 OK):** Array of study material objects

**Query Parameters:**
- `workspaceId` — Filter by workspace
- `documentId` — Filter by document
- `type` — Filter by type (summary, quiz, flashcards, etc.)

**Authentication:** Required

---

#### 33. Update Study Material Progress
```
PUT /study-materials/:materialId/progress
```

**Description:** Update quiz or flashcard progress.

**Request Body:**
```json
{
  "quizProgress": {
    "totalQuestions": 10,
    "correctAnswers": 7
  }
}
```

**Response (200 OK):** Updated material with progress

**Authentication:** Required

---

#### 34. Delete Study Material
```
DELETE /study-materials/:materialId
```

**Description:** Delete a study material.

**Response (200 OK):**
```json
{
  "message": "Study material deleted successfully"
}
```

**Authentication:** Required

---

### Search (`/search`)

#### 35. Full-Text Search
```
GET /search/:workspaceId?q=<query>
```

**Description:** Search documents and messages in workspace.

**Response (200 OK):**
```json
{
  "documents": [
    {
      "_id": "doc_id",
      "title": "Document title",
      "plainTextContent": "Matching content..."
    }
  ],
  "messages": [
    {
      "_id": "msg_id",
      "content": "Matching message...",
      "sender": { "username": "john_doe" }
    }
  ]
}
```

**Query Parameters:**
- `q` — Search query (required)

**Authentication:** Required

---

### Invitations (`/invites`)

#### 36. Create Invitation
```
POST /invites
```

**Description:** Create a workspace invitation for external user.

**Request Body:**
```json
{
  "workspaceId": "workspace_id",
  "email": "invited@example.com",
  "role": "member"
}
```

**Response (201 Created):**
```json
{
  "_id": "invitation_id",
  "email": "invited@example.com",
  "role": "member",
  "token": "invitation_token",
  "expiresAt": "2026-07-19T10:00:00Z"
}
```

**Authentication:** Required (admin role)

---

#### 37. Accept Invitation
```
POST /invites/accept/:inviteToken
```

**Description:** Accept workspace invitation (public, no auth required).

**Request Body:**
```json
{
  "userId": "user_id"
}
```

**Response (200 OK):**
```json
{
  "message": "Invitation accepted",
  "workspace": { "name": "Workspace Name" }
}
```

**Error Responses:**
- `404 Not Found` — Invalid or expired invitation
- `409 Conflict` — User already in workspace

---

#### 38. List Invitations
```
GET /invites/workspace/:workspaceId
```

**Description:** List pending invitations for workspace (admin only).

**Response (200 OK):** Array of invitation objects

**Authentication:** Required (admin role)

---

#### 39. Revoke Invitation
```
DELETE /invites/:invitationId
```

**Description:** Cancel a pending invitation (admin only).

**Response (200 OK):**
```json
{
  "message": "Invitation revoked"
}
```

**Authentication:** Required (admin role)

---

### Audit Logs (`/audit`)

#### 40. Get Audit Logs
```
GET /audit/:workspaceId?action=<action>&userId=<userId>&limit=50
```

**Description:** Retrieve workspace activity logs.

**Response (200 OK):**
```json
[
  {
    "_id": "log_id",
    "action": "document_created",
    "workspaceId": "workspace_id",
    "userId": "user_id",
    "resourceType": "document",
    "resourceId": "doc_id",
    "changes": { "title": "New Document" },
    "timestamp": "2026-06-19T10:00:00Z"
  }
]
```

**Query Parameters:**
- `action` — Filter by action type
- `userId` — Filter by user
- `limit` — Number of logs (default: 50, max: 100)

**Authentication:** Required

---

## Error Response Format

All errors follow this format:

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "timestamp": "2026-06-19T10:00:00Z"
}
```

**Common Status Codes:**
- `400 Bad Request` — Invalid input
- `401 Unauthorized` — Missing or invalid token
- `403 Forbidden` — Insufficient permissions
- `404 Not Found` — Resource doesn't exist
- `409 Conflict` — Resource conflict (duplicate slug, circular hierarchy, etc.)
- `422 Unprocessable Entity` — Valid format but content validation failed (AI errors)
- `429 Too Many Requests` — Rate limit exceeded
- `500 Internal Server Error` — Server error

---

## Real-Time Events (Socket.IO)

### Connect
```javascript
socket.on('connect', () => {
  // Authenticate and join rooms
  socket.emit('join-editor', { documentId: '...' });
});
```

### Document Updates (Yjs Sync)
```javascript
socket.on('document-update', (update) => {
  // Yjs binary update, merge into local document
});
```

### Presence (Cursors, Selection)
```javascript
socket.on('presence-update', {
  userId: '...',
  cursorPosition: 100,
  selection: { start: 50, end: 100 }
});
```

### Chat Messages
```javascript
socket.on('chat-message', {
  _id: 'msg_id',
  content: 'Real-time message',
  sender: { id: '...', username: '...' },
  createdAt: '2026-06-19T10:00:00Z'
});
```

### Channel Updates
```javascript
socket.on('channel-update', {
  action: 'created',
  channel: { _id: '...', name: '...' }
});
```

---

## Rate Limits

- **Global:** 1000 requests per 15 minutes per IP
- **Auth:** 20 attempts per 15 minutes (register, login, refresh)
- **AI:** 20 requests per minute
- **Messages:** 120 requests per minute

When rate limited, responses include `Retry-After` header.

---

## Environment Variables

```bash
# JWT
JWT_EXPIRES_IN=15m
SESSION_TTL_DAYS=14

# Invitations
INVITE_TTL_DAYS=7

# AI Service
GOOGLE_API_KEY=...
AI_MODEL=gemini-pro

# Database
MONGODB_URI=mongodb://localhost:27017/study-app

# Server
PORT=5000
NODE_ENV=development
```

---

## Examples

### Full Auth Flow
```bash
# 1. Register
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secure123","username":"john"}'

# 2. Login (get token)
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secure123"}'

# 3. Create workspace
curl -X POST http://localhost:5000/api/workspaces \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Study Group"}'
```

### Document Workflow
```bash
# 1. Create document
curl -X POST http://localhost:5000/api/documents \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"<WS_ID>","title":"My Notes"}'

# 2. Connect to real-time editing (Socket.IO)
# See frontend/app.js for implementation

# 3. Generate study material
curl -X POST http://localhost:5000/api/study-materials \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"<WS_ID>","documentId":"<DOC_ID>","type":"summary"}'
```
