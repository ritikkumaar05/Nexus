const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const AccountService = require('../services/AccountService');
const AuthService = require('../services/AuthService');
const EmailService = require('../services/EmailService');
const { createApp } = require('../app');
const { getJwtSecret } = require('../config/env');
const models = require('../models');
const { AccountToken, EmailOtp, Session, User } = models;
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
  const csrfToken = 'csrf-token';
  const oldHash = AuthService._hashRefreshToken(oldRefreshToken);
  const session = {
    _id: '507f1f77bcf86cd799439011',
    user: '507f1f77bcf86cd799439012',
    tokenVersion: 0,
    refreshTokenHash: oldHash,
    csrfTokenHash: AuthService._hashAccountToken(csrfToken),
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
    const refreshed = await AuthService.refreshToken(oldRefreshToken, csrfToken);
    assert.equal(refreshed.refreshToken === oldRefreshToken, false);
    assert.equal(typeof refreshed.csrfToken, 'string');
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
  const csrfToken = 'csrf-token';
  const baseSession = {
    _id: '507f1f77bcf86cd799439011',
    user: '507f1f77bcf86cd799439012',
    tokenVersion: 0,
    refreshTokenHash: AuthService._hashRefreshToken(token),
    csrfTokenHash: AuthService._hashAccountToken(csrfToken),
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

test('refresh rejects valid refresh token without matching CSRF token', async () => {
  const token = 'refresh-token';
  const session = {
    _id: '507f1f77bcf86cd799439011',
    user: '507f1f77bcf86cd799439012',
    tokenVersion: 0,
    refreshTokenHash: AuthService._hashRefreshToken(token),
    csrfTokenHash: AuthService._hashAccountToken('csrf-token'),
    previousRefreshTokenHash: '',
    usedRefreshTokenHashes: [],
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    async save() {}
  };

  await withPatchedModel([[Session, { findOne: async () => session }]], async () => {
    await assert.rejects(
      () => AuthService.refreshToken(token, 'wrong-csrf-token'),
      /CSRF token is invalid/
    );
  });
});

test('Google token verification rejects malformed verified email addresses', async () => {
  const originalFetch = global.fetch;
  const originalClientId = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = 'google-client-id';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      aud: 'google-client-id',
      sub: 'google-user-id',
      email: '@email.com',
      email_verified: true
    })
  });

  try {
    await assert.rejects(
      () => AuthService._verifyGoogleIdToken('id-token'),
      /Google account did not provide an email address/
    );
  } finally {
    global.fetch = originalFetch;
    if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = originalClientId;
  }
});

test('email verification OTP generation stores only a hash and response exposes no secret', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    email: 'verify@example.com',
    username: 'verify-user',
    emailVerifiedAt: null
  };
  let createdOtp = null;
  let sentOtp = '';

  await withPatchedModel([
    [User, { findOne: async () => user }],
    [EmailOtp, {
      findOne: () => ({ sort: async () => null }),
      updateMany: async () => ({ modifiedCount: 0 }),
      create: async (payload) => {
        createdOtp = payload;
        return payload;
      }
    }],
    [EmailService, {
      sendVerificationOtpEmail: async ({ otp }) => {
        sentOtp = otp;
      }
    }]
  ], async () => {
    const result = await AuthService.requestEmailVerification(user.email);

    assert.equal(result.verificationUrl, undefined);
    assert.equal(result.otp, undefined);
    assert.match(sentOtp, /^\d{6}$/);
    assert.equal(createdOtp.otpHash === sentOtp, false);
    assert.equal(createdOtp.otpHash, AuthService._hashOtp(sentOtp, user._id, user.email));
    assert.equal(createdOtp.attempts, 0);
  });
});

