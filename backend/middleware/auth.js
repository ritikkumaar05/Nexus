/**
 * ============================================================================
 * AUTHENTICATION MIDDLEWARE
 * ============================================================================
 * Intercepts incoming HTTP requests to verify the validity of the JWT token.
 */

const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/env');
const { Session } = require('../models');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const [scheme, token] = authHeader ? authHeader.split(' ') : [];

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Access Denied: No Token Provided' });
  }

  try {
    const verified = jwt.verify(token, getJwtSecret());

    if (verified.sessionId) {
      const session = await Session.findById(verified.sessionId);
      if (!session || session.revokedAt || session.expiresAt <= new Date()) {
        return res.status(401).json({ error: 'Session expired or revoked' });
      }
      if (session.tokenVersion !== verified.tokenVersion) {
        return res.status(401).json({ error: 'Session token has been rotated' });
      }
    }

    req.user = verified; // Attach the user payload (id & email) to the request object
    next(); // Pass control to the next route handler
  } catch (err) {
    res.status(401).json({ error: 'Invalid or Expired Token' });
  }
};

module.exports = authenticateToken;
