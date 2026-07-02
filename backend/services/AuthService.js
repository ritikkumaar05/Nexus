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
const { AccountToken, Session, User } = require('../models');
const { getJwtSecret } = require('../config/env');
const {
  NotFoundError,
  AuthenticationError,
  ValidationError,
  ConflictError
} = require('../utils/AppError');
const { AUTH, VALIDATION } = require('../config/constants');

class AuthService {
  /**
   * Register a new user
   * @param {string} email - User email
   * @param {string} password - User password
   * @param {string} username - Username
   * @returns {Promise<Object>} { token, refreshToken, user, verificationToken }
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
      email: normalizedEmail,
      passwordHash
    });

    const savedUser = await newUser.save();

    // Create auth payload
    const authPayload = await this._createAuthPayload(savedUser);

    // Create email verification token
    const verificationToken = await this._createAccountToken(savedUser, 'email-verification');

    return {
      ...authPayload,
      verificationToken
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

    // Find user by email
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      throw new AuthenticationError('Invalid email or password');
    }

    // Verify password
    const isPasswordValid = await this.validatePassword(password, user.passwordHash);

    if (!isPasswordValid) {
      throw new AuthenticationError('Invalid email or password');
    }

    // Create auth payload
    const authPayload = await this._createAuthPayload(user);

    return authPayload;
  }

  /**
   * Refresh access token using refresh token
   * @param {string} refreshTokenId - Session/refresh token ID
   * @returns {Promise<Object>} { token, refreshToken, user }
   * @throws {ValidationError} If refresh token ID is invalid
   * @throws {AuthenticationError} If token is invalid or expired
   * @throws {NotFoundError} If user not found
   */
  async refreshToken(refreshTokenId) {
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

    // Get user
    const user = await User.findById(session.user);

    if (!user) {
      throw new NotFoundError('User', session.user);
    }

    const nextRefreshToken = this._generateRefreshToken();
    const now = new Date();
    session.tokenVersion += 1;
    session.previousRefreshTokenHash = session.refreshTokenHash;
    session.usedRefreshTokenHashes = [
      ...usedTokenHashes,
      { tokenHash: session.refreshTokenHash, usedAt: now }
    ];
    session.refreshTokenHash = this._hashRefreshToken(nextRefreshToken);
    session.refreshTokenUsedAt = now;
    session.refreshTokenRotatedAt = now;
    await session.save();

    const token = this._signToken(user, session);

    return {
      token,
      refreshToken: nextRefreshToken,
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
      'username email emailVerifiedAt createdAt updatedAt'
    );

    if (!user) {
      throw new NotFoundError('User', userId);
    }

    return user;
  }

  /**
   * Create auth payload (token + refresh token + user info)
   * @param {Object} user - User document
   * @returns {Promise<Object>} { token, refreshToken, user }
   * @private
   */
  async _createAuthPayload(user) {
    const refreshToken = this._generateRefreshToken();
    const session = await Session.create({
      user: user._id,
      refreshTokenHash: this._hashRefreshToken(refreshToken),
      expiresAt: new Date(
        Date.now() + AUTH.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
      )
    });

    const token = this._signToken(user, session);

    return {
      token,
      refreshToken,
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
   * @param {string} type - Token type (email-verification, password-reset)
   * @returns {Promise<string>} Opaque token
   * @private
   */
  async _createAccountToken(user, type) {
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await AccountToken.create({
      user: user._id,
      type,
      tokenHash,
      expiresAt: new Date(
        Date.now() + AUTH.ACCOUNT_TOKEN_TTL_HOURS * 60 * 60 * 1000
      )
    });

    return token;
  }

  /**
   * Format user object for response
   * @param {Object} user - User document
   * @returns {Object} Formatted user
   * @private
   */
  _formatUser(user) {
    return {
      id: user._id,
      username: user.username,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt
    };
  }

  /**
   * Check if email format is valid (basic regex, not RFC 5322)
   * @param {string} email - Email to validate
   * @returns {boolean}
   * @private
   */
  _isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
}

module.exports = new AuthService();
