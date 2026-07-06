const { URL } = require('url');

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

  const response = await fetch(process.env.EMAIL_PROVIDER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.EMAIL_PROVIDER_API_KEY
        ? { Authorization: `Bearer ${process.env.EMAIL_PROVIDER_API_KEY}` }
        : {})
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'Nexus <no-reply@nexus.local>',
      to,
      subject,
      text,
      html
    })
  });

  if (!response.ok) {
    throw new Error(`Email provider rejected message with ${response.status}`);
  }

  return true;
};

const logDevelopmentEmail = ({ to, subject, text }) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('EMAIL_PROVIDER_URL is required to send email in production');
  }

  console.info(JSON.stringify({
    level: 'info',
    message: 'Development email generated',
    to,
    subject,
    text
  }));
};

const sendEmail = async (message) => {
  const sent = await sendViaHttpProvider(message);
  if (!sent) logDevelopmentEmail(message);
};

const sendVerificationEmail = async ({ user, token }) => {
  const verificationUrl = buildHashUrl('verify-email', { token });
  await sendEmail({
    to: user.email,
    subject: 'Verify your Nexus email',
    text: `Welcome to Nexus. Verify your email to finish setup: ${verificationUrl}`,
    html: `
      <p>Welcome to Nexus.</p>
      <p>Verify your email to finish setup:</p>
      <p><a href="${verificationUrl}">Verify email</a></p>
      <p>This link expires soon. If it expires, request a new one from the sign-in page.</p>
    `
  });
  return verificationUrl;
};

const sendPasswordResetEmail = async ({ user, token }) => {
  const resetUrl = buildHashUrl('reset-password', { token });
  await sendEmail({
    to: user.email,
    subject: 'Reset your Nexus password',
    text: `Reset your Nexus password here: ${resetUrl}`,
    html: `
      <p>Use this link to reset your Nexus password:</p>
      <p><a href="${resetUrl}">Reset password</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    `
  });
  return resetUrl;
};

module.exports = {
  buildHashUrl,
  sendPasswordResetEmail,
  sendVerificationEmail
};
