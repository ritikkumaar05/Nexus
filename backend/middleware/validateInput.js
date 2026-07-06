/**
 * ============================================================================
 * INPUT VALIDATION MIDDLEWARE
 * ============================================================================
 * Provides reusable Zod schemas and middleware for validating:
 * - Request body
 * - URL parameters
 * - Query strings
 * 
 * Usage:
 *   router.post('/',
 *     validateInput(schemas.createDocument),
 *     handler
 *   )
 */

const { z } = require('zod');
const { DOCUMENT_LIMITS, WORKSPACE_LIMITS, CHANNEL_LIMITS, MESSAGE_LIMITS, VALIDATION, STUDY_MATERIAL } = require('../config/constants');

// ============================================================================
// BASE SCHEMAS
// ============================================================================

/**
 * MongoDB ObjectId validation
 */
const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Invalid ID format')
  .optional();

const objectIdRequired = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Invalid ID format');

/**
 * Email validation
 */
const emailSchema = z
  .string()
  .email('Invalid email format')
  .transform((val) => val.toLowerCase().trim());

/**
 * Username validation
 */
const usernameSchema = z
  .string()
  .min(VALIDATION.USERNAME_MIN_LENGTH, `Username must be at least ${VALIDATION.USERNAME_MIN_LENGTH} characters`)
  .max(VALIDATION.USERNAME_MAX_LENGTH, `Username must not exceed ${VALIDATION.USERNAME_MAX_LENGTH} characters`)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens')
  .transform((val) => val.trim());

/**
 * Password validation
 */
const passwordSchema = z
  .string()
  .min(VALIDATION.PASSWORD_MIN_LENGTH, `Password must be at least ${VALIDATION.PASSWORD_MIN_LENGTH} characters`)
  .max(128, 'Password must not exceed 128 characters');

/**
 * Workspace name validation
 */
const workspaceNameSchema = z
  .string()
  .min(1, 'Workspace name is required')
  .max(WORKSPACE_LIMITS.NAME_MAX_LENGTH, `Workspace name cannot exceed ${WORKSPACE_LIMITS.NAME_MAX_LENGTH} characters`)
  .transform((val) => val.trim());

/**
 * Document title validation
 */
const documentTitleSchema = z
  .string()
  .max(DOCUMENT_LIMITS.TITLE_MAX_LENGTH, `Document title cannot exceed ${DOCUMENT_LIMITS.TITLE_MAX_LENGTH} characters`)
  .transform((val) => val.trim())
  .default(DOCUMENT_LIMITS.DEFAULT_TITLE);

const documentTitleUpdateSchema = z
  .string()
  .max(DOCUMENT_LIMITS.TITLE_MAX_LENGTH, `Document title cannot exceed ${DOCUMENT_LIMITS.TITLE_MAX_LENGTH} characters`)
  .transform((val) => val.trim());

/**
 * Channel name validation
 */
const channelNameSchema = z
  .string()
  .min(1, 'Channel name is required')
  .max(CHANNEL_LIMITS.NAME_MAX_LENGTH, `Channel name cannot exceed ${CHANNEL_LIMITS.NAME_MAX_LENGTH} characters`)
  .transform((val) => val.trim());

/**
 * Channel description validation
 */
const channelDescriptionSchema = z
  .string()
  .max(CHANNEL_LIMITS.DESCRIPTION_MAX_LENGTH, `Channel description cannot exceed ${CHANNEL_LIMITS.DESCRIPTION_MAX_LENGTH} characters`)
  .transform((val) => val.trim())
  .default('');

/**
 * Channel slug validation
 */
const channelSlugSchema = z
  .string()
  .max(CHANNEL_LIMITS.SLUG_MAX_LENGTH, `Channel slug cannot exceed ${CHANNEL_LIMITS.SLUG_MAX_LENGTH} characters`)
  .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens')
  .optional();

/**
 * Message content validation
 */
const messageContentSchema = z
  .string()
  .min(1, 'Message cannot be empty')
  .max(MESSAGE_LIMITS.MAX_CHARS, `Message cannot exceed ${MESSAGE_LIMITS.MAX_CHARS} characters`)
  .transform((val) => val.trim());

/**
 * Base64 content validation (for Yjs documents)
 */
const base64ContentSchema = z
  .string()
  .refine(
    (val) => {
      try {
        Buffer.from(val, 'base64');
        return true;
      } catch {
        return false;
      }
    },
    'Invalid base64 content'
  )
  .optional();

