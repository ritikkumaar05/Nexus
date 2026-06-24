const requiredInProduction = ['JWT_SECRET', 'MONGO_URI'];

const assertProductionEnv = () => {
  if (process.env.NODE_ENV !== 'production') return;

  const missing = requiredInProduction.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required production env vars: ${missing.join(', ')}`);
  }

  if (process.env.JWT_SECRET === 'fallback_secret_for_dev_only') {
    throw new Error('JWT_SECRET must not use the development fallback in production');
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