test('password reset request stores only a hashed token and exposes no reset URL', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    email: 'reset@example.com',
    username: 'reset-user',
    passwordHash: 'hash'
  };
  let createdToken = null;
  let updateManyCalls = 0;

  await withPatchedModel([
    [User, { findOne: async () => user }],
    [AccountToken, {
      findOne: () => ({ sort: async () => null }),
      updateMany: async () => {
        updateManyCalls += 1;
        return { modifiedCount: 0 };
      },
      create: async (payload) => {
        createdToken = payload;
        return payload;
      }
    }],
    [EmailService, {
      sendPasswordResetEmail: async () => ({
        resetUrl: 'http://localhost/reset-password?token=secret',
        delivered: true
      })
    }]
  ], async () => {
    const result = await AuthService.requestPasswordReset(user.email);

    assert.equal(result.resetUrl, undefined);
    assert.equal(result.token, undefined);
    assert.equal(createdToken.type, 'password-reset');
    assert.equal(createdToken.token, undefined);
    assert.equal(typeof createdToken.tokenHash, 'string');
    assert.equal(createdToken.tokenHash.length, 64);
    assert.equal(updateManyCalls, 1);
  });
});

test('password reset request enforces cooldown without revealing account state', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    email: 'reset@example.com',
    passwordHash: 'hash'
  };
  let createCalled = false;
  let sendCalled = false;

  await withPatchedModel([
    [User, { findOne: async () => user }],
    [AccountToken, {
      findOne: () => ({ sort: async () => ({ createdAt: new Date() }) }),
      updateMany: async () => ({ modifiedCount: 0 }),
      create: async () => {
        createCalled = true;
      }
    }],
    [EmailService, {
      sendPasswordResetEmail: async () => {
        sendCalled = true;
      }
    }]
  ], async () => {
    const result = await AuthService.requestPasswordReset(user.email);

    assert.equal(result.resetUrl, undefined);
    assert.equal(result.message, 'If an account exists, password reset instructions have been sent.');
    assert.equal(createCalled, false);
    assert.equal(sendCalled, false);
  });
});

test('password reset provider failure invalidates the freshly created token and stays generic', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    email: 'reset@example.com',
    passwordHash: 'hash'
  };
  let updateManyCalls = 0;

  await withPatchedModel([
    [User, { findOne: async () => user }],
    [AccountToken, {
      findOne: () => ({ sort: async () => null }),
      updateMany: async () => {
        updateManyCalls += 1;
        return { modifiedCount: 1 };
      },
      create: async (payload) => payload
    }],
    [EmailService, {
      sendPasswordResetEmail: async () => {
        throw new Error('provider unavailable');
      }
    }]
  ], async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      const result = await AuthService.requestPasswordReset(user.email);
      assert.equal(result.resetUrl, undefined);
      assert.equal(result.message, 'If an account exists, password reset instructions have been sent.');
      assert.equal(updateManyCalls, 2);
    } finally {
      console.error = originalError;
    }
  });
});

test('password reset consumes tokens atomically and revokes active sessions', async () => {
  const token = 'reset-token';
  const user = {
    _id: '507f1f77bcf86cd799439012',
    email: 'reset@example.com',
    username: 'reset-user',
    passwordHash: 'old-hash',
    authProvider: 'email',
    saveCount: 0,
    async save() {
      this.saveCount += 1;
    }
  };
  let consumed = false;
  let revokeQuery = null;

  await withPatchedModel([
    [AccountToken, {
      findOneAndUpdate: async (query, update) => {
        assert.equal(query.tokenHash, AuthService._hashAccountToken(token));
        assert.equal(query.type, 'password-reset');
        assert.equal(query.usedAt, null);
        assert.ok(query.expiresAt.$gt instanceof Date);
        assert.ok(update.usedAt instanceof Date);
        if (consumed) return null;
        consumed = true;
        return { user: user._id };
      },
      updateOne: async () => ({ modifiedCount: 0 })
    }],
    [User, { findById: async () => user }],
    [Session, {
      updateMany: async (query, update) => {
        revokeQuery = { query, update };
        return { modifiedCount: 3 };
      }
    }]
  ], async () => {
    const result = await AuthService.resetPassword(token, 'newpassword123');
    assert.equal(result.message, 'Password reset successful.');
    assert.equal(user.saveCount, 1);
    assert.notEqual(user.passwordHash, 'old-hash');
    assert.deepEqual(revokeQuery.query, { user: user._id, revokedAt: null });
    assert.ok(revokeQuery.update.revokedAt instanceof Date);

    await assert.rejects(
      () => AuthService.resetPassword(token, 'newpassword123'),
      /Invalid or expired reset link/
    );
  });
});

