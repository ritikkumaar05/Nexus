const requiredInProduction = [
  'JWT_SECRET',
  'MONGO_URI',
  'CORS_ORIGIN',
  'FRONTEND_ORIGIN',
  'API_BASE_URL',
  'EMAIL_PROVIDER_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT_URI'
];

const parseOriginList = (value = '') => value
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const assertUrl = (key, { requireHttps = false, allowCommaList = false } = {}) => {
  const values = allowCommaList ? parseOriginList(process.env[key]) : [process.env[key]];
  for (const value of values) {
    try {
      const parsed = new URL(value);
      if (requireHttps && parsed.protocol !== 'https:') {
        throw new Error('must use https');
      }
    } catch (err) {
      throw new Error(`${key} must be a valid ${requireHttps ? 'HTTPS ' : ''}URL${allowCommaList ? ' or comma-separated URL list' : ''}`);
    }
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

  assertUrl('CORS_ORIGIN', { requireHttps: true, allowCommaList: true });
  assertUrl('FRONTEND_ORIGIN', { requireHttps: true });
  assertUrl('API_BASE_URL', { requireHttps: true });
  assertUrl('EMAIL_PROVIDER_URL', { requireHttps: true });
  assertUrl('GOOGLE_OAUTH_REDIRECT_URI', { requireHttps: true });

  if (!process.env.GOOGLE_OAUTH_REDIRECT_URI.endsWith('/api/auth/google/callback')) {
    throw new Error('GOOGLE_OAUTH_REDIRECT_URI must end with /api/auth/google/callback');
  }

  const allowedSameSite = new Set(['none', 'lax', 'strict']);
  const sameSite = (process.env.REFRESH_COOKIE_SAMESITE || 'none').toLowerCase();
  if (!allowedSameSite.has(sameSite)) {
    throw new Error('REFRESH_COOKIE_SAMESITE must be one of: none, lax, strict');
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
