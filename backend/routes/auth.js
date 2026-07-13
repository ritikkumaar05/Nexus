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
const { isEmailVerificationRequired } = require('../config/env');

const REFRESH_COOKIE_NAME = 'nexus_refresh_token';
const OAUTH_STATE_COOKIE_NAME = 'nexus_oauth_state';

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

const authCookieSameSite = () => {
  const configured = (process.env.REFRESH_COOKIE_SAMESITE || '').toLowerCase();
  if (configured === 'none' || configured === 'lax') return configured;
  return process.env.NODE_ENV === 'production' ? 'none' : 'lax';
};

const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: authCookieSameSite(),
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

const waitForMinimumAuthResponseTime = async (startedAt, minimumMs = 150) => {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
};

const appBaseUrl = () => (
  process.env.FRONTEND_ORIGIN
  || process.env.APP_BASE_URL
  || 'http://localhost:5173'
).replace(/\/$/, '');

const apiBaseUrl = (req) => (
  process.env.API_BASE_URL
  || `${req.protocol}://${req.get('host')}`
).replace(/\/$/, '');

const googleRedirectUri = (req) => (
  process.env.GOOGLE_OAUTH_REDIRECT_URI
  || `${apiBaseUrl(req)}/api/auth/google/callback`
);

const redirectToFrontend = (res, route, params = {}) => {
  const query = new URLSearchParams(params);
  res.redirect(`${appBaseUrl()}/#/${route}${query.size ? `?${query.toString()}` : ''}`);
};

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
    if (result.refreshToken) setRefreshCookie(res, result.refreshToken);

    res.status(201).json({
      message: isEmailVerificationRequired()
        ? 'Account created. Check your email to verify your account before signing in.'
        : 'Account created and signed in successfully.',
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
 * GET /api/auth/google/start
 * Redirect to Google's OAuth consent screen.
 */
router.get('/google/start', asyncHandler(async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return redirectToFrontend(res, 'login', { error: 'Google Sign-In is not configured' });
  }

  const state = AuthService._generateRefreshToken();
  res.cookie(OAUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: authCookieSameSite(),
    path: '/api/auth/google',
    maxAge: 10 * 60 * 1000
  });

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', googleRedirectUri(req));
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('prompt', 'select_account');

  res.redirect(authUrl.toString());
}));

/**
 * GET /api/auth/google/callback
 * Handle Google's OAuth callback and redirect with a one-time handoff token.
 */
router.get('/google/callback', asyncHandler(async (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const expectedState = cookies[OAUTH_STATE_COOKIE_NAME];
  res.clearCookie(OAUTH_STATE_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: authCookieSameSite(),
    path: '/api/auth/google'
  });

  if (!req.query.state || req.query.state !== expectedState) {
    return redirectToFrontend(res, 'login', { error: 'Google sign-in could not be verified' });
  }

  if (req.query.error) {
    return redirectToFrontend(res, 'login', { error: 'Google sign-in was cancelled' });
  }

  try {
    const result = await AuthService.googleSignIn({
      code: req.query.code,
      redirectUri: googleRedirectUri(req)
    });
    return redirectToFrontend(res, 'oauth-callback', { token: result.handoffToken });
  } catch (err) {
    console.error('Google OAuth callback failed:', JSON.stringify({
      message: err.message,
      code: err.code || err.name || 'OAuthError'
    }));
    return redirectToFrontend(res, 'login', { error: 'Google sign-in failed. Please try again.' });
  }
}));

router.post('/google/complete', asyncHandler(async (req, res) => {
  const result = await AuthService.completeOauthHandoff(req.body?.token);
  setRefreshCookie(res, result.refreshToken);

  res.json({
    message: 'Signed in with Google',
    ...publicAuthResult(result)
  });
}));

router.post(
  '/resend-verification',
  validateInput(schemas.resendVerification),
  asyncHandler(async (req, res) => {
    const startedAt = Date.now();
    try {
      const result = await AuthService.requestEmailVerification(req.body.email);
      await waitForMinimumAuthResponseTime(startedAt);
      res.json(result);
    } catch (err) {
      await waitForMinimumAuthResponseTime(startedAt);
      throw err;
    }
  })
);

router.post('/verify-email', validateInput(schemas.verifyEmailOtp), asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  try {
    const result = await AuthService.verifyEmail(req.body.email, req.body.otp);
    await waitForMinimumAuthResponseTime(startedAt);
    res.json(result);
  } catch (err) {
    await waitForMinimumAuthResponseTime(startedAt);
    throw err;
  }
}));

router.post(
  '/password/forgot',
  validateInput(schemas.forgotPassword),
  asyncHandler(async (req, res) => {
    const startedAt = Date.now();
    try {
      const result = await AuthService.requestPasswordReset(req.body.email);
      await waitForMinimumAuthResponseTime(startedAt);
      res.json(result);
    } catch (err) {
      await waitForMinimumAuthResponseTime(startedAt);
      throw err;
    }
  })
);

router.post(
  '/password/reset',
  validateInput(schemas.resetPassword),
  asyncHandler(async (req, res) => {
    const startedAt = Date.now();
    try {
      const result = await AuthService.resetPassword(req.body.token, req.body.password);
      await waitForMinimumAuthResponseTime(startedAt);
      res.json(result);
    } catch (err) {
      await waitForMinimumAuthResponseTime(startedAt);
      throw err;
    }
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
    const result = await AuthService.refreshToken(refreshToken, req.headers['x-csrf-token']);
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
