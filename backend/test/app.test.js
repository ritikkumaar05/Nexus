const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, createCorsOptions } = require('../app');

test('createApp returns an Express app without starting the server', () => {
  const { app, corsOptions } = createApp();

  assert.equal(typeof app.use, 'function');
  assert.equal(typeof app.get, 'function');
  assert.equal(typeof corsOptions.origin, 'function');
});

test('createCorsOptions allows requests without an origin header', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  const corsOptions = createCorsOptions();

  const result = await new Promise((resolve, reject) => {
    corsOptions.origin(undefined, (err, allowed) => {
      if (err) return reject(err);
      return resolve(allowed);
    });
  });

  assert.equal(result, true);
  process.env.NODE_ENV = previousNodeEnv;
});

test('createCorsOptions fails closed in production without configured origins', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCorsOrigin = process.env.CORS_ORIGIN;
  const previousFrontendOrigin = process.env.FRONTEND_ORIGIN;
  process.env.NODE_ENV = 'production';
  delete process.env.CORS_ORIGIN;
  delete process.env.FRONTEND_ORIGIN;

  assert.throws(
    () => createCorsOptions(),
    /CORS_ORIGIN or FRONTEND_ORIGIN is required in production/
  );

  process.env.NODE_ENV = previousNodeEnv;
  if (previousCorsOrigin === undefined) {
    delete process.env.CORS_ORIGIN;
  } else {
    process.env.CORS_ORIGIN = previousCorsOrigin;
  }
  if (previousFrontendOrigin === undefined) {
    delete process.env.FRONTEND_ORIGIN;
  } else {
    process.env.FRONTEND_ORIGIN = previousFrontendOrigin;
  }
});

test('createCorsOptions allows only configured origins in production', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCorsOrigin = process.env.CORS_ORIGIN;
  process.env.NODE_ENV = 'production';
  process.env.CORS_ORIGIN = 'https://nexus.example';

  const corsOptions = createCorsOptions();
  const allowed = await new Promise((resolve, reject) => {
    corsOptions.origin('https://nexus.example', (err, result) => {
      if (err) return reject(err);
      return resolve(result);
    });
  });

  assert.equal(allowed, true);
  const noOriginAllowed = await new Promise((resolve, reject) => {
    corsOptions.origin(undefined, (err, result) => {
      if (err) return reject(err);
      return resolve(result);
    });
  });
  assert.equal(noOriginAllowed, true);

  await assert.rejects(
    () => new Promise((resolve, reject) => {
      corsOptions.origin('https://evil.example', (err, result) => {
        if (err) return reject(err);
        return resolve(result);
      });
    }),
    /Origin not allowed by CORS/
  );

  process.env.NODE_ENV = previousNodeEnv;
  if (previousCorsOrigin === undefined) {
    delete process.env.CORS_ORIGIN;
  } else {
    process.env.CORS_ORIGIN = previousCorsOrigin;
  }
});

test('createCorsOptions allows the configured frontend domain', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCorsOrigin = process.env.CORS_ORIGIN;
  const previousFrontendOrigin = process.env.FRONTEND_ORIGIN;
  process.env.NODE_ENV = 'production';
  delete process.env.CORS_ORIGIN;
  process.env.FRONTEND_ORIGIN = 'https://app.nexus.example/';

  const corsOptions = createCorsOptions();
  const allowed = await new Promise((resolve, reject) => {
    corsOptions.origin('https://app.nexus.example', (err, result) => {
      if (err) return reject(err);
      return resolve(result);
    });
  });

  assert.equal(allowed, true);

  process.env.NODE_ENV = previousNodeEnv;
  if (previousCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = previousCorsOrigin;
  if (previousFrontendOrigin === undefined) delete process.env.FRONTEND_ORIGIN;
  else process.env.FRONTEND_ORIGIN = previousFrontendOrigin;
});