test('OAuth user can set a password without losing Google sign-in', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    email: 'google@example.com',
    username: 'google-user',
    authProvider: 'google',
    googleId: 'google-123',
    passwordHash: null,
    saveCount: 0,
    async save() {
      this.saveCount += 1;
    }
  };
  let revokeQuery = null;

  await withPatchedModel([
    [User, { findById: async () => user }],
    [Session, {
      updateMany: async (query, update) => {
        revokeQuery = { query, update };
        return { modifiedCount: 2 };
      }
    }],
    [models.AuditLog, { create: async (payload) => payload }]
  ], async () => {
    const result = await AccountService.setPassword(user._id, 'Newpass123', '507f1f77bcf86cd799439011');

    assert.equal(result.user.googleConnected, true);
    assert.equal(result.user.hasPassword, true);
    assert.equal(user.authProvider, 'google');
    assert.ok(user.passwordHash);
    assert.ok(user.passwordChangedAt instanceof Date);
    assert.equal(user.saveCount, 1);
    assert.deepEqual(revokeQuery.query, {
      user: user._id,
      revokedAt: null,
      _id: { $ne: '507f1f77bcf86cd799439011' }
    });
  });
});

test('set password rejects accounts that already have a password', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    email: 'local@example.com',
    passwordHash: 'hash'
  };

  await withPatchedModel([[User, { findById: async () => user }]], async () => {
    await assert.rejects(
      () => AccountService.setPassword(user._id, 'Newpass123'),
      /Password has already been set/
    );
  });
});

test('change password rejects wrong current password and records a failed audit event', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    email: 'local@example.com',
    passwordHash: await AuthService.hashPassword('Oldpass123')
  };
  let auditAction = '';

  await withPatchedModel([
    [User, { findById: async () => user }],
    [models.AuditLog, {
      create: async (payload) => {
        auditAction = payload.action;
        return payload;
      }
    }]
  ], async () => {
    await assert.rejects(
      () => AccountService.changePassword(user._id, 'Wrongpass123', 'Newpass123'),
      /Current password is incorrect/
    );
    assert.equal(auditAction, 'account.password_change_failed');
  });
});

test('account delete request verifies password and sends a single-use OTP', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    email: 'delete@example.com',
    passwordHash: await AuthService.hashPassword('Deletepass123')
  };
  let createdOtp = null;
  let sentOtp = null;
  let invalidatedOldOtps = false;

  await withPatchedModel([
    [User, { findById: async () => user }],
    [EmailOtp, {
      updateMany: async (query, update) => {
        invalidatedOldOtps = query.purpose === 'account-delete' && Boolean(update.usedAt);
        return { modifiedCount: 0 };
      },
      create: async (payload) => {
        createdOtp = payload;
        return payload;
      }
    }],
    [EmailService, {
      sendAccountDeleteOtpEmail: async ({ otp }) => {
        sentOtp = otp;
        return true;
      }
    }],
    [models.AuditLog, { create: async (payload) => payload }]
  ], async () => {
    const result = await AccountService.requestAccountDeletion(user._id, { currentPassword: 'Deletepass123' });

    assert.equal(result.message, 'Account deletion confirmation code sent.');
    assert.equal(invalidatedOldOtps, true);
    assert.equal(createdOtp.purpose, 'account-delete');
    assert.equal(createdOtp.otpHash.length, 64);
    assert.equal(sentOtp.length, 6);
    assert.equal(createdOtp.otpHash.includes(sentOtp), false);
  });
});

