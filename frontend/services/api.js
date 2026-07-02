export const createApiClient = ({
  apiBase,
  getToken,
  onRefresh
}) => {
  const request = async (path, options = {}, retry = true) => {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    const token = getToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers,
      credentials: 'include'
    });

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
      if (response.status === 401 && retry && path !== '/api/auth/refresh') {
        const refreshed = await request('/api/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({})
        }, false);
        onRefresh?.(refreshed);
        return request(path, options, false);
      }
      if (response.status === 413) {
        throw new Error('This content is too large to save. Try shortening the document or saving smaller study material.');
      }
      throw new Error(data?.error || `Request failed with ${response.status}`);
    }

    return data;
  };

  return { request };
};
