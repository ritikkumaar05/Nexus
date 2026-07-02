const jwt = require('jsonwebtoken');
const { Session } = require('../models');
const { getJwtSecret } = require('../config/env');
const { AuthenticationError } = require('./AppError');

const validateAccessToken = async (token) => {
  if (!token || typeof token !== 'string') {
    throw new AuthenticationError('Access token is required');
  }

  const verified = jwt.verify(token, getJwtSecret());
  if (!verified.sessionId) {
    throw new AuthenticationError('Session is required');
  }

  const session = await Session.findById(verified.sessionId);
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    throw new AuthenticationError('Session expired or revoked');
  }

  if (session.tokenVersion !== verified.tokenVersion) {
    throw new AuthenticationError('Session token has been rotated');
  }

  return { verified, session };
};

module.exports = {
  validateAccessToken
};
