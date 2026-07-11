import { state, setDocuments } from '../state/store.js';
import { connectSocket, disconnectSocket, teardownYDoc } from './socket.js';
import { pendingInviteRoute } from './invites.js';

let authSessionRuntime = null;

export const configureAuthSessionRuntime = (runtime) => {
  authSessionRuntime = runtime;
};

const appRuntime = () => {
  if (!authSessionRuntime) {
    throw new Error('Auth session runtime has not been configured.');
  }

  return authSessionRuntime;
};

export const saveSession = ({ token, user, csrfToken }) => {
  state.token = token;
  state.user = user;
  state.csrfToken = csrfToken || state.csrfToken || '';
  localStorage.setItem('user', JSON.stringify(user));
  if (state.csrfToken) localStorage.setItem('csrfToken', state.csrfToken);
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
};

export const clearSession = () => {
  disconnectSocket();
  teardownYDoc();
  sessionStorage.removeItem('demoMode');
  state.demoMode = false;
  state.token = '';
  state.csrfToken = '';
  state.user = null;
  state.workspaces = [];
  state.channels = [];
  setDocuments([]);
  state.messages = [];
  state.documentMessages = [];
  state.workspaceThreads = [];
  appRuntime().tasks.resetTaskStore();
  state.studyMaterials = [];
  state.demoStudyMaterials = [];
  state.activityItems = [];
  state.typingUsers = [];
  state.lastAiAction = '';
  state.lastAiOutput = '';
  state.aiStructuredOutput = null;
  state.aiStudySession = null;
  state.pendingDoubtLinkedText = '';
  state.presence = [];
  state.selectedWorkspaceId = '';
  state.selectedChannelId = '';
  state.selectedDocumentId = '';
  localStorage.removeItem('token');
  localStorage.removeItem('csrfToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  localStorage.removeItem('workspaceId');
  localStorage.removeItem('channelId');
  localStorage.removeItem('documentId');
};

export const bootstrapAuthenticatedSession = async () => {
  try {
    await connectSocket();
  } catch (err) {
    console.warn('Realtime connection failed after sign in:', err.message);
  }

  try {
    await appRuntime().workspace.loadWorkspaces();
    if (state.token && !state.demoMode) await appRuntime().routes.renderRoute();
  } catch (err) {
    appRuntime().shell.render();
    appRuntime().shell.showToast(`Signed in, but workspace loading failed: ${err.message}`, true);
  }
};

export const completeAuthenticatedSession = (result) => {
  saveSession(result);
  appRuntime().shell.showToast('Signed in');
  appRuntime().routes.navigate(pendingInviteRoute() || 'home');
  void bootstrapAuthenticatedSession();
};

export const restoreSessionFromRefresh = async () => {
  if (state.token || !state.csrfToken) return false;

  try {
    const result = await appRuntime().data.request('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({})
    }, false);
    saveSession(result);
    return true;
  } catch (err) {
    state.csrfToken = '';
    localStorage.removeItem('csrfToken');
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    return false;
  }
};

export const completeOAuthCallback = async () => {
  const handoffToken = appRuntime().routes.routeQuery().get('token') || '';
  const error = appRuntime().routes.routeQuery().get('error') || '';

  if (error) {
    appRuntime().shell.showToast(error, true);
    appRuntime().routes.navigate('login');
    return false;
  }

  if (!handoffToken) {
    appRuntime().shell.showToast('Google sign-in could not be completed.', true);
    appRuntime().routes.navigate('login');
    return false;
  }

  try {
    const result = await appRuntime().data.request('/api/auth/google/complete', {
      method: 'POST',
      body: JSON.stringify({ token: handoffToken })
    }, false);
    completeAuthenticatedSession(result);
    return true;
  } catch (err) {
    appRuntime().shell.showToast(appRuntime().shell.friendlyUiMessage(err.message, { isError: true }), true);
    appRuntime().routes.navigate('login');
    return false;
  }
};

export const handleLogout = async () => {
  if (state.demoMode) {
    clearSession();
    appRuntime().routes.navigate('login');
    await appRuntime().routes.renderRoute();
    appRuntime().shell.showToast('Exited demo workspace');
    return;
  }

  const logoutRequest = state.token
    ? appRuntime().data.request('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) })
    : Promise.resolve();

  clearSession();
  appRuntime().routes.navigate('login');
  await appRuntime().routes.renderRoute();
  appRuntime().shell.showToast('Logged out');
  logoutRequest.catch((err) => console.warn('Logout request failed:', err.message));
};
