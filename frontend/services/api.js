export const createApiClient = ({
  apiBase,
  getToken,
  getCsrfToken,
  onRefresh
}) => {
  const friendlyError = (message = '', status = 0) => {
    const text = String(message || '').trim();
    const lower = text.toLowerCase();

    if (status === 0 || lower.includes('failed to fetch') || lower.includes('networkerror')) {
      return "Couldn't connect right now. Check your connection and try again.";
    }
    if (lower.includes('verify your email') || lower.includes('otp expired')) {
      return text;
    }
    if (
      lower.includes('current password') ||
      lower.includes('deletion code') ||
      lower.includes('continue with google') ||
      lower.includes('google identity')
    ) {
      return text;
    }
    if (status === 401 || lower.includes('invalid or expired') || lower.includes('session expired')) {
      return 'Your session expired. Please sign in again.';
    }
    if (status === 403 || lower.includes('access denied')) {
      return "You don't have permission to do that in this workspace.";
    }
    if (status === 404) {
      return "We couldn't find that item. It may have been moved or deleted.";
    }
    if (status === 409 || lower.includes('already')) {
      return text || 'That already exists. Try a different name or email.';
    }
    if (status === 429 || lower.includes('too many')) {
      return 'That refreshed too often. Wait a moment and try again.';
    }
    if (status === 503 || lower.includes('not configured') || lower.includes('temporarily unavailable')) {
      return 'This feature is temporarily unavailable. Please try again later.';
    }
    if (lower.includes('request failed')) {
      return "Something didn't go through. Please try again.";
    }

    return text || "Something didn't go through. Please try again.";
  };

  const request = async (path, options = {}, retry = true) => {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    const token = getToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    const csrfToken = getCsrfToken?.();
    if (csrfToken && path === '/api/auth/refresh') {
      headers['X-CSRF-Token'] = csrfToken;
    }

    let response;
    try {
      response = await fetch(`${apiBase}${path}`, {
        ...options,
        headers,
        credentials: 'include'
      });
    } catch (err) {
      throw new Error(friendlyError(err.message, 0));
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (err) {
        data = { error: text };
      }
    }

    if (!response.ok) {
      const canRefresh = ![
        '/api/auth/login',
        '/api/auth/register',
        '/api/auth/verify-email',
        '/api/auth/resend-verification',
        '/api/auth/password/forgot',
        '/api/auth/password/reset',
        '/api/auth/google/complete'
      ].includes(path);
      if (response.status === 401 && retry && canRefresh && path !== '/api/auth/refresh') {
        const refreshed = await request('/api/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({})
        }, false);
        onRefresh?.(refreshed);
        return request(path, options, false);
      }
      if (response.status === 413) {
        if (path === '/api/ai/document-action') {
          throw new Error('This lecture is too large to process in one request. Nexus is preparing it in smaller sections.');
        }
        throw new Error('This content is too large to save. Try shortening the document or saving smaller study material.');
      }
      const detailMessage = Array.isArray(data?.details) && data.details[0]?.message
        ? data.details[0].message
        : '';
      const error = new Error(friendlyError(detailMessage || data?.error || `Request failed with ${response.status}`, response.status));
      error.status = response.status;
      error.code = data?.code || '';
      throw error;
    }

    return data;
  };

  return { request };
};
