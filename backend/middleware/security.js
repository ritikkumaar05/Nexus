const createMemoryRateLimit = ({ windowMs, max, message }) => {
  const hits = new Map();

  // Clean up expired entries every 5 minutes to prevent memory leaks
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (record.resetAt <= now) {
        hits.delete(key);
      }
    }
  }, 5 * 60 * 1000);

  if (interval.unref) {
    interval.unref();
  }

  return (req, res, next) => {
    const key = `${req.ip}:${req.originalUrl.split('?')[0]}`;
    const now = Date.now();
    const current = hits.get(key);

    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count > max) {
      return res
        .status(429)
        .json(typeof message === 'object' ? message : { error: message || 'Too many requests' });
    }

    return next();
  };
};

const loadHelmet = () => {
  try {
    return require('helmet');
  } catch (err) {
    return () => (_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Referrer-Policy', 'no-referrer');
      next();
    };
  }
};

const loadRateLimit = () => {
  try {
    return require('express-rate-limit');
  } catch (err) {
    return createMemoryRateLimit;
  }
};

const helmet = loadHelmet();
const rateLimit = loadRateLimit();

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts' }
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests' }
});

const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many message requests' }
});

module.exports = {
  aiLimiter,
  authLimiter,
  globalLimiter,
  helmet,
  messageLimiter
};
