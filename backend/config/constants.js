/**
 * ============================================================================
 * CENTRALIZED CONSTANTS
 * ============================================================================
 * Single source of truth for magic numbers, limits, and configuration values.
 * Import this module instead of hardcoding values across route handlers.
 */

// ============================================================================
// RATE LIMITING
// ============================================================================
const RATE_LIMITS = {
  // Time window for rate limit checks (15 minutes in milliseconds)
  WINDOW_MS: 15 * 60 * 1000,
  
  // Global rate limit: requests per window across all endpoints
  GLOBAL: {
    WINDOW_MS: 15 * 60 * 1000,
    MAX_REQUESTS: 1000,
    MESSAGE: 'Too many requests'
  },
  
  // Authentication endpoints (register, login, refresh)
  AUTH: {
    WINDOW_MS: 15 * 60 * 1000,
    MAX_REQUESTS: 20,
    MESSAGE: 'Too many authentication attempts'
  },
  
  // AI endpoints (study material generation, summaries)
  AI: {
    WINDOW_MS: 60 * 1000, // 1 minute
    MAX_REQUESTS: 20,
    MESSAGE: 'Too many AI requests'
  },
  
  // Message posting (chat messages, comments, document messages)
  MESSAGE: {
    WINDOW_MS: 60 * 1000, // 1 minute
    MAX_REQUESTS: 120,
    MESSAGE: 'Too many message requests'
  }
};

// ============================================================================
// MESSAGE & CHAT
// ============================================================================
const MESSAGE_LIMITS = {
  // Maximum characters in a chat message or comment
  MAX_CHARS: 4000,
  
  // Maximum messages returned in paginated queries
  MAX_PAGE_SIZE: 100,
  
  // Default messages to fetch in a single request
  DEFAULT_PAGE_SIZE: 50
};

// ============================================================================
// DOCUMENT CONSTRAINTS
// ============================================================================
const DOCUMENT_LIMITS = {
  // Maximum length of document title
  TITLE_MAX_LENGTH: 120,
  
  // Default title when creating untitled document
  DEFAULT_TITLE: 'Untitled Page'
};

// ============================================================================
// WORKSPACE & CHANNEL CONSTRAINTS
// ============================================================================
const WORKSPACE_LIMITS = {
  // Maximum length of workspace name
  NAME_MAX_LENGTH: 80
};

const CHANNEL_LIMITS = {
  // Maximum length of channel name
  NAME_MAX_LENGTH: 80,
  
  // Maximum length of channel description
  DESCRIPTION_MAX_LENGTH: 240,
  
  // Maximum length of channel slug (URL-friendly name)
  SLUG_MAX_LENGTH: 60
};

// ============================================================================
// STUDY MATERIALS
// ============================================================================
const STUDY_MATERIAL = {
  // Valid types of study materials that can be generated
  VALID_TYPES: new Set([
    'summary',
    'quiz',
    'flashcards',
    'important_questions',
    'explanation'
  ]),
  
  // Maximum title length for study materials
  TITLE_MAX_LENGTH: 160,
  
  // Maximum content size in bytes (250 KB)
  MAX_CONTENT_BYTES: 250_000
};

// ============================================================================
// AUTHENTICATION & SESSIONS
// ============================================================================
const AUTH = {
  // Access token time-to-live (how long token is valid)
  // Env override: JWT_EXPIRES_IN
  ACCESS_TOKEN_TTL: process.env.JWT_EXPIRES_IN || '15m',
  
  // Session duration in days (how long before auto-logout)
  // Env override: SESSION_TTL_DAYS
  SESSION_TTL_DAYS: Number(process.env.SESSION_TTL_DAYS || 14),
  
  // Account token (password reset, email verification) TTL in hours
  ACCOUNT_TOKEN_TTL_HOURS: 2,

  // Email verification OTP duration and abuse controls
  EMAIL_OTP_TTL_MINUTES: Number(process.env.EMAIL_OTP_TTL_MINUTES || 10),
  EMAIL_OTP_MAX_ATTEMPTS: Number(process.env.EMAIL_OTP_MAX_ATTEMPTS || 5),
  EMAIL_OTP_RESEND_COOLDOWN_SECONDS: Number(process.env.EMAIL_OTP_RESEND_COOLDOWN_SECONDS || 60),

  // Password reset email abuse controls
  PASSWORD_RESET_COOLDOWN_SECONDS: Number(process.env.PASSWORD_RESET_COOLDOWN_SECONDS || 60),

  // OAuth handoff token duration in minutes
  OAUTH_HANDOFF_TTL_MINUTES: 5,
  
  // Bcrypt salt rounds for password hashing
  BCRYPT_SALT_ROUNDS: Number(process.env.BCRYPT_SALT_ROUNDS || 12)
};

// ============================================================================
// INVITATIONS
// ============================================================================
const INVITATIONS = {
  // Invitation expiration time in days
  // Env override: INVITE_TTL_DAYS
  TTL_DAYS: Number(process.env.INVITE_TTL_DAYS || 7)
};

// ============================================================================
// PAGINATION
// ============================================================================
const PAGINATION = {
  // Default page size for list endpoints
  DEFAULT_PAGE_SIZE: 50,
  
  // Maximum page size to prevent excessive data retrieval
  MAX_PAGE_SIZE: 100
};

// ============================================================================
// SOCKET.IO / REAL-TIME
// ============================================================================
const SOCKET = {
  // Key for Yjs shared text in document
  Y_TEXT_KEY: 'content',
  
  // Room naming convention for channels
  // Usage: getChannelRoom(workspaceId, channelId)
  ROOM_PREFIX: {
    CHANNEL: 'workspace',
    SEPARATOR: ':'
  }
};

// ============================================================================
// VALIDATION
// ============================================================================
const VALIDATION = {
  // Email regex pattern - basic validation (not RFC 5322 compliant)
  // TODO: Consider using email-validator library for RFC compliance
  EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  
  // Minimum length for passwords
  PASSWORD_MIN_LENGTH: 8,
  
  // Minimum length for usernames
  USERNAME_MIN_LENGTH: 3,
  
  // Maximum length for usernames
  USERNAME_MAX_LENGTH: 50
};

// ============================================================================
// WORKSPACE ROLES
// ============================================================================
const WORKSPACE_ROLES = {
  ADMIN: 'admin',
  MEMBER: 'member',
  VIEWER: 'viewer',
  
  // Role hierarchy for permission checks
  HIERARCHY: {
    admin: 3,
    member: 2,
    viewer: 1
  }
};

// ============================================================================
// ERROR CODES & STATUS
// ============================================================================
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_SERVER_ERROR: 500
};

// ============================================================================
// EXPORTS
// ============================================================================
module.exports = {
  RATE_LIMITS,
  MESSAGE_LIMITS,
  DOCUMENT_LIMITS,
  WORKSPACE_LIMITS,
  CHANNEL_LIMITS,
  STUDY_MATERIAL,
  AUTH,
  INVITATIONS,
  PAGINATION,
  SOCKET,
  VALIDATION,
  WORKSPACE_ROLES,
  HTTP_STATUS
};
