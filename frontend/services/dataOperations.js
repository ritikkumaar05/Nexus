import { state, collab, selectedWorkspace, selectedChannel, documentKey, selectedDocument, setDocuments, upsertDocument } from '../state/store.js';
import { currentRoute, navigate } from './router.js';
import { friendlyUiMessage } from '../utils/text.js';
import { connectSocket, disconnectSocket, teardownYDoc, setupYDoc, joinDocumentRoom, joinChannelRoom, joinWorkspaceChat } from './socket.js';

let dataRuntime = null;

export const configureDataRuntime = (runtime) => {
  dataRuntime = runtime;
};

const appRuntime = () => {
  if (!dataRuntime) {
    throw new Error('Data runtime has not been configured.');
  }
  return dataRuntime;
};

// Extracted Constants
export const GENERAL_CHAT_CHANNEL = 'general';
export const AUTOSAVE_DELAY_MS = 2800;
export const MAX_DOCUMENT_TEXT_CHARS = 200_000;
export const MAX_DOCUMENT_TEXT_BYTES = 850_000;
export const TASK_CACHE_TTL_MS = 45_000;

// Extracted Module State Variables
let autosaveTimer = null;
let dashboardHydrationTimer = null;
let flashcardProgressSaveTimer = null;
let activeDocumentLoadToken = 0;
const deletingDocumentIds = new Set();
let documentCreateInFlight = false;
let workspaceCreateInFlight = false;
let workspaceThreadsLoadSeq = 0;
let workspaceThreadsRequestKey = '';
let workspaceThreadsRequestPromise = null;
let workspaceThreadsLoadedKey = '';

// Getters & Setters for global bindings
export const getAutosaveTimer = () => autosaveTimer;
export const setAutosaveTimer = (val) => { autosaveTimer = val; };

export const getDashboardHydrationTimer = () => dashboardHydrationTimer;
export const setDashboardHydrationTimer = (val) => { dashboardHydrationTimer = val; };

export const getFlashcardProgressSaveTimer = () => flashcardProgressSaveTimer;
export const setFlashcardProgressSaveTimer = (val) => { flashcardProgressSaveTimer = val; };

export const getActiveDocumentLoadToken = () => activeDocumentLoadToken;
export const setActiveDocumentLoadToken = (val) => { activeDocumentLoadToken = val; };

export const getDeletingDocumentIds = () => deletingDocumentIds;

export const getDocumentCreateInFlight = () => documentCreateInFlight;
export const setDocumentCreateInFlight = (val) => { documentCreateInFlight = val; };

export const getWorkspaceCreateInFlight = () => workspaceCreateInFlight;
export const setWorkspaceCreateInFlight = (val) => { workspaceCreateInFlight = val; };

export const getWorkspaceThreadsLoadSeq = () => workspaceThreadsLoadSeq;
export const setWorkspaceThreadsLoadSeq = (val) => { workspaceThreadsLoadSeq = val; };

export const getWorkspaceThreadsRequestKey = () => workspaceThreadsRequestKey;
export const setWorkspaceThreadsRequestKey = (val) => { workspaceThreadsRequestKey = val; };

export const getWorkspaceThreadsRequestPromise = () => workspaceThreadsRequestPromise;
export const setWorkspaceThreadsRequestPromise = (val) => { workspaceThreadsRequestPromise = val; };

export const getWorkspaceThreadsLoadedKey = () => workspaceThreadsLoadedKey;
export const setWorkspaceThreadsLoadedKey = (val) => { workspaceThreadsLoadedKey = val; };

