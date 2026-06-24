const express = require('express');
const cors = require('cors');
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

const createCorsOptions = () => {
  const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true
  };
};

const createApp = () => {
  const app = express();
  const corsOptions = createCorsOptions();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use((err, _req, res, next) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({
        error: 'Request payload too large. Please reduce document size or generated content.'
      });
    }
    return next(err);
  });
  app.use(globalLimiter);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authLimiter, authRoutes);
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
