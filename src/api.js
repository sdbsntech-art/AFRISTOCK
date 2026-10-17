const API_BASE = '/api';

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    if (response.status === 401 && path !== '/login' && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('afristock:session-expired'));
    }
    const message = typeof data === 'string' ? data : data?.error || 'Une erreur est survenue.';
    throw new Error(message);
  }

  return data;
}

export default apiRequest;