// Helper to check/clear autosaveTimer
export const clearAutosaveTimer = () => {
  if (autosaveTimer) {
    window.clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
};

const clearGlobalAutosaveTimer = () => {
  clearAutosaveTimer();
};

// Helper for unique documents filtering
const uniqueDocuments = (documents = []) => {
  const seen = new Set();
  return documents.filter((document) => {
    const key = documentKey(document);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Extracted Functions - Workspace & Document loaders

export const loadWorkspaces = async () => {
  if (state.demoMode) {
    await appRuntime().loadDemoWorkspaceModule();
    appRuntime().hydrateDemoWorkspace();
    appRuntime().loadDemoDocument(state.selectedDocumentId);
    return;
  }
  if (!state.token) return;
  appRuntime().setLoading('workspaces', true);
  try {
    state.workspaces = await appRuntime().request('/api/workspaces');
    appRuntime().setError('workspaces');
  } catch (err) {
    appRuntime().setError('workspaces', err.message);
    throw err;
  } finally {
    state.loading.workspaces = false;
  }

  if (!state.workspaces.some((workspace) => workspace._id === state.selectedWorkspaceId)) {
    state.selectedWorkspaceId = state.workspaces[0]?._id || '';
  }

  if (state.selectedWorkspaceId) {
    localStorage.setItem('workspaceId', state.selectedWorkspaceId);
    appRuntime().hydrateActivityItems();
    await Promise.all([loadChannels(), loadDocuments()]);
  } else {
    localStorage.removeItem('workspaceId');
    state.channels = [];
    state.documents = [];
    state.messages = [];
    state.activityItems = [];
    appRuntime().resetTaskStore();
  }

  appRuntime().render();
};

export const loadChannels = async () => {
  if (state.demoMode) {
    if (!state.channels.some((channel) => channel.slug === state.selectedChannelId)) {
      state.selectedChannelId = state.channels.some((channel) => channel.slug === GENERAL_CHAT_CHANNEL)
        ? GENERAL_CHAT_CHANNEL
        : state.channels[0]?.slug || '';
    }
    state.chatOnlineUsers = appRuntime().collaborationPeople().map((person) => ({
      userId: person.id,
      username: person.name,
      email: person.email
    }));
    appRuntime().render();
    return;
  }
  state.channels = [];
  state.messages = [];
  state.chatLoadedKey = '';
  state.selectedChannelId = '';
  if (!state.selectedWorkspaceId) return;

  appRuntime().setLoading('channels', true);
  try {
    state.channels = await appRuntime().request(`/api/channels/${state.selectedWorkspaceId}`);
    appRuntime().setError('channels');
  } catch (err) {
    appRuntime().setError('channels', err.message);
    throw err;
  } finally {
    state.loading.channels = false;
  }
  const savedChannelId = localStorage.getItem('channelId') || '';
  state.selectedChannelId = state.channels.some((channel) => channel.slug === GENERAL_CHAT_CHANNEL)
    ? GENERAL_CHAT_CHANNEL
    : state.channels.some((channel) => channel.slug === savedChannelId)
      ? savedChannelId
      : state.channels[0]?.slug || '';

  if (state.selectedChannelId) {
    localStorage.setItem('channelId', state.selectedChannelId);
    joinChannelRoom();
    joinWorkspaceChat();
    await loadMessages();
  }
};

export const loadMessages = async () => {
  if (state.demoMode) {
    appRuntime().render();
    return;
  }
  state.messages = [];
  if (!state.selectedWorkspaceId || !state.selectedChannelId) return;

  if (state.messages.length && appRuntime().activeChatChannel().slug === state.selectedChannelId) {
    appRuntime().render();
    return;
  }

  appRuntime().setLoading('messages', true);
  try {
    state.messages = await appRuntime().request(`/api/messages/${state.selectedWorkspaceId}/${state.selectedChannelId}`);
    state.chatLoadedKey = `${state.selectedWorkspaceId}:${state.selectedChannelId}`;
    appRuntime().setError('messages');
  } catch (err) {
    if (err?.status === 429) {
      appRuntime().setError('messages');
      return;
    }
    appRuntime().setError('messages', err.message);
    throw err;
  } finally {
    state.loading.messages = false;
  }
  appRuntime().render();
};

export const loadDocuments = async () => {
  if (state.demoMode) {
    appRuntime().loadDemoDocument(state.selectedDocumentId);
    return;
  }
  // Clear documents, tasks, and threads synchronously before any await so that
  // no stale data from the previous workspace leaks through the async fetch gap.
  // This mirrors the pattern already used by setDocuments([]) and loadChannels().
  setDocuments([]);
  appRuntime().resetTaskStore();
  state.workspaceThreads = [];
  workspaceThreadsLoadedKey = '';
  workspaceThreadsLoadSeq += 1;
  if (!state.selectedWorkspaceId) return;

  appRuntime().setLoading('documents', true);
  try {
    setDocuments(await appRuntime().request(`/api/documents/workspace/${state.selectedWorkspaceId}`));
    appRuntime().renderDocuments();
    appRuntime().setError('documents');
  } catch (err) {
    appRuntime().setError('documents', err.message);
    throw err;
  } finally {
    state.loading.documents = false;
    appRuntime().renderDocuments();
  }
  const savedDocumentId = localStorage.getItem('documentId') || '';
  state.selectedDocumentId = state.documents.some((document) => String(document._id) === String(savedDocumentId))
    ? savedDocumentId
    : state.documents[0]?._id || '';

  if (state.selectedDocumentId) {
    localStorage.setItem('documentId', state.selectedDocumentId);
    await loadDocument(state.selectedDocumentId);
  } else {
    localStorage.removeItem('documentId');
    teardownYDoc();
    state.documentMessages = [];
    state.studyMaterials = [];
    appRuntime().els.documentTitleInput.value = '';
    appRuntime().setEditorText('');
    appRuntime().setCollabStatus('No document selected');
    appRuntime().setAutosaveStatus('No document');
    appRuntime().render();
  }
};

export const loadDocument = async (documentId) => {
  await ensureCurrentDocumentSaved();
  if (state.demoMode) {
    appRuntime().loadDemoDocument(documentId);
    return;
  }
  const loadToken = ++activeDocumentLoadToken;
  if (!appRuntime().getActiveDocumentOpenProfile()) appRuntime().startDocumentOpenProfile(documentId);
  const loadStartedAt = performance.now();
  appRuntime().setLoading('document', true);
  let doc;
  try {
    doc = await appRuntime().request(`/api/documents/${documentId}`);
    if (loadToken !== activeDocumentLoadToken) return null;
    appRuntime().setError('document');
  } catch (err) {
    if (loadToken === activeDocumentLoadToken) {
      appRuntime().setError('document', err.message);
      appRuntime().recordDocumentOpenMeasure('loadDocument', loadStartedAt);
      appRuntime().finishDocumentOpenProfile();
      throw err;
    }
    return null;
  } finally {
    if (loadToken === activeDocumentLoadToken) {
      state.loading.document = false;
      if (!doc) appRuntime().renderEditor();
    }
  }
  if (loadToken !== activeDocumentLoadToken) return null;
  state.selectedDocumentId = doc._id;
  state.typingUsers = [];
  state.selectedThreadId = '';
  state.contextLoadedFor = { tasks: '', threads: '', library: '' };
  state.documentTasks = appRuntime().selectedDocumentTasks();
  state.documentMessages = [];
  state.studyMaterials = [];
  localStorage.setItem('documentId', doc._id);
  upsertDocument(doc, { prepend: true });
  appRuntime().renderDocuments();
  appRuntime().els.documentTitleInput.value = doc.title || 'Untitled Lecture';
  appRuntime().setEditorHtml(doc.contentHtml || '', doc.plainTextContent || '');
  state.lastSavedTitle = appRuntime().els.documentTitleInput.value;
  state.lastSavedText = doc.plainTextContent || '';
  state.lastSavedHtml = doc.contentHtml || '';
  state.saveStatus = 'saved';
  state.pendingSavePromise = null;
  state.saveQueued = false;
  await setupYDoc(doc._id);
  joinDocumentRoom(doc._id);
  appRuntime().setAutosaveStatus('Saved');
  state.lastAiAction = '';
  state.lastAiOutput = '';
  state.aiStudySession = null;
  appRuntime().renderAiEmptyState(doc);
  appRuntime().updateActiveDocumentSelection();
  appRuntime().renderEditor();
  appRuntime().ensureActiveContextData();
  appRuntime().scheduleDashboardDataLoad();
  appRuntime().recordDocumentOpenMeasure('loadDocument', loadStartedAt);
  appRuntime().finishDocumentOpenProfile();
};

export const backgroundDocumentBatch = (limit = 8) => {
  const selected = selectedDocument();
  return uniqueDocuments([
    selected,
    ...state.documents
  ].filter(Boolean)).slice(0, limit);
};

export const createDocumentAndOpen = async (title = 'Untitled Lecture') => {
  if (!state.selectedWorkspaceId) {
    appRuntime().showToast('Select a workspace first', true);
    return null;
  }
  if (documentCreateInFlight) {
    appRuntime().showToast('Document is already being created');
    return null;
  }

  documentCreateInFlight = true;
  try {
    const doc = await appRuntime().request('/api/documents', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: state.selectedWorkspaceId, title })
    });
    upsertDocument(doc, { prepend: true });
    await loadDocument(doc._id);
    appRuntime().renderDocuments();
    return doc;
  } finally {
    documentCreateInFlight = false;
  }
};

export const clearActiveDocumentAfterDelete = () => {
  activeDocumentLoadToken += 1;
  clearGlobalAutosaveTimer();
  teardownYDoc();
  state.selectedDocumentId = '';
  state.typingUsers = [];
  state.selectedThreadId = '';
  state.contextLoadedFor = { tasks: '', threads: '', library: '' };
  state.documentTasks = [];
  state.documentMessages = [];
  state.studyMaterials = [];
  state.lastSavedTitle = '';
  state.lastSavedText = '';
  state.lastSavedHtml = '';
  state.saveStatus = 'saved';
  state.pendingSavePromise = null;
  state.saveQueued = false;
  localStorage.removeItem('documentId');
  appRuntime().els.documentTitleInput.value = '';
  appRuntime().setEditorText('');
  appRuntime().setCollabStatus('No document selected');
  appRuntime().setAutosaveStatus('No document');
  appRuntime().renderAiEmptyState(null);
  appRuntime().render();
};

export const deleteDocumentById = async (documentId) => {
  const id = String(documentId || '');
  if (!id || deletingDocumentIds.has(id)) return;
  const index = state.documents.findIndex((item) => documentKey(item) === id);
  const doc = state.documents[index];
  if (!doc) return;

  const title = doc.title?.trim() || 'Untitled Lecture';
  const confirmed = window.confirm(`Are you sure you want to delete "${title}" lecture?`);
  if (!confirmed) return;

  deletingDocumentIds.add(id);
  appRuntime().renderDocuments();
  const wasActive = id === String(state.selectedDocumentId);

  try {
    clearGlobalAutosaveTimer();
    if (state.demoMode) {
      state.documents = state.documents.filter((item) => documentKey(item) !== id);
    } else {
      await appRuntime().request(`/api/documents/${id}`, { method: 'DELETE' });
      state.documents = state.documents.filter((item) => documentKey(item) !== id);
    }

    if (wasActive) {
      const nextDocument = state.documents[index] || state.documents[index - 1] || state.documents[0] || null;
      if (nextDocument) {
        if (state.demoMode) {
          appRuntime().loadDemoDocument(nextDocument._id);
        } else {
          await loadDocument(nextDocument._id);
        }
      } else {
        clearActiveDocumentAfterDelete();
      }
    } else {
      appRuntime().renderDocuments();
    }
    appRuntime().showToast('Lecture deleted');
  } catch (err) {
    appRuntime().showToast(err.message || 'Document delete failed', true);
  } finally {
    deletingDocumentIds.delete(id);
    appRuntime().renderDocuments();
  }
};

export const createDefaultChannel = async () => {
  const channel = await appRuntime().request(`/api/channels/${state.selectedWorkspaceId}`, {
    method: 'POST',
    body: JSON.stringify({ name: 'General', slug: 'general' })
  });
  state.channels.unshift(channel);
  state.selectedChannelId = channel.slug;
  localStorage.setItem('channelId', channel.slug);
};

export const createDefaultDocument = async () => {
  await createDocumentAndOpen('Project Notes');
};

export const bootstrapWorkspace = async () => {
  if (!state.selectedWorkspaceId) return;
  if (state.channels.length === 0) await createDefaultChannel();
  if (state.documents.length === 0) await createDefaultDocument();
  await loadMessages();
};

export const createWorkspaceAndOpen = async (name, { closePanel = false, route = 'home' } = {}) => {
  const workspaceName = String(name || '').trim();
  if (!workspaceName) {
    appRuntime().showToast('Workspace name is required', true);
    return null;
  }
  if (state.demoMode) {
    appRuntime().showToast('Demo mode uses the sample workspace. Sign up to create your own.');
    return null;
  }
  if (workspaceCreateInFlight) {
    appRuntime().showToast('Workspace is already being created');
    return null;
  }

  workspaceCreateInFlight = true;
  try {
    clearGlobalAutosaveTimer();
    if (state.selectedDocumentId) await appRuntime().saveCurrentDocumentIfDirty();

    const workspace = await appRuntime().request('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name: workspaceName })
    });

    state.workspaces = [
      workspace,
      ...state.workspaces.filter((item) => String(item._id) !== String(workspace._id))
    ];
    state.selectedWorkspaceId = workspace._id;
    state.selectedDocumentId = '';
    state.selectedChannelId = '';
    state.messages = [];
    state.activityItems = [];
    appRuntime().resetTaskStore();
    state.documentMessages = [];
    state.workspaceThreads = [];
    localStorage.setItem('workspaceId', workspace._id);
    localStorage.removeItem('documentId');
    localStorage.removeItem('channelId');
    teardownYDoc();
    appRuntime().render();

    if (closePanel) appRuntime().closeToolPanel();
    await loadWorkspaces();
    await bootstrapWorkspace();
    navigate(route);
    appRuntime().showToast('Workspace created');
    return workspace;
  } catch (err) {
    appRuntime().showToast(friendlyUiMessage(err.message, { isError: true }), true);
    return null;
  } finally {
    workspaceCreateInFlight = false;
  }
};

