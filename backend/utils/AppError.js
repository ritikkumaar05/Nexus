/**
 * ============================================================================
 * APPLICATION ERROR HIERARCHY
 * ============================================================================
 * Centralized error classes for consistent error handling and responses.
 * 
 * Usage:
 *   throw new ValidationError('Invalid email format', { field: 'email' })
 *   throw new AuthorizationError('Admin role required')
 *   throw new NotFoundError('Workspace', 'workspace123')
 */

const { HTTP_STATUS } = require('../config/constants');

/**
 * Base application error class
 * All custom errors should extend this
 */
class AppError extends Error {
  constructor(message, statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();

    // Capture stack trace (for debugging in development)
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to JSON response format
   * @returns {Object} Error response object
   */
  toJSON() {
    return {
      error: this.message,
      code: this.code,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
      ...(this.details && { details: this.details })
    };
  }
}

/**
 * Authentication Error (401)
 * Thrown when user is not authenticated or token is invalid
 */
class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed', details = null) {
    super(
      message,
      HTTP_STATUS.UNAUTHORIZED,
      'AUTHENTICATION_ERROR',
      details
    );
  }
}

/**
 * Authorization Error (403)
 * Thrown when user doesn't have permission to access a resource
 */
class AuthorizationError extends AppError {
  constructor(message = 'Access denied', details = null) {
    super(
      message,
      HTTP_STATUS.FORBIDDEN,
      'AUTHORIZATION_ERROR',
      details
    );
  }
}

/**
 * Validation Error (400)
 * Thrown when input validation fails
 */
class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = null) {
    super(
      message,
      HTTP_STATUS.BAD_REQUEST,
      'VALIDATION_ERROR',
      details
    );
  }
}

/**
 * Not Found Error (404)
 * Thrown when a resource doesn't exist
 */
class NotFoundError extends AppError {
  constructor(resourceType = 'Resource', resourceId = null) {
    const message = resourceId
      ? `${resourceType} with ID "${resourceId}" not found`
      : `${resourceType} not found`;

    super(
      message,
      HTTP_STATUS.NOT_FOUND,
      'NOT_FOUND',
      { resourceType, resourceId }
    );
  }
}

/**
 * Conflict Error (409)
 * Thrown when operation conflicts with existing data (e.g., duplicate email, circular hierarchy)
 */
class ConflictError extends AppError {
  constructor(message = 'Resource conflict', details = null) {
    super(
      message,
      HTTP_STATUS.CONFLICT,
      'CONFLICT_ERROR',
      details
    );
  }
}

/**
 * Unprocessable Entity Error (422)
 * Thrown when request is well-formed but contains semantic errors
 * Typically used for business logic validation (e.g., AI generation failure)
 */
class UnprocessableEntityError extends AppError {
  constructor(message = 'Request could not be processed', details = null) {
    super(
      message,
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
      'UNPROCESSABLE_ENTITY',
      details
    );
  }
}

/**
 * Rate Limit Error (429)
 * Thrown when user exceeds rate limit
 */
class RateLimitError extends AppError {
  constructor(message = 'Too many requests', retryAfter = null) {
    const details = retryAfter ? { retryAfterSeconds: retryAfter } : null;

    super(
      message,
      HTTP_STATUS.TOO_MANY_REQUESTS,
      'RATE_LIMIT_EXCEEDED',
      details
    );
  }
}

/**
 * Internal Server Error (500)
 * Generic server error (default for unexpected errors)
 */
class InternalError extends AppError {
  constructor(message = 'Internal server error', details = null) {
    super(
      message,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
      details
    );
  }
}

/**
 * Async error handler wrapper
 * Wraps async route handlers to automatically catch errors
 * 
 * Usage:
 *   router.get('/', asyncHandler(async (req, res) => {
 *     const data = await getData()
 *     res.json(data)
 *   }))
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Global error handler middleware
 * Should be the last middleware in the app
 * 
 * Usage in app.js:
 *   app.use(globalErrorHandler)
 */
const globalErrorHandler = (err, req, res, next) => {
  const normalizedErr = normalizeError(err);
  // Default to internal error
  let appError = normalizedErr instanceof AppError
    ? normalizedErr
    : new InternalError(normalizedErr.message || 'An unexpected error occurred');

  // Log error (structured logging in production)
  const logData = {
    timestamp: appError.timestamp,
    code: appError.code,
    message: appError.message,
    statusCode: appError.statusCode,
    path: req.path,
    method: req.method,
    userId: req.user?.id || 'anonymous'
  };

  // Log to console (replace with Winston/Bunyan in production)
  if (process.env.NODE_ENV === 'development') {
    console.error('ERROR:', JSON.stringify(logData, null, 2));
    console.error('Stack:', err.stack);
  } else {
    console.error('ERROR:', JSON.stringify(logData));
  }

  // Send response
  const response = appError.toJSON();

  // Add retry header for rate limit errors
  if (appError instanceof RateLimitError && appError.details?.retryAfterSeconds) {
    res.set('Retry-After', appError.details.retryAfterSeconds);
  }

  res.status(appError.statusCode).json(response);
};

/**
 * Convert common errors to AppError
 * Useful for handling Mongoose, JWT, and other library errors
 */
const normalizeError = (err) => {
  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const details = Object.entries(err.errors).map(([field, error]) => ({
      field,
      message: error.message
    }));
    return new ValidationError('Database validation failed', details);
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return new ConflictError(`${field} already exists`, { field });
  }

  // Mongoose cast error
  if (err.name === 'CastError') {
    return new ValidationError('Invalid ID format');
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return new AuthenticationError('Invalid token');
  }

  if (err.name === 'TokenExpiredError') {
    return new AuthenticationError('Token expired');
  }

  // Zod validation error
  if (err.name === 'ZodError') {
    const details = (err.issues || err.errors).map((error) => ({
      path: error.path.join('.'),
      message: error.message
    }));
    return new ValidationError('Input validation failed', details);
  }

  // Return original error if not recognized
  return err;
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Error classes
  AppError,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
  RateLimitError,
  InternalError,

  // Utilities
  asyncHandler,
  globalErrorHandler,
  normalizeError
};
