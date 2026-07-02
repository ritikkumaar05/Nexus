const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const AuthService = require('../services/AuthService');
const { createApp } = require('../app');
const { getJwtSecret } = require('../config/env');
const { Session, User } = require('../models');
const { validateAccessToken } = require('../utils/sessionAuth');

const withPatchedModel = async (patches, fn) => {
  const originals = [];
  for (const [target, methods] of patches) {
    for (const [name, value] of Object.entries(methods)) {
      originals.push([target, name, target[name]]);
      target[name] = value;
    }
  }
  try {
    await fn();
  } finally {
    for (const [target, name, value] of originals.reverse()) {
      target[name] = value;
    }
  }
};

test('login response sets HttpOnly refresh cookie and omits refresh token JSON', async () => {
  const originalLogin = AuthService.login;
  AuthService.login = async () => ({
    token: 'access-token',
    refreshToken: 'refresh-token',
    user: { id: 'user-1', email: 'user@example.com' }
  });

  const { app } = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' })
    });
    const body = await response.json();
    const cookie = response.headers.get('set-cookie') || '';

    assert.equal(response.status, 200);
    assert.equal(body.refreshToken, undefined);
    assert.equal(body.token, 'access-token');
    assert.match(cookie, /nexus_refresh_token=refresh-token/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Path=\/api\/auth/);
  } finally {
    AuthService.login = originalLogin;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('auth payload creates a high-entropy refresh token and stores only its hash', async () => {
  let createdSession = null;
  await withPatchedModel([[Session, {
    create: async (payload) => {
      createdSession = payload;
      return { ...payload, _id: '507f1f77bcf86cd799439011', tokenVersion: 0 };
    }
  }]], async () => {
    const result = await AuthService._createAuthPayload({
      _id: '507f1f77bcf86cd799439012',
      email: 'user@example.com',
      username: 'user'
    });

    assert.equal(typeof result.refreshToken, 'string');
    assert.ok(result.refreshToken.length >= 80);
    assert.equal(createdSession.refreshToken, undefined);
    assert.equal(createdSession.refreshTokenHash, AuthService._hashRefreshToken(result.refreshToken));
    assert.notEqual(createdSession.refreshTokenHash, result.refreshToken);
  });
});

test('refresh rotates refresh token and rejects immediate reuse', async () => {
  const oldRefreshToken = 'old-refresh-token';
  const oldHash = AuthService._hashRefreshToken(oldRefreshToken);
  const session = {
    _id: '507f1f77bcf86cd799439011',
    user: '507f1f77bcf86cd799439012',
    tokenVersion: 0,
    refreshTokenHash: oldHash,
    previousRefreshTokenHash: '',
    usedRefreshTokenHashes: [],
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    saveCount: 0,
    async save() {
      this.saveCount += 1;
    }
  };

  await withPatchedModel([
    [Session, {
      findOne: async (query) => {
        const hashes = query.$or.map((entry) => entry.refreshTokenHash || entry.previousRefreshTokenHash);
        const usedHashes = query.$or
          .map((entry) => entry['usedRefreshTokenHashes.tokenHash'])
          .filter(Boolean);
        if (
          hashes.includes(session.refreshTokenHash)
          || hashes.includes(session.previousRefreshTokenHash)
          || usedHashes.some((hash) => session.usedRefreshTokenHashes.some((entry) => entry.tokenHash === hash))
        ) {
          return session;
        }
        return null;
      }
    }],
    [User, {
      findById: async () => ({
        _id: '507f1f77bcf86cd799439012',
        email: 'user@example.com',
        username: 'user'
      })
    }]
  ], async () => {
    const refreshed = await AuthService.refreshToken(oldRefreshToken);
    assert.equal(refreshed.refreshToken === oldRefreshToken, false);
    assert.equal(session.tokenVersion, 1);
    assert.equal(session.previousRefreshTokenHash, oldHash);
    assert.equal(session.usedRefreshTokenHashes[0].tokenHash, oldHash);
    assert.equal(session.refreshTokenHash, AuthService._hashRefreshToken(refreshed.refreshToken));

    await assert.rejects(
      () => AuthService.refreshToken(oldRefreshToken),
      /Refresh token reuse detected/
    );
    assert.ok(session.revokedAt);
    assert.ok(session.reusedAt);
  });
});

test('refresh rejects revoked and expired sessions', async () => {
  const token = 'refresh-token';
  const baseSession = {
    _id: '507f1f77bcf86cd799439011',
    user: '507f1f77bcf86cd799439012',
    tokenVersion: 0,
    refreshTokenHash: AuthService._hashRefreshToken(token),
    previousRefreshTokenHash: '',
    usedRefreshTokenHashes: [],
    async save() {}
  };

  for (const session of [
    { ...baseSession, revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
    { ...baseSession, revokedAt: null, expiresAt: new Date(Date.now() - 60_000) }
  ]) {
    await withPatchedModel([[Session, { findOne: async () => session }]], async () => {
      await assert.rejects(
        () => AuthService.refreshToken(token),
        /Invalid or expired refresh token/
      );
    });
  }
});

test('access token validation rejects revoked, expired, and rotated sessions', async () => {
  const token = jwt.sign(
    {
      id: '507f1f77bcf86cd799439012',
      email: 'user@example.com',
      sessionId: '507f1f77bcf86cd799439011',
      tokenVersion: 1
    },
    getJwtSecret(),
    { expiresIn: '15m' }
  );

  for (const session of [
    { revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), tokenVersion: 1 },
    { revokedAt: null, expiresAt: new Date(Date.now() - 60_000), tokenVersion: 1 },
    { revokedAt: null, expiresAt: new Date(Date.now() + 60_000), tokenVersion: 2 }
  ]) {
    await withPatchedModel([[Session, { findById: async () => session }]], async () => {
      await assert.rejects(
        () => validateAccessToken(token),
        /Session expired or revoked|Session token has been rotated/
      );
    });
  }
});