export const saveCurrentDocument = async ({ silent = false } = {}) => {
  if (!state.selectedDocumentId) return null;
  if (state.demoMode) return appRuntime().saveDemoDocument({ silent });

  const title = appRuntime().els.documentTitleInput.value || 'Untitled lecture';
  const plainTextContent = appRuntime().getEditorText();
  const contentHtml = appRuntime().getEditorHtml();
  const plainTextBytes = new TextEncoder().encode(plainTextContent).byteLength;
  if (plainTextContent.length > MAX_DOCUMENT_TEXT_CHARS || plainTextBytes > MAX_DOCUMENT_TEXT_BYTES) {
    const err = new Error('This document is too large to save. Shorten it before switching documents or leaving the page.');
    err.code = 'DOCUMENT_TOO_LARGE';
    state.saveStatus = 'error';
    appRuntime().setAutosaveStatus('Document too large to save');
    if (!silent) appRuntime().showToast(err.message, true);
    throw err;
  }
  if (title === state.lastSavedTitle && plainTextContent === state.lastSavedText && contentHtml === (state.lastSavedHtml || '')) {
    state.saveStatus = 'saved';
    appRuntime().setAutosaveStatus('Saved');
    return selectedDocument();
  }

  if (state.pendingSavePromise) {
    state.saveQueued = true;
    return state.pendingSavePromise;
  }

  state.saveStatus = 'saving';
  appRuntime().setAutosaveStatus(silent ? 'Autosaving...' : 'Saving...');
  state.pendingSavePromise = appRuntime().request(`/api/documents/${state.selectedDocumentId}`, {
    method: 'PUT',
    body: JSON.stringify({ title, plainTextContent, contentHtml })
  });

  try {
    const doc = await state.pendingSavePromise;
    state.lastSavedTitle = title;
    state.lastSavedText = plainTextContent;
    state.lastSavedHtml = contentHtml;
    state.saveStatus = 'saved';
    upsertDocument(doc, { prepend: true });
    if (plainTextContent.trim().length >= 200) {
      appRuntime().markLectureMilestone(doc._id, 'notesAdded', {
        message: 'Notes added',
        show: !silent
      });
    } else {
      appRuntime().refreshLectureProgress(doc._id);
    }
    appRuntime().setAutosaveStatus(silent ? 'Saved just now' : 'Saved');
    if (!silent) appRuntime().addActivity({ action: 'edited', target: doc.title || 'Untitled lecture', documentId: doc._id });
    if (silent) {
      appRuntime().refreshDocumentTitleChrome();
    } else {
      appRuntime().render();
    }
    return doc;
  } catch (err) {
    state.saveStatus = 'error';
    appRuntime().setAutosaveStatus('Save failed');
    throw err;
  } finally {
    state.pendingSavePromise = null;
    if (state.saveQueued) {
      state.saveQueued = false;
      const latestTitle = appRuntime().els.documentTitleInput.value || 'Untitled lecture';
      const latestText = appRuntime().getEditorText();
      const latestHtml = appRuntime().getEditorHtml();
      if (latestTitle !== state.lastSavedTitle || latestText !== state.lastSavedText || latestHtml !== (state.lastSavedHtml || '')) {
        scheduleAutosave();
      }
    }
  }
};

