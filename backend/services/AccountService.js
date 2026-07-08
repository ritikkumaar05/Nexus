const crypto = require('crypto');
const {
  AccountToken,
  AiGenerationCache,
  Attachment,
  AuditLog,
  Channel,
  Comment,
  Document,
  DocumentMessage,
  DocumentTask,
  DocumentVersion,
  EmailOtp,
  LearningEvent,
  LearningMemory,
  Message,
  Session,
  StudyMaterial,
  User,
  Workspace,
  WorkspaceInvitation
} = require('../models');
const { AUTH, VALIDATION } = require('../config/constants');
const AuthService = require('./AuthService');
const EmailService = require('./EmailService');
const { writeAuditLog } = require('../utils/audit');
const {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  ValidationError
} = require('../utils/AppError');

const DELETE_CONFIRMATIONS = new Set(['DELETE', 'Delete my account']);

const compactSession = (session = {}) => ({
  id: String(session._id),
  current: false,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  expiresAt: session.expiresAt,
  lastRotatedAt: session.refreshTokenRotatedAt || session.updatedAt
});

class AccountService {
  async getSecurityOverview(userId, currentSessionId = '') {
    const user = await this._requireUser(
      userId,
      'email passwordHash authProvider googleId emailVerifiedAt passwordChangedAt createdAt deletedAt'
    );

    return {
      account: {
        createdAt: user.createdAt || null
      },
      password: {
        hasPassword: Boolean(user.passwordHash),
        passwordChangedAt: user.passwordChangedAt || null
      },
      google: {
        connected: Boolean(user.googleId || user.authProvider === 'google'),
        clientId: process.env.GOOGLE_CLIENT_ID || ''
      },
      email: {
        address: user.email,
        verified: Boolean(user.emailVerifiedAt),
        verifiedAt: user.emailVerifiedAt || null
      }
    };
  }

  async getSecuritySessions(userId, currentSessionId = '') {
    const user = await this._requireUser(userId, '_id deletedAt');
    const sessions = await Session.find({ user: user._id, revokedAt: null, expiresAt: { $gt: new Date() } })
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean();

    return {
      sessions: sessions.map((session) => ({
        ...compactSession(session),
        current: String(session._id) === String(currentSessionId || '')
      }))
    };
  }

  async getSecurityActivity(userId) {
    const user = await this._requireUser(userId, '_id deletedAt');
    const activity = await AuditLog.find({
      $or: [
        { actor: user._id },
        { targetType: 'user', targetId: user._id }
      ]
    })
      .sort({ createdAt: -1 })
      .limit(12)
      .lean();

    return {
      activity: activity.map((entry) => ({
        id: String(entry._id),
        action: entry.action,
        createdAt: entry.createdAt,
        metadata: entry.metadata || {}
      }))
    };
  }

  async setPassword(userId, password, currentSessionId = '') {
    const user = await this._requireUser(userId);
    if (user.passwordHash) {
      throw new ConflictError('Password has already been set');
    }

    this._assertStrongPassword(password);
    user.passwordHash = await AuthService.hashPassword(password);
    user.passwordChangedAt = new Date();
    await user.save();

    await this._revokeOtherSessions(user._id, currentSessionId);
    await writeAuditLog({
      actor: user._id,
      action: 'account.password_set',
      targetType: 'user',
      targetId: user._id,
      metadata: { googleConnected: Boolean(user.googleId || user.authProvider === 'google') }
    });

    return {
      message: 'Password set successfully.',
      user: AuthService._formatUser(user)
    };
  }

  async changePassword(userId, currentPassword, newPassword, currentSessionId = '') {
    const user = await this._requireUser(userId);
    if (!user.passwordHash) {
      throw new ValidationError('Set a password before changing it');
    }

    const isCurrentPasswordValid = await AuthService.validatePassword(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      await writeAuditLog({
        actor: user._id,
        action: 'account.password_change_failed',
        targetType: 'user',
        targetId: user._id,
        metadata: { reason: 'invalid_current_password' }
      });
      throw new AuthenticationError('Current password is incorrect');
    }

    this._assertStrongPassword(newPassword);
    const isSamePassword = await AuthService.validatePassword(newPassword, user.passwordHash);
    if (isSamePassword) {
      throw new ValidationError('New password must be different from the current password');
    }

    user.passwordHash = await AuthService.hashPassword(newPassword);
    user.passwordChangedAt = new Date();
    await user.save();

    await Promise.all([
      this._revokeOtherSessions(user._id, currentSessionId),
      AccountToken.updateMany(
        { user: user._id, type: 'password-reset', usedAt: null },
        { usedAt: new Date() }
      )
    ]);

    await writeAuditLog({
      actor: user._id,
      action: 'account.password_changed',
      targetType: 'user',
      targetId: user._id
    });

    try {
      await EmailService.sendPasswordChangedEmail({ user });
    } catch (err) {
      console.error('Password change notification failed:', JSON.stringify({
        userId: String(user._id),
        message: err.message
      }));
    }

    return {
      message: 'Password changed successfully.',
      user: AuthService._formatUser(user)
    };
  }