const plainTextContentSchema = z
  .string()
  .max(5_000_000, 'Document content cannot exceed 5MB')
  .optional();

const contentHtmlSchema = z
  .string()
  .max(5_000_000, 'Document HTML cannot exceed 5MB')
  .optional();

/**
 * Role validation
 */
const roleSchema = z
  .enum(['admin', 'member', 'viewer'])
  .default('member');

/**
 * Task status validation
 */
const taskStatusSchema = z
  .enum(['todo', 'in_progress', 'done'])
  .default('todo');

/**
 * Task priority validation
 */
const prioritySchema = z
  .enum(['low', 'medium', 'high'])
  .default('medium');

/**
 * Study material type validation
 */
const studyMaterialTypeSchema = z
  .string()
  .refine(
    (val) => STUDY_MATERIAL.VALID_TYPES.has(val),
    `Type must be one of: ${Array.from(STUDY_MATERIAL.VALID_TYPES).join(', ')}`
  );

// ============================================================================
// REQUEST SCHEMAS
// ============================================================================

const schemas = {
  // ──────────────────────────────────────────────────────────────
  // AUTH
  // ──────────────────────────────────────────────────────────────
  register: z.object({
    email: emailSchema,
    password: passwordSchema,
    username: usernameSchema
  }),

  login: z.object({
    email: emailSchema,
    password: z.string()
  }),

  refresh: z.object({
    refreshToken: objectIdRequired
  }),

  // ──────────────────────────────────────────────────────────────
  // WORKSPACE
  // ──────────────────────────────────────────────────────────────
  createWorkspace: z.object({
    name: workspaceNameSchema
  }),

  updateWorkspace: z.object({
    name: workspaceNameSchema
  }),

  addWorkspaceMember: z.object({
    userId: objectIdSchema,
    email: emailSchema.optional(),
    role: roleSchema
  }).refine(
    (data) => data.userId || data.email,
    'Either userId or email must be provided'
  ),

  updateMemberRole: z.object({
    role: roleSchema
  }),

  // ──────────────────────────────────────────────────────────────
  // DOCUMENT
  // ──────────────────────────────────────────────────────────────
  createDocument: z.object({
    workspaceId: objectIdRequired,
    parentDocumentId: objectIdSchema,
    title: documentTitleSchema
  }),

  updateDocument: z.object({
    title: documentTitleUpdateSchema.optional(),
    plainTextContent: plainTextContentSchema,
    contentHtml: contentHtmlSchema,
    binaryUpdateBase64: base64ContentSchema,
    parentDocumentId: objectIdSchema.nullable().optional()
  }).refine(
    (data) => (
      data.title !== undefined ||
      data.plainTextContent !== undefined ||
      data.contentHtml !== undefined ||
      data.binaryUpdateBase64 !== undefined ||
      data.parentDocumentId !== undefined
    ),
    'At least one document field must be provided'
  ),

  createComment: z.object({
    body: z.string().min(1, 'Comment body is required').max(10000, 'Comment cannot exceed 10,000 characters'),
    rangeStart: z.number().int().nonnegative().optional().default(0),
    rangeEnd: z.number().int().nonnegative().optional().default(0)
  }),

  // ──────────────────────────────────────────────────────────────
  // CHANNEL
  // ──────────────────────────────────────────────────────────────
  createChannel: z.object({
    name: channelNameSchema,
    description: channelDescriptionSchema,
    slug: channelSlugSchema
  }),

  updateChannel: z.object({
    name: channelNameSchema.optional(),
    description: channelDescriptionSchema.optional()
  }).refine(
    (data) => data.name !== undefined || data.description !== undefined,
    'Either name or description must be provided'
  ),

  // ──────────────────────────────────────────────────────────────
  // MESSAGE
  // ──────────────────────────────────────────────────────────────
  createMessage: z.object({
    content: messageContentSchema
  }),

  updateMessage: z.object({
    content: messageContentSchema
  }),

  // ──────────────────────────────────────────────────────────────
  // TASK
  // ──────────────────────────────────────────────────────────────
  createTask: z.object({
    title: z.string().min(1, 'Title is required').max(200),
    description: z.string().max(1000).optional(),
    priority: prioritySchema.optional(),
    dueDate: z.string().datetime().or(z.string().length(0)).nullable().optional(),
    assignee: objectIdSchema.nullable().optional()
  }),

  updateTask: z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    status: taskStatusSchema.optional(),
    priority: prioritySchema.optional(),
    dueDate: z.string().datetime().or(z.string().length(0)).nullable().optional(),
    assignee: objectIdSchema.nullable().optional()
  }).refine(
    (data) => Object.keys(data).length > 0,
    'At least one field must be provided'
  ),

  // ──────────────────────────────────────────────────────────────
  // STUDY MATERIAL
  // ──────────────────────────────────────────────────────────────
  createStudyMaterial: z.object({
    workspaceId: objectIdRequired,
    documentId: objectIdRequired,
    type: studyMaterialTypeSchema,
    title: z
      .string()
      .min(1, 'Title is required')
      .max(STUDY_MATERIAL.TITLE_MAX_LENGTH, `Title cannot exceed ${STUDY_MATERIAL.TITLE_MAX_LENGTH} characters`)
      .optional()
  }),

  updateStudyMaterialProgress: z.object({
    quizProgress: z.object({
      lastScore: z.number().min(0).max(100).optional(),
      totalQuestions: z.number().int().nonnegative().max(200).optional(),
      correctCount: z.number().int().nonnegative().max(200).optional(),
      weakTopics: z.array(z.string()).max(12).optional()
    }).optional(),
    flashcardProgress: z.object({
      knownCardIds: z.array(z.string()).max(500).optional(),
      hardCardIds: z.array(z.string()).max(500).optional()
    }).optional()
  }).refine(
    (data) => data.quizProgress || data.flashcardProgress,
    'At least one progress metric must be provided'
  ),

  // ──────────────────────────────────────────────────────────────
  // INVITATION
  // ──────────────────────────────────────────────────────────────
  createInvitation: z.object({
    email: emailSchema,
    role: roleSchema.optional()
  }),

  acceptInvitation: z.object({
    userId: objectIdRequired
  })
};

