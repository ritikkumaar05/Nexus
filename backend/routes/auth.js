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
const { AUTH } = require('../config/constants');

const REFRESH_COOKIE_NAME = 'nexus_refresh_token';

const parseCookies = (cookieHeader = '') => cookieHeader
  .split(';')
  .map((cookie) => cookie.trim())
  .filter(Boolean)
  .reduce((cookies, cookie) => {
    const separatorIndex = cookie.indexOf('=');
    if (separatorIndex === -1) return cookies;
    const name = cookie.slice(0, separatorIndex);
    const value = cookie.slice(separatorIndex + 1);
    cookies[name] = decodeURIComponent(value);
    return cookies;
  }, {});

const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.REFRESH_COOKIE_SAMESITE || 'lax',
  path: '/api/auth',
  maxAge: AUTH.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
});

const setRefreshCookie = (res, refreshToken) => {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
};

const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    ...refreshCookieOptions(),
    maxAge: undefined
  });
};

const readRefreshCookie = (req) => parseCookies(req.headers.cookie || '')[REFRESH_COOKIE_NAME];

const publicAuthResult = ({ refreshToken, ...result }) => result;

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
    setRefreshCookie(res, result.refreshToken);

    res.status(201).json({
      message: 'Registration successful',
      ...publicAuthResult(result)
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
    setRefreshCookie(res, result.refreshToken);

    res.json({
      message: 'Logged in successfully',
      ...publicAuthResult(result)
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
  asyncHandler(async (req, res) => {
    const refreshToken = readRefreshCookie(req);
    const result = await AuthService.refreshToken(refreshToken);
    setRefreshCookie(res, result.refreshToken);

    res.json(publicAuthResult(result));
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
    clearRefreshCookie(res);

    res.json({ message: 'Logged out successfully' });
  })
);

module.exports = router;