export const isDocumentDirty = () => {
  if (!state.selectedDocumentId) return false;
  const title = appRuntime().els.documentTitleInput.value || 'Untitled lecture';
  const plainTextContent = appRuntime().getEditorText();
  const contentHtml = appRuntime().getEditorHtml();
  return title !== state.lastSavedTitle ||
         plainTextContent !== state.lastSavedText ||
         contentHtml !== (state.lastSavedHtml || '');
};

export const ensureCurrentDocumentSaved = async () => {
  if (!state.selectedDocumentId) return;

  // 1. Wait for any current in-flight save to finish
  while (state.pendingSavePromise) {
    await state.pendingSavePromise;
  }

  // 2. If there are still dirty changes, trigger a save and wait for it
  if (isDocumentDirty()) {
    appRuntime().setAutosaveStatus('Saving changes before switching...');
    await saveCurrentDocument({ silent: true });
    while (state.pendingSavePromise) {
      await state.pendingSavePromise;
    }
  }
};

export const saveCurrentDocumentIfDirty = async () => {
  const saveStartedAt = performance.now();
  if (!state.selectedDocumentId) return null;
  try {
    const dirty = isDocumentDirty();
    console.log('[dirty-check]', {
      documentId: state.selectedDocumentId,
      dirty,
      action: dirty ? 'save' : 'skip'
    });
    if (!dirty) return selectedDocument();
    return await saveCurrentDocument({ silent: true });
  } finally {
    appRuntime().recordDocumentOpenMeasure('saveCurrentDocumentIfDirty', saveStartedAt);
  }
};