  async requestAccountDeletion(userId, { currentPassword = '', googleIdToken = '' } = {}) {
    const user = await this._requireUser(userId);
    await this._verifyDeletePrimaryFactor(user, { currentPassword, googleIdToken });

    const now = new Date();
    await EmailOtp.updateMany(
      { user: user._id, purpose: 'account-delete', usedAt: null },
      { usedAt: now }
    );

    const otp = AuthService._generateNumericOtp();
    await EmailOtp.create({
      user: user._id,
      email: user.email,
      purpose: 'account-delete',
      otpHash: AuthService._hashOtp(otp, user._id, user.email),
      attempts: 0,
      lastSentAt: now,
      expiresAt: new Date(now.getTime() + AUTH.EMAIL_OTP_TTL_MINUTES * 60 * 1000)
    });

    await EmailService.sendAccountDeleteOtpEmail({
      user,
      otp,
      expiresInMinutes: AUTH.EMAIL_OTP_TTL_MINUTES
    });

    await writeAuditLog({
      actor: user._id,
      action: 'account.delete_requested',
      targetType: 'user',
      targetId: user._id
    });

    return { message: 'Account deletion confirmation code sent.' };
  }

  async confirmAccountDeletion(userId, { otp, confirmation } = {}) {
    const user = await this._requireUser(userId);
    if (!DELETE_CONFIRMATIONS.has(String(confirmation || '').trim())) {
      await this._auditFailedDelete(user, 'confirmation_mismatch');
      throw new ValidationError('Type DELETE to confirm account deletion');
    }

    await this._consumeDeleteOtp(user, otp);

    const lockedUser = await User.findOneAndUpdate(
      { _id: user._id, deletedAt: null },
      { deletedAt: new Date() },
      { returnDocument: 'after' }
    );
    if (!lockedUser) {
      await this._auditFailedDelete(user, 'already_deleting');
      throw new ConflictError('Account deletion is already in progress');
    }

    await this._hardDeleteUserData(lockedUser);

    return { message: 'Account deleted successfully.' };
  }

  async _verifyDeletePrimaryFactor(user, { currentPassword = '', googleIdToken = '' } = {}) {
    if (user.passwordHash) {
      const valid = await AuthService.validatePassword(currentPassword, user.passwordHash);
      if (!valid) {
        await this._auditFailedDelete(user, 'invalid_password');
        throw new AuthenticationError('Current password is incorrect');
      }
      return;
    }

    if (!user.googleId) {
      await this._auditFailedDelete(user, 'no_primary_factor');
      throw new AuthenticationError('No account verification method is available');
    }

    if (!googleIdToken || typeof googleIdToken !== 'string') {
      await this._auditFailedDelete(user, 'google_identity_required');
      throw new AuthenticationError('Continue with Google to confirm your identity');
    }

    const googleUser = await AuthService._verifyGoogleIdToken(googleIdToken);
    if (googleUser.googleId !== user.googleId || googleUser.email !== user.email) {
      await this._auditFailedDelete(user, 'google_identity_mismatch');
      throw new AuthenticationError('Google identity does not match this account');
    }
  }

  async _consumeDeleteOtp(user, otp) {
    const normalizedOtp = String(otp || '').trim();
    if (!/^\d{6}$/.test(normalizedOtp)) {
      await this._auditFailedDelete(user, 'invalid_otp_format');
      throw new AuthenticationError('Invalid or expired deletion code');
    }

    const now = new Date();
    const record = await EmailOtp.findOne({
      user: user._id,
      purpose: 'account-delete',
      usedAt: null,
      expiresAt: { $gt: now },
      attempts: { $lt: AUTH.EMAIL_OTP_MAX_ATTEMPTS }
    }).sort({ createdAt: -1 });

    if (!record) {
      await EmailOtp.updateMany(
        { user: user._id, purpose: 'account-delete', usedAt: null, expiresAt: { $lte: now } },
        { usedAt: now }
      );
      await this._auditFailedDelete(user, 'otp_missing_or_expired');
      throw new AuthenticationError('Invalid or expired deletion code');
    }

    if (!AuthService._constantTimeOtpCompare(record.otpHash, AuthService._hashOtp(normalizedOtp, user._id, user.email))) {
      record.attempts += 1;
      if (record.attempts >= AUTH.EMAIL_OTP_MAX_ATTEMPTS) {
        record.usedAt = now;
      }
      await record.save();
      await this._auditFailedDelete(user, 'otp_mismatch');
      throw new AuthenticationError('Invalid or expired deletion code');
    }

    record.usedAt = now;
    await record.save();
    await writeAuditLog({
      actor: user._id,
      action: 'account.delete_otp_verified',
      targetType: 'user',
      targetId: user._id
    });
  }

