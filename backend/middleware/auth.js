/**
 * ============================================================================
 * AUTHENTICATION MIDDLEWARE
 * ============================================================================
 * Intercepts incoming HTTP requests to verify the validity of the JWT token.
 */

const { validateAccessToken } = require('../utils/sessionAuth');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const [scheme, token] = authHeader ? authHeader.split(' ') : [];

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Access Denied: No Token Provided' });
  }

  try {
    const { verified } = await validateAccessToken(token);
    req.user = verified; // Attach the user payload (id & email) to the request object
    next(); // Pass control to the next route handler
  } catch (err) {
    console.error('[AUTH ERROR] Token verification failed:', err);
    res.status(401).json({ error: 'Invalid or Expired Token' });
  }
};

module.exports = authenticateToken;