export const scheduleAutosave = () => {
  if (!state.selectedDocumentId) return;
  if (!isDocumentDirty()) {
    state.saveStatus = 'saved';
    appRuntime().setAutosaveStatus('Saved');
    return;
  }
  state.saveStatus = 'dirty';
  appRuntime().setAutosaveStatus('Unsaved changes');
  clearAutosaveTimer();
  autosaveTimer = window.setTimeout(() => {
    saveCurrentDocument({ silent: true }).catch((err) => {
      appRuntime().setAutosaveStatus('Autosave failed');
      appRuntime().showToast(err.message, true);
    });
  }, AUTOSAVE_DELAY_MS);
};

export const loadDashboardTasks = async ({ limit = 8, clear = false } = {}) => {
  if (clear) {
    appRuntime().resetTaskStore();
    if (appRuntime().currentRoute() === 'tasks') appRuntime().renderTasksBoard();
  }
  if (state.demoMode) {
    appRuntime().syncLegacyTaskViews();
    return;
  }
  if (!state.selectedWorkspaceId || state.documents.length === 0) return;

  const workspaceId = state.selectedWorkspaceId;
  const cacheIsWarm = state.taskStore.loadedWorkspaceId === workspaceId
    && state.taskStore.loadedAt
    && (Date.now() - state.taskStore.loadedAt < TASK_CACHE_TTL_MS);
  if (!clear && cacheIsWarm) {
    appRuntime().syncLegacyTaskViews();
    return;
  }

  state.taskStore.loading = true;
  state.taskStore.error = '';
  try {
    const tasks = await appRuntime().request(`/api/workspaces/${workspaceId}/tasks`);
    if (workspaceId !== state.selectedWorkspaceId) return;
    appRuntime().setWorkspaceTasks(tasks, { workspaceId });
  } catch (err) {
    const docs = backgroundDocumentBatch(limit);
    const taskResults = await Promise.allSettled(docs.map((doc) => (
      appRuntime().request(`/api/workspaces/${workspaceId}/documents/${doc._id}/tasks`)
    )));
    if (workspaceId !== state.selectedWorkspaceId) return;
    const tasks = taskResults
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value || []);
    appRuntime().setWorkspaceTasks(tasks, { workspaceId });
    state.taskStore.error = err.message;
  } finally {
    if (workspaceId === state.selectedWorkspaceId) {
      state.taskStore.loading = false;
    }
  }
};

export const loadDocumentTasks = async () => {
  if (state.demoMode) {
    state.documentTasks = appRuntime().selectedDocumentTasks();
    appRuntime().renderTaskList();
    return;
  }
  state.documentTasks = appRuntime().selectedDocumentTasks();
  if (!state.selectedWorkspaceId || !state.selectedDocumentId) return;
  const workspaceId = state.selectedWorkspaceId;
  const documentId = state.selectedDocumentId;
  appRuntime().setLoading('tasks', true, { scoped: true });
  try {
    const tasks = await appRuntime().request(`/api/workspaces/${workspaceId}/documents/${documentId}/tasks`);
    if (workspaceId !== state.selectedWorkspaceId || documentId !== state.selectedDocumentId) return;
    tasks.forEach((task) => appRuntime().upsertTaskInStore(task));
    state.documentTasks = appRuntime().selectedDocumentTasks();
    appRuntime().setError('tasks');
  } catch (err) {
    if (workspaceId !== state.selectedWorkspaceId || documentId !== state.selectedDocumentId) return;
    appRuntime().setError('tasks', err.message);
    throw err;
  } finally {
    if (workspaceId === state.selectedWorkspaceId && documentId === state.selectedDocumentId) {
      state.loading.tasks = false;
    }
  }
  appRuntime().renderTaskList();
};