  async _hardDeleteUserData(user) {
    const userId = user._id;
    const ownedWorkspaces = await Workspace.find({ owner: userId }).select('_id').lean();
    const ownedWorkspaceIds = ownedWorkspaces.map((workspace) => workspace._id);
    const deletionMetadata = {
      userIdHash: this._sha256(String(userId)),
      emailHash: this._sha256(user.email),
      ownedWorkspaceCount: ownedWorkspaceIds.length,
      strategy: 'hard_delete'
    };

    if (ownedWorkspaceIds.length > 0) {
      await Promise.all([
        Attachment.deleteMany({ workspace: { $in: ownedWorkspaceIds } }),
        AiGenerationCache.deleteMany({ workspace: { $in: ownedWorkspaceIds } }),
        Channel.deleteMany({ workspace: { $in: ownedWorkspaceIds } }),
        Comment.deleteMany({ workspace: { $in: ownedWorkspaceIds } }),
        Document.deleteMany({ workspace: { $in: ownedWorkspaceIds } }),
        DocumentMessage.deleteMany({ workspace: { $in: ownedWorkspaceIds } }),
        DocumentTask.deleteMany({ workspace: { $in: ownedWorkspaceIds } }),
        DocumentVersion.deleteMany({ workspace: { $in: ownedWorkspaceIds } }),
        LearningEvent.deleteMany({ workspace: { $in: ownedWorkspaceIds } }),
        LearningMemory.deleteMany({ workspace: { $in: ownedWorkspaceIds } }),
        Message.deleteMany({ workspace: { $in: ownedWorkspaceIds } }),
        StudyMaterial.deleteMany({ workspace: { $in: ownedWorkspaceIds } }),
        WorkspaceInvitation.deleteMany({ workspace: { $in: ownedWorkspaceIds } }),
        AuditLog.deleteMany({ workspace: { $in: ownedWorkspaceIds } }),
        Workspace.deleteMany({ _id: { $in: ownedWorkspaceIds } })
      ]);
    }

    await Promise.all([
      Session.updateMany({ user: userId, revokedAt: null }, { revokedAt: new Date() }),
      AccountToken.updateMany({ user: userId, usedAt: null }, { usedAt: new Date() }),
      EmailOtp.updateMany({ user: userId, usedAt: null }, { usedAt: new Date() }),
      Workspace.updateMany({ owner: { $ne: userId } }, { $pull: { members: { user: userId } } }),
      Attachment.deleteMany({ uploadedBy: userId }),
      AiGenerationCache.deleteMany({ user: userId }),
      Comment.deleteMany({ author: userId }),
      DocumentMessage.deleteMany({ sender: userId }),
      DocumentTask.deleteMany({ $or: [{ assignee: userId }, { creator: userId }] }),
      DocumentVersion.deleteMany({ savedBy: userId }),
      LearningEvent.deleteMany({ user: userId }),
      LearningMemory.deleteMany({ user: userId }),
      Message.deleteMany({ sender: userId }),
      StudyMaterial.deleteMany({ $or: [{ createdBy: userId }, { updatedBy: userId }] }),
      WorkspaceInvitation.deleteMany({ invitedBy: userId }),
      Document.updateMany({ lastEditedBy: userId }, { $unset: { lastEditedBy: '' } }),
      AuditLog.updateMany({ actor: userId }, { actor: null }),
      AuditLog.updateMany({ targetType: 'user', targetId: userId }, { targetId: null }),
      writeAuditLog({
        actor: null,
        action: 'account.deleted',
        targetType: 'user',
        targetId: null,
        metadata: deletionMetadata
      })
    ]);

    await User.deleteOne({ _id: userId });
  }

  async _revokeOtherSessions(userId, currentSessionId = '') {
    const query = { user: userId, revokedAt: null };
    if (currentSessionId) {
      query._id = { $ne: currentSessionId };
    }
    return Session.updateMany(query, { revokedAt: new Date() });
  }

  async _requireUser(userId, projection = '') {
    const query = User.findById(userId);
    if (projection) query.select(projection);
    const user = await query;
    if (!user || user.deletedAt) {
      throw new NotFoundError('User', userId);
    }
    return user;
  }

  _assertStrongPassword(password) {
    if (!password || typeof password !== 'string') {
      throw new ValidationError('Password is required');
    }
    if (password.length < VALIDATION.PASSWORD_MIN_LENGTH || password.length > 128) {
      throw new ValidationError(`Password must be at least ${VALIDATION.PASSWORD_MIN_LENGTH} characters`);
    }
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      throw new ValidationError('Password must include uppercase, lowercase, and number characters');
    }
  }

  async _auditFailedDelete(user, reason) {
    await writeAuditLog({
      actor: user?._id || null,
      action: 'account.delete_failed',
      targetType: 'user',
      targetId: user?._id || null,
      metadata: { reason }
    });
  }

  _sha256(value = '') {
    return crypto.createHash('sha256').update(String(value || '').toLowerCase()).digest('hex');
  }
}

module.exports = new AccountService();
