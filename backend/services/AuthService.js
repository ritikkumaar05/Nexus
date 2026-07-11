/**
 * ============================================================================
 * AUTHENTICATION SERVICE
 * ============================================================================
 * Business logic for user authentication including registration, login,
 * password management, and session handling.
 * 
 * Extracted from routes/auth.js to be reusable across routes and middleware.
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { AccountToken, EmailOtp, Session, User } = require('../models');
const { getJwtSecret } = require('../config/env');
const EmailService = require('./EmailService');
const fetchWithTimeout = require('../utils/fetchWithTimeout');
const {
  NotFoundError,
  AuthenticationError,
  ValidationError,
  ConflictError
} = require('../utils/AppError');
const { AUTH, VALIDATION } = require('../config/constants');

const googleOauthTimeoutMs = () => Number(process.env.GOOGLE_OAUTH_TIMEOUT_MS || 10000);

class AuthService {
  /**
   * Register a new user
   * @param {string} email - User email
   * @param {string} password - User password
   * @param {string} username - Username
   * @returns {Promise<Object>} { user, verificationRequired }
   * @throws {ValidationError} If input is invalid
   * @throws {ConflictError} If email/username already exists
   */
  async register(email, password, username) {
    // Validate inputs
    if (!email || typeof email !== 'string') {
      throw new ValidationError('Email is required');
    }

    if (!password || typeof password !== 'string') {
      throw new ValidationError('Password is required');
    }

    if (!username || typeof username !== 'string') {
      throw new ValidationError('Username is required');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedUsername = username.trim();

    // Validate email format
    if (!this._isValidEmail(normalizedEmail)) {
      throw new ValidationError('Please provide a valid email address');
    }

    // Validate username length
    if (
      normalizedUsername.length < VALIDATION.USERNAME_MIN_LENGTH ||
      normalizedUsername.length > VALIDATION.USERNAME_MAX_LENGTH
    ) {
      throw new ValidationError(
        `Username must be between ${VALIDATION.USERNAME_MIN_LENGTH} and ${VALIDATION.USERNAME_MAX_LENGTH} characters`
      );
    }

    // Validate username format
    if (!/^[a-zA-Z0-9_-]+$/.test(normalizedUsername)) {
      throw new ValidationError(
        'Username can only contain letters, numbers, underscores, and hyphens'
      );
    }

    // Validate password length
    if (
      password.length < VALIDATION.PASSWORD_MIN_LENGTH ||
      password.length > 128
    ) {
      throw new ValidationError(
        `Password must be at least ${VALIDATION.PASSWORD_MIN_LENGTH} characters`
      );
    }

    // Check for existing user
    const existingUser = await User.findOne({
      deletedAt: null,
      $or: [{ email: normalizedEmail }, { username: normalizedUsername }]
    });

    if (existingUser) {
      const field = existingUser.email === normalizedEmail ? 'Email' : 'Username';
      throw new ConflictError(`${field} already registered`);
    }

    // Hash password
    const passwordHash = await this.hashPassword(password);

    // Create user
    const newUser = new User({
      username: normalizedUsername,
      fullName: normalizedUsername,
      email: normalizedEmail,
      passwordHash,
      authProvider: 'email',
      emailVerifiedAt: null
    });

    const savedUser = await newUser.save();

    try {
      await this._sendEmailVerificationOtp(savedUser);
    } catch (err) {
      await Promise.allSettled([
        EmailOtp.deleteMany({ user: savedUser._id, purpose: 'email-verification' }),
        typeof savedUser.deleteOne === 'function'
          ? savedUser.deleteOne()
          : User.deleteOne({ _id: savedUser._id })
      ]);
      throw err;
    }

    return {
      user: this._formatUser(savedUser),
      verificationRequired: true,
      verificationSent: true
    };
  }

  /**
   * Login user with email and password
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Promise<Object>} { token, refreshToken, user }
   * @throws {ValidationError} If email or password is missing
   * @throws {AuthenticationError} If credentials are invalid
   */
  async login(email, password) {
    if (!email || typeof email !== 'string') {
      throw new ValidationError('Email is required');
    }

    if (!password || typeof password !== 'string') {
      throw new ValidationError('Password is required');
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (!this._isValidEmail(normalizedEmail)) {
      throw new ValidationError('Please provide a valid email address');
    }

    // Find user by email
    const user = await User.findOne({ email: normalizedEmail, deletedAt: null });

    if (!user || !user.passwordHash) {
      throw new AuthenticationError('Invalid email or password');
    }

    // Verify password
    const isPasswordValid = await this.validatePassword(password, user.passwordHash);

    if (!isPasswordValid) {
      throw new AuthenticationError('Invalid email or password');
    }

    if (!user.emailVerifiedAt) {
      throw new AuthenticationError('Please verify your email before signing in');
    }

    // Create auth payload
    const authPayload = await this._createAuthPayload(user);

    return authPayload;
  }

  async googleSignIn({ code, redirectUri }) {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      throw new ValidationError('Google Sign-In is not configured');
    }

    if (!code || typeof code !== 'string') {
      throw new ValidationError('Google authorization code is required');
    }

    const tokenResponse = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    }, googleOauthTimeoutMs()).catch((err) => {
      if (err?.name === 'AbortError') {
        throw new AuthenticationError('Google sign-in timed out. Please try again.');
      }
      throw new AuthenticationError('Google authentication failed');
    });

    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.id_token) {
      throw new AuthenticationError('Google authentication failed');
    }

    const googleUser = await this._verifyGoogleIdToken(tokenData.id_token);
    const user = await this._findOrCreateGoogleUser(googleUser);
    const handoffToken = await this._createAccountToken(user, 'oauth-handoff', {
      ttlMs: AUTH.OAUTH_HANDOFF_TTL_MINUTES * 60 * 1000
    });

    return {
      handoffToken,
      user: this._formatUser(user)
    };
  }

  async completeOauthHandoff(token) {
    const accountToken = await this._consumeAccountToken(token, 'oauth-handoff');
    const user = await User.findById(accountToken.user);
    if (!user || user.deletedAt) {
      throw new NotFoundError('User', accountToken.user);
    }
    if (!this._isValidEmail(user.email)) {
      throw new AuthenticationError('This Google account did not provide a valid email address');
    }
    return this._createAuthPayload(user);
  }

  async requestEmailVerification(emailOrUserId) {
    const user = this._isValidObjectId(emailOrUserId)
      ? await User.findById(emailOrUserId)
      : await User.findOne({ email: String(emailOrUserId || '').toLowerCase().trim(), deletedAt: null });

    const generic = {
      message: 'If an unverified account exists, a new OTP has been sent.'
    };

    if (!user || user.deletedAt) {
      return generic;
    }

    if (user.emailVerifiedAt) {
      return generic;
    }

    await this._sendEmailVerificationOtp(user, { enforceCooldown: true });
    return generic;
  }

  async verifyEmail(email, otp) {
    const normalizedEmail = String(email || '').toLowerCase().trim();
    const normalizedOtp = String(otp || '').trim();
    const genericOtpError = 'Invalid or expired OTP';

    if (!this._isValidEmail(normalizedEmail)) {
      throw new ValidationError('Valid email is required');
    }

    if (!/^\d{6}$/.test(normalizedOtp)) {
      throw new ValidationError('Enter the 6-digit OTP from your email');
    }

    const user = await User.findOne({ email: normalizedEmail, deletedAt: null });
    if (!user) {
      this._constantTimeOtpCompare(
        this._hashOtp(normalizedOtp, 'missing-user', normalizedEmail),
        this._hashOtp('000000', 'missing-user', normalizedEmail)
      );
      throw new AuthenticationError(genericOtpError);
    }

    if (user.emailVerifiedAt) {
      this._constantTimeOtpCompare(
        this._hashOtp(normalizedOtp, user._id, normalizedEmail),
        this._hashOtp('000000', user._id, normalizedEmail)
      );
      throw new AuthenticationError(genericOtpError);
    }

    const now = new Date();
    const otpHash = this._hashOtp(normalizedOtp, user._id, normalizedEmail);
    const consumedOtp = await EmailOtp.findOneAndUpdate({
      user: user._id,
      email: normalizedEmail,
      purpose: 'email-verification',
      usedAt: null,
      expiresAt: { $gt: now },
      attempts: { $lt: AUTH.EMAIL_OTP_MAX_ATTEMPTS },
      otpHash
    }, {
      usedAt: now
    }, {
      returnDocument: 'after',
      sort: { createdAt: -1 }
    });

    if (!consumedOtp) {
      const latestActiveOtp = await EmailOtp.findOne({
        user: user._id,
        email: normalizedEmail,
        purpose: 'email-verification',
        usedAt: null
      }).sort({ createdAt: -1 });

      if (latestActiveOtp) {
        this._constantTimeOtpCompare(otpHash, latestActiveOtp.otpHash);
        if (latestActiveOtp.expiresAt <= now || latestActiveOtp.attempts >= AUTH.EMAIL_OTP_MAX_ATTEMPTS) {
          await EmailOtp.updateOne({ _id: latestActiveOtp._id, usedAt: null }, { usedAt: now });
        } else {
          const attemptedOtp = await EmailOtp.findOneAndUpdate({
            _id: latestActiveOtp._id,
            usedAt: null,
            attempts: { $lt: AUTH.EMAIL_OTP_MAX_ATTEMPTS }
          }, {
            $inc: { attempts: 1 }
          }, {
            returnDocument: 'after'
          });
          if (attemptedOtp?.attempts >= AUTH.EMAIL_OTP_MAX_ATTEMPTS) {
            await EmailOtp.updateOne({ _id: attemptedOtp._id, usedAt: null }, { usedAt: now });
          }
        }
      } else {
        this._constantTimeOtpCompare(
          otpHash,
          this._hashOtp('000000', user._id, normalizedEmail)
        );
      }
      throw new AuthenticationError(genericOtpError);
    }

    user.emailVerifiedAt = user.emailVerifiedAt || new Date();
    await Promise.all([
      user.save(),
      EmailOtp.updateMany(
        { user: user._id, purpose: 'email-verification', usedAt: null },
        { usedAt: now }
      )
    ]);

    return {
      message: 'Email verified successfully.',
      user: this._formatUser(user)
    };
  }

  async requestPasswordReset(email) {
    const generic = { message: 'If an account exists, password reset instructions have been sent.' };

    if (!email || typeof email !== 'string') {
      throw new ValidationError('Email is required');
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (!this._isValidEmail(normalizedEmail)) {
      throw new ValidationError('Please provide a valid email address');
    }

    const user = await User.findOne({ email: normalizedEmail, deletedAt: null });
    if (!user || !user.passwordHash) {
      return generic;
    }

    const latestActiveReset = await AccountToken.findOne({
      user: user._id,
      type: 'password-reset',
      usedAt: null
    }).sort({ createdAt: -1 });
    const cooldownMs = AUTH.PASSWORD_RESET_COOLDOWN_SECONDS * 1000;
    if (latestActiveReset?.createdAt && Date.now() - latestActiveReset.createdAt.getTime() < cooldownMs) {
      return generic;
    }

    await AccountToken.updateMany(
      { user: user._id, type: 'password-reset', usedAt: null },
      { usedAt: new Date() }
    );
    let resetToken = '';
    try {
      resetToken = await this._createAccountToken(user, 'password-reset');
    } catch (err) {
      if (err?.code === 11000) return generic;
      throw err;
    }

    try {
      const result = await EmailService.sendPasswordResetEmail({ user, token: resetToken });
      if (!result?.delivered) {
        await AccountToken.updateMany(
          { user: user._id, type: 'password-reset', usedAt: null },
          { usedAt: new Date() }
        );
      }
    } catch (err) {
      await AccountToken.updateMany(
        { user: user._id, type: 'password-reset', usedAt: null },
        { usedAt: new Date() }
      );
      console.error('Password reset email delivery failed:', JSON.stringify({
        userId: String(user._id),
        message: err.message
      }));
    }

    return generic;
  }

  async resetPassword(token, password) {
    if (!password || typeof password !== 'string') {
      throw new ValidationError('Password is required');
    }

    if (password.length < VALIDATION.PASSWORD_MIN_LENGTH || password.length > 128) {
      throw new ValidationError(`Password must be at least ${VALIDATION.PASSWORD_MIN_LENGTH} characters`);
    }

    const accountToken = await this._consumeAccountToken(token, 'password-reset');
    const user = await User.findById(accountToken.user);
    if (!user || user.deletedAt) {
      throw new NotFoundError('User', accountToken.user);
    }

    user.passwordHash = await this.hashPassword(password);
    user.authProvider = user.authProvider || 'email';
    user.passwordChangedAt = new Date();
    await Promise.all([
      user.save(),
      Session.updateMany(
        { user: user._id, revokedAt: null },
        { revokedAt: new Date() }
      )
    ]);

    return { message: 'Password reset successful.' };
  }

  /**
   * Refresh access token using refresh token
   * @param {string} refreshTokenId - Session/refresh token ID
   * @returns {Promise<Object>} { token, refreshToken, user }
   * @throws {ValidationError} If refresh token ID is invalid
   * @throws {AuthenticationError} If token is invalid or expired
   * @throws {NotFoundError} If user not found
   */
  async refreshToken(refreshTokenId, csrfToken) {
    if (!refreshTokenId || typeof refreshTokenId !== 'string') {
      throw new ValidationError('Refresh token is required');
    }

    const refreshTokenHash = this._hashRefreshToken(refreshTokenId);
    const session = await Session.findOne({
      $or: [
        { refreshTokenHash },
        { previousRefreshTokenHash: refreshTokenHash },
        { 'usedRefreshTokenHashes.tokenHash': refreshTokenHash }
      ]
    });

    if (!session || session.revokedAt || new Date() > session.expiresAt) {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    const usedTokenHashes = session.usedRefreshTokenHashes || [];
    const tokenWasAlreadyUsed = session.previousRefreshTokenHash === refreshTokenHash
      || usedTokenHashes.some((entry) => entry?.tokenHash === refreshTokenHash);

    if (tokenWasAlreadyUsed) {
      session.revokedAt = session.revokedAt || new Date();
      session.reusedAt = new Date();
      await session.save();
      throw new AuthenticationError('Refresh token reuse detected');
    }

    this._assertValidCsrfToken(session, csrfToken);

    // Get user
    const user = await User.findById(session.user);

    if (!user || user.deletedAt) {
      throw new NotFoundError('User', session.user);
    }

    if (!this._isValidEmail(user.email)) {
      throw new AuthenticationError('Session email is invalid');
    }

    const nextRefreshToken = this._generateRefreshToken();
    const nextCsrfToken = this._generateCsrfToken();
    const now = new Date();
    session.tokenVersion += 1;
    session.previousRefreshTokenHash = session.refreshTokenHash;
    session.usedRefreshTokenHashes = [
      ...usedTokenHashes,
      { tokenHash: session.refreshTokenHash, usedAt: now }
    ];
    session.refreshTokenHash = this._hashRefreshToken(nextRefreshToken);
    session.csrfTokenHash = this._hashAccountToken(nextCsrfToken);
    session.refreshTokenUsedAt = now;
    session.refreshTokenRotatedAt = now;
    await session.save();

    const token = this._signToken(user, session);

    return {
      token,
      refreshToken: nextRefreshToken,
      csrfToken: nextCsrfToken,
      user: this._formatUser(user)
    };
  }

  /**
   * Logout user by revoking session
   * @param {string} sessionId - Session ID
   * @returns {Promise<void>}
   * @throws {ValidationError} If session ID is invalid
   * @throws {NotFoundError} If session not found
   */
  async logout(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new ValidationError('Session ID is required');
    }

    const session = await Session.findById(sessionId);

    if (!session) {
      throw new NotFoundError('Session', sessionId);
    }

    session.revokedAt = new Date();
    await session.save();
  }

  /**
   * Hash a password using bcrypt
   * @param {string} plaintext - Plain password
   * @returns {Promise<string>} Hashed password
   */
  async hashPassword(plaintext) {
    if (!plaintext || typeof plaintext !== 'string') {
      throw new ValidationError('Password must be a string');
    }

    try {
      const hash = await bcrypt.hash(plaintext, AUTH.BCRYPT_SALT_ROUNDS || 10);
      return hash;
    } catch (err) {
      throw new Error('Failed to hash password');
    }
  }

  /**
   * Validate password against hash
   * @param {string} plaintext - Plain password
   * @param {string} hash - Hashed password
   * @returns {Promise<boolean>} true if password matches
   */
  async validatePassword(plaintext, hash) {
    if (!plaintext || typeof plaintext !== 'string') {
      return false;
    }

    if (!hash || typeof hash !== 'string') {
      return false;
    }

    try {
      const isMatch = await bcrypt.compare(plaintext, hash);
      return isMatch;
    } catch (err) {
      return false;
    }
  }

  /**
   * Get user profile
   * @param {string} userId - User ID
   * @returns {Promise<Object>} User object
   * @throws {NotFoundError} If user not found
   */
  async getProfile(userId) {
    const user = await User.findById(userId).select(
      'username fullName email passwordHash authProvider googleId profileImage emailVerifiedAt passwordChangedAt createdAt updatedAt lastLogin deletedAt'
    );

    if (!user || user.deletedAt) {
      throw new NotFoundError('User', userId);
    }

    return this._formatUser(user);
  }

  /**
   * Create auth payload (token + refresh token + user info)
   * @param {Object} user - User document
   * @returns {Promise<Object>} { token, refreshToken, user }
   * @private
   */
  async _createAuthPayload(user) {
    if (!this._isValidEmail(user.email)) {
      throw new AuthenticationError('Cannot create a session with an invalid email address');
    }

    user.fullName = user.fullName || user.username || user.email;
    user.lastLogin = new Date();
    if (typeof user.save === 'function') {
      await user.save();
    }

    const refreshToken = this._generateRefreshToken();
    const csrfToken = this._generateCsrfToken();
    const session = await Session.create({
      user: user._id,
      refreshTokenHash: this._hashRefreshToken(refreshToken),
      csrfTokenHash: this._hashAccountToken(csrfToken),
      expiresAt: new Date(
        Date.now() + AUTH.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
      )
    });

    const token = this._signToken(user, session);

    return {
      token,
      refreshToken,
      csrfToken,
      user: this._formatUser(user)
    };
  }

  /**
   * Sign JWT token
   * @param {Object} user - User document
   * @param {Object} session - Session document
   * @returns {string} JWT token
   * @private
   */
  _signToken(user, session) {
    return jwt.sign(
      {
        id: user._id,
        email: user.email,
        sessionId: session._id,
        tokenVersion: session.tokenVersion
      },
      getJwtSecret(),
      { expiresIn: AUTH.ACCESS_TOKEN_TTL }
    );
  }

  _generateRefreshToken() {
    return crypto.randomBytes(64).toString('base64url');
  }

  _hashRefreshToken(refreshToken) {
    return crypto.createHash('sha256').update(refreshToken).digest('hex');
  }

  /**
   * Create account token (for password reset, email verification, etc.)
   * @param {Object} user - User document
   * @param {string} type - Token type (password-reset, oauth-handoff)
   * @returns {Promise<string>} Opaque token
   * @private
   */
  async _createAccountToken(user, type, options = {}) {
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = this._hashAccountToken(token);
    const ttlMs = options.ttlMs || AUTH.ACCOUNT_TOKEN_TTL_HOURS * 60 * 60 * 1000;

    await AccountToken.create({
      user: user._id,
      type,
      tokenHash,
      expiresAt: new Date(Date.now() + ttlMs)
    });

    return token;
  }

  async _consumeAccountToken(token, type) {
    if (!token || typeof token !== 'string') {
      throw new ValidationError(type === 'password-reset' ? 'Reset link is required' : 'Token is required');
    }

    const now = new Date();
    const tokenHash = this._hashAccountToken(token);
    const accountToken = await AccountToken.findOneAndUpdate({
      tokenHash,
      type,
      usedAt: null,
      expiresAt: { $gt: now }
    }, {
      usedAt: now
    }, {
      returnDocument: 'after'
    });

    if (!accountToken) {
      await AccountToken.updateOne(
        { tokenHash, type, usedAt: null, expiresAt: { $lte: now } },
        { usedAt: now }
      );
      throw new AuthenticationError(type === 'password-reset' ? 'Invalid or expired reset link' : 'Invalid or expired token');
    }

    return accountToken;
  }

  _hashAccountToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  _generateCsrfToken() {
    return crypto.randomBytes(32).toString('base64url');
  }

  _generateNumericOtp() {
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  }

  _hashOtp(otp, userId, email) {
    return crypto
      .createHmac('sha256', getJwtSecret())
      .update(`${String(userId)}:${String(email).toLowerCase().trim()}:${String(otp)}`)
      .digest('hex');
  }

  _constantTimeOtpCompare(actualHash, expectedHash) {
    const actual = Buffer.from(String(actualHash || ''), 'hex');
    const expected = Buffer.from(String(expectedHash || ''), 'hex');
    if (actual.length !== expected.length) {
      const fallback = Buffer.from(this._hashAccountToken('otp-length-mismatch'), 'hex');
      crypto.timingSafeEqual(fallback, fallback);
      return false;
    }
    return crypto.timingSafeEqual(actual, expected);
  }

  async _sendEmailVerificationOtp(user, { enforceCooldown = false } = {}) {
    const normalizedEmail = String(user.email || '').toLowerCase().trim();
    if (!this._isValidEmail(normalizedEmail)) {
      throw new ValidationError('Cannot send OTP to an invalid email address');
    }

    const now = new Date();
    if (enforceCooldown) {
      const latestOtp = await EmailOtp.findOne({
        user: user._id,
        purpose: 'email-verification',
        usedAt: null
      }).sort({ createdAt: -1 });
      const cooldownMs = AUTH.EMAIL_OTP_RESEND_COOLDOWN_SECONDS * 1000;
      if (latestOtp?.lastSentAt && now - latestOtp.lastSentAt < cooldownMs) {
        return false;
      }
    }

    await EmailOtp.updateMany(
      { user: user._id, purpose: 'email-verification', usedAt: null },
      { usedAt: now }
    );

    const otp = this._generateNumericOtp();
    try {
      await EmailOtp.create({
        user: user._id,
        email: normalizedEmail,
        purpose: 'email-verification',
        otpHash: this._hashOtp(otp, user._id, normalizedEmail),
        attempts: 0,
        lastSentAt: now,
        expiresAt: new Date(now.getTime() + AUTH.EMAIL_OTP_TTL_MINUTES * 60 * 1000)
      });
    } catch (err) {
      if (err?.code === 11000) return false;
      throw err;
    }

    await EmailService.sendVerificationOtpEmail({
      user,
      otp,
      expiresInMinutes: AUTH.EMAIL_OTP_TTL_MINUTES
    });
    return true;
  }

  _assertValidCsrfToken(session, csrfToken) {
    if (!session.csrfTokenHash) {
      throw new AuthenticationError('Session CSRF token is missing');
    }

    if (!csrfToken || typeof csrfToken !== 'string') {
      throw new AuthenticationError('CSRF token is required');
    }

    const expected = Buffer.from(session.csrfTokenHash, 'hex');
    const actual = Buffer.from(this._hashAccountToken(csrfToken), 'hex');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      throw new AuthenticationError('CSRF token is invalid');
    }
  }

  _expiredTokenMessage(type) {
    if (type === 'password-reset') {
      return 'Password reset link expired. Please request a new email.';
    }
    if (type === 'oauth-handoff') {
      return 'Google sign-in expired. Please try again.';
    }
    return 'OTP expired. Please request a new OTP.';
  }

  async _verifyGoogleIdToken(idToken) {
    const response = await fetchWithTimeout(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      {},
      googleOauthTimeoutMs()
    ).catch((err) => {
      if (err?.name === 'AbortError') {
        throw new AuthenticationError('Google sign-in timed out. Please try again.');
      }
      throw new AuthenticationError('Google authentication failed');
    });
    const profile = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new AuthenticationError('Google authentication failed');
    }

    if (profile.aud !== process.env.GOOGLE_CLIENT_ID) {
      throw new AuthenticationError('Google token audience mismatch');
    }

    if (profile.email_verified !== 'true' && profile.email_verified !== true) {
      throw new AuthenticationError('Google account email is not verified');
    }

    if (!profile.sub) {
      throw new AuthenticationError('Google account identity is missing');
    }

    const normalizedEmail = String(profile.email || '').toLowerCase().trim();
    if (!this._isValidEmail(normalizedEmail)) {
      throw new AuthenticationError('Google account did not provide an email address');
    }

    return {
      googleId: profile.sub,
      email: normalizedEmail,
      fullName: profile.name || profile.email,
      profileImage: profile.picture || ''
    };
  }

  async _findOrCreateGoogleUser(googleUser) {
    if (!this._isValidEmail(googleUser.email)) {
      throw new AuthenticationError('Google account did not provide a valid email address');
    }

    const now = new Date();
    let user = await User.findOne({
      $or: [
        { googleId: googleUser.googleId, deletedAt: null },
        { email: googleUser.email, deletedAt: null }
      ]
    });

    if (user) {
      user.googleId = user.googleId || googleUser.googleId;
      user.fullName = user.fullName || googleUser.fullName;
      user.profileImage = googleUser.profileImage || user.profileImage || '';
      user.emailVerifiedAt = user.emailVerifiedAt || now;
      user.authProvider = 'google';
      await user.save();
      return user;
    }

    user = new User({
      username: await this._uniqueUsernameFromEmail(googleUser.email),
      fullName: googleUser.fullName,
      email: googleUser.email,
      authProvider: 'google',
      googleId: googleUser.googleId,
      profileImage: googleUser.profileImage,
      emailVerifiedAt: now
    });

    return user.save();
  }

  async _uniqueUsernameFromEmail(email) {
    const base = String(email)
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 32) || 'google-user';

    let candidate = base.length >= VALIDATION.USERNAME_MIN_LENGTH
      ? base
      : `${base}${crypto.randomBytes(2).toString('hex')}`;
    let suffix = 0;

    while (await User.findOne({ username: candidate })) {
      suffix += 1;
      candidate = `${base.slice(0, 40)}-${suffix}`;
    }

    return candidate;
  }

  /**
   * Format user object for response
   * @param {Object} user - User document
   * @returns {Object} Formatted user
   * @private
   */
  _formatUser(user) {
    return {
      uid: user._id,
      id: user._id,
      username: user.username,
      fullName: user.fullName || user.username,
      email: user.email,
      authProvider: user.authProvider || 'email',
      hasPassword: Boolean(user.passwordHash),
      googleConnected: Boolean(user.googleId || user.authProvider === 'google'),
      profileImage: user.profileImage || '',
      emailVerified: Boolean(user.emailVerifiedAt),
      emailVerifiedAt: user.emailVerifiedAt,
      passwordChangedAt: user.passwordChangedAt || null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLogin: user.lastLogin
    };
  }

  /**
   * Check if email format is valid (basic regex, not RFC 5322)
   * @param {string} email - Email to validate
   * @returns {boolean}
   * @private
   */
  _isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const normalizedEmail = email.toLowerCase().trim();
    if (normalizedEmail.length > 254 || normalizedEmail !== email.trim().toLowerCase()) return false;
    if (!VALIDATION.EMAIL_REGEX.test(normalizedEmail)) return false;

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
  }

  _isValidObjectId(value) {
    return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
  }
}

module.exports = new AuthService();
