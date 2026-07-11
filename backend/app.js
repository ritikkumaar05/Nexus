const express = require('express');
const cors = require('cors');
const accountRoutes = require('./routes/account');
const authRoutes = require('./routes/auth');
const workspaceRoutes = require('./routes/workspace');
const documentRoutes = require('./routes/document');
const messageRoutes = require('./routes/message');
const documentTaskRoutes = require('./routes/documentTask');
const documentMessageRoutes = require('./routes/documentMessage');
const channelRoutes = require('./routes/channel');
const inviteRoutes = require('./routes/invite');
const attachmentRoutes = require('./routes/attachment');
const auditRoutes = require('./routes/audit');
const searchRoutes = require('./routes/search');
const studyMaterialRoutes = require('./routes/studyMaterial');
const aiRoutes = require('./services/aiRoutes');
const {
  aiLimiter,
  authLimiter,
  globalLimiter,
  helmet,
  messageLimiter
} = require('./middleware/security');
const { globalErrorHandler } = require('./utils/AppError');

const parseTrustProxy = () => {
  const configured = process.env.TRUST_PROXY
    || (process.env.NODE_ENV === 'production' ? '1' : '');
  const normalized = String(configured).trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return configured;
};

const createCorsOptions = () => {
  const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && allowedOrigins.length === 0) {
    throw new Error('CORS_ORIGIN is required in production');
  }

  return {
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      if (!isProduction && allowedOrigins.length === 0) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
    optionsSuccessStatus: 204
  };
};

const createApp = () => {
  const app = express();
  const corsOptions = createCorsOptions();
  const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '6mb';

  app.disable('x-powered-by');
  app.set('trust proxy', parseTrustProxy());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(express.json({ limit: requestBodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: requestBodyLimit }));
  app.use((err, _req, res, next) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({
        error: 'This request is too large for Nexus to process. Please reduce the content and try again.'
      });
    }
    return next(err);
  });
  app.use(globalLimiter);

  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/account', authLimiter, accountRoutes);
  app.use('/api/workspaces', workspaceRoutes);
  app.use('/api/workspaces/:workspaceId/documents/:documentId/tasks', documentTaskRoutes);
  app.use('/api/workspaces/:workspaceId/documents/:documentId/messages', messageLimiter, documentMessageRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/channels', channelRoutes);
  app.use('/api/messages', messageLimiter, messageRoutes);
  app.use('/api/invites', inviteRoutes);
  app.use('/api/attachments', attachmentRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/study-material', studyMaterialRoutes);
  app.use('/api/ai', aiLimiter, aiRoutes);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });

  // Global error handler (must be last middleware)
  app.use(globalErrorHandler);

  return { app, corsOptions };
};

module.exports = {
  createApp,
  createCorsOptions
};
