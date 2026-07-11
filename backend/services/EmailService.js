const { URL } = require('url');
const { ServiceUnavailableError } = require('../utils/AppError');
const fetchWithTimeout = require('../utils/fetchWithTimeout');

const emailTimeoutMs = () => Number(process.env.EMAIL_PROVIDER_TIMEOUT_MS || 10000);

const appBaseUrl = () => (
  process.env.FRONTEND_ORIGIN
  || process.env.APP_BASE_URL
  || 'http://localhost:5173'
).replace(/\/$/, '');

const buildHashUrl = (route, params = {}) => {
  const url = new URL(appBaseUrl());
  url.hash = `/${route}`;
  const query = new URLSearchParams(params);
  return `${url.origin}${url.pathname}${url.search}#/${route}?${query.toString()}`;
};

const sendViaHttpProvider = async ({ to, subject, text, html }) => {
  if (!process.env.EMAIL_PROVIDER_URL) return false;
  if (!process.env.EMAIL_FROM || !process.env.EMAIL_PROVIDER_API_KEY) {
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableError('Email delivery is not configured.');
    }
  }

  let response;
  try {
    response = await fetchWithTimeout(process.env.EMAIL_PROVIDER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.EMAIL_PROVIDER_API_KEY
          ? { Authorization: `Bearer ${process.env.EMAIL_PROVIDER_API_KEY}` }
          : {})
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        subject,
        html,
        text
      })
    }, emailTimeoutMs());
  } catch (err) {
    const timedOut = err?.name === 'AbortError';
    console.error(JSON.stringify({
      level: 'error',
      message: timedOut ? 'Email provider request timed out' : 'Email provider request failed',
      providerUrl: process.env.EMAIL_PROVIDER_URL,
      timeoutMs: emailTimeoutMs()
    }));
    throw new ServiceUnavailableError(timedOut
      ? 'Email delivery timed out. Please try again in a moment.'
      : 'Email delivery failed. Please try again in a moment.');
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(JSON.stringify({
      level: 'error',
      message: 'Email provider rejected request',
      status: response.status,
      providerUrl: process.env.EMAIL_PROVIDER_URL,
      bodyPreview: body.slice(0, 500)
    }));
    throw new ServiceUnavailableError('Email delivery failed. Please try again in a moment.');
  }

  return true;
};

const logDevelopmentEmail = ({ to, subject }) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('EMAIL_PROVIDER_URL is required to send email in production');
  }

  console.info(JSON.stringify({
    level: 'info',
    message: 'Development email generated',
    to,
    subject,
    note: 'Email body is intentionally redacted to avoid logging sensitive verification data.'
  }));
};

const sendEmail = async (message) => {
  const sent = await sendViaHttpProvider(message);
  if (!sent) logDevelopmentEmail(message);
  return sent;
};

const sendVerificationOtpEmail = async ({ user, otp, expiresInMinutes = 10 }) => {
  return sendEmail({
    to: user.email,
    subject: 'Your Nexus verification OTP',
    text: `Your Nexus email verification OTP is ${otp}. It expires in ${expiresInMinutes} minutes. If you did not request this, ignore this email.`,
    html: `
      <p>Welcome to Nexus.</p>
      <p>Your email verification OTP is:</p>
      <p style="font-size: 24px; font-weight: 700; letter-spacing: 4px;">${otp}</p>
      <p>This OTP expires in ${expiresInMinutes} minutes. If you did not request this, you can ignore this email.</p>
    `
  });
};

const sendPasswordResetEmail = async ({ user, token }) => {
  const resetUrl = buildHashUrl('reset-password', { token });
  const delivered = await sendEmail({
    to: user.email,
    subject: 'Reset your Nexus password',
    text: `Reset your Nexus password here: ${resetUrl}`,
    html: `
      <p>Use this link to reset your Nexus password:</p>
      <p><a href="${resetUrl}">Reset password</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    `
  });
  return { delivered };
};

const sendPasswordChangedEmail = async ({ user }) => {
  return sendEmail({
    to: user.email,
    subject: 'Your Nexus password was changed',
    text: 'Your Nexus password was changed. If this was not you, reset your password immediately and contact support.',
    html: `
      <p>Your Nexus password was changed.</p>
      <p>If this was not you, reset your password immediately and contact support.</p>
    `
  });
};

const sendAccountDeleteOtpEmail = async ({ user, otp, expiresInMinutes = 10 }) => {
  return sendEmail({
    to: user.email,
    subject: 'Confirm Nexus account deletion',
    text: `Your Nexus account deletion code is ${otp}. It expires in ${expiresInMinutes} minutes. If you did not request this, secure your account immediately.`,
    html: `
      <p>Your Nexus account deletion code is:</p>
      <p style="font-size: 24px; font-weight: 700; letter-spacing: 4px;">${otp}</p>
      <p>This code expires in ${expiresInMinutes} minutes. If you did not request this, secure your account immediately.</p>
    `
  });
};

module.exports = {
  buildHashUrl,
  sendAccountDeleteOtpEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendVerificationOtpEmail
};