test('account delete confirm rejects wrong OTP and consumes after max attempts', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    email: 'delete@example.com'
  };
  const record = {
    otpHash: AuthService._hashOtp('111111', user._id, user.email),
    attempts: 4,
    usedAt: null,
    saveCount: 0,
    async save() {
      this.saveCount += 1;
    }
  };

  await withPatchedModel([
    [User, { findById: async () => user }],
    [EmailOtp, {
      findOne: () => ({ sort: async () => record }),
      updateMany: async () => ({ modifiedCount: 0 })
    }],
    [models.AuditLog, { create: async (payload) => payload }]
  ], async () => {
    await assert.rejects(
      () => AccountService.confirmAccountDeletion(user._id, { otp: '222222', confirmation: 'DELETE' }),
      /Invalid or expired deletion code/
    );
    assert.equal(record.attempts, 5);
    assert.ok(record.usedAt instanceof Date);
    assert.equal(record.saveCount, 1);
  });
});

test('account delete confirm consumes OTP, revokes sessions, and hard deletes owned data', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    email: 'delete@example.com'
  };
  const record = {
    otpHash: AuthService._hashOtp('123456', user._id, user.email),
    attempts: 0,
    usedAt: null,
    saveCount: 0,
    async save() {
      this.saveCount += 1;
    }
  };
  const calls = [];
  const deleteMany = (name) => async (query) => {
    calls.push([name, 'deleteMany', query]);
    return { deletedCount: 1 };
  };
  const updateMany = (name) => async (query, update) => {
    calls.push([name, 'updateMany', query, update]);
    return { modifiedCount: 1 };
  };

  await withPatchedModel([
    [User, {
      findById: async () => user,
      findOneAndUpdate: async () => user,
      deleteOne: deleteMany('User')
    }],
    [EmailOtp, {
      findOne: () => ({ sort: async () => record }),
      updateMany: updateMany('EmailOtp')
    }],
    [models.Workspace, {
      find: () => ({ select: () => ({ lean: async () => [{ _id: '507f1f77bcf86cd799439099' }] }) }),
      deleteMany: deleteMany('Workspace'),
      updateMany: updateMany('Workspace')
    }],
    [Session, { updateMany: updateMany('Session') }],
    [AccountToken, { updateMany: updateMany('AccountToken') }],
    [models.AiGenerationCache, { deleteMany: deleteMany('AiGenerationCache') }],
    [models.Attachment, { deleteMany: deleteMany('Attachment') }],
    [models.Channel, { deleteMany: deleteMany('Channel') }],
    [models.Comment, { deleteMany: deleteMany('Comment') }],
    [models.Document, { deleteMany: deleteMany('Document'), updateMany: updateMany('Document') }],
    [models.DocumentMessage, { deleteMany: deleteMany('DocumentMessage') }],
    [models.DocumentTask, { deleteMany: deleteMany('DocumentTask') }],
    [models.DocumentVersion, { deleteMany: deleteMany('DocumentVersion') }],
    [models.LearningEvent, { deleteMany: deleteMany('LearningEvent') }],
    [models.LearningMemory, { deleteMany: deleteMany('LearningMemory') }],
    [models.Message, { deleteMany: deleteMany('Message') }],
    [models.StudyMaterial, { deleteMany: deleteMany('StudyMaterial') }],
    [models.WorkspaceInvitation, { deleteMany: deleteMany('WorkspaceInvitation') }],
    [models.AuditLog, { create: async (payload) => payload, deleteMany: deleteMany('AuditLog'), updateMany: updateMany('AuditLog') }]
  ], async () => {
    const result = await AccountService.confirmAccountDeletion(user._id, { otp: '123456', confirmation: 'DELETE' });

    assert.equal(result.message, 'Account deleted successfully.');
    assert.ok(record.usedAt instanceof Date);
    assert.equal(record.saveCount, 1);
    assert.ok(calls.some(([name, method]) => name === 'Session' && method === 'updateMany'));
    assert.ok(calls.some(([name, method]) => name === 'AccountToken' && method === 'updateMany'));
    assert.ok(calls.some(([name, method]) => name === 'LearningMemory' && method === 'deleteMany'));
    assert.ok(calls.some(([name, method]) => name === 'Workspace' && method === 'deleteMany'));
    assert.ok(calls.some(([name, method]) => name === 'User' && method === 'deleteMany'));
  });
});

