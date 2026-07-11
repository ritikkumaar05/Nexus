const requiredInProduction = [
  'JWT_SECRET',
  'MONGO_URI',
  'CORS_ORIGIN',
  'FRONTEND_ORIGIN',
  'API_BASE_URL',
  'EMAIL_PROVIDER_URL',
  'EMAIL_PROVIDER_API_KEY',
  'EMAIL_FROM',
  'GEMINI_API_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT_URI'
];

const parseOriginList = (value = '') => value
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const assertUrl = (key, { requireHttps = false, allowCommaList = false, disallowLocalhost = false } = {}) => {
  const values = allowCommaList ? parseOriginList(process.env[key]) : [process.env[key]];
  if (values.length === 0) {
    throw new Error(`${key} must include at least one URL`);
  }
  for (const value of values) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch (err) {
      throw new Error(`${key} must be a valid ${requireHttps ? 'HTTPS ' : ''}URL${allowCommaList ? ' or comma-separated URL list' : ''}`);
    }
    if (requireHttps && parsed.protocol !== 'https:') {
      throw new Error(`${key} must use HTTPS in production`);
    }
    if (disallowLocalhost && ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(parsed.hostname)) {
      throw new Error(`${key} must not point to localhost in production`);
    }
  }
};

const extractEmailAddress = (value = '') => {
  const trimmed = value.trim();
  const match = trimmed.match(/<([^<>]+)>$/);
  return (match ? match[1] : trimmed).trim().toLowerCase();
};

const assertProductionEmailFrom = () => {
  const email = extractEmailAddress(process.env.EMAIL_FROM || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('EMAIL_FROM must be a valid sender email address in production');
  }

  const blockedSenders = new Set([
    'no-reply@example.com',
    'onboarding@resend.dev'
  ]);
  if (blockedSenders.has(email)) {
    throw new Error('EMAIL_FROM must use a verified production sender, not a test/default sender');
  }
};

const assertPositiveIntegerEnv = (key, defaultValue) => {
  const value = process.env[key] || String(defaultValue);
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
};

const assertProductionEnv = () => {
  if (process.env.NODE_ENV !== 'production') return;

  const missing = requiredInProduction.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required production env vars: ${missing.join(', ')}`);
  }

  if (process.env.JWT_SECRET === 'fallback_secret_for_dev_only') {
    throw new Error('JWT_SECRET must not use the development fallback in production');
  }

  if (process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }

  assertUrl('CORS_ORIGIN', { requireHttps: true, allowCommaList: true, disallowLocalhost: true });
  assertUrl('FRONTEND_ORIGIN', { requireHttps: true, disallowLocalhost: true });
  assertUrl('API_BASE_URL', { requireHttps: true, disallowLocalhost: true });
  assertUrl('EMAIL_PROVIDER_URL', { requireHttps: true, disallowLocalhost: true });
  assertUrl('GOOGLE_OAUTH_REDIRECT_URI', { requireHttps: true, disallowLocalhost: true });

  if (!process.env.GOOGLE_OAUTH_REDIRECT_URI.endsWith('/api/auth/google/callback')) {
    throw new Error('GOOGLE_OAUTH_REDIRECT_URI must end with /api/auth/google/callback');
  }

  assertProductionEmailFrom();
  assertPositiveIntegerEnv('EMAIL_PROVIDER_TIMEOUT_MS', 10000);
  assertPositiveIntegerEnv('GOOGLE_OAUTH_TIMEOUT_MS', 10000);

  const allowedSameSite = new Set(['none', 'lax']);
  const sameSite = (process.env.REFRESH_COOKIE_SAMESITE || 'none').toLowerCase();
  if (!allowedSameSite.has(sameSite)) {
    throw new Error('REFRESH_COOKIE_SAMESITE must be one of: none, lax in production');
  }
};

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  return secret || 'fallback_secret_for_dev_only';
};

module.exports = {
  assertProductionEnv,
  getJwtSecret
};