export const fetchWorkspaceThreadsForDocuments = async (docs = [], { limitPerDocument = 80 } = {}) => {
  const documentIds = docs.map((doc) => documentKey(doc)).filter(Boolean);
  if (!documentIds.length) return [];

  const query = new URLSearchParams({
    documentIds: documentIds.join(','),
    limit: String(limitPerDocument)
  });

  try {
    return await appRuntime().request(`/api/workspaces/${state.selectedWorkspaceId}/thread-summaries?${query.toString()}`);
  } catch (err) {
    const threadResults = await Promise.allSettled(docs.map(async (doc) => {
      const threads = await appRuntime().request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${doc._id}/messages`);
      return threads.map((thread) => ({
        ...thread,
        documentId: doc._id,
        documentTitle: doc.title || 'Untitled Lecture'
      }));
    }));
    if (!threadResults.some((result) => result.status === 'fulfilled')) {
      throw threadResults.find((result) => result.status === 'rejected')?.reason || err;
    }
    return threadResults
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value || []);
  }
};

export const loadWorkspaceThreads = async ({ limit = 8, clear = false, force = false } = {}) => {
  if (clear) {
    state.workspaceThreads = [];
    workspaceThreadsLoadedKey = '';
  }
  if (state.demoMode) {
    state.workspaceThreads = state.documentMessages.map((thread) => ({
      ...thread,
      documentId: state.selectedDocumentId,
      documentTitle: appRuntime().selectedDocumentTitle()
    }));
    state.loading.threads = false;
    appRuntime().setError('threads');
    return;
  }
  if (!state.selectedWorkspaceId || state.documents.length === 0) return;

  const docs = backgroundDocumentBatch(limit);
  const docIds = docs.map((doc) => documentKey(doc)).filter(Boolean);
  const requestKey = `${state.selectedWorkspaceId}:${docIds.join(',')}:${limit}`;
  if (!force && state.workspaceThreads.length && workspaceThreadsLoadedKey === requestKey) {
    return state.workspaceThreads;
  }
  if (workspaceThreadsRequestPromise && workspaceThreadsRequestKey === requestKey) {
    return workspaceThreadsRequestPromise;
  }

  const loadSeq = ++workspaceThreadsLoadSeq;
  const workspaceId = state.selectedWorkspaceId;
  workspaceThreadsRequestKey = requestKey;
  appRuntime().setError('threads');
  appRuntime().setLoading('threads', true);

  workspaceThreadsRequestPromise = fetchWorkspaceThreadsForDocuments(docs)
    .then((threads) => {
      if (loadSeq !== workspaceThreadsLoadSeq || workspaceId !== state.selectedWorkspaceId) {
        return state.workspaceThreads;
      }
      state.workspaceThreads = threads
        .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
      workspaceThreadsLoadedKey = requestKey;
      return state.workspaceThreads;
    })
    .catch((err) => {
      if (loadSeq === workspaceThreadsLoadSeq) appRuntime().setError('threads', err.message);
      throw err;
    })
    .finally(() => {
      if (workspaceThreadsRequestKey === requestKey) {
        workspaceThreadsRequestKey = '';
        workspaceThreadsRequestPromise = null;
      }
      if (loadSeq === workspaceThreadsLoadSeq) {
        appRuntime().setLoading('threads', false);
      }
    });

  return workspaceThreadsRequestPromise;
};

export const loadDocumentMessages = async () => {
  if (state.demoMode) {
    appRuntime().renderThreadList();
    return;
  }
  state.documentMessages = [];
  if (!state.selectedWorkspaceId || !state.selectedDocumentId) return;
  const workspaceId = state.selectedWorkspaceId;
  const documentId = state.selectedDocumentId;
  appRuntime().setLoading('messages', true, { scoped: true });
  try {
    const messages = await appRuntime().request(`/api/workspaces/${workspaceId}/documents/${documentId}/messages`);
    if (workspaceId !== state.selectedWorkspaceId || documentId !== state.selectedDocumentId) return;
    state.documentMessages = messages;
    state.workspaceThreads = [
      ...state.workspaceThreads.filter((thread) => String(thread.documentId) !== String(documentId)),
      ...state.documentMessages.map((thread) => ({
        ...thread,
        documentId,
        documentTitle: appRuntime().selectedDocumentTitle()
      }))
    ];
    appRuntime().setError('messages');
  } catch (err) {
    if (workspaceId !== state.selectedWorkspaceId || documentId !== state.selectedDocumentId) return;
    appRuntime().setError('messages', err.message);
    throw err;
  } finally {
    if (workspaceId === state.selectedWorkspaceId && documentId === state.selectedDocumentId) {
      state.loading.messages = false;
    }
  }
  appRuntime().renderThreadList();
};

export const scheduleDashboardDataLoad = () => {
  window.clearTimeout(dashboardHydrationTimer);
  if (!state.selectedWorkspaceId || state.documents.length === 0) return;
  if (state.demoMode) {
    loadDashboardTasks();
    loadWorkspaceThreads();
    return;
  }

  const workspaceId = state.selectedWorkspaceId;
  dashboardHydrationTimer = window.setTimeout(async () => {
    if (workspaceId !== state.selectedWorkspaceId) return;
    try {
      const route = appRuntime().currentRoute();
      await Promise.allSettled([
        loadDashboardTasks({ limit: route === 'tasks' ? state.documents.length : 8 }),
        loadWorkspaceThreads({ limit: route === 'threads' ? state.documents.length : 8 })
      ]);
      if (workspaceId !== state.selectedWorkspaceId) return;
      const currentRouteNow = appRuntime().currentRoute();
      if (currentRouteNow === 'home') appRuntime().renderHomePage();
      if (currentRouteNow === 'threads') appRuntime().renderThreadsPage();
      if (currentRouteNow === 'tasks') appRuntime().renderTasksBoard();
    } catch (err) {
      console.warn('Background dashboard refresh failed:', err);
    }
  }, 160);
};

export const loadStudyMaterialsForDocument = async (documentId = state.selectedDocumentId) => {
  state.studyMaterials = [];
  state.selectedStudyMaterialId = '';
  state.currentAiResultSavedId = '';
  if (!documentId) {
    appRuntime().renderStudyLibrary();
    return;
  }
  if (state.demoMode) {
    state.studyMaterials = state.demoStudyMaterials
      .filter((material) => String(material.documentId) === String(documentId))
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    appRuntime().renderStudyLibrary();
    return;
  }

  const activeDocumentId = documentId;
  appRuntime().setLoading('studyMaterials', true, { scoped: true });
  try {
    const materials = await appRuntime().request(`/api/study-material/document/${activeDocumentId}`);
    if (String(activeDocumentId) !== String(state.selectedDocumentId)) return;
    state.studyMaterials = materials;
    appRuntime().setError('studyMaterials');
  } catch (err) {
    if (String(activeDocumentId) !== String(state.selectedDocumentId)) return;
    appRuntime().setError('studyMaterials', err.message);
  } finally {
    if (String(activeDocumentId) === String(state.selectedDocumentId)) {
      state.loading.studyMaterials = false;
      appRuntime().renderStudyLibrary();
    }
  }
};

export const upsertStudyMaterial = (material) => {
  if (!material?._id) return;
  state.studyMaterials = [
    material,
    ...state.studyMaterials.filter((item) => String(item._id) !== String(material._id))
  ].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
};

export const saveCurrentAiResultToLibrary = async () => {
  if (!state.selectedDocumentId) return appRuntime().showToast('Open a document before saving study material', true);
  const payload = appRuntime().buildStudyMaterialPayload();
  if (!payload) return appRuntime().showToast('Generate mentor output first', true);
  if (state.studyMaterialSaving) return null;

  state.studyMaterialSaving = true;
  appRuntime().updateLibrarySaveButton();
  try {
    let material;
    const existingId = state.currentAiResultSavedId;
    if (existingId && state.aiStudySession?.type === 'quiz') {
      material = await updateStudyMaterialProgress(existingId, { quizProgress: appRuntime().getQuizProgressFromSession() });
    } else if (existingId && state.aiStudySession?.type === 'flashcards') {
      material = await updateStudyMaterialProgress(existingId, { flashcardProgress: appRuntime().getFlashcardProgressFromSession() });
    } else if (existingId) {
      appRuntime().showToast('Already saved to Study Library');
      return state.studyMaterials.find((item) => String(item._id) === String(existingId)) || null;
    } else if (state.demoMode) {
      material = {
        _id: `demo-material-${Date.now()}`,
        workspaceId: state.selectedWorkspaceId,
        documentId: state.selectedDocumentId,
        ...payload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        quizProgress: state.aiStudySession?.type === 'quiz' ? appRuntime().getQuizProgressFromSession() || {} : {},
        flashcardProgress: state.aiStudySession?.type === 'flashcards' ? {
          ...(appRuntime().getFlashcardProgressFromSession() || {}),
          knownCount: appRuntime().getFlashcardProgressFromSession()?.knownCardIds?.length || 0,
          hardCount: appRuntime().getFlashcardProgressFromSession()?.hardCardIds?.length || 0
        } : {}
      };
      state.demoStudyMaterials = [
        material,
        ...state.demoStudyMaterials.filter((item) => String(item._id) !== String(material._id))
      ];
      upsertStudyMaterial(material);
      appRuntime().showToast('Saved in demo library. Create an account to keep it.');
    } else {
      material = await appRuntime().request('/api/study-material', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (state.aiStudySession?.type === 'quiz' && state.aiStudySession.completed) {
        material = await updateStudyMaterialProgress(material._id, { quizProgress: appRuntime().getQuizProgressFromSession() });
      } else if (state.aiStudySession?.type === 'flashcards') {
        const progress = appRuntime().getFlashcardProgressFromSession();
        if (progress?.knownCardIds?.length || progress?.hardCardIds?.length) {
          material = await updateStudyMaterialProgress(material._id, { flashcardProgress: progress });
        }
      }
      upsertStudyMaterial(material);
      appRuntime().showToast('Saved to Study Library');
    }

    if (material?._id) {
      state.currentAiResultSavedId = material._id;
      state.selectedStudyMaterialId = material._id;
      if (payload.type === 'summary') {
        appRuntime().markLectureMilestone(payload.documentId, 'summarySaved', {
          message: 'Summary saved for revision',
          show: false
        });
      }
      appRuntime().addActivity({ action: 'saved study material from', target: appRuntime().selectedDocumentTitle(), documentId: payload.documentId });
      appRuntime().renderStudyLibrary();
      appRuntime().updateLibrarySaveButton();
      appRuntime().activateContextTab('library');
    }
    return material;
  } catch (err) {
    appRuntime().showToast(err.message, true);
    return null;
  } finally {
    state.studyMaterialSaving = false;
    appRuntime().updateLibrarySaveButton();
  }
};

export const updateStudyMaterialProgress = async (materialId, body) => {
  if (!materialId || !body) return null;
  if (state.demoMode) {
    const material = state.demoStudyMaterials.find((item) => String(item._id) === String(materialId));
    if (!material) return null;
    if (body.quizProgress) {
      material.quizProgress = {
        ...(material.quizProgress || {}),
        ...body.quizProgress,
        attempts: (material.quizProgress?.attempts || 0) + 1,
        lastAttemptAt: new Date().toISOString()
      };
    }
    if (body.flashcardProgress) {
      const knownCardIds = body.flashcardProgress.knownCardIds || [];
      const hardCardIds = body.flashcardProgress.hardCardIds || [];
      material.flashcardProgress = {
        knownCardIds,
        hardCardIds,
        knownCount: knownCardIds.length,
        hardCount: hardCardIds.length,
        lastStudiedAt: new Date().toISOString()
      };
    }
    material.updatedAt = new Date().toISOString();
    upsertStudyMaterial(material);
    appRuntime().renderStudyLibrary();
    return material;
  }

  const material = await appRuntime().request(`/api/study-material/${materialId}/progress`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });
  upsertStudyMaterial(material);
  if (body.quizProgress) {
    appRuntime().markLectureMilestone(material.documentId, 'quizAttempted', { show: false });
  }
  if (body.flashcardProgress) {
    const reviewed = (body.flashcardProgress.knownCardIds || []).length + (body.flashcardProgress.hardCardIds || []).length;
    if (reviewed) appRuntime().markLectureMilestone(material.documentId, 'flashcardsReviewed', { show: false });
  }
  appRuntime().renderStudyLibrary();
  return material;
};

export const scheduleFlashcardProgressSave = () => {
  if (!state.currentAiResultSavedId || state.aiStudySession?.type !== 'flashcards') return;
  window.clearTimeout(flashcardProgressSaveTimer);
  flashcardProgressSaveTimer = window.setTimeout(() => {
    updateStudyMaterialProgress(state.currentAiResultSavedId, {
      flashcardProgress: appRuntime().getFlashcardProgressFromSession()
    }).catch((err) => console.warn('Background flashcard progress save failed:', err.message));
  }, 1800);
};

export const openStudyMaterial = (materialId) => {
  const material = state.studyMaterials.find((item) => String(item._id) === String(materialId));
  if (!material) return;
  const action = material.content?.action || appRuntime().materialTypeToAiAction(material.type);
  state.selectedStudyMaterialId = material._id;
  state.currentAiResultSavedId = material._id;
  state.lastAiAction = action;
  state.lastAiOutput = material.content?.output || material.title || '';
  state.aiStructuredOutput = material.content?.structured || null;
  state.aiStudySession = material.content?.session || appRuntime().buildAiStudySession(action, state.lastAiOutput, state.aiStructuredOutput);
  if (state.aiStudySession?.type === 'quiz') {
    state.aiStudySession.currentIndex = 0;
    state.aiStudySession.answers = {};
    state.aiStudySession.completed = false;
  }
  if (state.aiStudySession?.type === 'flashcards') {
    state.aiStudySession.currentIndex = 0;
    state.aiStudySession.flipped = false;
    state.aiStudySession.progress = {};
    (material.flashcardProgress?.knownCardIds || []).forEach((cardId) => {
      const index = state.aiStudySession.cards?.findIndex((card) => card.id === cardId);
      if (index >= 0) state.aiStudySession.progress[index] = 'known';
    });
    (material.flashcardProgress?.hardCardIds || []).forEach((cardId) => {
      const index = state.aiStudySession.cards?.findIndex((card) => card.id === cardId);
      if (index >= 0) state.aiStudySession.progress[index] = 'hard';
    });
  }
  appRuntime().activateContextTab('ai');
  appRuntime().renderAiStudyOutput();
};

export const deleteStudyMaterial = async (materialId) => {
  if (!materialId) return;
  try {
    if (state.demoMode) {
      state.demoStudyMaterials = state.demoStudyMaterials.filter((item) => String(item._id) !== String(materialId));
      state.studyMaterials = state.studyMaterials.filter((item) => String(item._id) !== String(materialId));
    } else {
      await appRuntime().request(`/api/study-material/${materialId}`, { method: 'DELETE' });
      state.studyMaterials = state.studyMaterials.filter((item) => String(item._id) !== String(materialId));
    }
    if (String(state.currentAiResultSavedId) === String(materialId)) state.currentAiResultSavedId = '';
    appRuntime().renderStudyLibrary();
    appRuntime().updateLibrarySaveButton();
    appRuntime().showToast('Study material deleted');
  } catch (err) {
    appRuntime().showToast(err.message, true);
  }
};