test('email verification OTP resend cooldown avoids creating a new OTP', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    email: 'cooldown@example.com',
    username: 'cooldown-user',
    emailVerifiedAt: null
  };
  let createCalled = false;
  let emailCalled = false;

  await withPatchedModel([
    [User, { findOne: async () => user }],
    [EmailOtp, {
      findOne: () => ({ sort: async () => ({ lastSentAt: new Date() }) }),
      updateMany: async () => ({ modifiedCount: 0 }),
      create: async () => {
        createCalled = true;
      }
    }],
    [EmailService, {
      sendVerificationOtpEmail: async () => {
        emailCalled = true;
      }
    }]
  ], async () => {
    const result = await AuthService.requestEmailVerification(user.email);

    assert.equal(result.verificationUrl, undefined);
    assert.equal(result.otp, undefined);
    assert.equal(createCalled, false);
    assert.equal(emailCalled, false);
  });
});

test('email verification rejects wrong OTP and increments attempts', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    email: 'wrong@example.com',
    username: 'wrong-user',
    emailVerifiedAt: null
  };
  const activeOtp = {
    _id: 'otp-wrong',
    otpHash: AuthService._hashOtp('123456', user._id, user.email),
    attempts: 0,
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    async save() {}
  };

  await withPatchedModel([
    [User, { findOne: async () => user }],
    [EmailOtp, {
      findOneAndUpdate: async (query, update) => {
        if (query._id === activeOtp._id && update.$inc?.attempts) {
          activeOtp.attempts += update.$inc.attempts;
          return activeOtp;
        }
        return null;
      },
      findOne: () => ({ sort: async () => activeOtp }),
      updateOne: async (query, update) => {
        if (query._id === activeOtp._id || !query._id) {
          if (update.$inc?.attempts) activeOtp.attempts += update.$inc.attempts;
          if (update.usedAt) activeOtp.usedAt = update.usedAt;
        }
      }
    }]
  ], async () => {
    await assert.rejects(
      () => AuthService.verifyEmail(user.email, '000000'),
      /Invalid or expired OTP/
    );
    assert.equal(activeOtp.attempts, 1);
    assert.equal(activeOtp.usedAt, null);
  });
});

test('email verification enforces maximum OTP attempts', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    email: 'attempts@example.com',
    username: 'attempts-user',
    emailVerifiedAt: null
  };
  const activeOtp = {
    _id: 'otp-attempts',
    otpHash: AuthService._hashOtp('123456', user._id, user.email),
    attempts: 4,
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    async save() {}
  };

  await withPatchedModel([
    [User, { findOne: async () => user }],
    [EmailOtp, {
      findOneAndUpdate: async (query, update) => {
        if (query._id === activeOtp._id && update.$inc?.attempts) {
          activeOtp.attempts += update.$inc.attempts;
          return activeOtp;
        }
        return null;
      },
      findOne: () => ({ sort: async () => activeOtp }),
      updateOne: async (_query, update) => {
        if (update.usedAt) activeOtp.usedAt = update.usedAt;
      }
    }]
  ], async () => {
    await assert.rejects(
      () => AuthService.verifyEmail(user.email, '000000'),
      /Invalid or expired OTP/
    );
    assert.equal(activeOtp.attempts, 5);
    assert.ok(activeOtp.usedAt);
  });
});