// ============================================================================
// MIDDLEWARE FACTORY
// ============================================================================

/**
 * Validate request body
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @returns {Function} Express middleware
 * 
 * Usage: router.post('/', validateInput(schemas.createDocument), handler)
 */
const validateInput = (schema) => {
  return (req, res, next) => {
    try {
      // Validate and transform the request body
      const validated = schema.parse(req.body);
      // Replace body with validated data
      req.body = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formattedErrors = (error.issues || error.errors).map((err) => ({
          path: err.path.join('.'),
          message: err.message
        }));
        return res.status(400).json({
          error: 'Validation failed',
          details: formattedErrors
        });
      }
      return res.status(400).json({ error: 'Invalid input' });
    }
  };
};

/**
 * Validate URL parameters
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @returns {Function} Express middleware
 * 
 * Usage: router.get('/:id', validateParams(z.object({ id: objectIdRequired })), handler)
 */
const validateParams = (schema) => {
  return (req, res, next) => {
    try {
      const validated = schema.parse(req.params);
      req.params = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Invalid parameters',
          details: (error.issues || error.errors).map((err) => ({
            param: err.path.join('.'),
            message: err.message
          }))
        });
      }
      return res.status(400).json({ error: 'Invalid parameters' });
    }
  };
};

/**
 * Validate query string parameters
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @returns {Function} Express middleware
 * 
 * Usage: router.get('/', validateQuery(z.object({ limit: z.number().optional() })), handler)
 */
const validateQuery = (schema) => {
  return (req, res, next) => {
    try {
      const validated = schema.parse(req.query);
      req.query = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: (error.issues || error.errors).map((err) => ({
            param: err.path.join('.'),
            message: err.message
          }))
        });
      }
      return res.status(400).json({ error: 'Invalid query parameters' });
    }
  };
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Schemas
  schemas,
  
  // Base schemas (for composing custom schemas)
  objectIdSchema,
  objectIdRequired,
  emailSchema,
  usernameSchema,
  passwordSchema,
  workspaceNameSchema,
  documentTitleSchema,
  documentTitleUpdateSchema,
  channelNameSchema,
  channelDescriptionSchema,
  channelSlugSchema,
  messageContentSchema,
  base64ContentSchema,
  plainTextContentSchema,
  contentHtmlSchema,
  roleSchema,
  taskStatusSchema,
  prioritySchema,
  studyMaterialTypeSchema,
  
  // Middleware factories
  validateInput,
  validateParams,
  validateQuery
};
