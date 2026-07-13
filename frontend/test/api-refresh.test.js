import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiClient } from '../services/api.js';

const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('parallel 401 responses share one refresh and all retry successfully', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  let token = 'expired-token';
  let csrfToken = 'old-csrf';
  let refreshCount = 0;
  let oldTokenRequestCount = 0;
  let refreshedRequestCount = 0;

  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/api/auth/refresh')) {
      refreshCount += 1;
      assert.equal(options.headers['X-CSRF-Token'], 'old-csrf');
      await delay(15);
      return jsonResponse(200, { token: 'fresh-token', csrfToken: 'fresh-csrf', user: { id: 'user-1' } });
    }
    if (options.headers.Authorization === 'Bearer expired-token') {
      oldTokenRequestCount += 1;
      return jsonResponse(401, { error: 'Invalid or Expired Token' });
    }
    assert.equal(options.headers.Authorization, 'Bearer fresh-token');
    refreshedRequestCount += 1;
    return jsonResponse(200, { ok: true });
  };

  const { request } = createApiClient({
    apiBase: 'http://test.local',
    getToken: () => token,
    getCsrfToken: () => csrfToken,
    onRefresh: (session) => {
      token = session.token;
      csrfToken = session.csrfToken;
    }
  });

  const results = await Promise.all(
    Array.from({ length: 5 }, (_, index) => request(`/api/resource/${index}`))
  );

  assert.equal(refreshCount, 1);
  assert.equal(oldTokenRequestCount, 5);
  assert.equal(refreshedRequestCount, 5);
  assert.deepEqual(results, Array.from({ length: 5 }, () => ({ ok: true })));
});

test('a late old-token 401 retries with the refreshed token without rotating again', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  let token = 'expired-token';
  let csrfToken = 'old-csrf';
  let refreshCount = 0;

  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/api/auth/refresh')) {
      refreshCount += 1;
      await delay(5);
      return jsonResponse(200, { token: 'fresh-token', csrfToken: 'fresh-csrf', user: { id: 'user-1' } });
    }
    if (options.headers.Authorization === 'Bearer expired-token') {
      if (url.endsWith('/api/slow')) await delay(30);
      return jsonResponse(401, { error: 'Invalid or Expired Token' });
    }
    return jsonResponse(200, { ok: true, authorization: options.headers.Authorization });
  };

  const { request } = createApiClient({
    apiBase: 'http://test.local',
    getToken: () => token,
    getCsrfToken: () => csrfToken,
    onRefresh: (session) => {
      token = session.token;
      csrfToken = session.csrfToken;
    }
  });

  const [fast, slow] = await Promise.all([
    request('/api/fast'),
    request('/api/slow')
  ]);

  assert.equal(refreshCount, 1);
  assert.equal(fast.authorization, 'Bearer fresh-token');
  assert.equal(slow.authorization, 'Bearer fresh-token');
});

test('failed shared refresh invokes auth failure once and does not leave callers hanging', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  let token = 'expired-token';
  let refreshCount = 0;
  let authFailureCount = 0;

  globalThis.fetch = async (url) => {
    if (url.endsWith('/api/auth/refresh')) {
      refreshCount += 1;
      await delay(10);
      return jsonResponse(401, { error: 'CSRF token is invalid' });
    }
    return jsonResponse(401, { error: 'Invalid or Expired Token' });
  };

  const { request } = createApiClient({
    apiBase: 'http://test.local',
    getToken: () => token,
    getCsrfToken: () => 'invalid-csrf',
    onAuthFailure: () => {
      authFailureCount += 1;
      token = '';
    }
  });

  const results = await Promise.allSettled([
    request('/api/one'),
    request('/api/two'),
    request('/api/three')
  ]);

  assert.equal(refreshCount, 1);
  assert.equal(authFailureCount, 1);
  assert.equal(token, '');
  assert.ok(results.every((result) => result.status === 'rejected'));
  assert.ok(results.every((result) => result.reason.message === 'Your session expired. Please sign in again.'));
});

test('single expired request refreshes and retries normally', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  let token = 'expired-token';
  let refreshCount = 0;

  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/api/auth/refresh')) {
      refreshCount += 1;
      return jsonResponse(200, { token: 'fresh-token', csrfToken: 'fresh-csrf' });
    }
    return options.headers.Authorization === 'Bearer fresh-token'
      ? jsonResponse(200, { ok: true })
      : jsonResponse(401, { error: 'Invalid or Expired Token' });
  };

  const { request } = createApiClient({
    apiBase: 'http://test.local',
    getToken: () => token,
    getCsrfToken: () => 'csrf',
    onRefresh: (session) => { token = session.token; }
  });

  assert.deepEqual(await request('/api/resource'), { ok: true });
  assert.equal(refreshCount, 1);
});
