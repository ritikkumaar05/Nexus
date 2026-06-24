/**
 * ============================================================================
 * AUTHENTICATION ROUTER (REFACTORED)
 * ============================================================================
 * Handles user sign-up, login, token refresh, and session management.
 * Now uses AuthService for business logic and validation middleware for inputs.
 */

const express = require('express');
const router = express.Router();
const { validateInput, schemas } = require('../middleware/validateInput');
const { asyncHandler } = require('../utils/AppError');
const authenticateToken = require('../middleware/auth');
const AuthService = require('../services/AuthService');


/**
 * POST /api/auth/register
 * Register a new user account
 */
router.post(
  '/register',
  validateInput(schemas.register),
  asyncHandler(async (req, res) => {
    const { email, password, username } = req.body;
    const result = await AuthService.register(email, password, username);

    res.status(201).json({
      message: 'Registration successful',
      ...result
    });
  })
);

/**
 * POST /api/auth/login
 * Login with email and password
 */
router.post(
  '/login',
  validateInput(schemas.login),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const result = await AuthService.login(email, password);

    res.json({
      message: 'Logged in successfully',
      ...result
    });
  })
);

/**
 * GET /api/auth/me
 * Get current user profile
 */
router.get(
  '/me',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const user = await AuthService.getProfile(req.user.id);

    res.json({ user });
  })
);

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post(
  '/refresh',
  validateInput(schemas.refresh),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;
    const result = await AuthService.refreshToken(refreshToken);

    res.json(result);
  })
);

/**
 * POST /api/auth/logout
 * Logout current session
 */
router.post(
  '/logout',
  authenticateToken,
  asyncHandler(async (req, res) => {
    if (req.user.sessionId) {
      await AuthService.logout(req.user.sessionId);
    }

    res.json({ message: 'Logged out successfully' });
  })
);

module.exports = router;