test('email verification rejects expired OTP and marks it used', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    email: 'expired@example.com',
    username: 'expired-user',
    emailVerifiedAt: null
  };
  const activeOtp = {
    _id: 'otp-expired',
    otpHash: AuthService._hashOtp('123456', user._id, user.email),
    attempts: 0,
    usedAt: null,
    expiresAt: new Date(Date.now() - 60_000),
    async save() {}
  };

  await withPatchedModel([
    [User, { findOne: async () => user }],
    [EmailOtp, {
      findOneAndUpdate: async () => null,
      findOne: () => ({ sort: async () => activeOtp }),
      updateOne: async (_query, update) => {
        if (update.usedAt) activeOtp.usedAt = update.usedAt;
      }
    }]
  ], async () => {
    await assert.rejects(
      () => AuthService.verifyEmail(user.email, '123456'),
      /Invalid or expired OTP/
    );
    assert.ok(activeOtp.usedAt);
  });
});

test('email verification accepts correct OTP, marks user verified, and invalidates active OTPs', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    email: 'correct@example.com',
    username: 'correct-user',
    emailVerifiedAt: null,
    async save() {}
  };
  const activeOtp = {
    _id: 'otp-correct',
    otpHash: AuthService._hashOtp('123456', user._id, user.email),
    attempts: 0,
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    async save() {}
  };
  let updateManyQuery = null;

  await withPatchedModel([
    [User, { findOne: async () => user }],
    [EmailOtp, {
      findOneAndUpdate: async (query, update) => {
        if (query.otpHash === activeOtp.otpHash && update.usedAt) {
          activeOtp.usedAt = update.usedAt;
          return activeOtp;
        }
        return null;
      },
      updateMany: async (query) => {
        updateManyQuery = query;
      }
    }]
  ], async () => {
    const result = await AuthService.verifyEmail(user.email, '123456');

    assert.equal(result.message, 'Email verified successfully.');
    assert.ok(user.emailVerifiedAt);
    assert.ok(activeOtp.usedAt);
    assert.equal(updateManyQuery.user, user._id);
    assert.equal(updateManyQuery.usedAt, null);
  });
});

test('concurrent email verification with same OTP only succeeds once', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    email: 'race@example.com',
    username: 'race-user',
    emailVerifiedAt: null,
    async save() {}
  };
  const activeOtp = {
    _id: 'otp-race',
    otpHash: AuthService._hashOtp('123456', user._id, user.email),
    attempts: 0,
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000)
  };
  let successfulConsumes = 0;

  await withPatchedModel([
    [User, { findOne: async () => user }],
    [EmailOtp, {
      findOneAndUpdate: async (query, update) => {
        if (query.otpHash === activeOtp.otpHash && !activeOtp.usedAt && update.usedAt) {
          activeOtp.usedAt = update.usedAt;
          successfulConsumes += 1;
          return activeOtp;
        }
        return null;
      },
      findOne: () => ({ sort: async () => (activeOtp.usedAt ? null : activeOtp) }),
      updateMany: async () => ({ modifiedCount: 0 })
    }]
  ], async () => {
    const results = await Promise.allSettled([
      AuthService.verifyEmail(user.email, '123456'),
      AuthService.verifyEmail(user.email, '123456')
    ]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(successfulConsumes, 1);
  });
});

test('concurrent verification resend only creates and emails one active OTP', async () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    email: 'resend-race@example.com',
    username: 'resend-race-user',
    emailVerifiedAt: null
  };
  let activeCreated = false;
  let createCount = 0;
  let emailCount = 0;

  await withPatchedModel([
    [User, { findOne: async () => user }],
    [EmailOtp, {
      findOne: () => ({ sort: async () => null }),
      updateMany: async () => ({ modifiedCount: 0 }),
      create: async () => {
        createCount += 1;
        if (activeCreated) {
          const err = new Error('duplicate active OTP');
          err.code = 11000;
          throw err;
        }
        activeCreated = true;
      }
    }],
    [EmailService, {
      sendVerificationOtpEmail: async () => {
        emailCount += 1;
      }
    }]
  ], async () => {
    const results = await Promise.allSettled([
      AuthService.requestEmailVerification(user.email),
      AuthService.requestEmailVerification(user.email)
    ]);

    assert.equal(results.every((result) => result.status === 'fulfilled'), true);
    assert.equal(createCount, 2);
    assert.equal(emailCount, 1);
  });
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
