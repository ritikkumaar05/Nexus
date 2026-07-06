const jwt = require('jsonwebtoken');
const { Session } = require('../models');
const { getJwtSecret } = require('../config/env');
const { AuthenticationError } = require('./AppError');

const isValidTokenEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const normalizedEmail = email.toLowerCase().trim();
  if (normalizedEmail.length > 254 || normalizedEmail !== email.trim().toLowerCase()) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return false;

  const [localPart, domain] = normalizedEmail.split('@');
  if (!localPart || !domain || localPart.length > 64) return false;
  if (localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) return false;

  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => (
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  )) && /^[a-z]{2,63}$/.test(labels[labels.length - 1]);
};

const validateAccessToken = async (token) => {
  if (!token || typeof token !== 'string') {
    throw new AuthenticationError('Access token is required');
  }

  const verified = jwt.verify(token, getJwtSecret());
  if (!verified.sessionId) {
    throw new AuthenticationError('Session is required');
  }

  if (!isValidTokenEmail(verified.email)) {
    throw new AuthenticationError('Session email is invalid');
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
  isValidTokenEmail,
  validateAccessToken
};
