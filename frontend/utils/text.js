export const friendlyUiMessage = (message = '', { isError = false } = {}) => {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();

  if (!text) return isError ? "Something didn't go through. Please try again." : '';
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return "Couldn't connect right now. Check your connection and try again.";
  }
  if (lower.includes('verify your email') || lower.includes('otp expired')) {
    return text;
  }
  if (lower.includes('invalid or expired refresh token') || lower.includes('invalid or expired token') || lower.includes('session expired')) {
    return 'Your session expired. Please sign in again.';
  }
  if (lower.includes('too many')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (lower.includes('gemini_api_key') || lower.includes('not configured')) {
    return 'AI is not available yet. Try again later or continue writing your notes.';
  }
  if (lower.includes('request failed')) {
    return "Something didn't go through. Please try again.";
  }

  return text;
};

export const isValidSignupUsername = (username = '') => /^[a-zA-Z0-9_-]{3,50}$/.test(username);

export const markdownFileName = (file) => (file?.name || 'uploaded-file').replace(/[\n\r[\]()]/g, ' ').trim() || 'uploaded-file';

export const getInitials = (value = '') => {
  const parts = String(value || 'User').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
};

export const formatRelativeTime = (dateValue) => {
  if (!dateValue) return 'Recently';
  const timestamp = new Date(dateValue).getTime();
  if (Number.isNaN(timestamp)) return 'Recently';
  const diff = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'Just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
};

export const formatChatTime = (dateValue) => {
  const date = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
