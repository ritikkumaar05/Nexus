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
  const corsOptions = createCorsOptions();

  const result = await new Promise((resolve, reject) => {
    corsOptions.origin(undefined, (err, allowed) => {
      if (err) return reject(err);
      return resolve(allowed);
    });
  });

  assert.equal(result, true);
});
