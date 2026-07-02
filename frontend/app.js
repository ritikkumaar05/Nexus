// import './styles/workspace.css';
import './styles/shared-shell.css';
import { createApiClient } from './services/api.js';
import { currentRoute, routeQuery, navigate, renderRoute } from './services/router.js';
import {
  collab,
  documentKey,
  isDemoMode,
  selectedChannel,
  selectedDocument,
  selectedWorkspace,
  setDocuments,
  state,
  upsertDocument
} from './state/store.js';
import {
  socketState,
  loadYjs,
  loadSocketClient,
  connectSocket,
  disconnectSocket,
  teardownYDoc,
  setupYDoc,
  joinDocumentRoom,
  joinChannelRoom,
  joinWorkspaceChat,
  publishChatTyping,
  scheduleChatTypingStop,
  publishCursor,
  publishTyping,
  applyEditorInputToYDoc
} from './services/socket.js';
import {
  modalState,
  showToast,
  syncOverlayScrollLock,
  showMemberDetailsModal,
  showRemoveMemberModal,
  showAskDoubtModal
} from './services/modals.js';
import {
  inviteState,
  formatInviteRole,
  formatInviteExpiry,
  parseInviteInput,
  inviteCredentialQuery,
  inviteCredentialStorageValue,
  readPendingInviteCredential,
  storePendingInviteCredential,
  clearPendingInviteCredential,
  inviteLinkForToken,
  pendingInviteRoute,
  hydrateJoinRouteFromPath,
  renderInviteResultTool,
  renderJoinWorkspaceTool,
  showInviteMemberModal,
  previewInviteCredential,
  openJoinWorkspaceFlow,
  acceptActiveInvite
} from './services/invites.js';

const API_BASE = localStorage.getItem('apiBase') || 'http://localhost:5000';
const Y_TEXT_KEY = 'content';
let request;
let demoWorkspacePromise = null;
let demoWorkspaceModule = null;

let autosaveTimer = null;
let dashboardHydrationTimer = null;
let aiSelectionHintTimer = null;
let titleUiTimer = null;
let aiGenerationInFlight = false;
let flashcardProgressSaveTimer = null;
let documentCreateInFlight = false;
let activeDocumentOpenProfile = null;

let activeWorkspaceMenuId = '';
let activeWorkspaceRenameId = '';
let pendingWorkspaceDeleteId = '';
let pendingWorkspaceInvites = [];
let generatedInviteResult = null;
let activeDocumentLoadToken = 0;
const deletingDocumentIds = new Set();

let membersActiveTab = 'members';
let membersSearchQuery = '';
let membersRoleFilter = 'all';
let membersStatusFilter = 'all';
let membersActiveMenuMemberId = '';
let membersActionMenuRect = null;
let membersDetailsModalMemberId = '';
let membersRemoveCandidateId = '';
let membersRemovingMemberId = '';
let inviteExpiryOption = '7';

let settingsWorkspaceName = '';
let settingsWorkspaceDescription = 'Shared workspace for notes, projects, tasks, and discussions.';
let settingsTheme = '';
let settingsDensity = '';
let settingsReduceMotion = false;
let settingsEmailNotifications = false;
let settingsTaskNotifications = false;
let settingsDiscussionNotifications = false;
let settingsMentionNotifications = false;
let settingsInviteNotifications = false;
let settingsSaveInProgress = false;

let selectedCommandIndex = 0;
let threadFilterTab = 'all';
let threadSearchQuery = '';
let taskSearchQuery = '';
let taskFilterTab = 'all';
let taskSortField = 'priority';
let taskViewMode = 'board';
let activeTaskMoreMenuId = '';

const AUTOSAVE_DELAY_MS = 2800;
const CURSOR_PUBLISH_INTERVAL_MS = 300;
const TYPING_PUBLISH_INTERVAL_MS = 1000;
const CHAT_TYPING_PUBLISH_INTERVAL_MS = 1200;
const GENERAL_CHAT_CHANNEL = 'general';
const MAX_DOCUMENT_TEXT_CHARS = 200_000;
const MAX_DOCUMENT_TEXT_BYTES = 850_000;

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



const loadDemoWorkspaceModule = async () => {
  if (!demoWorkspacePromise) {
    demoWorkspacePromise = import('./features/demoWorkspace.js');
  }
  demoWorkspaceModule = demoWorkspaceModule || await demoWorkspacePromise;
  return demoWorkspaceModule;
};

const requireDemoWorkspaceModule = () => {
  if (!demoWorkspaceModule) {
    throw new Error('Demo workspace is still loading. Try again in a moment.');
  }
  return demoWorkspaceModule;
};

const startDocumentOpenProfile = (documentId) => {
  activeDocumentOpenProfile = {
    documentId,
    startedAt: performance.now(),
    marks: []
  };
  console.time?.(`document-open:${documentId}`);
  console.log('[perf] document-open-start', { documentId });
};

const recordDocumentOpenMeasure = (name, startedAt) => {
  if (!activeDocumentOpenProfile || !startedAt) return;
  activeDocumentOpenProfile.marks.push({
    name,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10
  });
};

const finishDocumentOpenProfile = () => {
  if (!activeDocumentOpenProfile) return;
  const profile = activeDocumentOpenProfile;
  profile.durationMs = Math.round((performance.now() - profile.startedAt) * 10) / 10;
  console.timeEnd?.(`document-open:${profile.documentId}`);
  console.log('[perf] document-open-end', {
    documentId: profile.documentId,
    durationMs: profile.durationMs
  });
  console.table?.(profile.marks);
  activeDocumentOpenProfile = null;
};

const els = {
  aiActionSelect: document.getElementById('aiActionSelect'),
  aiOutput: document.getElementById('aiOutput'),
  aiSelectionHint: document.getElementById('aiSelectionHint'),
  activityList: document.getElementById('activityList'),
  askDoubtBtn: document.getElementById('askDoubtBtn'),
  askDoubtEditorBtn: document.getElementById('askDoubtEditorBtn'),
  authForm: document.getElementById('authForm'),
  authPanel: document.getElementById('authPanel'),
  channelForm: document.getElementById('channelForm'),
  channelList: document.getElementById('channelList'),
  channelNameInput: document.getElementById('channelNameInput'),
  channelTitle: document.getElementById('channelTitle'),
  chatUnreadBadge: document.getElementById('chatUnreadBadge'),
  collabStatus: document.getElementById('collabStatus'),
  commandInput: document.getElementById('commandInput'),
  commandPalette: document.getElementById('commandPalette'),
  commandResults: document.getElementById('commandResults'),
  copyAiOutputBtn: document.getElementById('copyAiOutputBtn'),
  createAiDocumentBtn: document.getElementById('createAiDocumentBtn'),
  demoAiPrompts: document.getElementById('demoAiPrompts'),
  demoBanner: document.getElementById('demoBanner'),
  documentsResizeHandle: document.getElementById('documentsResizeHandle'),
  autosaveStatus: document.getElementById('autosaveStatus'),
  topbarSaveChip: document.getElementById('topbarSaveChip'),
  topbarSaveLabel: document.getElementById('topbarSaveLabel'),
  workspaceBadge: document.getElementById('workspaceBadge'),
  workspaceBadgeLabel: document.getElementById('workspaceBadgeLabel'),
  workspaceSwitcherAvatar: document.getElementById('workspaceSwitcherAvatar'),
  editorEmptyState: document.getElementById('editorEmptyState'),
  emptyActionBlank: document.getElementById('emptyActionBlank'),
  emptyActionPaste: document.getElementById('emptyActionPaste'),
  documentEditor: document.getElementById('documentEditor'),
  documentBreadcrumb: document.getElementById('documentBreadcrumb'),
  documentList: document.getElementById('documentList'),
  documentNewPageBtn: document.getElementById('documentNewPageBtn'),
  documentTitleInput: document.getElementById('documentTitleInput'),
  emailInput: document.getElementById('emailInput'),
  lastEditedStatus: document.getElementById('lastEditedStatus'),
  loginTab: document.getElementById('loginTab'),
  logoutBtn: document.getElementById('logoutBtn'),
  focusModeBtn: document.getElementById('focusModeBtn'),
  messageForm: document.getElementById('messageForm'),
  messageInput: document.getElementById('messageInput'),
  messageList: document.getElementById('messageList'),
  memberPresenceList: document.getElementById('memberPresenceList'),
  mobileSidebarCloseBtn: document.getElementById('mobileSidebarCloseBtn'),
  mobileSidebarOpenBtn: document.getElementById('mobileSidebarOpenBtn'),
  sidebarCollapseBtn: document.getElementById('sidebarCollapseBtn'),
  sidebarThemeToggleBtn: document.getElementById('sidebarThemeToggleBtn'),
  sidebarUserAvatar: document.getElementById('sidebarUserAvatar'),
  aiContextLabel: document.getElementById('aiContextLabel'),
  aiResizeHandle: document.getElementById('aiResizeHandle'),
  tasksContextLabel: document.getElementById('tasksContextLabel'),
  discussionContextLabel: document.getElementById('discussionContextLabel'),
  membersContextLabel: document.getElementById('membersContextLabel'),
  newDocBtn: document.getElementById('newDocBtn'),
  passwordInput: document.getElementById('passwordInput'),
  presenceList: document.getElementById('presenceList'),
  remoteCursorLayer: document.getElementById('remoteCursorLayer'),
  refreshMessagesBtn: document.getElementById('refreshMessagesBtn'),
  refreshWorkspacesBtn: document.getElementById('refreshWorkspacesBtn'),
  registerTab: document.getElementById('registerTab'),
  routePage: document.getElementById('routePage'),
  runAiBtn: document.getElementById('runAiBtn'),
  saveDocBtn: document.getElementById('saveDocBtn'),
  saveAiToDocumentBtn: document.getElementById('saveAiToDocumentBtn'),
  saveAiToLibraryBtn: document.getElementById('saveAiToLibraryBtn'),
  libraryContextLabel: document.getElementById('libraryContextLabel'),
  studyLibraryList: document.getElementById('studyLibraryList'),
  regenerateAiBtn: document.getElementById('regenerateAiBtn'),
  sessionLabel: document.getElementById('sessionLabel'),
  taskForm: document.getElementById('taskForm'),
  taskInput: document.getElementById('taskInput'),
  taskList: document.getElementById('taskList'),
  toast: document.getElementById('toast'),
  toolPanel: document.getElementById('toolPanel'),
  typingStatus: document.getElementById('typingStatus'),
  usernameInput: document.getElementById('usernameInput'),
  workspaceForm: document.getElementById('workspaceForm'),
  workspaceList: document.getElementById('workspaceList'),
  workspaceMeta: document.getElementById('workspaceMeta'),
  workspaceNameInput: document.getElementById('workspaceNameInput'),
  workspaceOnlineAvatars: document.getElementById('workspaceOnlineAvatars'),
  workspaceOnlineText: document.getElementById('workspaceOnlineText'),
  workspaceTitle: document.getElementById('workspaceTitle')
};



const copyText = async (text, successMessage = 'Copied') => {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    showToast(text);
  }
};



const traceWorkspaceDelete = (message, payload = {}) => {
  if (localStorage.getItem('nexusWorkspaceDeleteDebug') === 'true') {
    console.info(`[workspace-delete] ${message}`, payload);
  }
};

const setAutosaveStatus = (message) => {
  if (!els.autosaveStatus) return;
  els.autosaveStatus.textContent = message;
  const normalized = String(message || '').toLowerCase();
  const status = normalized.includes('fail') || normalized.includes('large') || normalized.includes('error')
    ? 'error'
    : normalized.includes('saving') || normalized.includes('syncing')
      ? 'saving'
      : normalized.includes('unsaved')
        ? 'unsaved'
        : normalized.includes('no document')
          ? 'idle'
          : 'saved';
  els.saveStatusChip?.setAttribute('data-save-state', status);
};

const PANEL_RESIZE_CONFIG = {
  documents: {
    handle: () => els.documentsResizeHandle,
    panel: () => document.querySelector('.document-workspace-panel'),
    cssVar: '--documents-pane-width',
    storageKey: 'nexusDocumentsPanelWidth',
    min: 220,
    max: 340,
    defaultWidth: 240,
    direction: 1
  },
  ai: {
    handle: () => els.aiResizeHandle,
    panel: () => document.querySelector('.context-panel'),
    cssVar: '--ai-panel-width',
    storageKey: 'nexusAiPanelWidth',
    min: 260,
    max: 420,
    defaultWidth: 320,
    direction: -1
  }
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const readStoredPanelWidth = ({ storageKey, min, max, defaultWidth }) => {
  const storedValue = localStorage.getItem(storageKey);
  if (storedValue === null) return defaultWidth;
  const raw = Number.parseFloat(storedValue);
  return Number.isFinite(raw) ? clamp(raw, min, max) : defaultWidth;
};

const setPanelWidth = (config, width, { persist = false } = {}) => {
  const nextWidth = Math.round(clamp(width, config.min, config.max));
  document.documentElement.style.setProperty(config.cssVar, `${nextWidth}px`);
  document.querySelector('.nexus-documents')?.style.setProperty(config.cssVar, `${nextWidth}px`);
  if (persist) localStorage.setItem(config.storageKey, String(nextWidth));
  return nextWidth;
};

const panelResizeEnabled = () => window.matchMedia('(min-width: 1101px)').matches;

const safePanelMax = (panelKey) => {
  const layout = document.querySelector('.nexus-documents');
  if (!layout || !panelResizeEnabled()) return PANEL_RESIZE_CONFIG[panelKey].max;

  const minEditorWidth = 420;
  const handleReserve = 20;
  const otherPanelKey = panelKey === 'documents' ? 'ai' : 'documents';
  const otherPanel = PANEL_RESIZE_CONFIG[otherPanelKey].panel();
  const otherWidth = otherPanel?.getBoundingClientRect().width
    || readStoredPanelWidth(PANEL_RESIZE_CONFIG[otherPanelKey]);
  const available = layout.getBoundingClientRect().width - otherWidth - minEditorWidth - handleReserve;

  return Math.max(
    PANEL_RESIZE_CONFIG[panelKey].min,
    Math.min(PANEL_RESIZE_CONFIG[panelKey].max, Math.floor(available))
  );
};

const clampPanelWidthsToViewport = () => {
  if (!panelResizeEnabled()) return;
  Object.entries(PANEL_RESIZE_CONFIG).forEach(([panelKey, config]) => {
    const panel = config.panel();
    const current = panel?.getBoundingClientRect().width || readStoredPanelWidth(config);
    const nextWidth = clamp(current, config.min, safePanelMax(panelKey));
    setPanelWidth(config, nextWidth);
  });
};

const initResizableWorkspacePanels = () => {
  Object.values(PANEL_RESIZE_CONFIG).forEach((config) => {
    setPanelWidth(config, readStoredPanelWidth(config));
  });

  Object.entries(PANEL_RESIZE_CONFIG).forEach(([panelKey, config]) => {
    const handle = config.handle();
    if (!handle) return;

    let startX = 0;
    let startWidth = 0;
    let startLayoutRect = null;
    let frame = 0;
    let pendingWidth = 0;

    const finishResize = () => {
      document.body.classList.remove('is-resizing-panels');
      handle.classList.remove('active');
      handle.removeAttribute('aria-valuenow');
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
      window.cancelAnimationFrame(frame);
      if (pendingWidth) setPanelWidth(config, pendingWidth, { persist: true });
      pendingWidth = 0;
    };

    const applyPendingWidth = () => {
      frame = 0;
      setPanelWidth(config, pendingWidth);
    };

    function onPointerMove(event) {
      const nextMax = safePanelMax(panelKey);
      if (startLayoutRect && panelKey === 'documents') {
        pendingWidth = clamp(event.clientX - startLayoutRect.left, config.min, nextMax);
      } else if (startLayoutRect && panelKey === 'ai') {
        pendingWidth = clamp(startLayoutRect.right - event.clientX, config.min, nextMax);
      } else {
        pendingWidth = clamp(startWidth + ((event.clientX - startX) * config.direction), config.min, nextMax);
      }
      handle.setAttribute('aria-valuenow', String(Math.round(pendingWidth)));
      if (!frame) frame = window.requestAnimationFrame(applyPendingWidth);
    }

    handle.addEventListener('pointerdown', (event) => {
      if (!panelResizeEnabled()) return;
      const panel = config.panel();
      if (!panel) return;

      event.preventDefault();
      startX = event.clientX;
      startWidth = panel.getBoundingClientRect().width || readStoredPanelWidth(config);
      startLayoutRect = document.querySelector('.nexus-documents')?.getBoundingClientRect() || null;
      pendingWidth = startWidth;
      document.body.classList.add('is-resizing-panels');
      handle.classList.add('active');
      handle.setAttribute('aria-valuemin', String(config.min));
      handle.setAttribute('aria-valuemax', String(config.max));
      handle.setAttribute('aria-valuenow', String(Math.round(startWidth)));
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', finishResize, { once: true });
      window.addEventListener('pointercancel', finishResize, { once: true });
      try {
        handle.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic or interrupted pointer events may not be capturable; window listeners still carry the drag.
      }
    });

    handle.addEventListener('keydown', (event) => {
      if (!panelResizeEnabled() || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const panel = config.panel();
      if (!panel) return;

      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? 16 : -16;
      const currentWidth = panel.getBoundingClientRect().width || readStoredPanelWidth(config);
      const nextWidth = clamp(currentWidth + (delta * config.direction), config.min, safePanelMax(panelKey));
      setPanelWidth(config, nextWidth, { persist: true });
    });
  });

  window.addEventListener('resize', clampPanelWidthsToViewport);
  clampPanelWidthsToViewport();
};



const persistPreferences = () => {
  localStorage.setItem('nexusPreferences', JSON.stringify(state.preferences));
};

const applyPreferences = () => {
  document.body.dataset.theme = state.preferences.theme || 'light';
  document.body.dataset.density = state.preferences.density || 'comfortable';
  document.body.classList.toggle('reduce-motion', Boolean(state.preferences.reduceMotion));
  // Don't collapse sidebar if we're on the Documents workspace
  if (!document.body.classList.contains('document-workspace-screen')) {
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    document.body.classList.toggle('sidebar-collapsed', isCollapsed);
  }
};

const toggleTheme = () => {
  const current = state.preferences.theme || 'light';
  let newTheme = 'dark';
  if (current === 'dark') {
    newTheme = 'light';
  } else if (current === 'light') {
    newTheme = 'dark';
  } else {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    newTheme = isDark ? 'light' : 'dark';
  }
  state.preferences.theme = newTheme;
  persistPreferences();
  applyPreferences();
  showToast(`Theme changed to ${newTheme}`);
};

const saveSession = ({ token, user }) => {
  state.token = token;
  state.user = user;
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
  localStorage.removeItem('refreshToken');
};

({ request } = createApiClient({
  apiBase: API_BASE,
  getToken: () => state.token,
  onRefresh: saveSession
}));

const clearSession = () => {
  disconnectSocket();
  teardownYDoc();
  sessionStorage.removeItem('demoMode');
  state.demoMode = false;
  state.token = '';
  state.user = null;
  state.workspaces = [];
  state.channels = [];
  setDocuments([]);
  state.messages = [];
  state.documentMessages = [];
  state.workspaceThreads = [];
  state.documentTasks = [];
  state.dashboardTasks = [];
  state.studyMaterials = [];
  state.demoStudyMaterials = [];
  state.activityItems = [];
  state.typingUsers = [];
  state.lastAiAction = '';
  state.lastAiOutput = '';
  state.aiStudySession = null;
  state.pendingDoubtLinkedText = '';
  state.presence = [];
  state.selectedWorkspaceId = '';
  state.selectedChannelId = '';
  state.selectedDocumentId = '';
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  localStorage.removeItem('workspaceId');
  localStorage.removeItem('channelId');
  localStorage.removeItem('documentId');
};

const selectedDocumentTitle = () => selectedDocument()?.title || els.documentTitleInput?.value || 'Untitled document';

const hydrateDemoWorkspace = ({ selectedDocumentId = state.selectedDocumentId } = {}) => {
  const { createDemoState, DEMO_WORKSPACE_ID } = requireDemoWorkspaceModule();
  const demo = createDemoState();
  const documentId = demo.documents.some((doc) => String(doc._id) === String(selectedDocumentId))
    ? selectedDocumentId
    : 'demo-doc-ds-lecture';

  state.user = demo.user;
  state.workspaces = demo.workspaces.map((workspace) => ({
    ...workspace,
    members: (workspace.members || []).slice(0, 3)
  }));
  state.channels = demo.channels.slice(0, 5);
  setDocuments(demo.documents.slice(0, 8));
  state.messages = demo.messages.slice(0, 5);
  state.documentMessages = demo.documentMessages.slice(0, 5);
  state.workspaceThreads = state.documentMessages
    .slice(0, 5)
    .map((thread) => ({ ...thread, documentTitle: 'Distributed Systems - Lecture Notes', documentId: 'demo-doc-ds-lecture' }));
  state.documentTasks = demo.documentTasks.slice(0, 5);
  state.dashboardTasks = state.documentTasks;
  state.presence = demo.presence.slice(0, 3);
  state.activityItems = demo.activityItems.slice(0, 5);
  state.typingUsers = [{ userId: 'demo-user-priya', email: 'Priya Sharma' }];
  state.selectedWorkspaceId = DEMO_WORKSPACE_ID;
  state.selectedChannelId = demo.channels[0]?.slug || '';
  state.selectedDocumentId = documentId;
  state.errors = {};
  Object.keys(state.loading).forEach((key) => {
    state.loading[key] = false;
  });
};

const loadDemoDocument = (documentId = state.selectedDocumentId) => {
  const doc = state.documents.find((item) => item._id === documentId) || state.documents[0];
  if (!doc) return;

  teardownYDoc();
  state.selectedDocumentId = doc._id;
  state.typingUsers = [];
  state.lastAiAction = '';
  state.lastAiOutput = '';
  state.aiStudySession = null;
  state.pendingDoubtLinkedText = '';
  state.selectedThreadId = '';
  state.contextLoadedFor = { tasks: '', threads: '', library: '' };
  els.documentTitleInput.value = doc.title || 'Untitled Page';
  setEditorText(doc.plainTextContent || '');
  state.lastSavedTitle = els.documentTitleInput.value;
  state.lastSavedText = doc.plainTextContent || '';
  state.saveStatus = 'saved';
  state.pendingSavePromise = null;
  state.saveQueued = false;
  setAutosaveStatus('Demo changes are temporary');
  setCollabStatus(`Demo mode · ${state.presence.length} collaborators`);
  state.lastAiAction = '';
  state.lastAiOutput = '';
  state.aiStudySession = null;
  state.currentAiResultSavedId = '';
  state.studyMaterials = state.demoStudyMaterials
    .filter((material) => String(material.documentId) === String(doc._id))
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  renderAiEmptyState(doc);
  renderPresence();
  render();
};

const enterDemoMode = async ({ route = 'home' } = {}) => {
  await loadDemoWorkspaceModule();
  disconnectSocket();
  teardownYDoc();
  sessionStorage.setItem('demoMode', 'true');
  state.demoMode = true;
  state.token = '';
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  localStorage.removeItem('workspaceId');
  localStorage.removeItem('channelId');
  localStorage.removeItem('documentId');
  hydrateDemoWorkspace();
  loadDemoDocument(state.selectedDocumentId);
  showToast('Demo workspace ready');
  navigate(route);
};

const exitDemoMode = () => {
  if (!state.demoMode) return;
  sessionStorage.removeItem('demoMode');
  state.demoMode = false;
  state.user = null;
  state.workspaces = [];
  state.channels = [];
  setDocuments([]);
  state.messages = [];
  state.documentMessages = [];
  state.workspaceThreads = [];
  state.documentTasks = [];
  state.dashboardTasks = [];
  state.studyMaterials = [];
  state.demoStudyMaterials = [];
  state.activityItems = [];
  state.typingUsers = [];
  state.presence = [];
  state.selectedWorkspaceId = '';
  state.selectedChannelId = '';
  state.selectedDocumentId = '';
  setEditorText('');
  els.documentTitleInput.value = '';
  setAutosaveStatus('No document');
  setCollabStatus('Offline');
  renderPresence();
};

const saveDemoDocument = ({ silent = false } = {}) => {
  const doc = selectedDocument();
  if (!doc) return null;
  doc.title = els.documentTitleInput.value || 'Untitled document';
  doc.plainTextContent = getEditorText();
  doc.updatedAt = new Date().toISOString();
  state.lastSavedTitle = doc.title;
  state.lastSavedText = doc.plainTextContent;
  state.saveStatus = 'saved';
  setAutosaveStatus(silent ? 'Demo autosaved locally' : 'Demo saved locally');
  if (!silent) addActivity({ action: 'edited', target: doc.title || 'Untitled document', documentId: doc._id });
  if (!silent) showToast('Demo changes are temporary. Create an account to save your own workspace.');
  render();
  return doc;
};

const createDemoDocument = () => {
  const doc = {
    _id: `demo-doc-${Date.now()}`,
    title: 'Untitled Page',
    category: 'Project Work',
    plainTextContent: '',
    updatedAt: new Date().toISOString()
  };
  upsertDocument(doc, { prepend: true });
  loadDemoDocument(doc._id);
  addActivity({ action: 'created document', target: doc.title, documentId: doc._id });
  showToast('Demo document created locally');
};

const demoAiResponse = (action) => {
  const { DEMO_AI_OUTPUTS } = requireDemoWorkspaceModule();
  const mappedAction = {
    'extract-tasks': 'exam',
    expand: 'explain',
    quiz: 'quiz',
    flashcards: 'flashcards',
    'simple-explanation': 'simple-explanation',
    'important-questions': 'important-questions'
  }[action] || action;
  return DEMO_AI_OUTPUTS[mappedAction] || DEMO_AI_OUTPUTS.summarize;
};

const setRouteChrome = (route) => {
  document.querySelectorAll('[data-route-link]').forEach((link) => {
    link.classList.toggle('active', link.dataset.routeLink === route);
  });
};

const normalizeContextTab = (tab = 'ai') => ({
  discussion: 'threads',
  thread: 'threads'
}[tab] || tab);

const activateContextTab = (tab) => {
  const activeTab = normalizeContextTab(tab);
  state.activeContextTab = activeTab;
  document.querySelectorAll('.context-tab').forEach((button) => {
    const isActive = normalizeContextTab(button.dataset.contextTab) === activeTab;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
  document.querySelectorAll('.context-view').forEach((view) => {
    const isActive = normalizeContextTab(view.dataset.contextView) === activeTab;
    view.classList.toggle('active', isActive);
    view.hidden = !isActive;
  });
  renderActiveContextPanel();
  ensureActiveContextData();
};

function ensureActiveContextData({ force = false } = {}) {
  const contextStartedAt = performance.now();
  if (!state.selectedDocumentId) return;
  const docId = String(state.selectedDocumentId);
  if (state.activeContextTab === 'tasks' && (force || state.contextLoadedFor.tasks !== docId)) {
    state.contextLoadedFor.tasks = docId;
    loadDocumentTasks().catch((err) => showToast(err.message, true));
  }
  if (state.activeContextTab === 'threads' && (force || state.contextLoadedFor.threads !== docId)) {
    state.contextLoadedFor.threads = docId;
    loadDocumentMessages().catch((err) => showToast(err.message, true));
  }
  if (state.activeContextTab === 'library' && (force || state.contextLoadedFor.library !== docId)) {
    state.contextLoadedFor.library = docId;
    loadStudyMaterialsForDocument(docId).catch((err) => showToast(err.message, true));
  }
  recordDocumentOpenMeasure('ensureActiveContextData', contextStartedAt);
}

const openCommandPalette = () => {
  if (!state.token && !state.demoMode) return;
  els.commandPalette.classList.remove('hidden');
  syncOverlayScrollLock();
  els.commandInput.value = '';
  selectedCommandIndex = 0;
  renderCommandResults();
  window.setTimeout(() => els.commandInput.focus(), 0);
};

const closeCommandPalette = () => {
  els.commandPalette.classList.add('hidden');
  syncOverlayScrollLock();
};

const renderCommandResults = () => {
  const query = els.commandInput.value.trim().toLowerCase();
  
  const sortedDocs = [...state.documents]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));

  const docMatches = sortedDocs
    .filter((doc) => !query || (doc.title || 'Untitled Page').toLowerCase().includes(query))
    .slice(0, 5)
    .map((doc) => ({
      type: 'Document',
      label: doc.title || 'Untitled Page',
      subtitle: doc.updatedAt ? `Last edited ${formatRelativeTime(doc.updatedAt)}` : 'Workspace document',
      action: 'Open',
      attrs: `data-command-document="${doc._id}"`
    }));

  const channelMatches = state.channels
    .filter((channel) => !query || channel.name.toLowerCase().includes(query))
    .slice(0, 4)
    .map((channel) => ({
      type: 'Discussion',
      label: `# ${channel.name}`,
      subtitle: 'Workspace discussion channel',
      action: 'Open',
      attrs: `data-command-channel="${channel.slug}"`
    }));

  const actions = [
    { type: 'Action', label: 'Create new document', subtitle: 'Start a blank note in this workspace', action: 'Run', attrs: 'data-command-action="new-document"' },
    { type: 'Action', label: 'Toggle focus mode', subtitle: 'Distraction-free learning environment', action: 'Run', attrs: 'data-command-action="focus"' },
    { type: 'Action', label: 'Open AI panel', subtitle: 'Chat with Nexus Gemini AI helper', action: 'Run', attrs: 'data-command-action="ai"' }
  ].filter((item) => !query || item.label.toLowerCase().includes(query));

  const items = [...docMatches, ...channelMatches, ...actions];
  
  if (selectedCommandIndex >= items.length) {
    selectedCommandIndex = 0;
  }
  if (selectedCommandIndex < 0) {
    selectedCommandIndex = Math.max(0, items.length - 1);
  }

  if (items.length === 0) {
    els.commandResults.innerHTML = `
      <div class="command-empty-state">
        <span class="empty-icon-bubble">⌕</span>
        <h3>No results found</h3>
        <p>Try searching for a document title, channel name, or action keyword.</p>
        <div class="command-empty-quick-actions">
          <button class="quick-action-btn" data-command-action="new-document" type="button">
            <span>Create new document</span>
            <kbd>↵</kbd>
          </button>
          <button class="quick-action-btn" data-command-action="ai" type="button">
            <span>Ask AI</span>
            <kbd>↵</kbd>
          </button>
        </div>
      </div>
    `;
    return;
  }

  let html = '';
  let lastGroup = null;
  items.forEach((item, index) => {
    let groupName = '';
    if (item.type === 'Document') groupName = 'Documents';
    else if (item.type === 'Discussion') groupName = 'Discussions';
    else if (item.type === 'Action') groupName = 'Actions';

    if (groupName !== lastGroup) {
      html += `<div class="command-group-title">${groupName}</div>`;
      lastGroup = groupName;
    }

    const isSelected = index === selectedCommandIndex;
    const selectedClass = isSelected ? 'selected' : '';
    
    let iconSvg = '';
    if (item.type === 'Document') {
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
    } else if (item.type === 'Discussion') {
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line><line x1="10" y1="3" x2="8" y2="21"></line><line x1="16" y1="3" x2="14" y2="21"></line></svg>`;
    } else {
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
    }

    html += `
      <button class="command-item ${selectedClass}" type="button" ${item.attrs} data-index="${index}">
        <span class="command-item-left">
          <span class="command-item-icon">${iconSvg}</span>
          <span class="command-item-details">
            <span class="command-item-label">${escapeHtml(item.label)}</span>
            <span class="command-item-subtitle">${escapeHtml(item.subtitle)}</span>
          </span>
        </span>
        <span class="command-item-right">
          <span class="command-item-action">${escapeHtml(item.action)} <span class="action-arrow">→</span></span>
        </span>
      </button>
    `;
  });

  els.commandResults.innerHTML = html;

  const activeEl = els.commandResults.querySelector('.command-item.selected');
  if (activeEl) {
    activeEl.scrollIntoView({ block: 'nearest' });
  }
};

const commandPaletteRuntime = { openCommandPalette };

const openCommandPaletteFeature = async () => {
  const feature = await import('./features/commandPalette.js');
  feature.open(commandPaletteRuntime);
};

const toggleFocusMode = (force) => {
  const shouldEnable = force ?? !document.body.classList.contains('focus-mode');
  if (shouldEnable && !document.body.classList.contains('document-workspace-screen')) return;
  document.body.classList.toggle('focus-mode', shouldEnable);
  els.focusModeBtn.textContent = document.body.classList.contains('focus-mode') ? 'Exit focus' : 'Focus';
};

const toggleSidebarCollapse = (force) => {
  const isCollapsed = document.body.classList.toggle('sidebar-collapsed', force ?? !document.body.classList.contains('sidebar-collapsed'));
  localStorage.setItem('sidebarCollapsed', isCollapsed ? 'true' : 'false');
};

const emptyState = ({
  title,
  body,
  action = '',
  actionId = '',
  secondaryAction = '',
  secondaryActionId = '',
  icon = '✦',
  hint = '',
  className = ''
}) => `
  <div class="empty-state ${escapeHtml(className)}">
    <span class="empty-icon">${escapeHtml(icon)}</span>
    <strong>${escapeHtml(title)}</strong>
    <p>${escapeHtml(body)}</p>
    ${(action || secondaryAction) ? `
      <div class="empty-actions">
        ${action ? `<button ${actionId ? `id="${escapeHtml(actionId)}"` : ''} class="primary" type="button">${escapeHtml(action)}</button>` : ''}
        ${secondaryAction ? `<button ${secondaryActionId ? `id="${escapeHtml(secondaryActionId)}"` : ''} class="ghost" type="button">${escapeHtml(secondaryAction)}</button>` : ''}
      </div>
    ` : ''}
    ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
  </div>
`;

const loadingRows = (count = 3) => Array.from({ length: count }, () => '<span class="skeleton-row"></span>').join('');

const errorState = (message) => `
  <div class="error-state">
    <strong>Could not load</strong>
    <p>${escapeHtml(message)}</p>
  </div>
`;

const setLoading = (key, value, { scoped = false } = {}) => {
  state.loading[key] = value;
  if (key === 'document') return renderEditor();
  if (scoped && key === 'tasks') return renderTaskList();
  if (scoped && key === 'messages') return renderThreadList();
  if (scoped && key === 'studyMaterials') return renderStudyLibrary();
  if (scoped && key === 'chat' && currentRoute() === 'chat') return renderChatPage();
  render();
};

const setError = (key, message = '') => {
  if (message) state.errors[key] = message;
  else delete state.errors[key];
};

const isTextareaEditor = () => els.documentEditor?.tagName === 'TEXTAREA';

const getEditorText = () => {
  if (!els.documentEditor) return '';
  return isTextareaEditor() ? els.documentEditor.value : (els.documentEditor.innerText || '');
};

const updateEditorEmptyState = () => {
  if (!els.editorEmptyState) return;
  const doc = selectedDocument();
  const content = getEditorText().trim();
  if (doc && !state.loading.document && content.length === 0) {
    els.editorEmptyState.classList.remove('hidden');
  } else {
    els.editorEmptyState.classList.add('hidden');
  }
};

// Nexus editor is plain text for this MVP.
// Do not save or render raw HTML because that can create stored XSS.
const getEditorHtml = () => '';

const htmlToPlainText = (html = '') => {
  if (!html) return '';
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return parsed.body?.textContent || '';
};

const setEditorText = (value = '') => {
  if (!els.documentEditor) return;
  const nextValue = String(value);
  if (isTextareaEditor()) {
    if (els.documentEditor.value === nextValue) {
      updateEditorEmptyState();
      return;
    }
    const wasFocused = document.activeElement === els.documentEditor;
    const selectionStart = els.documentEditor.selectionStart || 0;
    const selectionEnd = els.documentEditor.selectionEnd || selectionStart;
    els.documentEditor.value = nextValue;
    if (wasFocused) {
      const nextStart = Math.min(selectionStart, nextValue.length);
      const nextEnd = Math.min(selectionEnd, nextValue.length);
      els.documentEditor.setSelectionRange(nextStart, nextEnd);
    }
    updateEditorEmptyState();
    return;
  }
  if (els.documentEditor.textContent === nextValue) {
    updateEditorEmptyState();
    return;
  }
  els.documentEditor.textContent = nextValue;
  updateEditorEmptyState();
};

const setEditorHtml = (html = '', fallbackText = '') => {
  setEditorText(fallbackText || htmlToPlainText(html));
};

const insertStarterOutline = () => {
  const doc = selectedDocument();
  if (!doc) return showToast('Create or select a document first', true);
  const title = els.documentTitleInput.value.trim() || doc.title || 'Study Notes';
  const outline = [
    `${title}`,
    '',
    'Overview',
    '- ',
    '',
    'Key concepts',
    '- ',
    '',
    'Questions to clarify',
    '- ',
    '',
    'Summary',
    '- '
  ].join('\n');
  setEditorText(outline);
  applyEditorInputToYDoc();
  scheduleAutosave();
  els.documentEditor.focus();
};

const getEditorSelection = () => {
  if (isTextareaEditor()) {
    const start = els.documentEditor.selectionStart || 0;
    const end = els.documentEditor.selectionEnd || start;
    return { start, end };
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !els.documentEditor.contains(selection.anchorNode)) {
    const length = getEditorText().length;
    return { start: length, end: length };
  }

  const range = selection.getRangeAt(0);
  const startRange = range.cloneRange();
  startRange.selectNodeContents(els.documentEditor);
  startRange.setEnd(range.startContainer, range.startOffset);

  const endRange = range.cloneRange();
  endRange.selectNodeContents(els.documentEditor);
  endRange.setEnd(range.endContainer, range.endOffset);

  return {
    start: startRange.toString().length,
    end: endRange.toString().length
  };
};

const getSelectedEditorText = () => {
  if (isTextareaEditor()) {
    const { start, end } = getEditorSelection();
    return getEditorText().slice(start, end).trim();
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !els.documentEditor.contains(selection.anchorNode)) return '';
  return selection.toString().trim();
};

const selectedAiSource = () => document.querySelector('input[name="aiSource"]:checked')?.value || 'document';

const getAiSourceText = () => {
  const selectedText = getSelectedEditorText();
  if (selectedAiSource() === 'selection') return selectedText;
  return getEditorText().trim();
};

const updateAiSelectionHint = () => {
  if (!els.aiSelectionHint) return;
  const selectedText = getSelectedEditorText();
  els.aiSelectionHint.textContent = selectedText
    ? `Selected text available: ${selectedText.length} characters.`
    : 'Select text in the editor to use a focused paragraph.';
};

const scheduleAiSelectionHintUpdate = () => {
  window.clearTimeout(aiSelectionHintTimer);
  aiSelectionHintTimer = window.setTimeout(updateAiSelectionHint, 80);
};

const aiActionLabel = (action = '') => ({
  summarize: 'Summary',
  quiz: 'Quiz',
  flashcards: 'Flashcards',
  'simple-explanation': 'Simple Explanation',
  'important-questions': 'Important Questions'
}[action] || 'Study Material');

const aiActionToMaterialType = (action = '') => ({
  summarize: 'summary',
  quiz: 'quiz',
  flashcards: 'flashcards',
  'simple-explanation': 'explanation',
  'important-questions': 'important_questions'
}[action] || 'summary');

const materialTypeToAiAction = (type = '') => ({
  summary: 'summarize',
  quiz: 'quiz',
  flashcards: 'flashcards',
  explanation: 'simple-explanation',
  important_questions: 'important-questions'
}[type] || 'summarize');

const materialTypeLabel = (type = '') => ({
  summary: 'Summary',
  quiz: 'Quiz',
  flashcards: 'Flashcards',
  explanation: 'Explanation',
  important_questions: 'Important Questions'
}[type] || 'Study Material');

const currentAiMaterialTitle = () => `${selectedDocumentTitle()} ${aiActionLabel(state.lastAiAction || 'summarize')}`;

const setAiOutput = (action, output) => {
  state.lastAiAction = action;
  state.lastAiOutput = output;
  state.aiStudySession = buildAiStudySession(action, output);
  state.currentAiResultSavedId = '';
  renderAiStudyOutput();
};

const updateLibrarySaveButton = () => {
  if (!els.saveAiToLibraryBtn) return;
  const action = state.lastAiAction || 'summarize';
  const saved = Boolean(state.currentAiResultSavedId);
  const sessionType = state.aiStudySession?.type;
  els.saveAiToLibraryBtn.disabled = state.studyMaterialSaving || !state.lastAiOutput.trim() || (saved && !['quiz', 'flashcards'].includes(sessionType));
  if (state.studyMaterialSaving) {
    els.saveAiToLibraryBtn.textContent = 'Saving...';
  } else if (saved && sessionType === 'quiz') {
    els.saveAiToLibraryBtn.textContent = 'Update Saved Progress';
  } else if (saved && sessionType === 'flashcards') {
    els.saveAiToLibraryBtn.textContent = 'Update Saved Progress';
  } else if (saved) {
    els.saveAiToLibraryBtn.textContent = 'Saved';
  } else if (action === 'quiz') {
    els.saveAiToLibraryBtn.textContent = 'Save Quiz to Library';
  } else if (action === 'flashcards') {
    els.saveAiToLibraryBtn.textContent = 'Save Flashcards to Library';
  } else {
    els.saveAiToLibraryBtn.textContent = 'Save to Library';
  }
};

const setAiGenerating = (generating) => {
  aiGenerationInFlight = generating;
  document.body.classList.toggle('ai-generating', generating);
  document.querySelectorAll('[data-ai-study-action], [data-demo-ai], #runAiBtn, #regenerateAiBtn').forEach((button) => {
    button.disabled = generating;
  });
  if (els.aiActionSelect) els.aiActionSelect.disabled = generating;
};

const renderAiEmptyState = (doc = selectedDocument()) => {
  state.aiStudySession = null;
  els.aiOutput.innerHTML = emptyState({
    title: doc ? 'Ready to study smarter?' : 'Open a note to use AI',
    body: doc
      ? 'Turn your notes into summaries, quizzes, flashcards, and simple explanations.'
      : 'Select a document, then Nexus can generate study material from your notes.',
    action: '',
    actionId: '',
    secondaryAction: '',
    secondaryActionId: '',
    icon: '✦',
    className: 'ai-empty-state'
  });
  updateLibrarySaveButton();
};

const isMine = (message = {}) => {
  const senderId = message.sender?._id || message.sender;
  return senderId && state.user?.id && String(senderId) === String(state.user.id);
};

const filteredThreads = () => state.documentMessages.filter((thread) => {
  if (state.threadFilter === 'all') return true;
  if (state.threadFilter === 'mine') return isMine(thread);
  if (state.threadFilter === 'resolved') return thread.status === 'resolved';
  return thread.status !== 'resolved';
});

const selectedThread = () => state.documentMessages.find((thread) => thread._id === state.selectedThreadId) || null;

const refreshDocumentTitleChrome = ({ deferList = false } = {}) => {
  const doc = selectedDocument();
  const title = doc?.title || els.documentTitleInput.value || 'Current document';
  els.documentBreadcrumb.textContent = title;
  if (deferList) {
    window.clearTimeout(titleUiTimer);
    titleUiTimer = window.setTimeout(() => refreshDocumentTitleChrome(), 220);
    return;
  }
  const activeDocumentRow = els.documentList.querySelector(`[data-document-id="${CSS.escape(String(state.selectedDocumentId || ''))}"]`);
  const activeDocumentTitle = activeDocumentRow?.querySelector('.document-row-title');
  if (activeDocumentTitle && doc) activeDocumentTitle.textContent = doc.title || 'Untitled Page';
};

const renderTaskList = () => {
  const doc = selectedDocument();
  if (state.loading.tasks) {
    els.taskList.innerHTML = loadingRows(3);
    return;
  }
  if (state.errors.tasks) {
    els.taskList.innerHTML = errorState(state.errors.tasks);
    return;
  }
  els.taskList.innerHTML = doc && state.documentTasks.length ? state.documentTasks.map((task) => `
    <label data-task-id="${task._id}" class="${task.status === 'done' ? 'done' : ''}">
      <input type="checkbox" ${task.status === 'done' ? 'checked' : ''} />
      <span>${escapeHtml(task.title)}</span>
      <small>${escapeHtml(task.priority || 'medium')}</small>
      <button class="task-delete" type="button" data-delete-task="${task._id}" title="Delete task">×</button>
    </label>
  `).join('') : emptyState({
    title: doc ? 'No tasks yet' : 'No document selected',
    body: doc ? 'Break your study goals into small tasks and track progress with your team.' : 'Select a document to see its task list.',
    action: doc ? '+ Add Task' : '',
    actionId: doc ? 'emptyPanelAddTaskBtn' : '',
    icon: '✓',
    hint: doc ? 'Try: revise notes, prepare quiz, complete assignment.' : ''
  });
};

const getQuizProgressFromSession = (session = state.aiStudySession) => {
  if (!session || session.type !== 'quiz') return null;
  const totalQuestions = session.questions.length;
  const correctCount = session.questions.reduce((sum, question, index) => (
    sum + (question.answer && session.answers?.[index] === question.answer ? 1 : 0)
  ), 0);
  const weakTopics = session.questions
    .filter((question, index) => question.answer && session.answers?.[index] !== question.answer)
    .map((question) => question.topic)
    .filter(Boolean);
  return {
    lastScore: totalQuestions ? Math.round((correctCount / totalQuestions) * 100) : 0,
    totalQuestions,
    correctCount,
    weakTopics: [...new Set(weakTopics)].slice(0, 8)
  };
};

const getFlashcardProgressFromSession = (session = state.aiStudySession) => {
  if (!session || session.type !== 'flashcards') return null;
  const knownCardIds = [];
  const hardCardIds = [];
  Object.entries(session.progress || {}).forEach(([index, value]) => {
    const cardId = session.cards?.[Number(index)]?.id || `card-${index}`;
    if (value === 'known') knownCardIds.push(cardId);
    if (value === 'hard') hardCardIds.push(cardId);
  });
  return { knownCardIds, hardCardIds };
};

const buildStudyMaterialPayload = () => {
  if (!state.lastAiOutput.trim() || !state.lastAiAction) return null;
  const action = state.lastAiAction;
  const session = state.aiStudySession || buildAiStudySession(action, state.lastAiOutput);
  let content = { action, output: state.lastAiOutput };
  if (session?.type === 'quiz') {
    content = {
      action,
      session: {
        type: 'quiz',
        questions: session.questions || []
      }
    };
  } else if (session?.type === 'flashcards') {
    content = {
      action,
      session: {
        type: 'flashcards',
        cards: session.cards || []
      }
    };
  } else if (session?.type === 'structured') {
    content = {
      action,
      output: state.lastAiOutput,
      sections: session.sections || []
    };
  }
  return {
    workspaceId: state.selectedWorkspaceId,
    documentId: state.selectedDocumentId,
    type: aiActionToMaterialType(action),
    title: currentAiMaterialTitle(),
    content,
    metadata: {
      source: selectedAiSource(),
      documentTitle: selectedDocumentTitle()
    }
  };
};

const materialMetaText = (material = {}) => {
  if (material.type === 'quiz') {
    const total = material.quizProgress?.totalQuestions || material.content?.session?.questions?.length || 0;
    const score = material.quizProgress?.lastScore;
    const weakTopic = material.quizProgress?.weakTopics?.[0];
    return `${total} questions${score !== null && score !== undefined ? ` · Last score ${score}%` : ''}${weakTopic ? ` · Weak: ${weakTopic}` : ''}`;
  }
  if (material.type === 'flashcards') {
    const total = material.content?.session?.cards?.length || 0;
    return `${total} cards · ${material.flashcardProgress?.knownCount || 0} known · ${material.flashcardProgress?.hardCount || 0} hard`;
  }
  if (material.type === 'important_questions') return 'Exam prep · organized questions';
  return `Created ${formatRelativeTime(material.createdAt)}`;
};

const renderStudyLibrary = () => {
  const doc = selectedDocument();
  if (!els.studyLibraryList) return;
  if (els.libraryContextLabel) {
    els.libraryContextLabel.textContent = doc
      ? `Saved study material for "${doc.title || 'Untitled document'}".`
      : 'Open a note to view saved study material.';
  }

  if (!doc) {
    els.studyLibraryList.innerHTML = emptyState({
      title: 'Select a document',
      body: 'Open a note to view saved study material.',
      icon: '▣'
    });
    return;
  }

  if (state.loading.studyMaterials) {
    els.studyLibraryList.innerHTML = loadingRows(4);
    return;
  }

  if (state.errors.studyMaterials) {
    els.studyLibraryList.innerHTML = errorState(state.errors.studyMaterials);
    return;
  }

  els.studyLibraryList.innerHTML = state.studyMaterials.length ? state.studyMaterials.map((material) => `
    <article class="study-library-card" data-study-material-id="${material._id}">
      <span class="material-badge">${escapeHtml(materialTypeLabel(material.type))}</span>
      <strong>${escapeHtml(material.title || materialTypeLabel(material.type))}</strong>
      <small>${escapeHtml(materialMetaText(material))}</small>
      <div class="study-library-actions">
        <button class="primary" data-open-study-material="${material._id}" type="button">Open</button>
        <button class="ghost" data-delete-study-material="${material._id}" type="button">Delete</button>
      </div>
    </article>
  `).join('') : emptyState({
    title: 'No saved study material yet',
    body: 'Generate a summary, quiz, or flashcards from this note and save it here.',
    action: 'Go to AI',
    actionId: 'emptyLibraryGoAiBtn',
    secondaryAction: 'Generate Quiz',
    secondaryActionId: 'emptyLibraryQuizBtn',
    icon: '▣'
  });
};

const renderActiveContextPanel = () => {
  const activeTab = normalizeContextTab(state.activeContextTab);
  if (activeTab === 'tasks') renderTaskList();
  if (activeTab === 'library') renderStudyLibrary();
  if (activeTab === 'threads') renderThreadList();
  if (activeTab === 'activity') renderActivityList();
  if (activeTab === 'members') renderPresence();
  if (activeTab === 'ai') updateLibrarySaveButton();
};

const renderThreadList = () => {
  const doc = selectedDocument();
  if (state.loading.messages) {
    els.messageList.innerHTML = loadingRows(4);
    return;
  }
  if (state.errors.messages) {
    els.messageList.innerHTML = errorState(state.errors.messages);
    return;
  }

  document.querySelectorAll('[data-thread-filter]').forEach((button) => {
    button.classList.toggle('active', button.dataset.threadFilter === state.threadFilter);
  });
  const threads = filteredThreads();
  const activeThread = selectedThread();
  const threadListMarkup = threads.map((thread) => {
    const senderName = thread.sender?.username || thread.sender?.email || 'Member';
    const replyCount = thread.replies?.length || 0;
    return `
      <button class="thread-doubt-card ${thread._id === state.selectedThreadId ? 'active' : ''}" data-thread-id="${thread._id}" type="button">
        <span class="thread-status ${thread.status === 'resolved' ? 'resolved' : 'open'}">${thread.status === 'resolved' ? 'Resolved' : 'Open'}</span>
        <strong>${escapeHtml(thread.body)}</strong>
        ${thread.linkedText ? `<em>${escapeHtml(thread.linkedText.slice(0, 120))}</em>` : ''}
        <small>${replyCount} ${replyCount === 1 ? 'reply' : 'replies'} · Asked by ${escapeHtml(senderName)}</small>
      </button>
    `;
  }).join('');

  const detailMarkup = activeThread ? `
    <article class="thread-detail-card">
      <div class="thread-detail-head">
        <span class="thread-status ${activeThread.status === 'resolved' ? 'resolved' : 'open'}">${activeThread.status === 'resolved' ? 'Resolved' : 'Open'}</span>
        <button class="ghost" data-resolve-thread="${activeThread._id}" data-next-status="${activeThread.status === 'resolved' ? 'open' : 'resolved'}" type="button">
          ${activeThread.status === 'resolved' ? 'Reopen' : 'Mark Resolved'}
        </button>
      </div>
      <h4>${escapeHtml(activeThread.body)}</h4>
      ${activeThread.linkedText ? `<blockquote>${escapeHtml(activeThread.linkedText)}</blockquote>` : ''}
      <div class="thread-replies">
        ${(activeThread.replies || []).map((reply) => `
          <article class="message-reply">
            <strong>${escapeHtml(reply.sender?.username || reply.sender?.email || 'Member')}</strong>
            <p>${escapeHtml(reply.body)}</p>
          </article>
        `).join('') || '<p class="muted-copy">No replies yet. Help your team by answering this doubt.</p>'}
      </div>
    </article>
  ` : '';

  els.messageList.innerHTML = doc && state.documentMessages.length
    ? `${threadListMarkup || emptyState({ title: 'No matching doubts', body: 'Try another filter or ask a new doubt.' })}${detailMarkup}`
    : emptyState({
      title: doc ? 'No doubts on this note' : 'No document selected',
      body: doc ? 'Ask a question on this note and keep the answer linked forever.' : 'Select a document to open its threads.',
      action: doc ? 'Ask Doubt' : '',
      actionId: doc ? 'emptyPanelAskDoubtBtn' : '',
      icon: '?'
    });
  els.messageList.scrollTop = els.messageList.scrollHeight;
  setThreadComposer();
};

const setThreadComposer = () => {
  const thread = selectedThread();
  if (!els.messageInput || !els.messageForm) return;
  els.messageInput.placeholder = thread ? `Reply to: ${thread.body.slice(0, 42)}...` : 'Ask a doubt...';
  els.messageForm.querySelector('button').textContent = thread ? 'Reply' : 'Post';
};

const startAskDoubt = () => {
  showAskDoubtModal();
};

const renderMessageFormContext = () => {
  const container = document.getElementById('messageFormContextContainer');
  if (!container) return;
  
  if (state.pendingDoubtLinkedText) {
    container.innerHTML = `
      <div class="linked-context-pill">
        <span>🔗 Context: "${escapeHtml(state.pendingDoubtLinkedText.slice(0, 40))}${state.pendingDoubtLinkedText.length > 40 ? '...' : ''}"</span>
        <button type="button" class="clear-context-btn" title="Clear context">×</button>
      </div>
    `;
    container.classList.remove('hidden');
    
    // Add click handler to clear button
    const clearBtn = container.querySelector('.clear-context-btn');
    clearBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      state.pendingDoubtLinkedText = '';
      renderMessageFormContext();
    });
  } else {
    container.innerHTML = '';
    container.classList.add('hidden');
  }
};

const renderSessionChrome = () => {
  const signedIn = Boolean(state.token);
  const demo = isDemoMode();
  els.authPanel.classList.add('hidden');
  els.logoutBtn.classList.toggle('hidden', !signedIn && !demo);
  els.demoBanner?.classList.toggle('hidden', !demo);
  els.demoAiPrompts?.classList.toggle('hidden', !demo);
  document.body.classList.toggle('demo-mode', demo);
  els.sessionLabel.textContent = demo ? 'Demo mode' : (state.user ? state.user.email : 'Signed out');
  document.getElementById('sessionName').textContent = state.user
    ? state.user.username || state.user.email?.split('@')[0] || 'Signed in'
    : 'Signed out';
  if (els.sidebarUserAvatar) {
    const avatarLabel = state.user?.username || state.user?.email || (demo ? 'Alex Rivera' : 'User');
    els.sidebarUserAvatar.textContent = getInitials(avatarLabel) || 'U';
  }

  els.loginTab.classList.toggle('active', state.authMode === 'login');
  els.registerTab.classList.toggle('active', state.authMode === 'register');
  els.usernameInput.classList.toggle('hidden', state.authMode !== 'register');
};

const renderWorkspace = () => {
  const workspace = selectedWorkspace();
  const workspaceInitial = workspace?.name?.trim()?.charAt(0).toUpperCase() || 'W';
  els.workspaceTitle.textContent = workspace?.name || 'Choose or create a workspace';
  if (els.workspaceBadgeLabel) {
    els.workspaceBadgeLabel.textContent = workspace?.name ? workspace.name.toUpperCase() : 'WORKSPACE';
  }
  if (els.workspaceSwitcherAvatar) {
    els.workspaceSwitcherAvatar.textContent = workspaceInitial;
    els.workspaceSwitcherAvatar.title = workspace?.name || 'No workspace selected';
  }
  const collabPeople = collaborationPeople();
  const chatOnlineIds = new Set(state.chatOnlineUsers.map((user) => String(user.userId)).filter(Boolean));
  const onlinePeople = state.chatOnlineUsers.length
    ? collabPeople.map((person) => ({ ...person, online: chatOnlineIds.has(String(person.id)) })).filter((person) => person.online)
    : collabPeople.filter((person) => person.online);
  els.workspaceMeta.textContent = workspace
    ? `${onlinePeople.length || (state.demoMode ? 3 : 0)} online · ${workspace.members?.length || 0} member(s)`
    : 'No workspace selected';
  if (els.workspaceOnlineText) {
    els.workspaceOnlineText.textContent = workspace
      ? `${onlinePeople.length || (state.demoMode ? 3 : 1)} online now`
      : 'No workspace selected';
  }
  if (els.workspaceOnlineAvatars) {
    els.workspaceOnlineAvatars.innerHTML = (onlinePeople.length ? onlinePeople : collabPeople.slice(0, 3)).slice(0, 4).map((person) => `
      <span title="${escapeHtml(person.name)}">${escapeHtml(getInitials(person.name))}</span>
    `).join('');
  }
  document.getElementById('workspaceSwitcherName').textContent = workspace?.name || 'Select workspace';

  if (state.loading.workspaces) {
    els.workspaceList.innerHTML = loadingRows(2);
  } else if (state.errors.workspaces) {
    els.workspaceList.innerHTML = errorState(state.errors.workspaces);
  } else {
    els.workspaceList.innerHTML = state.workspaces.map((item) => `
      <button class="${item._id === state.selectedWorkspaceId ? 'active' : ''}" data-workspace-id="${item._id}" type="button">
        ${escapeHtml(item.name)}
      </button>
  `).join('') || emptyState({
      title: 'Create your first study workspace',
      body: 'Bring notes, tasks, doubts, and AI study help into one place.',
      action: 'Create Workspace',
      actionId: 'emptyCreateWorkspaceBtn',
      secondaryAction: 'Join Workspace',
      secondaryActionId: 'emptyJoinWorkspaceBtn',
      icon: '▣',
      hint: 'A workspace is a study room for a subject, project, or group.'
    });
  }
};

const renderChannels = () => {
  els.channelTitle.textContent = 'Threads / Doubts';
  if (state.loading.channels) {
    els.channelList.innerHTML = loadingRows(3);
  } else if (state.errors.channels) {
    els.channelList.innerHTML = errorState(state.errors.channels);
  } else {
    els.channelList.innerHTML = state.channels.map((item) => `
      <button class="${item.slug === state.selectedChannelId ? 'active' : ''}" data-channel-id="${item.slug}" type="button">
        # ${escapeHtml(item.name)}
      </button>
    `).join('') || emptyState({
      title: 'No discussion channels yet',
      body: 'Create a channel for questions, project updates, or study notes.',
      action: 'Create Channel',
      actionId: 'emptyCreateChannelBtn',
      icon: '▱'
    });
  }
};

const renderDocumentRow = (item) => {
  const title = item.title?.trim() || 'Untitled Page';
  const id = documentKey(item);
  const isActive = id === String(state.selectedDocumentId);
  const isDeleting = deletingDocumentIds.has(id);
  return `
    <div class="document-row ${isActive ? 'active' : ''} ${isDeleting ? 'is-deleting' : ''}" data-document-id="${escapeHtml(id)}" role="button" tabindex="0" aria-label="Open document ${escapeHtml(title)}">
      <span class="document-row-title">${escapeHtml(title)}</span>
      <button class="document-delete-button" data-delete-document="${escapeHtml(id)}" aria-label="Delete document ${escapeHtml(title)}" title="Delete ${escapeHtml(title)}" type="button" ${isDeleting ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6h18"></path>
          <path d="M8 6V4h8v2"></path>
          <path d="M6 6l1 15h10l1-15"></path>
          <path d="M10 11v6"></path>
          <path d="M14 11v6"></path>
        </svg>
      </button>
    </div>
  `;
};

const renderDocuments = () => {
  const demo = isDemoMode();
  if (state.loading.documents) {
    els.documentList.innerHTML = loadingRows(5);
  } else if (state.errors.documents) {
    els.documentList.innerHTML = errorState(state.errors.documents);
  } else {
    if (demo && state.documents.length) {
      const groupedDocuments = state.documents.reduce((groups, item) => {
        const category = item.category || 'Documents';
        groups[category] = [...(groups[category] || []), item];
        return groups;
      }, {});
      els.documentList.innerHTML = `${Object.entries(groupedDocuments).map(([category, items]) => `
        <div class="document-folder-title">${escapeHtml(category)}</div>
        ${items.map(renderDocumentRow).join('')}
      `).join('')}`;
    } else {
      const documentsMarkup = state.documents.map(renderDocumentRow).join('');
      els.documentList.innerHTML = documentsMarkup
        ? documentsMarkup
        : emptyState({
        title: 'No documents yet',
        body: 'Create your first study note or start from a simple template.',
        action: '+ New Document',
        actionId: 'emptyNewDocBtn',
        secondaryAction: 'Use Template',
        secondaryActionId: 'emptyTemplateDocBtn',
        icon: '▤',
        hint: 'Start with one lecture, topic, or project.'
      });
    }
  }
};

const updateActiveDocumentSelection = () => {
  els.documentList.querySelectorAll('[data-document-id]').forEach((button) => {
    button.classList.toggle('active', String(button.dataset.documentId) === String(state.selectedDocumentId));
  });
};

const renderEditor = () => {
  const renderStartedAt = performance.now();
  const doc = selectedDocument();
  const documentTitle = doc?.title || els.documentTitleInput.value || 'Current document';
  document.body.classList.toggle('is-loading-document', state.loading.document);
  document.body.classList.toggle('has-no-document', !doc);
  els.saveDocBtn.disabled = !doc || state.loading.document;
  els.runAiBtn.disabled = aiGenerationInFlight || !doc || state.loading.document;
  els.taskInput.disabled = !doc;
  els.messageInput.disabled = !doc;
  els.documentTitleInput.disabled = !doc || state.loading.document;
  els.documentBreadcrumb.textContent = documentTitle;
  if (els.lastEditedStatus) {
    els.lastEditedStatus.textContent = doc
      ? (doc.updatedAt ? `Edited ${formatRelativeTime(doc.updatedAt)}` : 'Not saved yet')
      : 'No document';
  }

  if (!doc) {
    els.documentTitleInput.value = '';
    els.documentTitleInput.placeholder = 'Select a document';
    els.documentEditor.disabled = true;
    els.documentEditor.placeholder = 'Select a note to start studying';
    setEditorText('');
    state.lastAiAction = '';
    state.lastAiOutput = '';
    state.aiStudySession = null;
    renderAiEmptyState(null);
  } else {
    els.documentTitleInput.placeholder = 'Untitled document';
    els.documentEditor.disabled = false;
    els.documentEditor.placeholder = 'Start writing your notes...';
  }

  const contextTitle = doc ? `"${doc.title || 'Untitled document'}"` : 'the current document';
  els.aiContextLabel.textContent = doc
    ? `AI actions will use ${contextTitle}.`
    : 'Select a document to use AI with document context.';
  els.tasksContextLabel.textContent = doc
    ? `Tasks are scoped to ${contextTitle}.`
    : 'Select a document to see document tasks.';
  els.discussionContextLabel.textContent = doc
    ? `Doubts are linked to ${contextTitle}.`
    : 'Select a document to ask and resolve doubts.';
  els.membersContextLabel.textContent = doc
    ? `Presence while editing ${contextTitle}.`
    : 'Open a document to see live collaborators.';
  if (els.libraryContextLabel) {
    els.libraryContextLabel.textContent = doc
      ? `Saved study material for ${contextTitle}.`
      : 'Open a note to view saved study material.';
  }

  renderActiveContextPanel();
  updateTypingStatus();
  if (aiGenerationInFlight) setAiGenerating(true);
  recordDocumentOpenMeasure('renderEditor', renderStartedAt);
};

const renderContextPanel = () => {
  renderActiveContextPanel();
};

const render = () => {
  renderSessionChrome();
  syncUnreadBadge();
  renderWorkspace();
  if (document.body.classList.contains('workspace-screen')) {
    renderChannels();
    renderDocuments();
    renderEditor();
    renderMessageFormContext();
  }
};

const setMainMode = (mode, options = {}) => {
  const workspaceLayout = document.querySelector('.workspace-layout');
  const sidebar = document.querySelector('.sidebar');
  const isWorkspace = mode === 'workspace';

  document.body.classList.toggle('auth-screen', mode === 'auth');
  document.body.classList.toggle('feature-screen', mode === 'feature');
  document.body.classList.toggle('workspace-screen', isWorkspace);
  
  const isDocumentWorkspace = Boolean(options.documentWorkspace);
  document.body.classList.toggle('document-workspace-screen', isDocumentWorkspace);
  if (!isDocumentWorkspace && document.body.classList.contains('focus-mode')) {
    document.body.classList.remove('focus-mode');
    if (els.focusModeBtn) els.focusModeBtn.textContent = 'Focus';
  }
  
  // Restore user's saved preference
  const savedCollapsed = localStorage.getItem('sidebarCollapsed');
  if (savedCollapsed === 'true') {
    document.body.classList.add('sidebar-collapsed');
  } else {
    document.body.classList.remove('sidebar-collapsed');
  }

  workspaceLayout.classList.toggle('hidden', !isWorkspace);
  els.routePage.classList.toggle('hidden', isWorkspace);
  sidebar.classList.toggle('auth-mode', mode === 'auth');
};

const resolveStartupSurface = ({ routeAtStart, routeCompleted = true } = {}) => {
  if (!document.body.classList.contains('app-booting')) return;
  if (!routeCompleted) return;
  if (routeAtStart && currentRoute() !== routeAtStart) return;

  const hasResolvedMode = document.body.classList.contains('auth-screen') ||
    document.body.classList.contains('feature-screen') ||
    document.body.classList.contains('workspace-screen');

  if (hasResolvedMode) {
    document.body.classList.remove('app-booting');
  }
};


const lazyRouteModule = (name) => import(`./features/${name}.js`);

const renderAuthPage = async (...args) => (await lazyRouteModule('auth')).renderAuthPage(...args);
const renderPasswordRecoveryPage = async (...args) => (await lazyRouteModule('auth')).renderPasswordRecoveryPage(...args);
const getDashboardData = async (...args) => (await lazyRouteModule('home')).getDashboardData(...args);
const renderHomePage = async (...args) => (await lazyRouteModule('home')).renderHomePage(...args);
const renderChatPage = async (...args) => (await lazyRouteModule('chat')).renderChatPage(...args);
const renderChatMessages = async (...args) => (await lazyRouteModule('chat')).renderChatMessages(...args);
const applyComposerFormat = async (...args) => (await lazyRouteModule('chat')).applyComposerFormat(...args);
const showChatModal = async (...args) => (await lazyRouteModule('chat')).showChatModal(...args);
const highlightSearchInDom = async (...args) => (await lazyRouteModule('chat')).highlightSearchInDom(...args);
const handleChatDropdownAction = async (...args) => (await lazyRouteModule('chat')).handleChatDropdownAction(...args);
const handleChatAction = async (...args) => (await lazyRouteModule('chat')).handleChatAction(...args);
const handleChatEmptyAction = async (...args) => (await lazyRouteModule('chat')).handleChatEmptyAction(...args);
const renderThreadListSection = async (...args) => (await lazyRouteModule('threads')).renderThreadListSection(...args);
const renderThreadDetailHtml = async (...args) => (await lazyRouteModule('threads')).renderThreadDetailHtml(...args);
const renderThreadsPage = async (...args) => (await lazyRouteModule('threads')).renderThreadsPage(...args);
const getFilteredTasks = async (...args) => (await lazyRouteModule('tasks')).getFilteredTasks(...args);
const renderTaskCardHtml = async (...args) => (await lazyRouteModule('tasks')).renderTaskCardHtml(...args);
const showAddTaskModal = async (...args) => (await lazyRouteModule('tasks')).showAddTaskModal(...args);
const showEditTaskModal = async (...args) => (await lazyRouteModule('tasks')).showEditTaskModal(...args);
const renderTasksPage = async (...args) => (await lazyRouteModule('tasks')).renderTasksPage(...args);
const renderMembersPage = async (...args) => (await lazyRouteModule('members')).renderMembersPage(...args);
const renderSettingsContent = async (...args) => (await lazyRouteModule('settings')).renderSettingsContent(...args);
const renderSettingsPage = async (...args) => (await lazyRouteModule('settings')).renderSettingsPage(...args);
const renderWorkspaceSettingsPage = async (...args) => (await lazyRouteModule('settings')).renderWorkspaceSettingsPage(...args);
const renderWorkspacePage = async (...args) => (await lazyRouteModule('documentsWorkspace')).renderWorkspacePage(...args);
const getInitials = (value = '') => {
  const parts = String(value || 'User').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
};

const formatRelativeTime = (dateValue) => {
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

const formatChatTime = (dateValue) => {
  const date = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const activeChatChannel = () => state.channels.find((channel) => channel.slug === GENERAL_CHAT_CHANNEL)
  || state.channels[0]
  || { slug: GENERAL_CHAT_CHANNEL, name: 'General' };

const chatSenderName = (message = {}) => message.sender?.username
  || message.sender?.email?.split('@')[0]
  || 'Member';

const syncUnreadBadge = () => {
  if (!els.chatUnreadBadge) return;
  const count = Number(state.unreadChatCount || 0);
  els.chatUnreadBadge.textContent = count > 99 ? '99+' : String(count);
  els.chatUnreadBadge.classList.toggle('hidden', count <= 0);
  localStorage.setItem('chatUnreadCount', String(count));
};

const clearChatUnread = () => {
  state.unreadChatCount = 0;
  syncUnreadBadge();
};

const currentChatPreview = () => {
  const message = [...state.chatMessages].reverse().find((item) => item.channelId === activeChatChannel().slug)
    || [...state.messages].reverse().find((item) => item.channelId === GENERAL_CHAT_CHANNEL)
    || null;
  if (!message) return null;
  return {
    sender: chatSenderName(message),
    content: message.content || '',
    time: message.createdAt || message.updatedAt
  };
};

const chatOnlineCount = () => {
  if (state.demoMode) return Math.max(4, collaborationPeople().filter((person) => person.online).length);
  return state.chatOnlineUsers.length || collaborationPeople().filter((person) => person.online).length || (selectedWorkspace() ? 1 : 0);
};

const highlightActiveMatch = () => {
  searchState.matches.forEach((el) => el.classList.remove('active-highlight'));

  if (searchState.currentIndex >= 0 && searchState.currentIndex < searchState.matches.length) {
    const activeEl = searchState.matches[searchState.currentIndex];
    activeEl.classList.add('active-highlight');
    activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  updateSearchMatchesCounter();
};

const updateSearchMatchesCounter = () => {
  const counter = document.getElementById('chatSearchMatches');
  if (counter) {
    const current = searchState.matches.length > 0 ? searchState.currentIndex + 1 : 0;
    counter.textContent = `${current} / ${searchState.matches.length}`;
  }
};

const navigateSearchMatch = (direction) => {
  if (searchState.matches.length === 0) return;
  if (direction === 'next') {
    searchState.currentIndex = (searchState.currentIndex + 1) % searchState.matches.length;
  } else if (direction === 'prev') {
    searchState.currentIndex = (searchState.currentIndex - 1 + searchState.matches.length) % searchState.matches.length;
  }
  highlightActiveMatch();
};

const closeChatSearch = () => {
  const container = document.getElementById('chatHeaderSearchContainer');
  if (container) {
    container.classList.add('hidden');
  }
  const input = document.getElementById('chatSearchInput');
  if (input) {
    input.value = '';
  }
  highlightSearchInDom('');
};

const handleChatMessageAction = (action, msgId, msgArticle) => {
  if (action === 'copy') {
    const textEl = msgArticle?.querySelector('.chat-bubble p');
    const content = textEl?.textContent || '';
    if (content) {
      navigator.clipboard.writeText(content)
        .then(() => showToast('Message copied to clipboard'))
        .catch(() => showToast('Failed to copy message', true));
    }
  } else if (action === 'reply') {
    const nameEl = msgArticle?.querySelector('.chat-sender-name');
    const senderName = nameEl?.textContent || 'teammate';
    const input = document.getElementById('workspaceChatInput');
    if (input) {
      input.value = `Replying to @${senderName}: "${input.value}"`;
      input.focus();
      const event = new Event('input', { bubbles: true });
      input.dispatchEvent(event);
    }
  }
};

const renderChatTypingIndicator = () => {
  const typingEl = document.getElementById('workspaceChatTyping');
  if (!typingEl) return;
  const typingNames = state.chatTypingUsers
    .filter((user) => user.userId !== state.user?.id)
    .map((user) => user.username || user.email?.split('@')[0] || 'Someone');
  typingEl.textContent = typingNames.length
    ? `${typingNames.slice(0, 2).join(', ')} ${typingNames.length === 1 ? 'is' : 'are'} typing...`
    : '';
};

const getTimeGreeting = (name = '') => {
  const hour = new Date().getHours();
  const suffix = name ? `, ${name}` : '';
  if (hour >= 5 && hour < 12) return `Good morning${suffix} 👋`;
  if (hour >= 12 && hour < 17) return `Good afternoon${suffix} 👋`;
  if (hour >= 17 && hour < 22) return `Good evening${suffix} 👋`;
  return `Working late${suffix}? 🌙`;
};

const isDueToday = (task = {}) => {
  if (!task.dueDate) return false;
  const due = new Date(task.dueDate);
  const today = new Date();
  return due.getFullYear() === today.getFullYear()
    && due.getMonth() === today.getMonth()
    && due.getDate() === today.getDate();
};

const formatTaskDue = (task = {}) => {
  if (!task.dueDate) return 'No due date';
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return 'No due date';
  if (isDueToday(task)) {
    return due.getHours() || due.getMinutes()
      ? `Due today ${due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'Due today';
  }
  return `Due ${due.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
};

const getWorkspaceMembers = () => selectedWorkspace()?.members || [];

const getUserDisplayName = (user) => {
  if (!user) return 'Unknown user';
  if (typeof user === 'string') return user;
  return user.username || user.name || user.firstName || user.email?.split('@')[0] || user.email || 'Unknown user';
};

const getMemberDisplayName = (member = {}) => {
  return getUserDisplayName(member.user || member);
};

const getMemberName = (member = {}) => getMemberDisplayName(member);

const collaborationPeople = () => {
  const workspaceMembers = getWorkspaceMembers();
  if (state.demoMode) {
    return workspaceMembers.slice(0, 3).map((member, index) => ({
      id: member.user?._id || `demo-member-${index}`,
      name: getMemberName(member),
      email: member.user?.email || member.email || '',
      status: index === 0 ? 'Editing ML Study Guide' : index === 1 ? 'Viewing CAP Theorem' : 'In Tasks',
      online: true
    }));
  }

  const presenceEmails = new Set(state.presence.map((user) => user.email).filter(Boolean));
  return workspaceMembers.map((member) => {
    const name = getMemberName(member);
    const email = member.user?.email || member.email || '';
    const id = memberUserId(member);
    const online = presenceEmails.has(email) || state.presence.some((user) => String(user.userId) === id);
    return {
      id: id || email || name,
      name,
      email,
      status: online ? `Editing ${selectedDocumentTitle()}` : `Role · ${member.role || 'member'}`,
      online
    };
  });
};

const memberUserId = (member = {}) => String(
  member.user?._id ||
  member.user?.id ||
  member.userId ||
  member._id ||
  member.id ||
  member.user ||
  ''
);
const isWorkspaceOwner = (workspace = selectedWorkspace(), userId = state.user?.id) => (
  Boolean(workspace?.owner && userId && String(workspace.owner?._id || workspace.owner) === String(userId))
);
const isCurrentUserWorkspaceAdmin = (workspace = selectedWorkspace()) => {
  if (isWorkspaceOwner(workspace)) return true;
  const member = workspace?.members?.find((item) => memberUserId(item) === String(state.user?.id));
  return member?.role === 'admin';
};
const displayWorkspaceRole = (workspace, member) => (
  isWorkspaceOwner(workspace, memberUserId(member)) ? 'OWNER' : String(member.role || 'member').toUpperCase()
);

const memberActionPolicy = (workspace = selectedWorkspace(), member = {}) => {
  const currentUserId = String(state.user?.id || state.user?._id || '');
  const targetUserId = memberUserId(member);
  const currentMember = workspace?.members?.find((item) => memberUserId(item) === currentUserId);
  const isSelf = Boolean(currentUserId && targetUserId && currentUserId === targetUserId);
  const currentIsOwner = isWorkspaceOwner(workspace, currentUserId);
  const currentIsAdmin = currentIsOwner || currentMember?.role === 'admin';
  const targetIsOwner = isWorkspaceOwner(workspace, targetUserId);
  const targetRole = member.role || 'member';
  const targetIsAdmin = targetRole === 'admin';
  const adminCount = (workspace?.members || []).filter((item) => (
    item.role === 'admin' || isWorkspaceOwner(workspace, memberUserId(item))
  )).length;
  let removeAllowed = true;
  let removeReason = '';

  if (state.demoMode) {
    removeAllowed = false;
    removeReason = 'Demo members cannot be removed.';
  } else if (isSelf) {
    removeAllowed = false;
    removeReason = 'You cannot remove yourself here.';
  } else if (!currentIsAdmin) {
    removeAllowed = false;
    removeReason = 'Only admins can remove members.';
  } else if (targetIsOwner) {
    removeAllowed = false;
    removeReason = 'Workspace owner cannot be removed.';
  } else if (targetIsAdmin && !currentIsOwner) {
    removeAllowed = false;
    removeReason = 'Only the owner can remove admins.';
  } else if (targetIsAdmin && adminCount <= 1) {
    removeAllowed = false;
    removeReason = 'At least one admin must remain.';
  }

  return {
    isSelf,
    currentIsAdmin,
    currentIsOwner,
    targetIsOwner,
    targetIsAdmin,
    canChangeRole: !state.demoMode && currentIsOwner && !targetIsOwner && !isSelf,
    canRemove: removeAllowed,
    removeReason
  };
};

const removeMembersActionMenu = () => {
  document.getElementById('membersActionPortal')?.remove();
};

const closeMembersActionMenu = () => {
  membersActiveMenuMemberId = '';
  membersActionMenuRect = null;
  removeMembersActionMenu();
  document.querySelectorAll('.members-menu-trigger-btn[aria-expanded="true"]').forEach((button) => {
    button.setAttribute('aria-expanded', 'false');
  });
};

const renderMembersActionMenu = () => {
  removeMembersActionMenu();
  if (!membersActiveMenuMemberId) return;
  const workspace = selectedWorkspace();
  const member = workspace?.members?.find((item) => memberUserId(item) === membersActiveMenuMemberId);
  if (!workspace || !member || !membersActionMenuRect) return;

  const displayName = getMemberDisplayName(member);
  const email = member.user?.email || member.email || '';
  const role = member.role || 'member';
  const policy = memberActionPolicy(workspace, member);
  const menuWidth = 220;
  const estimatedHeight = policy.canChangeRole && policy.canRemove ? 238 : policy.canRemove || policy.canChangeRole ? 196 : 154;
  const viewportPadding = 12;
  const left = Math.min(
    Math.max(viewportPadding, membersActionMenuRect.right - menuWidth),
    window.innerWidth - menuWidth - viewportPadding
  );
  const openUpward = membersActionMenuRect.bottom + estimatedHeight + viewportPadding > window.innerHeight;
  const top = openUpward
    ? Math.max(viewportPadding, membersActionMenuRect.top - estimatedHeight - 8)
    : Math.min(window.innerHeight - viewportPadding, membersActionMenuRect.bottom + 8);

  const portal = document.createElement('div');
  portal.id = 'membersActionPortal';
  portal.className = 'member-action-dropdown member-action-portal';
  portal.setAttribute('role', 'menu');
  portal.style.left = `${Math.round(left)}px`;
  portal.style.top = `${Math.round(top)}px`;
  portal.innerHTML = `
    <button type="button" class="members-menu-action-btn" data-menu-action="view-profile" data-member-id="${escapeHtml(membersActiveMenuMemberId)}" role="menuitem">
      <span class="menu-action-icon">◷</span><span>View profile</span>
    </button>
    <button type="button" class="members-menu-action-btn" data-menu-action="copy-email" data-member-email="${escapeHtml(email)}" role="menuitem">
      <span class="menu-action-icon">□</span><span>Copy email</span>
    </button>
    ${policy.canChangeRole ? `
      <button type="button" class="members-menu-action-btn" data-menu-action="change-role" data-role-to="${role === 'admin' ? 'member' : 'admin'}" data-member-id="${escapeHtml(membersActiveMenuMemberId)}" role="menuitem">
        <span class="menu-action-icon">◇</span><span>Make ${role === 'admin' ? 'member' : 'admin'}</span>
      </button>
    ` : ''}
    <button type="button" class="members-menu-action-btn" data-menu-action="message" data-member-id="${escapeHtml(membersActiveMenuMemberId)}" role="menuitem">
      <span class="menu-action-icon">↗</span><span>Message member</span>
    </button>
    ${policy.canRemove ? `
      <button type="button" class="members-menu-action-btn danger" data-menu-action="remove" data-member-id="${escapeHtml(membersActiveMenuMemberId)}" role="menuitem">
        <span class="menu-action-icon">−</span><span>Remove from workspace</span>
      </button>
    ` : ''}
  `;
  document.body.appendChild(portal);
  document.querySelectorAll('.members-menu-trigger-btn').forEach((button) => {
    button.setAttribute('aria-expanded', button.dataset.triggerMenuFor === membersActiveMenuMemberId ? 'true' : 'false');
  });
};

const openMembersActionMenu = (memberId, triggerButton) => {
  if (membersActiveMenuMemberId === memberId) {
    closeMembersActionMenu();
    return;
  }
  membersActiveMenuMemberId = memberId;
  membersActionMenuRect = triggerButton.getBoundingClientRect();
  renderMembersActionMenu();
};



const handleMembersMenuAction = async (menuAction) => {
  const action = menuAction.dataset.menuAction;
  const memberId = menuAction.dataset.memberId;
  const workspace = selectedWorkspace();
  if (!workspace) return;

  if (action === 'view-profile') {
    const member = workspace.members.find((m) => memberUserId(m) === memberId);
    if (member) showMemberDetailsModal(member);
    closeMembersActionMenu();
  } else if (action === 'copy-email') {
    const email = menuAction.dataset.memberEmail;
    await copyText(email, 'Email copied');
    closeMembersActionMenu();
  } else if (action === 'message') {
    showToast('Direct messages are not available yet.');
    closeMembersActionMenu();
  } else if (action === 'change-role') {
    if (state.demoMode) {
      showToast('Demo roles cannot be updated');
      closeMembersActionMenu();
      return;
    }
    const roleTo = menuAction.dataset.roleTo;
    if (confirm(`Change member's role to ${roleTo.toUpperCase()}?`)) {
      try {
        await request(`/api/workspaces/${state.selectedWorkspaceId}/members/${memberId}`, {
          method: 'PATCH',
          body: JSON.stringify({ role: roleTo })
        });
        await loadWorkspaces();
        showToast('Member role updated');
        closeMembersActionMenu();
        renderMembersPage();
      } catch (err) {
        showToast(err.message, true);
      }
    }
  } else if (action === 'remove') {
    const member = workspace.members.find((m) => memberUserId(m) === memberId);
    const policy = member ? memberActionPolicy(workspace, member) : { canRemove: false, removeReason: 'Member not found.' };
    closeMembersActionMenu();
    if (!policy.canRemove) {
      showToast(policy.removeReason || 'You cannot remove this member.', true);
      return;
    }
    showRemoveMemberModal(memberId);
  }
};

const addActivity = ({ actor = state.user?.username || state.user?.email || 'You', action, target, documentId = state.selectedDocumentId }) => {
  if (!action || !target) return;
  state.activityItems.unshift({
    id: `activity-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    actor,
    action,
    target,
    time: 'Just now',
    documentId
  });
  state.activityItems = state.activityItems.slice(0, 12);
  if (normalizeContextTab(state.activeContextTab) === 'activity') renderActivityList();
};

const renderActivityList = () => {
  if (!els.activityList) return;
  els.activityList.innerHTML = state.activityItems.map((item) => `
    <button class="activity-item" data-activity-document="${escapeHtml(item.documentId || '')}" type="button">
      <span class="avatar-dot">${escapeHtml(getInitials(item.actor))}</span>
      <span>
        <strong>${escapeHtml(item.actor)}</strong>
        <small>${escapeHtml(item.action)} ${escapeHtml(item.target)} · ${escapeHtml(item.time || 'Recently')}</small>
      </span>
    </button>
  `).join('') || emptyState({
    title: 'No activity yet',
    body: 'Edits, tasks, replies, and AI generations will appear here.',
    action: 'Create Document',
    actionId: 'emptyActivityNewDocBtn',
    secondaryAction: 'Invite Member',
    secondaryActionId: 'emptyActivityInviteBtn',
    icon: '◷'
  });
};

const updateTypingStatus = () => {
  if (!els.typingStatus) return;
  const names = state.typingUsers
    .filter((user) => user.userId !== state.user?.id)
    .map((user) => user.username || user.email || user.userId || 'Someone');
  if (names.length) {
    els.typingStatus.textContent = `${names.slice(0, 2).join(', ')} ${names.length === 1 ? 'is' : 'are'} typing...`;
    els.typingStatus.classList.add('active');
    return;
  }
  if (state.presence.length > 0) {
    els.typingStatus.textContent = `${state.presence.length} ${state.presence.length === 1 ? 'person is' : 'people are'} here with you.`;
  } else {
    els.typingStatus.textContent = 'Only you are editing.';
  }
  els.typingStatus.classList.remove('active');
};

const getActivityIcon = (action) => {
  const a = String(action).toLowerCase();
  if (a.includes('edit') || a.includes('writ') || a.includes('creat')) return '📝';
  if (a.includes('chat') || a.includes('repli') || a.includes('sent') || a.includes('messag')) return '💬';
  if (a.includes('complet')) return '✅';
  if (a.includes('ai') || a.includes('generat')) return '🤖';
  if (a.includes('doubt') || a.includes('ask')) return '❓';
  if (a.includes('invit') || a.includes('member')) return '👥';
  return '📝';
};

const getFilteredWorkspaceThreads = () => {
  let list = state.workspaceThreads || [];

  // 1. Filter by tab
  if (threadFilterTab === 'unresolved') {
    list = list.filter(t => t.status !== 'resolved');
  } else if (threadFilterTab === 'resolved') {
    list = list.filter(t => t.status === 'resolved');
  } else if (threadFilterTab === 'mine') {
    const currentUserId = state.user?.id || state.user?._id;
    list = list.filter(t => {
      const senderId = t.sender?._id || t.sender;
      return String(senderId) === String(currentUserId);
    });
  }

  // 2. Filter by search query
  if (threadSearchQuery.trim()) {
    const q = threadSearchQuery.toLowerCase().trim();
    list = list.filter(t => {
      const titleMatch = (t.body || '').toLowerCase().includes(q);
      const docMatch = (t.documentTitle || '').toLowerCase().includes(q);
      const authorName = t.sender?.username || t.sender?.email || '';
      const authorMatch = authorName.toLowerCase().includes(q);
      const statusMatch = (t.status || '').toLowerCase().includes(q);
      return titleMatch || docMatch || authorMatch || statusMatch;
    });
  }

  return list;
};



const renderEmptyDetailHtml = (hasDoubts) => {
  if (hasDoubts) {
    return `
      <div class="threads-premium-empty-state">
        <div class="empty-icon-circle">?</div>
        <h2>No doubt selected</h2>
        <p>Select a doubt from the left panel or ask a new question from your notes.</p>
        <div class="empty-actions">
          <button class="primary ask-doubt-action-btn" type="button">Ask Doubt</button>
          <button class="subtle-btn go-to-docs-btn" type="button">Open Documents</button>
        </div>
      </div>
    `;
  } else {
    return `
      <div class="threads-premium-empty-state">
        <div class="empty-icon-circle">?</div>
        <h2>No doubts yet</h2>
        <p>Open a document, select text, and ask a doubt to start a linked thread.</p>
        <div class="empty-actions">
          <button class="primary ask-doubt-action-btn" type="button">Ask Doubt</button>
          <button class="subtle-btn go-to-docs-btn" type="button">Go to Documents</button>
        </div>
      </div>
    `;
  }
};

const sortTasks = (list, field) => {
  const priorityWeight = { high: 3, medium: 2, low: 1 };
  return [...list].sort((a, b) => {
    if (field === 'priority') {
      const wA = priorityWeight[a.priority] || 2;
      const wB = priorityWeight[b.priority] || 2;
      return wB - wA;
    }
    if (field === 'dueDate') {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    }
    if (field === 'createdAt') {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    }
    return 0;
  });
};

const getTaskStats = (tasks) => {
  const currentUserId = String(state.user?.id || state.user?._id || '');
  const open = tasks.filter(t => t.status !== 'done' && t.status !== 'completed');
  const completed = tasks.filter(t => t.status === 'done' || t.status === 'completed');
  
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const threeDaysLater = new Date(now);
  threeDaysLater.setDate(threeDaysLater.getDate() + 3);
  
  const dueSoon = open.filter(t => {
    if (!t.dueDate) return false;
    const d = new Date(t.dueDate);
    return d >= now && d <= threeDaysLater;
  });

  const assignedToMe = open.filter(t => {
    const assId = t.assignee?._id || t.assignee;
    return assId && String(assId) === currentUserId;
  });

  return {
    open: open.length,
    dueSoon: dueSoon.length,
    completed: completed.length,
    assignedToMe: assignedToMe.length
  };
};

const isMemberOnline = (member) => {
  const userId = memberUserId(member);
  if (state.demoMode) {
    return userId !== 'demo-user-alex';
  }
  const chatOnlineIds = new Set(state.chatOnlineUsers.map((user) => String(user.userId)).filter(Boolean));
  const presenceUserIds = new Set(state.presence.map((user) => String(user.userId)).filter(Boolean));
  return chatOnlineIds.has(userId) || presenceUserIds.has(userId) || userId === String(state.user?.id);
};

const getMemberActivityText = (member) => {
  const userId = memberUserId(member);
  if (state.demoMode) {
    if (userId === 'demo-user-priya') return 'Editing ML Study Guide';
    if (userId === 'demo-user-sam') return 'In Tasks';
    if (userId === 'demo-user-rohan') return 'Viewing CAP Theorem';
  }
  const pres = state.presence.find(u => String(u.userId) === userId);
  if (pres) {
    return `Editing ${selectedDocumentTitle()}`;
  }
  const isOnline = isMemberOnline(member);
  if (isOnline) {
    return 'Active in workspace';
  }
  return 'No recent activity';
};

const syncSettingsFormState = (workspace) => {
  const preferences = state.preferences;
  settingsWorkspaceName = workspace?.name || '';
  settingsWorkspaceDescription = workspace ? (localStorage.getItem(`nexusWorkspaceDescription_${workspace._id}`) || 'Shared workspace for notes, projects, tasks, and discussions.') : '';
  settingsTheme = preferences.theme || 'light';
  settingsDensity = preferences.density || 'comfortable';
  settingsReduceMotion = Boolean(preferences.reduceMotion);
  settingsEmailNotifications = preferences.emailNotifications !== false;
  settingsTaskNotifications = preferences.taskNotifications !== false;
  settingsDiscussionNotifications = preferences.discussionNotifications !== false;
  settingsMentionNotifications = preferences.mentionNotifications !== false;
  settingsInviteNotifications = preferences.inviteNotifications !== false;
  settingsSaveInProgress = false;
};

const isSettingsDirty = () => {
  const workspace = selectedWorkspace();
  const preferences = state.preferences;
  if (state.activeSettingsTab === 'general') {
    const currentDesc = workspace ? (localStorage.getItem(`nexusWorkspaceDescription_${workspace._id}`) || 'Shared workspace for notes, projects, tasks, and discussions.') : '';
    return settingsWorkspaceName !== (workspace?.name || '') ||
           settingsWorkspaceDescription !== currentDesc;
  }
  if (state.activeSettingsTab === 'appearance') {
    return settingsTheme !== (preferences.theme || 'light') ||
           settingsDensity !== (preferences.density || 'comfortable') ||
           settingsReduceMotion !== Boolean(preferences.reduceMotion);
  }
  if (state.activeSettingsTab === 'notifications') {
    return settingsEmailNotifications !== (preferences.emailNotifications !== false) ||
           settingsTaskNotifications !== (preferences.taskNotifications !== false) ||
           settingsDiscussionNotifications !== (preferences.discussionNotifications !== false) ||
           settingsMentionNotifications !== (preferences.mentionNotifications !== false) ||
           settingsInviteNotifications !== (preferences.inviteNotifications !== false);
  }
  return false;
};

const updateSaveButtonState = () => {
  const saveBtn = document.getElementById('settingsSaveBtn');
  if (saveBtn) {
    saveBtn.disabled = settingsSaveInProgress || !isSettingsDirty();
  }
};

const renderInvitePage = async () => {
  setMainMode('feature');
  setRouteChrome('');
  const token = routeQuery().get('token') || '';
  const code = routeQuery().get('code') || '';
  const credential = token ? { token } : code ? { code } : {};
  let inviteMarkup = '<p>Paste an invite link or code below to preview and accept it.</p>';
  activeJoinInvite = null;

  if (credential.token || credential.code) {
    try {
      const invite = await previewInviteCredential(credential);
      activeJoinInvite = { preview: invite, credential };
      if (!state.token) {
        storePendingInviteCredential(credential);
        showToast('Log in or create an account to join this workspace.');
        navigate('login');
        return;
      }
      inviteMarkup = `
        <div class="join-confirm-page">
          <h3>Join workspace?</h3>
          <dl class="invite-summary-grid">
            <div><dt>Workspace</dt><dd>${escapeHtml(invite.workspaceName || invite.workspace?.name || 'Workspace')}</dd></div>
            <div><dt>Role</dt><dd>${escapeHtml(formatInviteRole(invite.role))}</dd></div>
            <div><dt>Expires</dt><dd>${escapeHtml(formatInviteExpiry(invite.expiresAt))}</dd></div>
          </dl>
        </div>
      `;
    } catch (err) {
      inviteMarkup = `<p class="invite-error">${escapeHtml(err.message || 'This invite link is invalid.')}</p>`;
    }
  }

  els.routePage.innerHTML = `
    <div class="page-shell">
      <header class="page-hero">
        <div>
          <p class="eyebrow">Invitation</p>
          <h2>Join Workspace</h2>
          <p>Join a workspace from an invite link, token, or code.</p>
        </div>
      </header>
      <section class="page-card">
        ${inviteMarkup}
        ${activeJoinInvite ? '' : `<input id="inviteTokenInput" value="${escapeHtml(token || code)}" placeholder="Invite link, token, or STUDY code" />`}
        <button id="${activeJoinInvite ? 'confirmJoinWorkspaceBtn' : 'previewInviteBtn'}" class="primary" type="button">${activeJoinInvite ? 'Join Workspace' : 'Preview invite'}</button>
      </section>
    </div>
  `;
};

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const parseMarkdownToHtml = (text = '') => {
  if (!text) return '';
  let escaped = escapeHtml(text);

  // 1. Extract code blocks
  const codeBlocks = [];
  escaped = escaped.replace(/```(?:[a-zA-Z0-9-]*\n)?([\s\S]*?)```/g, (match, codeContent) => {
    const index = codeBlocks.push(codeContent);
    return `__CODE_BLOCK_PLACEHOLDER_${index - 1}__`;
  });

  // 2. Extract inline code
  const inlineCodes = [];
  escaped = escaped.replace(/`([^`\n]+)`/g, (match, inlineContent) => {
    const index = inlineCodes.push(inlineContent);
    return `__INLINE_CODE_PLACEHOLDER_${index - 1}__`;
  });

  // 3. Bold, Italic, Strikethrough
  escaped = escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // 4. Bullet lists & newlines
  const lines = escaped.split('\n');
  let inList = false;
  const parsedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const content = trimmed.substring(2);
      if (!inList) {
        parsedLines.push('<ul class="chat-bullet-list">');
        inList = true;
      }
      parsedLines.push(`<li>${content}</li>`);
    } else {
      if (inList) {
        parsedLines.push('</ul>');
        inList = false;
      }
      parsedLines.push(line);
    }
  }
  if (inList) {
    parsedLines.push('</ul>');
  }

  // Re-assemble and convert non-list newlines to <br>
  let result = '';
  for (let i = 0; i < parsedLines.length; i++) {
    const line = parsedLines[i];
    const isTag = line.startsWith('<ul') || line.startsWith('</ul') || line.startsWith('<li');
    result += line;
    if (i < parsedLines.length - 1) {
      const nextLine = parsedLines[i + 1];
      const nextIsTag = nextLine.startsWith('<ul') || nextLine.startsWith('</ul') || nextLine.startsWith('<li');
      if (!isTag && !nextIsTag) {
        result += '<br>';
      } else {
        result += '\n';
      }
    }
  }

  // 5. Restore inline code
  inlineCodes.forEach((codeContent, index) => {
    result = result.replace(`__INLINE_CODE_PLACEHOLDER_${index}__`, `<code class="chat-inline-code">${codeContent}</code>`);
  });

  // 6. Restore code blocks
  codeBlocks.forEach((codeContent, index) => {
    const trimmedCode = codeContent.trim();
    result = result.replace(`__CODE_BLOCK_PLACEHOLDER_${index}__`, `<div class="chat-code-block"><pre><code>${trimmedCode}</code></pre></div>`);
  });

  return result;
};

const renderMarkdown = (text = '') => {
  if (!text) return '';
  return escapeHtml(text)
    .replace(/```([\s\S]+?)```/g, '<pre><code>$1</code></pre>') // code blocks
    .replace(/`([^`]+)`/g, '<code>$1</code>')                 // inline code
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')       // bold
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')                   // italic
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')                  // h3
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')                    // h2
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')                    // h1
    .split('\n')
    .map(line => {
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        return `<li>${line.trim().substring(2)}</li>`;
      }
      return line;
    })
    .join('\n')
    .replaceAll('\n', '<br>');
};


const cleanAiLine = (value = '') => String(value)
  .replace(/^[-*•]\s*/, '')
  .replace(/^#{1,6}\s*/, '')
  .trim();

const stripAiLabel = (value = '', label = '') => cleanAiLine(value)
  .replace(new RegExp(`^${label}\\s*[:：-]\\s*`, 'i'), '')
  .trim();

const splitAiSections = (output = '') => {
  const sections = [];
  let current = null;

  output.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    const normalized = cleanAiLine(line).replace(/:$/, '');
    const isHeading = /^(short summary|detailed summary|key points|things to remember|important terms|revision notes|simple explanation|real-life example|real life example|exam answer version|exam answer|very important|medium important|quick revision|what to revise first)$/i.test(normalized);

    if (isHeading) {
      current = { title: normalized, items: [], text: '' };
      sections.push(current);
      return;
    }

    if (!current) {
      current = { title: 'Study Output', items: [], text: '' };
      sections.push(current);
    }

    if (/^[-*•]\s+/.test(line) || /^\d+[).]\s+/.test(line)) {
      current.items.push(cleanAiLine(line));
    } else {
      current.text = `${current.text}${current.text ? '\n' : ''}${cleanAiLine(line)}`;
    }
  });

  return sections.filter((section) => section.title || section.text || section.items.length);
};

const parseQuizOutput = (output = '') => {
  const normalized = output.replace(/\r/g, '').trim();
  if (!normalized) return [];

  const blocks = normalized
    .split(/\n\s*(?=(?:Question\s*)?\d+\s*[).:-])/i)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block, index) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return null;

    let question = lines[0]
      .replace(/^(?:Question\s*)?\d+\s*[).:-]\s*/i, '')
      .trim();
    const options = [];
    let answer = '';
    let answerText = '';
    let explanation = '';
    let topic = '';

    lines.slice(1).forEach((line) => {
      const optionMatch = line.match(/^([A-D])\s*[).:-]\s*(.+)$/i);
      if (optionMatch) {
        options.push({ key: optionMatch[1].toUpperCase(), text: optionMatch[2].trim() });
        return;
      }

      const answerMatch = line.match(/^Answer\s*[:：-]\s*([A-D])?\)?\s*(.*)$/i);
      if (answerMatch) {
        answer = (answerMatch[1] || '').toUpperCase();
        answerText = (answerMatch[2] || '').trim();
        return;
      }

      const explanationMatch = line.match(/^Explanation\s*[:：-]\s*(.*)$/i);
      if (explanationMatch) {
        explanation = explanationMatch[1].trim();
        return;
      }

      const topicMatch = line.match(/^Topic\s*[:：-]\s*(.*)$/i);
      if (topicMatch) {
        topic = topicMatch[1].trim();
        return;
      }

      if (!question) question = line;
      else if (!explanation && !/^Quiz/i.test(line)) explanation = line;
    });

    if (!question || /^quiz from your notes$/i.test(question)) return null;

    if (!answer && options.length && answerText) {
      const match = options.find((option) => option.text.toLowerCase().includes(answerText.toLowerCase()));
      if (match) answer = match.key;
    }

    return {
      id: `q-${index}`,
      question,
      options,
      answer,
      answerText,
      explanation,
      topic: topic || 'Study notes'
    };
  }).filter(Boolean);
};

const parseFlashcardsOutput = (output = '') => {
  const lines = output.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  const cards = [];
  let current = null;

  lines.forEach((line) => {
    if (/^Front\s*[:：-]/i.test(line)) {
      if (current?.front && current?.back) cards.push(current);
      current = { front: stripAiLabel(line, 'Front'), back: '', tag: 'Study notes' };
      return;
    }

    if (/^Back\s*[:：-]/i.test(line)) {
      if (!current) current = { front: '', back: '', tag: 'Study notes' };
      current.back = stripAiLabel(line, 'Back');
      return;
    }

    if (/^Tag\s*[:：-]/i.test(line)) {
      if (!current) current = { front: '', back: '', tag: 'Study notes' };
      current.tag = stripAiLabel(line, 'Tag') || 'Study notes';
      return;
    }

    if (current && current.back && !/^Flashcards/i.test(line)) {
      current.back = `${current.back} ${cleanAiLine(line)}`.trim();
    }
  });

  if (current?.front && current?.back) cards.push(current);
  return cards.map((card, index) => ({ ...card, id: `card-${index}` }));
};

const buildAiStudySession = (action = '', output = '') => {
  if (action === 'quiz') {
    const questions = parseQuizOutput(output);
    if (questions.length) {
      return {
        type: 'quiz',
        questions,
        currentIndex: 0,
        answers: {},
        completed: false
      };
    }
  }

  if (action === 'flashcards') {
    const cards = parseFlashcardsOutput(output);
    if (cards.length) {
      return {
        type: 'flashcards',
        cards,
        currentIndex: 0,
        flipped: false,
        progress: {}
      };
    }
  }

  return {
    type: 'structured',
    action,
    sections: splitAiSections(output),
    output
  };
};

const renderAiStudyOutput = () => {
  if (!els.aiOutput) return;
  const session = state.aiStudySession;
  if (!session) {
    els.aiOutput.innerHTML = renderMarkdown(state.lastAiOutput || '');
    updateLibrarySaveButton();
    return;
  }

  if (session.type === 'quiz') {
    els.aiOutput.innerHTML = renderQuizSession(session);
    updateLibrarySaveButton();
    return;
  }

  if (session.type === 'flashcards') {
    els.aiOutput.innerHTML = renderFlashcardSession(session);
    updateLibrarySaveButton();
    return;
  }

  els.aiOutput.innerHTML = renderStructuredAiOutput(session);
  updateLibrarySaveButton();
};

const renderStructuredAiOutput = (session) => {
  const sections = session.sections?.length ? session.sections : [{ title: aiActionLabel(session.action), text: session.output, items: [] }];
  return `
    <div class="study-output study-output-${escapeHtml(session.action || 'general')}">
      <header class="study-output-head">
        <span>✦</span>
        <div>
          <strong>${escapeHtml(aiActionLabel(session.action))}</strong>
          <small>Generated from ${escapeHtml(selectedAiSource() === 'selection' ? 'selected text' : 'the current document')}</small>
        </div>
      </header>
      <div class="study-section-grid">
        ${sections.map((section) => `
          <article class="study-section-card">
            <h4>${escapeHtml(section.title)}</h4>
            ${section.text ? `<div>${renderMarkdown(section.text)}</div>` : ''}
            ${section.items?.length ? `<ul>${section.items.map((item) => `<li>${renderMarkdown(item)}</li>`).join('')}</ul>` : ''}
          </article>
        `).join('')}
      </div>
    </div>
  `;
};

const renderQuizSession = (session) => {
  const total = session.questions.length;
  const answeredCount = Object.keys(session.answers || {}).length;
  const score = session.questions.reduce((sum, question, index) => {
    const selected = session.answers?.[index];
    return sum + (selected && question.answer && selected === question.answer ? 1 : 0);
  }, 0);

  if (session.completed) {
    const weakTopics = session.questions
      .filter((question, index) => question.answer && session.answers?.[index] !== question.answer)
      .map((question) => question.topic)
      .filter(Boolean);
    const uniqueWeakTopics = [...new Set(weakTopics)].slice(0, 4);

    return `
      <div class="quiz-shell quiz-complete">
        <header class="quiz-hero">
          <span>✓</span>
          <div>
            <strong>Your score: ${score}/${total}</strong>
            <small>${score === total ? 'Perfect. You are ready to revise faster.' : 'Review mistakes, then turn weak topics into flashcards.'}</small>
          </div>
        </header>
        ${uniqueWeakTopics.length ? `
          <article class="quiz-review-card">
            <h4>Weak topics</h4>
            <div class="study-chip-row">${uniqueWeakTopics.map((topic) => `<span>${escapeHtml(topic)}</span>`).join('')}</div>
          </article>
        ` : ''}
        <div class="quiz-result-list">
          ${session.questions.map((question, index) => {
            const selected = session.answers?.[index];
            const correct = question.answer && selected === question.answer;
            return `
              <article class="quiz-review-card ${correct ? 'correct' : 'wrong'}">
                <strong>Q${index + 1}. ${escapeHtml(question.question)}</strong>
                <p>${correct ? 'Correct' : `Your answer: ${escapeHtml(selected || 'Not answered')}. Correct answer: ${escapeHtml(question.answer || question.answerText || 'See explanation')}`}</p>
                ${question.explanation ? `<small>${escapeHtml(question.explanation)}</small>` : ''}
              </article>
            `;
          }).join('')}
        </div>
        <div class="quiz-actions">
          <button class="primary" data-quiz-action="restart" type="button">Retake quiz</button>
          <button class="ghost" data-ai-study-action="flashcards" type="button">Create flashcards</button>
        </div>
      </div>
    `;
  }

  const index = Math.min(session.currentIndex, total - 1);
  const question = session.questions[index];
  const selected = session.answers?.[index];
  const answered = Boolean(selected);
  const correct = answered && question.answer && selected === question.answer;

  return `
    <div class="quiz-shell">
      <header class="quiz-progress-head">
        <div>
          <strong>Interactive Quiz</strong>
          <small>Question ${index + 1} of ${total} · ${answeredCount}/${total} answered</small>
        </div>
        <span>${Math.round((answeredCount / total) * 100)}%</span>
      </header>
      <div class="quiz-progress-bar"><span style="width:${Math.max(5, (answeredCount / total) * 100)}%"></span></div>
      <article class="quiz-question-card">
        <span class="quiz-topic">${escapeHtml(question.topic || 'Study notes')}</span>
        <h4>${escapeHtml(question.question)}</h4>
        ${question.options.length ? `
          <div class="quiz-options">
            ${question.options.map((option) => {
              const isSelected = selected === option.key;
              const isCorrect = answered && question.answer === option.key;
              const isWrong = answered && isSelected && question.answer && question.answer !== option.key;
              return `<button class="quiz-option ${isSelected ? 'selected' : ''} ${isCorrect ? 'correct' : ''} ${isWrong ? 'wrong' : ''}" data-quiz-answer="${escapeHtml(option.key)}" type="button" ${answered ? 'disabled' : ''}><strong>${escapeHtml(option.key)}</strong><span>${escapeHtml(option.text)}</span></button>`;
            }).join('')}
          </div>
        ` : `
          <div class="quiz-reveal-card">
            <p>This quiz item has a written answer.</p>
            <button class="primary" data-quiz-answer="revealed" type="button" ${answered ? 'disabled' : ''}>Reveal answer</button>
          </div>
        `}
        ${answered ? `
          <div class="quiz-feedback ${correct || !question.answer ? 'correct' : 'wrong'}">
            <strong>${question.answer ? (correct ? 'Correct ✅' : 'Not quite') : 'Answer revealed'}</strong>
            <p>${escapeHtml(question.explanation || question.answerText || 'Review the answer and continue.')}</p>
          </div>
        ` : ''}
      </article>
      <div class="quiz-actions">
        <button class="ghost" data-quiz-action="prev" type="button" ${index === 0 ? 'disabled' : ''}>Previous</button>
        ${index < total - 1 ? `<button class="primary" data-quiz-action="next" type="button" ${!answered ? 'disabled' : ''}>Next</button>` : `<button class="primary" data-quiz-action="finish" type="button" ${!answered ? 'disabled' : ''}>Finish Quiz</button>`}
      </div>
    </div>
  `;
};

const renderFlashcardSession = (session) => {
  const total = session.cards.length;
  const index = Math.min(session.currentIndex, total - 1);
  const card = session.cards[index];
  const progressValues = Object.values(session.progress || {});
  const knownCount = progressValues.filter((value) => value === 'known').length;
  const hardCount = progressValues.filter((value) => value === 'hard').length;

  return `
    <div class="flashcard-shell">
      <header class="quiz-progress-head">
        <div>
          <strong>Flashcard Study Mode</strong>
          <small>Card ${index + 1} of ${total} · ${knownCount} known · ${hardCount} hard</small>
        </div>
        <span>${Math.round(((knownCount + hardCount) / total) * 100)}%</span>
      </header>
      <div class="quiz-progress-bar"><span style="width:${Math.max(5, ((knownCount + hardCount) / total) * 100)}%"></span></div>
      <div class="flashcard-container ${session.flipped ? 'flipped' : ''}" data-flashcard-action="flip">
        <div class="flashcard-inner">
          <div class="flashcard-front">
            <span>${escapeHtml(card.tag || 'Study notes')}</span>
            <strong>${renderMarkdown(card.front)}</strong>
            <small>Front side · click to flip</small>
          </div>
          <div class="flashcard-back">
            <span>${escapeHtml(card.tag || 'Study notes')}</span>
            <strong>${renderMarkdown(card.back)}</strong>
            <small>Back side · click to flip</small>
          </div>
        </div>
      </div>
      <div class="flashcard-actions">
        <button class="ghost" data-flashcard-action="prev" type="button" ${index === 0 ? 'disabled' : ''}>Previous</button>
        <button class="soft-button" data-flashcard-action="hard" type="button">Hard</button>
        <button class="primary" data-flashcard-action="known" type="button">Known</button>
        <button class="ghost" data-flashcard-action="next" type="button" ${index === total - 1 ? 'disabled' : ''}>Next</button>
      </div>
    </div>
  `;
};

const handleAiStudyOutputClick = (event) => {
  const session = state.aiStudySession;
  if (!session) return;

  const aiActionButton = event.target.closest('[data-ai-study-action]');
  if (aiActionButton) return;

  const quizAnswerButton = event.target.closest('[data-quiz-answer]');
  if (quizAnswerButton && session.type === 'quiz') {
    session.answers[session.currentIndex] = quizAnswerButton.dataset.quizAnswer;
    renderAiStudyOutput();
    return;
  }

  const quizActionButton = event.target.closest('[data-quiz-action]');
  if (quizActionButton && session.type === 'quiz') {
    const action = quizActionButton.dataset.quizAction;
    if (action === 'prev') session.currentIndex = Math.max(0, session.currentIndex - 1);
    if (action === 'next') session.currentIndex = Math.min(session.questions.length - 1, session.currentIndex + 1);
    if (action === 'finish') {
      session.completed = true;
      if (state.currentAiResultSavedId) {
        updateStudyMaterialProgress(state.currentAiResultSavedId, {
          quizProgress: getQuizProgressFromSession(session)
        }).catch((err) => showToast(err.message, true));
      }
    }
    if (action === 'restart') {
      session.currentIndex = 0;
      session.answers = {};
      session.completed = false;
    }
    renderAiStudyOutput();
    return;
  }

  const flashcardButton = event.target.closest('[data-flashcard-action]');
  if (flashcardButton && session.type === 'flashcards') {
    const action = flashcardButton.dataset.flashcardAction;
    if (action === 'flip') session.flipped = !session.flipped;
    if (action === 'prev') {
      session.currentIndex = Math.max(0, session.currentIndex - 1);
      session.flipped = false;
    }
    if (action === 'next') {
      session.currentIndex = Math.min(session.cards.length - 1, session.currentIndex + 1);
      session.flipped = false;
    }
    if (action === 'known' || action === 'hard') {
      session.progress[session.currentIndex] = action;
      session.currentIndex = Math.min(session.cards.length - 1, session.currentIndex + 1);
      session.flipped = false;
      scheduleFlashcardProgressSave();
    }
    renderAiStudyOutput();
  }
};


const uint8ToBase64 = (uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < uint8Array.length; index += chunkSize) {
    binary += String.fromCharCode(...uint8Array.subarray(index, index + chunkSize));
  }

  return btoa(binary);
};

const base64ToUint8 = (value) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const setCollabStatus = (message) => {
  els.collabStatus.textContent = message;
};



const renderPresence = () => {
  const presenceStartedAt = performance.now();
  els.presenceList.innerHTML = state.presence.map((user) => {
    const label = user.email || user.userId || 'Collaborator';
    const status = user.cursor ? 'Editing' : 'Online';
    return `<span class="presence-pill" title="${escapeHtml(`${label} · ${status}`)}"><strong>${escapeHtml(getInitials(label))}</strong><span>${escapeHtml(status)}</span></span>`;
  }).join('');

  const peopleFallback = collaborationPeople().slice(0, 8);
  els.memberPresenceList.innerHTML = (state.presence.length ? state.presence.map((user) => {
    const label = user.email || user.userId || 'Collaborator';
    const status = user.cursor ? 'Editing now' : 'Online';
    return `
      <article class="member-row">
        <span class="avatar-dot">${escapeHtml(label.slice(0, 1).toUpperCase())}</span>
        <div>
          <strong>${escapeHtml(label)}</strong>
          <p>${escapeHtml(status)}</p>
        </div>
      </article>
    `;
  }) : peopleFallback.map((person) => `
    <article class="member-row">
      <span class="avatar-dot">${escapeHtml(getInitials(person.name))}</span>
      <div>
        <strong>${escapeHtml(person.name)}</strong>
        <p>${escapeHtml(person.status || (person.online ? 'Online' : 'Offline'))}</p>
      </div>
    </article>
  `)).join('') || emptyState({
    title: 'Studying alone?',
    body: 'Invite your group and see collaborators, presence, and cursor activity here.',
    action: 'Invite Member',
    actionId: 'emptyMembersInviteBtn',
    icon: '◌'
  });

  els.remoteCursorLayer.innerHTML = state.presence
    .filter((user) => user.userId !== state.user?.id && user.cursor)
    .map((user) => {
      const label = user.email || 'Collaborator';
      return `<span class="remote-cursor">${escapeHtml(label)} @ ${user.cursor.start}</span>`;
    })
    .join('');
  updateTypingStatus();
  recordDocumentOpenMeasure('renderPresence', presenceStartedAt);
};

const loadWorkspaces = async () => {
  if (state.demoMode) {
    await loadDemoWorkspaceModule();
    hydrateDemoWorkspace();
    loadDemoDocument(state.selectedDocumentId);
    return;
  }
  if (!state.token) return;
  setLoading('workspaces', true);
  try {
    state.workspaces = await request('/api/workspaces');
    setError('workspaces');
  } catch (err) {
    setError('workspaces', err.message);
    throw err;
  } finally {
    state.loading.workspaces = false;
  }

  if (!state.workspaces.some((workspace) => workspace._id === state.selectedWorkspaceId)) {
    state.selectedWorkspaceId = state.workspaces[0]?._id || '';
  }

  if (state.selectedWorkspaceId) {
    localStorage.setItem('workspaceId', state.selectedWorkspaceId);
    await Promise.all([loadChannels(), loadDocuments()]);
  } else {
    localStorage.removeItem('workspaceId');
    state.channels = [];
    state.documents = [];
    state.chatMessages = [];
  }

  render();
};

const loadChannels = async () => {
  if (state.demoMode) {
    state.selectedChannelId = GENERAL_CHAT_CHANNEL;
    state.chatMessages = state.messages.filter((message) => message.channelId === GENERAL_CHAT_CHANNEL);
    state.chatOnlineUsers = collaborationPeople().map((person) => ({
      userId: person.id,
      username: person.name,
      email: person.email
    }));
    render();
    return;
  }
  state.channels = [];
  state.messages = [];
  state.chatMessages = [];
  state.selectedChannelId = '';
  if (!state.selectedWorkspaceId) return;

  setLoading('channels', true);
  try {
    state.channels = await request(`/api/channels/${state.selectedWorkspaceId}`);
    setError('channels');
  } catch (err) {
    setError('channels', err.message);
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

const loadMessages = async () => {
  if (state.demoMode) {
    render();
    return;
  }
  state.messages = [];
  if (!state.selectedWorkspaceId || !state.selectedChannelId) return;

  if (state.chatMessages.length && activeChatChannel().slug === state.selectedChannelId) {
    state.messages = [...state.chatMessages];
    render();
    return;
  }

  setLoading('messages', true);
  try {
    state.messages = await request(`/api/messages/${state.selectedWorkspaceId}/${state.selectedChannelId}`);
    setError('messages');
  } catch (err) {
    setError('messages', err.message);
    throw err;
  } finally {
    state.loading.messages = false;
  }
  render();
};

const ensureChatReady = async () => {
  if (state.demoMode) {
    state.chatMessages = state.messages.filter((message) => message.channelId === GENERAL_CHAT_CHANNEL);
    state.chatOnlineUsers = collaborationPeople().map((person) => ({
      userId: person.id,
      username: person.name,
      email: person.email
    }));
    return;
  }
  if (!state.selectedWorkspaceId) return;
  if (!state.channels.length) await loadChannels();
  if (!activeChatChannel().slug) return;
  state.selectedChannelId = activeChatChannel().slug;
  localStorage.setItem('channelId', state.selectedChannelId);
  joinChannelRoom();
  joinWorkspaceChat();
  if (!state.chatMessages.length) await loadChatMessages();
};

const loadChatMessages = async () => {
  if (state.demoMode) {
    state.chatMessages = state.messages.filter((message) => message.channelId === GENERAL_CHAT_CHANNEL);
    return;
  }
  const channel = activeChatChannel();
  if (!state.selectedWorkspaceId || !channel.slug) return;

  if (state.messages.length && state.selectedChannelId === channel.slug) {
    state.chatMessages = [...state.messages];
    return;
  }

  state.loading.chat = true;
  try {
    state.chatMessages = await request(`/api/messages/${state.selectedWorkspaceId}/${channel.slug}`);
    setError('chat');
  } catch (err) {
    setError('chat', err.message);
    throw err;
  } finally {
    state.loading.chat = false;
  }
};


const sendWorkspaceChatMessage = async () => {
  const input = document.getElementById('workspaceChatInput');
  const content = input?.value.trim() || '';
  const channel = activeChatChannel();
  if (!state.selectedWorkspaceId || !channel.slug || !content) return;

  window.chatForceScrollBottom = true;
  publishChatTyping(false);
  if (state.demoMode) {
    const message = {
      _id: `demo-chat-${Date.now()}`,
      workspace: state.selectedWorkspaceId,
      channelId: channel.slug,
      sender: { _id: state.user?.id, username: state.user?.username || 'You' },
      content,
      createdAt: new Date().toISOString()
    };
    state.messages.push(message);
    state.chatMessages.push(message);
    input.value = '';
    renderChatPage();
    return;
  }

  if (collab.socket?.connected) {
    collab.socket.emit('send-chat-message', {
      workspaceId: state.selectedWorkspaceId,
      channelId: channel.slug,
      content
    });
    input.value = '';
    return;
  }

  const message = await request(`/api/messages/${state.selectedWorkspaceId}/${channel.slug}`, {
    method: 'POST',
    body: JSON.stringify({ content })
  });
  state.messages.push(message);
  state.chatMessages.push(message);
  input.value = '';
  renderChatPage();
};

const getDocumentContextPath = () => {
  if (!state.selectedWorkspaceId || !state.selectedDocumentId) return '';
  return `/api/workspaces/${state.selectedWorkspaceId}/documents/${state.selectedDocumentId}`;
};

const loadDocumentTasks = async () => {
  if (state.demoMode) {
    renderTaskList();
    return;
  }
  state.documentTasks = [];
  if (!state.selectedWorkspaceId || !state.selectedDocumentId) return;
  const workspaceId = state.selectedWorkspaceId;
  const documentId = state.selectedDocumentId;
  setLoading('tasks', true, { scoped: true });
  try {
    const tasks = await request(`/api/workspaces/${workspaceId}/documents/${documentId}/tasks`);
    if (workspaceId !== state.selectedWorkspaceId || documentId !== state.selectedDocumentId) return;
    state.documentTasks = tasks;
    setError('tasks');
  } catch (err) {
    if (workspaceId !== state.selectedWorkspaceId || documentId !== state.selectedDocumentId) return;
    setError('tasks', err.message);
    throw err;
  } finally {
    if (workspaceId === state.selectedWorkspaceId && documentId === state.selectedDocumentId) {
      state.loading.tasks = false;
    }
  }
  renderTaskList();
};

const loadDocumentMessages = async () => {
  if (state.demoMode) {
    renderThreadList();
    return;
  }
  state.documentMessages = [];
  if (!state.selectedWorkspaceId || !state.selectedDocumentId) return;
  const workspaceId = state.selectedWorkspaceId;
  const documentId = state.selectedDocumentId;
  setLoading('messages', true, { scoped: true });
  try {
    const messages = await request(`/api/workspaces/${workspaceId}/documents/${documentId}/messages`);
    if (workspaceId !== state.selectedWorkspaceId || documentId !== state.selectedDocumentId) return;
    state.documentMessages = messages;
    state.workspaceThreads = [
      ...state.workspaceThreads.filter((thread) => String(thread.documentId) !== String(documentId)),
      ...state.documentMessages.map((thread) => ({
        ...thread,
        documentId,
        documentTitle: selectedDocumentTitle()
      }))
    ];
    setError('messages');
  } catch (err) {
    if (workspaceId !== state.selectedWorkspaceId || documentId !== state.selectedDocumentId) return;
    setError('messages', err.message);
    throw err;
  } finally {
    if (workspaceId === state.selectedWorkspaceId && documentId === state.selectedDocumentId) {
      state.loading.messages = false;
    }
  }
  renderThreadList();
};

const loadStudyMaterialsForDocument = async (documentId = state.selectedDocumentId) => {
  state.studyMaterials = [];
  state.selectedStudyMaterialId = '';
  state.currentAiResultSavedId = '';
  if (!documentId) {
    renderStudyLibrary();
    return;
  }
  if (state.demoMode) {
    state.studyMaterials = state.demoStudyMaterials
      .filter((material) => String(material.documentId) === String(documentId))
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    renderStudyLibrary();
    return;
  }

  const activeDocumentId = documentId;
  setLoading('studyMaterials', true, { scoped: true });
  try {
    const materials = await request(`/api/study-material/document/${activeDocumentId}`);
    if (String(activeDocumentId) !== String(state.selectedDocumentId)) return;
    state.studyMaterials = materials;
    setError('studyMaterials');
  } catch (err) {
    if (String(activeDocumentId) !== String(state.selectedDocumentId)) return;
    setError('studyMaterials', err.message);
  } finally {
    if (String(activeDocumentId) === String(state.selectedDocumentId)) {
      state.loading.studyMaterials = false;
      renderStudyLibrary();
    }
  }
};

const upsertStudyMaterial = (material) => {
  if (!material?._id) return;
  state.studyMaterials = [
    material,
    ...state.studyMaterials.filter((item) => String(item._id) !== String(material._id))
  ].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
};

const saveCurrentAiResultToLibrary = async () => {
  if (!state.selectedDocumentId) return showToast('Open a document before saving study material', true);
  const payload = buildStudyMaterialPayload();
  if (!payload) return showToast('Generate study material first', true);
  if (state.studyMaterialSaving) return null;

  state.studyMaterialSaving = true;
  updateLibrarySaveButton();
  try {
    let material;
    const existingId = state.currentAiResultSavedId;
    if (existingId && state.aiStudySession?.type === 'quiz') {
      material = await updateStudyMaterialProgress(existingId, { quizProgress: getQuizProgressFromSession() });
    } else if (existingId && state.aiStudySession?.type === 'flashcards') {
      material = await updateStudyMaterialProgress(existingId, { flashcardProgress: getFlashcardProgressFromSession() });
    } else if (existingId) {
      showToast('Already saved to Study Library');
      return state.studyMaterials.find((item) => String(item._id) === String(existingId)) || null;
    } else if (state.demoMode) {
      material = {
        _id: `demo-material-${Date.now()}`,
        workspaceId: state.selectedWorkspaceId,
        documentId: state.selectedDocumentId,
        ...payload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        quizProgress: state.aiStudySession?.type === 'quiz' ? getQuizProgressFromSession() || {} : {},
        flashcardProgress: state.aiStudySession?.type === 'flashcards' ? {
          ...(getFlashcardProgressFromSession() || {}),
          knownCount: getFlashcardProgressFromSession()?.knownCardIds?.length || 0,
          hardCount: getFlashcardProgressFromSession()?.hardCardIds?.length || 0
        } : {}
      };
      state.demoStudyMaterials = [
        material,
        ...state.demoStudyMaterials.filter((item) => String(item._id) !== String(material._id))
      ];
      upsertStudyMaterial(material);
      showToast('Saved in demo library. Create an account to keep it.');
    } else {
      material = await request('/api/study-material', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (state.aiStudySession?.type === 'quiz' && state.aiStudySession.completed) {
        material = await updateStudyMaterialProgress(material._id, { quizProgress: getQuizProgressFromSession() });
      } else if (state.aiStudySession?.type === 'flashcards') {
        const progress = getFlashcardProgressFromSession();
        if (progress?.knownCardIds?.length || progress?.hardCardIds?.length) {
          material = await updateStudyMaterialProgress(material._id, { flashcardProgress: progress });
        }
      }
      upsertStudyMaterial(material);
      showToast('Saved to Study Library');
    }

    if (material?._id) {
      state.currentAiResultSavedId = material._id;
      state.selectedStudyMaterialId = material._id;
      renderStudyLibrary();
      updateLibrarySaveButton();
      activateContextTab('library');
    }
    return material;
  } catch (err) {
    showToast(err.message, true);
    return null;
  } finally {
    state.studyMaterialSaving = false;
    updateLibrarySaveButton();
  }
};

const updateStudyMaterialProgress = async (materialId, body) => {
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
    renderStudyLibrary();
    return material;
  }

  const material = await request(`/api/study-material/${materialId}/progress`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });
  upsertStudyMaterial(material);
  renderStudyLibrary();
  return material;
};

const scheduleFlashcardProgressSave = () => {
  if (!state.currentAiResultSavedId || state.aiStudySession?.type !== 'flashcards') return;
  window.clearTimeout(flashcardProgressSaveTimer);
  flashcardProgressSaveTimer = window.setTimeout(() => {
    updateStudyMaterialProgress(state.currentAiResultSavedId, {
      flashcardProgress: getFlashcardProgressFromSession()
    }).catch((err) => showToast(err.message, true));
  }, 1800);
};

const openStudyMaterial = (materialId) => {
  const material = state.studyMaterials.find((item) => String(item._id) === String(materialId));
  if (!material) return;
  const action = material.content?.action || materialTypeToAiAction(material.type);
  state.selectedStudyMaterialId = material._id;
  state.currentAiResultSavedId = material._id;
  state.lastAiAction = action;
  state.lastAiOutput = material.content?.output || material.title || '';
  state.aiStudySession = material.content?.session || buildAiStudySession(action, state.lastAiOutput);
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
  activateContextTab('ai');
  renderAiStudyOutput();
};

const deleteStudyMaterial = async (materialId) => {
  if (!materialId) return;
  try {
    if (state.demoMode) {
      state.demoStudyMaterials = state.demoStudyMaterials.filter((item) => String(item._id) !== String(materialId));
      state.studyMaterials = state.studyMaterials.filter((item) => String(item._id) !== String(materialId));
    } else {
      await request(`/api/study-material/${materialId}`, { method: 'DELETE' });
      state.studyMaterials = state.studyMaterials.filter((item) => String(item._id) !== String(materialId));
    }
    if (String(state.currentAiResultSavedId) === String(materialId)) state.currentAiResultSavedId = '';
    renderStudyLibrary();
    updateLibrarySaveButton();
    showToast('Study material deleted');
  } catch (err) {
    inviteRequestInFlight = false;
    if (['workspaceInviteCreateBtn', 'inviteMemberBtn'].includes(target.id)) {
      target.disabled = false;
    }
    showToast(err.message, true);
  }
};

const backgroundDocumentBatch = (limit = 8) => {
  const selected = selectedDocument();
  return uniqueDocuments([
    selected,
    ...state.documents
  ].filter(Boolean)).slice(0, limit);
};

const loadDashboardTasks = async ({ limit = 8, clear = false } = {}) => {
  if (clear) state.dashboardTasks = [];
  if (state.demoMode) {
    state.dashboardTasks = state.documentTasks;
    return;
  }
  if (!state.selectedWorkspaceId || state.documents.length === 0) return;

  const docs = backgroundDocumentBatch(limit);
  const taskResults = await Promise.allSettled(docs.map((doc) => (
    request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${doc._id}/tasks`)
  )));

  state.dashboardTasks = taskResults
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value || []);
};

const loadWorkspaceThreads = async ({ limit = 8, clear = false } = {}) => {
  if (clear) state.workspaceThreads = [];
  if (state.demoMode) {
    state.workspaceThreads = state.documentMessages.map((thread) => ({
      ...thread,
      documentId: state.selectedDocumentId,
      documentTitle: selectedDocumentTitle()
    }));
    return;
  }
  if (!state.selectedWorkspaceId || state.documents.length === 0) return;

  const docs = backgroundDocumentBatch(limit);
  const threadResults = await Promise.allSettled(docs.map(async (doc) => {
    const threads = await request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${doc._id}/messages`);
    return threads.map((thread) => ({
      ...thread,
      documentId: doc._id,
      documentTitle: doc.title || 'Untitled Page'
    }));
  }));

  state.workspaceThreads = threadResults
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value || [])
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
};

const scheduleDashboardDataLoad = () => {
  window.clearTimeout(dashboardHydrationTimer);
  if (!state.selectedWorkspaceId || state.documents.length === 0) return;
  if (state.demoMode) {
    loadDashboardTasks();
    loadWorkspaceThreads();
    return;
  }

  const workspaceId = state.selectedWorkspaceId;
  const route = currentRoute();
  dashboardHydrationTimer = window.setTimeout(async () => {
    if (workspaceId !== state.selectedWorkspaceId) return;
    try {
      await Promise.allSettled([
        loadDashboardTasks({ limit: route === 'tasks' ? state.documents.length : 8 }),
        loadWorkspaceThreads({ limit: route === 'threads' ? state.documents.length : 8 })
      ]);
      if (workspaceId !== state.selectedWorkspaceId) return;
      const currentRouteNow = currentRoute();
      if (currentRouteNow === 'home') renderHomePage();
      if (currentRouteNow === 'threads') renderThreadsPage();
      if (currentRouteNow === 'tasks') renderTasksPage();
    } catch (err) {
      console.warn('Background dashboard refresh failed:', err);
    }
  }, 160);
};

const loadDocuments = async () => {
  if (state.demoMode) {
    loadDemoDocument(state.selectedDocumentId);
    return;
  }
  setDocuments([]);
  if (!state.selectedWorkspaceId) return;

  setLoading('documents', true);
  try {
    setDocuments(await request(`/api/documents/workspace/${state.selectedWorkspaceId}`));
    setError('documents');
  } catch (err) {
    setError('documents', err.message);
    throw err;
  } finally {
    state.loading.documents = false;
  }
  const savedDocumentId = localStorage.getItem('documentId') || '';
  state.selectedDocumentId = state.documents.some((document) => String(document._id) === String(savedDocumentId))
    ? savedDocumentId
    : state.documents[0]?._id || '';

  if (state.selectedDocumentId) {
    localStorage.setItem('documentId', state.selectedDocumentId);
    state.dashboardTasks = [];
    state.workspaceThreads = [];
    scheduleDashboardDataLoad();
    await loadDocument(state.selectedDocumentId);
  } else {
    localStorage.removeItem('documentId');
    teardownYDoc();
    state.documentTasks = [];
    state.documentMessages = [];
    state.studyMaterials = [];
    els.documentTitleInput.value = '';
    setEditorText('');
    setCollabStatus('No document selected');
    setAutosaveStatus('No document');
    render();
  }
};

const loadDocument = async (documentId) => {
  if (state.demoMode) {
    loadDemoDocument(documentId);
    return;
  }
  const loadToken = ++activeDocumentLoadToken;
  if (!activeDocumentOpenProfile) startDocumentOpenProfile(documentId);
  const loadStartedAt = performance.now();
  setLoading('document', true);
  let doc;
  try {
    doc = await request(`/api/documents/${documentId}`);
    if (loadToken !== activeDocumentLoadToken) return null;
    setError('document');
  } catch (err) {
    if (loadToken === activeDocumentLoadToken) {
      setError('document', err.message);
      recordDocumentOpenMeasure('loadDocument', loadStartedAt);
      finishDocumentOpenProfile();
      throw err;
    }
    return null;
  } finally {
    if (loadToken === activeDocumentLoadToken) {
      state.loading.document = false;
      if (!doc) renderEditor();
    }
  }
  if (loadToken !== activeDocumentLoadToken) return null;
  state.selectedDocumentId = doc._id;
  state.typingUsers = [];
  state.selectedThreadId = '';
  state.contextLoadedFor = { tasks: '', threads: '', library: '' };
  state.documentTasks = [];
  state.documentMessages = [];
  state.studyMaterials = [];
  localStorage.setItem('documentId', doc._id);
  upsertDocument(doc, { prepend: true });
  els.documentTitleInput.value = doc.title || 'Untitled Page';
  setEditorHtml(doc.contentHtml || '', doc.plainTextContent || '');
  state.lastSavedTitle = els.documentTitleInput.value;
  state.lastSavedText = doc.plainTextContent || '';
  state.saveStatus = 'saved';
  state.pendingSavePromise = null;
  state.saveQueued = false;
  await setupYDoc(doc._id);
  joinDocumentRoom(doc._id);
  setAutosaveStatus('Saved');
  state.lastAiAction = '';
  state.lastAiOutput = '';
  state.aiStudySession = null;
  renderAiEmptyState(doc);
  updateActiveDocumentSelection();
  renderEditor();
  ensureActiveContextData();
  scheduleDashboardDataLoad();
  recordDocumentOpenMeasure('loadDocument', loadStartedAt);
  finishDocumentOpenProfile();
};

const saveCurrentDocument = async ({ silent = false } = {}) => {
  if (!state.selectedDocumentId) return null;
  if (state.demoMode) return saveDemoDocument({ silent });

  const title = els.documentTitleInput.value || 'Untitled document';
  const plainTextContent = getEditorText();
  const plainTextBytes = new TextEncoder().encode(plainTextContent).byteLength;
  if (plainTextContent.length > MAX_DOCUMENT_TEXT_CHARS || plainTextBytes > MAX_DOCUMENT_TEXT_BYTES) {
    const err = new Error('This document is too large to save. Shorten it before switching documents or leaving the page.');
    err.code = 'DOCUMENT_TOO_LARGE';
    state.saveStatus = 'error';
    setAutosaveStatus('Document too large to save');
    if (!silent) showToast(err.message, true);
    throw err;
  }
  if (title === state.lastSavedTitle && plainTextContent === state.lastSavedText) {
    state.saveStatus = 'saved';
    setAutosaveStatus('Saved');
    return selectedDocument();
  }

  if (state.pendingSavePromise) {
    state.saveQueued = true;
    return state.pendingSavePromise;
  }

  state.saveStatus = 'saving';
  setAutosaveStatus(silent ? 'Autosaving...' : 'Saving...');
  state.pendingSavePromise = request(`/api/documents/${state.selectedDocumentId}`, {
    method: 'PUT',
    body: JSON.stringify({ title, plainTextContent })
  });

  try {
    const doc = await state.pendingSavePromise;
    state.lastSavedTitle = title;
    state.lastSavedText = plainTextContent;
    state.saveStatus = 'saved';
    upsertDocument(doc, { prepend: true });
    setAutosaveStatus(silent ? 'Saved just now' : 'Saved');
    if (!silent) addActivity({ action: 'edited', target: doc.title || 'Untitled document', documentId: doc._id });
    if (silent) {
      refreshDocumentTitleChrome();
    } else {
      render();
    }
    return doc;
  } catch (err) {
    state.saveStatus = 'error';
    throw err;
  } finally {
    state.pendingSavePromise = null;
    if (state.saveQueued) {
      state.saveQueued = false;
      const latestTitle = els.documentTitleInput.value || 'Untitled document';
      const latestText = getEditorText();
      if (latestTitle !== state.lastSavedTitle || latestText !== state.lastSavedText) {
        scheduleAutosave();
      }
    }
  }
};

const saveCurrentDocumentIfDirty = async () => {
  const saveStartedAt = performance.now();
  if (!state.selectedDocumentId) return null;
  const title = els.documentTitleInput.value || 'Untitled document';
  const plainTextContent = getEditorText();
  try {
    const titleChanged = title !== state.lastSavedTitle;
    const contentChanged = plainTextContent !== state.lastSavedText;
    console.log('[dirty-check]', {
      documentId: state.selectedDocumentId,
      titleChanged,
      contentChanged,
      editorLength: plainTextContent.length,
      lastSavedLength: state.lastSavedText.length,
      action: titleChanged || contentChanged ? 'save' : 'skip'
    });
    if (!titleChanged && !contentChanged) return selectedDocument();
    return await saveCurrentDocument({ silent: true });
  } finally {
    recordDocumentOpenMeasure('saveCurrentDocumentIfDirty', saveStartedAt);
  }
};

const clearActiveDocumentAfterDelete = () => {
  activeDocumentLoadToken += 1;
  window.clearTimeout(autosaveTimer);
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
  state.saveStatus = 'saved';
  state.pendingSavePromise = null;
  state.saveQueued = false;
  localStorage.removeItem('documentId');
  els.documentTitleInput.value = '';
  setEditorText('');
  setCollabStatus('No document selected');
  setAutosaveStatus('No document');
  renderAiEmptyState(null);
  render();
};

const deleteDocumentById = async (documentId) => {
  const id = String(documentId || '');
  if (!id || deletingDocumentIds.has(id)) return;
  const index = state.documents.findIndex((item) => documentKey(item) === id);
  const doc = state.documents[index];
  if (!doc) return;

  const title = doc.title?.trim() || 'Untitled Page';
  const confirmed = window.confirm(`Are you sure you want to delete "${title}" page?`);
  if (!confirmed) return;

  deletingDocumentIds.add(id);
  renderDocuments();
  const wasActive = id === String(state.selectedDocumentId);

  try {
    window.clearTimeout(autosaveTimer);
    if (state.demoMode) {
      state.documents = state.documents.filter((item) => documentKey(item) !== id);
    } else {
      await request(`/api/documents/${id}`, { method: 'DELETE' });
      state.documents = state.documents.filter((item) => documentKey(item) !== id);
    }

    if (wasActive) {
      const nextDocument = state.documents[index] || state.documents[index - 1] || state.documents[0] || null;
      if (nextDocument) {
        if (state.demoMode) {
          loadDemoDocument(nextDocument._id);
        } else {
          await loadDocument(nextDocument._id);
        }
      } else {
        clearActiveDocumentAfterDelete();
      }
    } else {
      renderDocuments();
    }
    showToast('Document deleted');
  } catch (err) {
    showToast(err.message || 'Document delete failed', true);
  } finally {
    deletingDocumentIds.delete(id);
    renderDocuments();
  }
};

const createDocumentAndOpen = async (title = 'Untitled Page') => {
  if (!state.selectedWorkspaceId) {
    showToast('Select a workspace first', true);
    return null;
  }
  if (documentCreateInFlight) {
    showToast('Document is already being created');
    return null;
  }

  documentCreateInFlight = true;
  try {
    const doc = await request('/api/documents', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: state.selectedWorkspaceId, title })
    });
    upsertDocument(doc, { prepend: true });
    await loadDocument(doc._id);
    return doc;
  } finally {
    documentCreateInFlight = false;
  }
};

const runStudyAiAction = async (action) => {
  if (aiGenerationInFlight) {
    showToast('AI is already generating. Give it a moment.');
    return null;
  }

  const doc = selectedDocument();
  if (!doc) return showToast('Open a document before using AI', true);

  const text = getAiSourceText();
  if (!text) return showToast(selectedAiSource() === 'selection' ? 'Select some text first' : 'Add document text before running AI', true);
  if (text.length < 80) showToast('This note is short. Add more detail for better results.');

  const label = aiActionLabel(action).toLowerCase();
  els.aiActionSelect.value = action;
  activateContextTab('ai');
  state.aiStudySession = null;
  setAiGenerating(true);
  els.aiOutput.innerHTML = `<div class="ai-loading-card"><span>✦</span><strong>Creating ${escapeHtml(label)}...</strong><small>Nexus is turning your notes into active study material.</small></div>`;

  if (state.demoMode) {
    window.setTimeout(() => {
      setAiOutput(action, demoAiResponse(action));
      addActivity({ action: `generated ${aiActionLabel(action).toLowerCase()} from`, target: selectedDocumentTitle() });
      setAiGenerating(false);
    }, 350);
    return null;
  }

  try {
    const result = await request('/api/ai/document-action', {
      method: 'POST',
      body: JSON.stringify({
        action,
        text,
        workspaceId: state.selectedWorkspaceId,
        documentId: state.selectedDocumentId,
        source: selectedAiSource(),
        difficulty: 'medium',
        questionCount: 10
      })
    });
    setAiOutput(action, result.response);
    addActivity({ action: `generated ${aiActionLabel(action).toLowerCase()} from`, target: selectedDocumentTitle() });
    return result.response;
  } catch (err) {
    els.aiOutput.textContent = 'AI could not generate right now. Try again in a few seconds.';
    showToast(err.message, true);
    return null;
  } finally {
    setAiGenerating(false);
  }
};

const saveAiOutputToDocument = async () => {
  if (!state.selectedDocumentId || !state.lastAiOutput.trim()) return showToast('Generate study material first', true);
  const stamp = new Date().toLocaleDateString();
  const block = `\n\n---\nAI ${aiActionLabel(state.lastAiAction)}\nGenerated on ${stamp}\n\n${state.lastAiOutput.trim()}\n`;
  setEditorText(`${getEditorText()}${block}`);
  applyEditorInputToYDoc();
  await saveCurrentDocument();
  showToast('AI result saved below your notes');
};

const createAiOutputDocument = async () => {
  if (!state.lastAiOutput.trim()) return showToast('Generate study material first', true);
  if (!state.selectedWorkspaceId) return showToast('Select a workspace first', true);
  const title = `${selectedDocumentTitle()} - ${aiActionLabel(state.lastAiAction)}`;

  if (state.demoMode) {
    const doc = {
      _id: `demo-ai-doc-${Date.now()}`,
      title,
      category: 'AI Study Material',
      plainTextContent: state.lastAiOutput,
      updatedAt: new Date().toISOString()
    };
    upsertDocument(doc, { prepend: true });
    loadDemoDocument(doc._id);
    navigate('workspace');
    return showToast('Demo study material document created locally');
  }

  const doc = await request('/api/documents', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId: state.selectedWorkspaceId,
      title
    })
  });
  const savedDoc = await request(`/api/documents/${doc._id}`, {
    method: 'PUT',
    body: JSON.stringify({
      title,
      plainTextContent: state.lastAiOutput
    })
  });
  upsertDocument(savedDoc, { prepend: true });
  await loadDocument(savedDoc._id);
  navigate('workspace');
  showToast('Study material document created');
};

const scheduleAutosave = () => {
  if (!state.selectedDocumentId) return;
  const title = els.documentTitleInput.value || 'Untitled document';
  const plainTextContent = getEditorText();
  if (title === state.lastSavedTitle && plainTextContent === state.lastSavedText) {
    state.saveStatus = 'saved';
    setAutosaveStatus('Saved');
    return;
  }
  state.saveStatus = 'dirty';
  setAutosaveStatus('Unsaved changes');
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    saveCurrentDocument({ silent: true }).catch((err) => {
      setAutosaveStatus('Autosave failed');
      showToast(err.message, true);
    });
  }, AUTOSAVE_DELAY_MS);
};

const createDefaultChannel = async () => {
  const channel = await request(`/api/channels/${state.selectedWorkspaceId}`, {
    method: 'POST',
    body: JSON.stringify({ name: 'General', slug: 'general' })
  });
  state.channels.unshift(channel);
  state.selectedChannelId = channel.slug;
  localStorage.setItem('channelId', channel.slug);
};

const createDefaultDocument = async () => {
  await createDocumentAndOpen('Project Notes');
};

const bootstrapWorkspace = async () => {
  if (!state.selectedWorkspaceId) return;
  if (state.channels.length === 0) await createDefaultChannel();
  if (state.documents.length === 0) await createDefaultDocument();
  await Promise.all([loadMessages(), loadDocuments()]);
};

const renderToolPanel = (html, title = 'Workspace Panel', subtitle = 'Manage focused actions without cluttering the sidebar') => {
  const panelClass = [
    'tool-panel-card',
    html.includes('invite-member-card') ? 'invite-tool-panel-card' : '',
    html.includes('workspace-switcher-card') ? 'workspace-switcher-panel-card' : ''
  ].filter(Boolean).join(' ');
  els.toolPanel.innerHTML = `
    <div class="${panelClass}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="tool-panel-head">
        <div>
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(subtitle)}</small>
        </div>
        <button id="closeToolPanelBtn" class="icon-button" type="button" aria-label="Close panel">×</button>
      </div>
      ${html}
    </div>
  `;
  els.toolPanel.classList.add('open');
  syncOverlayScrollLock();
};

const closeToolPanel = () => {
  els.toolPanel.innerHTML = '';
  els.toolPanel.classList.remove('open');
  activeWorkspaceMenuId = '';
  activeWorkspaceRenameId = '';
  pendingWorkspaceDeleteId = '';
  syncOverlayScrollLock();
};

const renderWorkspacesTool = () => {
  const workspace = selectedWorkspace();
  const workspaceListMarkup = state.workspaces.length
    ? state.workspaces.map((item) => {
      const isActive = item._id === state.selectedWorkspaceId;
      return `
        <article class="workspace-option ${isActive ? 'active' : ''}">
          <button class="workspace-option-main" data-tool-workspace-id="${item._id}" type="button">
            <span class="workspace-avatar">${escapeHtml(getInitials(item.name || 'Workspace'))}</span>
            <span>
              <strong>${escapeHtml(item.name)}</strong>
              <small>${escapeHtml(item.members?.length ? `${item.members.length} member(s)` : 'Study workspace')}</small>
            </span>
            ${isActive ? '<em>Current</em>' : ''}
          </button>
        </article>
      `;
    }).join('')
    : emptyState({
      title: 'No workspaces yet',
      body: 'Create your first study workspace, join a teammate invite, or try the demo workspace.',
      action: 'Try Demo',
      actionId: 'emptyToolTryDemoBtn',
      secondaryAction: 'Join Workspace',
      secondaryActionId: 'emptyToolJoinWorkspaceBtn',
      icon: '▣'
    });

  renderToolPanel(`
    <div class="tool-card workspace-switcher-card">
      <div class="workspace-option-list">${workspaceListMarkup}</div>
      <div class="workspace-switcher-actions">
        <button class="soft-button" data-route-go="workspace-settings" type="button">Manage Workspace</button>
        <button class="ghost" id="openJoinWorkspaceBtn" type="button">Join Workspace</button>
      </div>
    </div>
    <div class="tool-card workspace-create-card">
      <div class="workspace-create-head">
        <span class="workspace-create-icon" aria-hidden="true">+</span>
        <div>
          <strong>Create workspace</strong>
          <p>Spin up a focused room for a subject, exam, or project.</p>
        </div>
      </div>
      <label class="workspace-create-field" for="toolWorkspaceNameInput">
        <span>Workspace name</span>
        <input id="toolWorkspaceNameInput" placeholder="Example: DBMS Exam Prep" />
      </label>
      <button class="primary" id="toolCreateWorkspaceBtn" type="button">Create workspace</button>
      ${state.demoMode ? '<p class="muted-copy">Demo mode uses the sample workspace. Sign up to create your own.</p>' : ''}
    </div>
  `, 'Switch workspace', 'Choose a workspace or create a new study room');
  window.setTimeout(() => document.getElementById('toolWorkspaceNameInput')?.focus(), 0);
};

const renderDashboardDocumentTool = () => {
  if (!state.selectedWorkspaceId && !state.demoMode) {
    showToast('Create or select a workspace first', true);
    return renderWorkspacesTool();
  }

  renderToolPanel(`
    <div class="tool-card dashboard-document-card">
      <div class="dashboard-document-head">
        <span class="dashboard-document-icon" aria-hidden="true">+</span>
        <div>
          <strong>New note</strong>
          <p>Create a note and open it immediately in the editor.</p>
        </div>
      </div>
      <label class="dashboard-document-field" for="dashboardDocumentTitleInput">
        <span>Note title</span>
        <input id="dashboardDocumentTitleInput" placeholder="Untitled Page" />
      </label>
      <button class="primary" id="dashboardCreateDocumentBtn" type="button">Create document</button>
    </div>
  `, 'New note', 'Start a note in the current workspace');
  window.setTimeout(() => document.getElementById('dashboardDocumentTitleInput')?.focus(), 0);
};

const renderDashboardTaskTool = () => {
  renderToolPanel(`
    <div class="tool-card">
      <strong>New task</strong>
      <p>Add a task to the current document and surface it on the dashboard.</p>
      <input id="dashboardTaskTitleInput" placeholder="Task title" />
      <select id="dashboardTaskPriorityInput">
        <option value="medium">Medium priority</option>
        <option value="high">High priority</option>
        <option value="low">Low priority</option>
      </select>
      <input id="dashboardTaskDueInput" type="date" />
      <button class="primary" id="dashboardCreateTaskBtn" type="button">Create task</button>
    </div>
  `);
  const dueInput = document.getElementById('dashboardTaskDueInput');
  if (dueInput) dueInput.valueAsDate = new Date();
  window.setTimeout(() => document.getElementById('dashboardTaskTitleInput')?.focus(), 0);
};

const renderMembersTool = async () => {
  const workspace = selectedWorkspace();
  if (!workspace) return renderToolPanel('<div class="tool-card"><p>Select a workspace first.</p></div>');

  const invites = state.demoMode ? [] : await request(`/api/invites/workspace/${state.selectedWorkspaceId}`).catch(() => []);
  renderToolPanel(`
    <div class="tool-card">
      <strong>Workspace settings</strong>
      <input id="renameWorkspaceInput" value="${escapeHtml(workspace.name)}" />
      <button class="primary" id="renameWorkspaceBtn" type="button">Rename workspace</button>
    </div>
    <div class="tool-card">
      <strong>Invite member</strong>
      <input id="inviteEmailInput" placeholder="optional teammate email" />
      <select id="inviteRoleInput">
        <option value="viewer">Viewer</option>
        <option value="member" selected>Editor</option>
        <option value="admin">Admin</option>
      </select>
      <button class="primary" id="inviteMemberBtn" type="button">Create invite</button>
      ${state.demoMode ? '<p class="muted-copy">Demo members are sample collaborators. Sign up to invite your own team.</p>' : ''}
    </div>
    <div class="tool-card">
      <strong>Members</strong>
      <ul>${(workspace.members || []).map((member) => `<li>${escapeHtml(member.user?.email || member.user)} — ${escapeHtml(member.role)}</li>`).join('')}</ul>
    </div>
    <div class="tool-card">
      <strong>Pending invites</strong>
      ${invites.length ? `<ul>${invites.map((invite) => `<li>${escapeHtml(invite.email || 'Shareable link')} — ${escapeHtml(formatInviteRole(invite.role))}</li>`).join('')}</ul>` : emptyState({
        title: 'No pending invites',
        body: 'Invite your first teammate when you are ready to collaborate.',
        action: 'Invite Member',
        actionId: 'emptyToolInviteMemberBtn',
        icon: '◌'
      })}
    </div>
  `);
};

const renderProfileTool = () => {
  renderToolPanel(`
    <div class="profile-tool">
      <section class="tool-card profile-tool-card profile-identity-card">
        <div class="profile-card-head">
          <span class="profile-card-icon" aria-hidden="true">◎</span>
          <div>
            <strong>Profile</strong>
            <p>${escapeHtml(state.user?.email || 'No email on file')}</p>
          </div>
        </div>
        <div class="profile-field-stack">
          <button class="ghost profile-secondary-btn" id="requestVerifyBtn" type="button">Create verification token</button>
          <label class="profile-input-field" for="verifyTokenInput">
            <span>Verification token</span>
            <input id="verifyTokenInput" placeholder="Paste verification token" />
          </label>
          <button class="primary profile-primary-btn" id="verifyEmailBtn" type="button">Verify email</button>
        </div>
      </section>
      <section class="tool-card profile-tool-card">
        <div class="profile-card-head">
          <span class="profile-card-icon" aria-hidden="true">◇</span>
          <div>
            <strong>Change password</strong>
            <p>Update your password while you are signed in.</p>
          </div>
        </div>
        <div class="profile-field-stack">
          <label class="profile-input-field" for="currentPasswordInput">
            <span>Current password</span>
            <input id="currentPasswordInput" type="password" placeholder="Enter current password" />
          </label>
          <label class="profile-input-field" for="newPasswordInput">
            <span>New password</span>
            <input id="newPasswordInput" type="password" placeholder="Enter new password" />
          </label>
          <button class="primary profile-primary-btn" id="changePasswordBtn" type="button">Change password</button>
        </div>
      </section>
      <section class="tool-card profile-tool-card">
        <div class="profile-card-head">
          <span class="profile-card-icon" aria-hidden="true">↺</span>
          <div>
            <strong>Reset password</strong>
            <p>Create and use a reset token for this account.</p>
          </div>
        </div>
        <div class="profile-field-stack">
          <label class="profile-input-field" for="forgotEmailInput">
            <span>Account email</span>
            <input id="forgotEmailInput" placeholder="Account email" value="${escapeHtml(state.user?.email || '')}" />
          </label>
          <button class="ghost profile-secondary-btn" id="forgotPasswordBtn" type="button">Create reset token</button>
          <label class="profile-input-field" for="resetTokenInput">
            <span>Reset token</span>
            <input id="resetTokenInput" placeholder="Paste reset token" />
          </label>
          <label class="profile-input-field" for="resetPasswordInput">
            <span>New password</span>
            <input id="resetPasswordInput" type="password" placeholder="Enter new password" />
          </label>
          <button class="primary profile-primary-btn" id="resetPasswordBtn" type="button">Reset password</button>
        </div>
      </section>
    </div>
  `, 'Account settings', 'Manage email verification and password security.');
};

const renderSearchTool = () => {
  renderToolPanel(`
    <div class="tool-card">
      <strong>Search workspace</strong>
      <input id="searchInput" placeholder="Search documents and messages" />
      <button class="primary" id="searchBtn" type="button">Search</button>
      <div id="searchResults">
        ${emptyState({
          title: 'Search your workspace',
          body: 'Find documents, doubts, and messages without leaving your note.',
          action: 'Create Note',
          actionId: 'emptySearchCreateNoteBtn',
          icon: '⌕'
        })}
      </div>
    </div>
  `);
};

const renderChannelTool = () => {
  const channel = selectedChannel();
  renderToolPanel(`
    <div class="tool-card">
      <strong>Channel settings</strong>
      <input id="channelRenameInput" value="${escapeHtml(channel?.name || '')}" />
      <button class="primary" id="renameChannelBtn" type="button">Rename channel</button>
      <button class="ghost" id="archiveChannelBtn" type="button">Archive channel</button>
    </div>
  `);
};

const renderTrashTool = async () => {
  if (!state.selectedWorkspaceId) return;
  const docs = await request(`/api/documents/workspace/${state.selectedWorkspaceId}/trash/list`);
  renderToolPanel(`
    <div class="tool-card">
      <strong>Trash</strong>
      ${docs.length ? `<ul>${docs.map((doc) => `<li>${escapeHtml(doc.title)} <button class="ghost" data-restore-doc="${doc._id}" type="button">Restore</button></li>`).join('')}</ul>` : emptyState({
        title: 'Trash is empty',
        body: 'Deleted documents will appear here so you can restore them later.',
        icon: '✓'
      })}
    </div>
  `);
};

const renderCommentsTool = async () => {
  if (!state.selectedDocumentId) return;
  const comments = await request(`/api/documents/${state.selectedDocumentId}/comments`);
  renderToolPanel(`
    <div class="tool-card">
      <strong>Comments</strong>
      <input id="commentInput" placeholder="Add a comment or suggestion" />
      <button class="primary" id="addCommentBtn" type="button">Add comment</button>
      ${comments.length ? `<ul>${comments.map((comment) => `<li>${escapeHtml(comment.body)} — ${escapeHtml(comment.author?.email || '')}</li>`).join('')}</ul>` : emptyState({
        title: 'No comments yet',
        body: 'Leave a note or suggestion for your study group.',
        action: 'Focus Comment',
        actionId: 'emptyCommentFocusBtn',
        icon: '▱'
      })}
    </div>
  `);
};

const renderFilesTool = async () => {
  if (!state.selectedWorkspaceId) return;
  const attachments = await request(`/api/attachments/${state.selectedWorkspaceId}${state.selectedDocumentId ? `?documentId=${state.selectedDocumentId}` : ''}`);
  renderToolPanel(`
    <div class="tool-card">
      <strong>Attachments</strong>
      <input id="attachmentInput" type="file" />
      <button class="primary" id="uploadAttachmentBtn" type="button">Upload</button>
      ${attachments.length ? `<ul>${attachments.map((file) => `<li>${escapeHtml(file.filename)} (${file.size} bytes)</li>`).join('')}</ul>` : emptyState({
        title: 'No files attached',
        body: 'Attach PDFs, screenshots, or reference material to keep everything together.',
        action: 'Choose File',
        actionId: 'emptyAttachmentChooseBtn',
        icon: '↥'
      })}
    </div>
  `);
};

const renderVersionsTool = async () => {
  if (!state.selectedDocumentId) return;
  const versions = await request(`/api/documents/${state.selectedDocumentId}/versions`);
  renderToolPanel(`
    <div class="tool-card">
      <strong>Version history</strong>
      ${versions.length ? `<ul>${versions.map((version) => `<li>${new Date(version.createdAt).toLocaleString()} — ${escapeHtml(version.savedBy?.email || '')}</li>`).join('')}</ul>` : emptyState({
        title: 'No saved versions yet',
        body: 'Version snapshots will appear here after this document has history.',
        icon: '◷'
      })}
    </div>
  `);
};

const renderAuditTool = async () => {
  if (!state.selectedWorkspaceId) return;
  const logs = await request(`/api/audit/${state.selectedWorkspaceId}`).catch((err) => [{ action: err.message }]);
  renderToolPanel(`
    <div class="tool-card">
      <strong>Audit log</strong>
      ${logs.length ? `<ul>${logs.map((log) => `<li>${escapeHtml(log.action)} ${log.createdAt ? `— ${new Date(log.createdAt).toLocaleString()}` : ''}</li>`).join('')}</ul>` : emptyState({
        title: 'No audit events yet',
        body: 'Workspace security and admin events will appear here.',
        icon: '◷'
      })}
    </div>
  `);
};

const openTool = async (tool) => {
  try {
    if (tool === 'workspaces') return renderWorkspacesTool();
    if (tool === 'members') return renderMembersTool();
    if (tool === 'profile') return renderProfileTool();
    if (tool === 'channel') return renderChannelTool();
    if (tool === 'search') return renderSearchTool();
    if (tool === 'trash') return renderTrashTool();
    if (tool === 'comments') return renderCommentsTool();
    if (tool === 'files') return renderFilesTool();
    if (tool === 'versions') return renderVersionsTool();
    if (tool === 'audit') return renderAuditTool();
  } catch (err) {
    showToast(err.message, true);
  }
};

const createTemplateDocument = async () => {
  const templateTitle = 'Lecture Notes';
  const templateBody = `Lecture Notes

Topic:

Key ideas:
- 
- 
- 

Questions:
- 

Summary:
`;

  if (!state.selectedWorkspaceId && !state.demoMode) {
    document.getElementById('workspaceNameInput')?.focus();
    return showToast('Create or select a workspace first', true);
  }

  if (state.demoMode) {
    const doc = {
      _id: `demo-doc-template-${Date.now()}`,
      title: templateTitle,
      category: 'Templates',
      plainTextContent: templateBody,
      updatedAt: new Date().toISOString()
    };
    upsertDocument(doc, { prepend: true });
    loadDemoDocument(doc._id);
    navigate('workspace');
    addActivity({ action: 'created document from template', target: templateTitle, documentId: doc._id });
    return showToast('Template note created');
  }

  const doc = await createDocumentAndOpen(templateTitle);
  if (!doc) return;
  setEditorText(templateBody);
  await saveCurrentDocument({ silent: true });
  navigate('workspace');
  addActivity({ action: 'created document from template', target: templateTitle, documentId: doc._id });
  showToast('Template note created');
};

const handleEmptyStateAction = async (target) => {
  const id = target?.id;
  if (!id) return false;

  if (id === 'emptyOpenWorkspaceSwitcherBtn') {
    await openTool('workspaces');
    return true;
  }

  if ([
    'emptyCreateWorkspaceBtn',
    'emptyHomeCreateWorkspaceBtn',
    'emptyToolCreateWorkspaceBtn'
  ].includes(id)) {
    renderWorkspacesTool();
    return true;
  }

  if ([
    'emptyTryDemoBtn',
    'emptyHomeTryDemoBtn',
    'emptyToolTryDemoBtn'
  ].includes(id)) {
    await enterDemoMode();
    return true;
  }

  if (id === 'emptyCreateChannelBtn') {
    document.getElementById('channelNameInput')?.focus();
    return true;
  }

  if ([
    'emptyNewDocBtn',
    'emptyEditorNewDocBtn',
    'emptyOpenRecentBtn',
    'emptyCommandNewDocBtn',
    'emptySearchCreateNoteBtn',
    'dashboardEmptyNewDocBtn',
    'dashboardEmptyActivityDocBtn',
    'emptyActivityNewDocBtn'
  ].includes(id)) {
    els.newDocBtn.click();
    return true;
  }

  if ([
    'emptyTemplateDocBtn',
    'dashboardEmptyTemplateBtn'
  ].includes(id)) {
    await createTemplateDocument();
    return true;
  }

  if ([
    'emptyPanelAddTaskBtn',
    'dashboardEmptyTaskBtn'
  ].includes(id)) {
    if (id === 'dashboardEmptyTaskBtn') renderDashboardTaskTool();
    else els.taskInput?.focus();
    return true;
  }

  if ([
    'emptyPanelAskDoubtBtn',
    'dashboardEmptyDoubtBtn',
    'emptyThreadsAskDoubtBtn',
    'emptyThreadsDetailAskDoubtBtn'
  ].includes(id)) {
    const docId = state.selectedDocumentId || state.documents[0]?._id;
    if (docId) await loadDocument(docId);
    navigate('workspace');
    window.setTimeout(startAskDoubt, 0);
    return true;
  }

  if ([
    'dashboardEmptyInviteBtn',
    'emptyMembersInviteBtn',
    'emptyToolInviteMemberBtn',
    'emptyActivityInviteBtn'
  ].includes(id)) {
    generatedInviteResult = null;
    showInviteMemberModal();
    return true;
  }

  if ([
    'emptyJoinWorkspaceBtn',
    'emptyToolJoinWorkspaceBtn'
  ].includes(id)) {
    renderJoinWorkspaceTool();
    return true;
  }

  if (id === 'emptyAiSummarizeBtn') {
    await runStudyAiAction('summarize');
    return true;
  }

  if (id === 'emptyAiQuizBtn') {
    await runStudyAiAction('quiz');
    return true;
  }

  if (id === 'emptyLibraryGoAiBtn') {
    activateContextTab('ai');
    return true;
  }

  if (id === 'emptyLibraryQuizBtn') {
    activateContextTab('ai');
    await runStudyAiAction('quiz');
    return true;
  }

  if (id === 'emptySearchAskAiBtn') {
    closeToolPanel();
    navigate('workspace');
    window.setTimeout(() => activateContextTab('ai'), 0);
    return true;
  }

  if (id === 'emptyCommentFocusBtn') {
    document.getElementById('commentInput')?.focus();
    return true;
  }

  if (id === 'emptyAttachmentChooseBtn') {
    document.getElementById('attachmentInput')?.click();
    return true;
  }

  return false;
};

document.querySelector('.tool-grid')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-tool]');
  if (!button) return;
  await openTool(button.dataset.tool);
});

document.addEventListener('click', async (event) => {
  if (await handleEmptyStateAction(event.target)) return;

  if (event.target.closest('[data-command-palette-open]')) {
    await openCommandPaletteFeature();
    return;
  }

  const openMaterialButton = event.target.closest('[data-open-study-material]');
  if (openMaterialButton) {
    openStudyMaterial(openMaterialButton.dataset.openStudyMaterial);
    return;
  }

  const deleteMaterialButton = event.target.closest('[data-delete-study-material]');
  if (deleteMaterialButton) {
    await deleteStudyMaterial(deleteMaterialButton.dataset.deleteStudyMaterial);
    return;
  }

  const aiStudyButton = event.target.closest('[data-ai-study-action]');
  if (aiStudyButton) {
    await runStudyAiAction(aiStudyButton.dataset.aiStudyAction);
    return;
  }

  const documentScreenAi = event.target.closest('.workspace-layout [data-dashboard-ai]');
  if (documentScreenAi) {
    const action = documentScreenAi.dataset.dashboardAi;
    if (action === 'outline') insertStarterOutline();
    else await runStudyAiAction(action || 'summarize');
    return;
  }

  const documentScreenAction = event.target.closest('.workspace-layout [data-dashboard-action]');
  if (documentScreenAction) {
    const action = documentScreenAction.dataset.dashboardAction;
    if (action === 'ai') {
      activateContextTab('ai');
      els.documentEditor.focus();
      return;
    }
  }

  const routeButton = event.target.closest('[data-route-go]');
  if (routeButton && !els.routePage.contains(routeButton)) {
    if (state.demoMode && ['login', 'signup'].includes(routeButton.dataset.routeGo)) {
      exitDemoMode();
    }
    if (!state.demoMode && state.selectedDocumentId && routeButton.dataset.routeGo !== 'workspace') {
      window.clearTimeout(autosaveTimer);
      await saveCurrentDocumentIfDirty().catch((err) => showToast(err.message, true));
    }
    closeToolPanel();
    navigate(routeButton.dataset.routeGo);
    return;
  }

  const settingsTab = event.target.closest('[data-settings-tab]');
  if (settingsTab) {
    state.activeSettingsTab = settingsTab.dataset.settingsTab;
    localStorage.setItem('settingsTab', state.activeSettingsTab);
    applyPreferences();
    syncSettingsFormState(selectedWorkspace());
    renderSettingsPage();
    return;
  }

  const contextButton = event.target.closest('[data-context-tab]');
  if (contextButton) {
    activateContextTab(contextButton.dataset.contextTab);
    return;
  }

  const toolButton = event.target.closest('[data-tool]');
  if (toolButton) {
    if (toolButton.id === 'workspaceOnlineSummary') {
      navigate('members');
      return;
    }
    await openTool(toolButton.dataset.tool);
  }
});

els.commandInput.addEventListener('input', () => {
  selectedCommandIndex = 0;
  renderCommandResults();
});

els.commandInput.addEventListener('keydown', async (event) => {
  if (els.commandPalette.classList.contains('hidden')) return;

  const query = els.commandInput.value.trim().toLowerCase();
  
  const sortedDocs = [...state.documents]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));

  const docMatches = sortedDocs
    .filter((doc) => !query || (doc.title || 'Untitled Page').toLowerCase().includes(query))
    .slice(0, 5);

  const channelMatches = state.channels
    .filter((channel) => !query || channel.name.toLowerCase().includes(query))
    .slice(0, 4);

  const actions = [
    { type: 'Action', label: 'Create new document', attrs: 'data-command-action="new-document"' },
    { type: 'Action', label: 'Toggle focus mode', attrs: 'data-command-action="focus"' },
    { type: 'Action', label: 'Open AI panel', attrs: 'data-command-action="ai"' }
  ].filter((item) => !query || item.label.toLowerCase().includes(query));

  const totalLength = docMatches.length + channelMatches.length + actions.length;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (totalLength > 0) {
      selectedCommandIndex = (selectedCommandIndex + 1) % totalLength;
      renderCommandResults();
    }
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (totalLength > 0) {
      selectedCommandIndex = (selectedCommandIndex - 1 + totalLength) % totalLength;
      renderCommandResults();
    }
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const activeEl = els.commandResults.querySelector('.command-item.selected');
    if (activeEl) {
      activeEl.click();
    }
  }
});

els.commandResults.addEventListener('mouseover', (event) => {
  const item = event.target.closest('.command-item');
  if (item && item.dataset.index !== undefined) {
    const idx = parseInt(item.dataset.index, 10);
    if (idx !== selectedCommandIndex) {
      selectedCommandIndex = idx;
      const activeItems = els.commandResults.querySelectorAll('.command-item');
      activeItems.forEach((el, index) => {
        el.classList.toggle('selected', index === selectedCommandIndex);
      });
    }
  }
});

els.commandPalette.addEventListener('click', async (event) => {
  if (event.target === els.commandPalette) {
    closeCommandPalette();
    return;
  }

  const documentButton = event.target.closest('[data-command-document]');
  if (documentButton) {
    closeCommandPalette();
    await loadDocument(documentButton.dataset.commandDocument);
    return;
  }

  const channelButton = event.target.closest('[data-command-channel]');
  if (channelButton) {
    closeCommandPalette();
    state.selectedChannelId = channelButton.dataset.commandChannel;
    if (!state.demoMode) localStorage.setItem('channelId', state.selectedChannelId);
    await loadMessages();
    activateContextTab('discussion');
    render();
    return;
  }

  const actionButton = event.target.closest('[data-command-action]');
  if (!actionButton) return;
  closeCommandPalette();
  if (actionButton.dataset.commandAction === 'new-document') return els.newDocBtn.click();
  if (actionButton.dataset.commandAction === 'focus') return toggleFocusMode();
  if (actionButton.dataset.commandAction === 'ai') return activateContextTab('ai');
});

document.addEventListener('keydown', async (event) => {
  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  const meta = event.metaKey || event.ctrlKey;

  if (meta && key === 'b') {
    event.preventDefault();
    toggleSidebarCollapse();
    return;
  }

  if (meta && key === 'k') {
    event.preventDefault();
    await openCommandPaletteFeature();
    return;
  }

  if (meta && key === 's') {
    event.preventDefault();
    els.saveDocBtn.click();
    return;
  }

  if (meta && event.shiftKey && key === 'f') {
    event.preventDefault();
    toggleFocusMode();
    return;
  }

  if (meta && event.shiftKey && key === 'n') {
    event.preventDefault();
    els.newDocBtn.click();
    return;
  }

  if (event.key === 'Escape') {
    closeCommandPalette();
    closeToolPanel();
    document.body.classList.remove('sidebar-open');
    if (activeTaskMoreMenuId) {
      activeTaskMoreMenuId = '';
      renderTasksPage();
    }
  }
});

const refreshToolView = async (tool) => {
  await openTool(tool);
};

const handleToolPanelClick = async (event) => {
  const target = event.target;

  if (target.closest('#closeToolPanelBtn')) {
    closeToolPanel();
    return;
  }

  try {
    if (target.closest('[data-copy-invite-link]')) {
      const invite = latestCreatedInvite?.invite || latestCreatedInvite?.invitation || {};
      const token = latestCreatedInvite?.token || invite.token || '';
      const inviteLink = token ? inviteLinkForToken(token) : latestCreatedInvite?.inviteLink || '';
      if (!inviteLink) return showToast('Invite link is not available', true);
      await copyText(inviteLink, 'Invite link copied');
      return;
    }

    if (target.closest('[data-copy-invite-code]')) {
      const invite = latestCreatedInvite?.invite || latestCreatedInvite?.invitation || {};
      const code = latestCreatedInvite?.code || invite.code || '';
      if (!code) return showToast('Invite code is not available', true);
      await copyText(code, 'Invite code copied');
      return;
    }

    if (target.id === 'doneInviteResultBtn' || target.id === 'cancelJoinWorkspaceBtn') {
      closeToolPanel();
      return;
    }

    if (target.id === 'openJoinWorkspaceBtn') {
      renderJoinWorkspaceTool();
      return;
    }

    if (target.id === 'previewJoinWorkspaceBtn') {
      const input = document.getElementById('joinWorkspaceInviteInput')?.value.trim() || '';
      await openJoinWorkspaceFlow(input);
      return;
    }

    if (target.id === 'confirmJoinWorkspaceBtn') {
      await acceptActiveInvite();
      return;
    }

    const workspaceMenuButton = target.closest('[data-workspace-menu-id]');
    if (workspaceMenuButton) {
      const workspaceId = workspaceMenuButton.dataset.workspaceMenuId;
      activeWorkspaceMenuId = activeWorkspaceMenuId === workspaceId ? '' : workspaceId;
      activeWorkspaceRenameId = '';
      pendingWorkspaceDeleteId = '';
      renderWorkspacesTool();
      return;
    }

    if (target.id === 'workspaceSettingsRenameBtn') {
      if (state.demoMode) return showToast('Demo workspace settings are temporary. Sign up to manage your own workspace.');
      const workspace = selectedWorkspace();
      const name = document.getElementById('workspaceSettingsNameInput')?.value.trim();
      if (!workspace?._id) return showToast('Select a workspace first', true);
      if (!name) return showToast('Workspace name is required', true);
      await request(`/api/workspaces/${workspace._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name })
      });
      await loadWorkspaces();
      await renderWorkspaceSettingsPage();
      return showToast('Workspace renamed');
    }

    if (target.id === 'copyWorkspaceIdBtn') {
      const workspace = selectedWorkspace();
      if (!workspace?._id) return showToast('Select a workspace first', true);
      await copyText(workspace._id, 'Workspace ID copied');
      return;
    }

    if (target.id === 'copyInviteLinkBtn') {
      const inviteLink = `${location.origin}${location.pathname}#/invite`;
      await copyText(inviteLink, 'Invite page link copied');
      return;
    }

    if (target.id === 'workspaceInviteCreateBtn') {
      if (state.demoMode) return showToast('Demo members are examples. Sign up to invite real collaborators.');
      const workspace = selectedWorkspace();
      if (!workspace?._id) return showToast('Select a workspace first', true);
      const email = document.getElementById('workspaceInviteEmailInput')?.value.trim();
      const role = document.getElementById('workspaceInviteRoleInput')?.value || 'member';
      if (inviteRequestInFlight) return;
      inviteRequestInFlight = true;
      target.disabled = true;
      const result = await request(`/api/invites/${workspace._id}`, {
        method: 'POST',
        body: JSON.stringify({ email, role })
      });
      inviteRequestInFlight = false;
      await renderWorkspaceSettingsPage();
      renderInviteResultTool(result);
      return;
    }

    const revokeInviteButton = target.closest('[data-revoke-invite-id]');
    if (revokeInviteButton) {
      if (state.demoMode) return showToast('Demo invites are temporary. Sign up to manage real invites.');
      const workspace = selectedWorkspace();
      if (!workspace?._id) return showToast('Select a workspace first', true);
      await request(`/api/invites/${workspace._id}/${revokeInviteButton.dataset.revokeInviteId}`, { method: 'DELETE' });
      await renderWorkspaceSettingsPage();
      return showToast('Invite revoked');
    }

    const removeMemberButton = target.closest('[data-remove-workspace-member]');
    if (removeMemberButton) {
      if (state.demoMode) return showToast('Demo members are examples. Sign up to manage real members.');
      const workspace = selectedWorkspace();
      const memberId = removeMemberButton.dataset.removeWorkspaceMember;
      if (!workspace?._id || !memberId) return showToast('Select a workspace first', true);
      await request(`/api/workspaces/${workspace._id}/members/${memberId}`, { method: 'DELETE' });
      await loadWorkspaces();
      await renderWorkspaceSettingsPage();
      return showToast('Member removed');
    }

    const renameWorkspaceButton = target.closest('[data-rename-workspace-id]');
    if (renameWorkspaceButton) {
      if (state.demoMode) return showToast('Demo workspace settings are temporary. Sign up to create your own workspace.');
      activeWorkspaceRenameId = renameWorkspaceButton.dataset.renameWorkspaceId;
      activeWorkspaceMenuId = '';
      pendingWorkspaceDeleteId = '';
      renderWorkspacesTool();
      window.setTimeout(() => document.querySelector('.workspace-rename-form input')?.focus(), 0);
      return;
    }

    if (target.closest('[data-cancel-workspace-rename]')) {
      activeWorkspaceRenameId = '';
      renderWorkspacesTool();
      return;
    }

    const deleteWorkspaceButton = target.closest('[data-delete-workspace-id]');
    if (deleteWorkspaceButton) {
      if (deleteWorkspaceButton.disabled) return showToast('Create or join another workspace before deleting this one.', true);
      if (state.demoMode) return showToast('Demo workspace settings are temporary. Sign up to create your own workspace.');
      pendingWorkspaceDeleteId = deleteWorkspaceButton.dataset.deleteWorkspaceId;
      activeWorkspaceMenuId = '';
      activeWorkspaceRenameId = '';
      if (currentRoute() === 'workspace-settings') await renderWorkspaceSettingsPage();
      else renderWorkspacesTool();
      return;
    }

    if (target.closest('[data-cancel-workspace-delete]')) {
      pendingWorkspaceDeleteId = '';
      if (currentRoute() === 'workspace-settings') await renderWorkspaceSettingsPage();
      else renderWorkspacesTool();
      return;
    }

    const confirmDeleteWorkspaceButton = target.closest('[data-confirm-workspace-delete]');
    if (confirmDeleteWorkspaceButton) {
      if (state.workspaces.length <= 1) return showToast('Create or join another workspace before deleting this one.', true);
      const workspaceId = confirmDeleteWorkspaceButton.dataset.confirmWorkspaceDelete;
      const deletingSelected = workspaceId === state.selectedWorkspaceId;
      const beforeDeleteWorkspaces = state.workspaces.map((workspace) => workspace._id);
      traceWorkspaceDelete('confirmation accepted', {
        workspaceId,
        selectedWorkspaceId: state.selectedWorkspaceId,
        beforeDeleteWorkspaces
      });
      traceWorkspaceDelete('DELETE request started', {
        path: `/api/workspaces/${workspaceId}`,
        method: 'DELETE'
      });
      const deleteResponse = await request(`/api/workspaces/${workspaceId}`, { method: 'DELETE' });
      traceWorkspaceDelete('DELETE response received', deleteResponse);
      state.workspaces = state.workspaces.filter((workspace) => workspace._id !== workspaceId);
      traceWorkspaceDelete('local state after removal', state.workspaces.map((workspace) => workspace._id));
      await loadWorkspaces();
      traceWorkspaceDelete('workspace list after refresh', state.workspaces.map((workspace) => workspace._id));
      if (deletingSelected) {
        const nextWorkspace = state.workspaces[0];
        state.selectedWorkspaceId = nextWorkspace?._id || '';
        if (state.selectedWorkspaceId) localStorage.setItem('workspaceId', state.selectedWorkspaceId);
        else localStorage.removeItem('workspaceId');
        teardownYDoc();
        await Promise.all([loadChannels(), loadDocuments()]);
      }
      pendingWorkspaceDeleteId = '';
      activeWorkspaceMenuId = '';
      activeWorkspaceRenameId = '';
      closeToolPanel();
      navigate('home');
      return showToast('Workspace deleted');
    }

    const workspaceToolButton = target.closest('[data-tool-workspace-id]');
    if (workspaceToolButton) {
      if (state.demoMode) return showToast('Demo mode uses the sample CS Final Year workspace.');
      const workspaceId = workspaceToolButton.dataset.toolWorkspaceId;
      if (!workspaceId || workspaceId === state.selectedWorkspaceId) {
        closeToolPanel();
        return;
      }
      window.clearTimeout(autosaveTimer);
      if (state.selectedDocumentId) await saveCurrentDocument({ silent: true }).catch(() => {});
      state.selectedWorkspaceId = workspaceId;
      localStorage.setItem('workspaceId', state.selectedWorkspaceId);
      state.chatMessages = [];
      teardownYDoc();
      closeToolPanel();
      await Promise.all([loadChannels(), loadDocuments()]);
      navigate('home');
      return showToast('Workspace switched');
    }

    if (target.id === 'toolCreateWorkspaceBtn') {
      if (state.demoMode) return showToast('Demo mode uses the sample workspace. Sign up to create your own.');
      const input = document.getElementById('toolWorkspaceNameInput');
      const name = input?.value.trim();
      if (!name) return showToast('Workspace name is required', true);
      const workspace = await request('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name })
      });
      state.selectedWorkspaceId = workspace._id;
      localStorage.setItem('workspaceId', workspace._id);
      closeToolPanel();
      await loadWorkspaces();
      await bootstrapWorkspace();
      navigate('home');
      return showToast('Workspace created');
    }

    if (target.id === 'renameWorkspaceBtn') {
      if (state.demoMode) {
        return showToast('Demo workspace settings are temporary. Sign up to create your own workspace.');
      }
      const name = document.getElementById('renameWorkspaceInput').value;
      await request(`/api/workspaces/${state.selectedWorkspaceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name })
      });
      await loadWorkspaces();
      await refreshToolView('members');
      return showToast('Workspace renamed');
    }

    if (target.id === 'inviteMemberBtn') {
      if (state.demoMode) {
        return showToast('Demo members are examples. Sign up to invite real collaborators.');
      }
      if (inviteRequestInFlight) return;
      inviteRequestInFlight = true;
      target.disabled = true;
      const result = await request(`/api/invites/${state.selectedWorkspaceId}`, {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('inviteEmailInput').value,
          role: document.getElementById('inviteRoleInput').value
        })
      });
      inviteRequestInFlight = false;
      renderInviteResultTool(result);
      return;
    }

    if (target.id === 'dashboardCreateDocumentBtn') {
      const title = document.getElementById('dashboardDocumentTitleInput').value.trim() || 'Untitled Page';
      if (!state.selectedWorkspaceId) return showToast('Select a workspace first', true);
      if (state.demoMode) {
        const doc = {
          _id: `demo-doc-${Date.now()}`,
          title,
          category: 'Project Work',
          plainTextContent: '',
          updatedAt: new Date().toISOString()
        };
        upsertDocument(doc, { prepend: true });
        closeToolPanel();
        loadDemoDocument(doc._id);
        navigate('workspace');
        addActivity({ action: 'created document', target: title, documentId: doc._id });
        return showToast('Demo document created locally');
      }

      const doc = await createDocumentAndOpen(title);
      if (!doc) return;
      closeToolPanel();
      navigate('workspace');
      addActivity({ action: 'created document', target: title, documentId: doc._id });
      return showToast('Document created');
    }

    if (target.id === 'dashboardCreateTaskBtn') {
      if (!state.selectedWorkspaceId) return showToast('Select a workspace first', true);
      const doc = selectedDocument() || state.documents[0];
      if (!doc) return showToast('Create a document before adding tasks', true);
      const title = document.getElementById('dashboardTaskTitleInput').value.trim();
      if (!title) return showToast('Task title is required', true);
      const priority = document.getElementById('dashboardTaskPriorityInput').value;
      const dueDate = document.getElementById('dashboardTaskDueInput').value || new Date().toISOString();

      if (state.demoMode) {
        const task = {
          _id: `demo-task-${Date.now()}`,
          title,
          status: 'todo',
          priority,
          dueDate,
          assignee: { username: state.user?.username || 'Alex Rivera' }
        };
        state.documentTasks.push(task);
        state.dashboardTasks.push(task);
        closeToolPanel();
        addActivity({ action: 'created task', target: title });
        renderHomePage();
        return showToast('Demo task added locally');
      }

      const task = await request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${doc._id}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ title, priority, dueDate })
      });
      state.dashboardTasks.push(task);
      if (String(doc._id) === String(state.selectedDocumentId)) state.documentTasks.push(task);
      closeToolPanel();
      addActivity({ action: 'created task', target: title });
      renderHomePage();
      return showToast('Task created');
    }

    if (target.id === 'requestVerifyBtn') {
      const result = await request('/api/auth/verify-email/request', { method: 'POST', body: JSON.stringify({}) });
      return showToast(result.verificationToken ? `Verification token: ${result.verificationToken}` : result.message);
    }

    if (target.id === 'verifyEmailBtn') {
      await request('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: document.getElementById('verifyTokenInput').value })
      });
      return showToast('Email verified');
    }

    if (target.id === 'changePasswordBtn') {
      await request('/api/auth/password/change', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: document.getElementById('currentPasswordInput').value,
          newPassword: document.getElementById('newPasswordInput').value
        })
      });
      return showToast('Password changed');
    }

    if (target.id === 'forgotPasswordBtn') {
      const result = await request('/api/auth/password/forgot', {
        method: 'POST',
        body: JSON.stringify({ email: document.getElementById('forgotEmailInput').value })
      });
      return showToast(result.resetToken ? `Reset token: ${result.resetToken}` : result.message);
    }

    if (target.id === 'resetPasswordBtn') {
      await request('/api/auth/password/reset', {
        method: 'POST',
        body: JSON.stringify({
          token: document.getElementById('resetTokenInput').value,
          password: document.getElementById('resetPasswordInput').value
        })
      });
      return showToast('Password reset');
    }

    // Cancel settings changes
    if (target.id === 'settingsCancelBtn') {
      event.preventDefault();
      syncSettingsFormState(selectedWorkspace());
      applyPreferences();
      renderSettingsPage();
      return;
    }

    // Save settings changes
    if (target.id === 'settingsSaveBtn') {
      event.preventDefault();
      settingsSaveInProgress = true;
      updateSaveButtonState();
      
      try {
        const workspace = selectedWorkspace();
        if (state.activeSettingsTab === 'general') {
          if (state.demoMode) {
            showToast('Demo workspace settings are temporary.');
          } else {
            if (workspace?._id) {
              if (!settingsWorkspaceName) {
                showToast('Workspace name is required', true);
                settingsSaveInProgress = false;
                updateSaveButtonState();
                return;
              }
              await request(`/api/workspaces/${workspace._id}`, {
                method: 'PATCH',
                body: JSON.stringify({ name: settingsWorkspaceName })
              });
              if (settingsWorkspaceDescription) {
                localStorage.setItem(`nexusWorkspaceDescription_${workspace._id}`, settingsWorkspaceDescription);
              }
              await loadWorkspaces();
            }
          }
          showToast('Workspace profile saved');
        } else if (state.activeSettingsTab === 'appearance') {
          state.preferences.theme = settingsTheme;
          state.preferences.density = settingsDensity;
          state.preferences.reduceMotion = settingsReduceMotion;
          persistPreferences();
          applyPreferences();
          showToast('Appearance preferences saved');
        } else if (state.activeSettingsTab === 'notifications') {
          state.preferences.emailNotifications = settingsEmailNotifications;
          state.preferences.taskNotifications = settingsTaskNotifications;
          state.preferences.discussionNotifications = settingsDiscussionNotifications;
          state.preferences.mentionNotifications = settingsMentionNotifications;
          state.preferences.inviteNotifications = settingsInviteNotifications;
          persistPreferences();
          showToast('Notification preferences saved');
        }
      } catch (err) {
        showToast(err.message, true);
      } finally {
        settingsSaveInProgress = false;
        syncSettingsFormState(selectedWorkspace());
        renderSettingsPage();
      }
      return;
    }

    // Leave Workspace action
    if (target.id === 'settingsLeaveWorkspaceBtn') {
      event.preventDefault();
      const workspace = selectedWorkspace();
      if (!workspace?._id) return showToast('No workspace selected', true);
      if (state.workspaces.length <= 1) return showToast('Create or join another workspace before leaving this one.', true);
      
      const confirmMsg = `Are you sure you want to leave the workspace "${workspace.name}"? You will lose access to all notes, channels, tasks, and discussions.`;
      if (confirm(confirmMsg)) {
        try {
          await request(`/api/workspaces/${workspace._id}/members/${state.user.id}`, { method: 'DELETE' });
          showToast(`Left workspace "${workspace.name}"`);
          state.workspaces = state.workspaces.filter((w) => w._id !== workspace._id);
          await loadWorkspaces();
          const nextWorkspace = state.workspaces[0];
          state.selectedWorkspaceId = nextWorkspace?._id || '';
          if (state.selectedWorkspaceId) localStorage.setItem('workspaceId', state.selectedWorkspaceId);
          else localStorage.removeItem('workspaceId');
          teardownYDoc();
          collab.activeDocumentId = '';
          state.selectedDocumentId = '';
          state.selectedChannelId = '';
          localStorage.removeItem('documentId');
          localStorage.removeItem('channelId');
          if (state.selectedWorkspaceId) {
            await loadWorkspaceData(state.selectedWorkspaceId);
          }
          navigate('home');
        } catch (err) {
          showToast(err.message, true);
        }
      }
      return;
    }

    // Delete Workspace action (from settings page)
    if (target.id === 'settingsDeleteWorkspaceBtn') {
      event.preventDefault();
      const workspace = selectedWorkspace();
      if (!workspace?._id) return showToast('No workspace selected', true);
      if (state.workspaces.length <= 1) return showToast('Create or join another workspace before deleting this one.', true);
      
      const confirmMsg = `Are you sure you want to permanently DELETE the workspace "${workspace.name}"? This action cannot be undone. All documents, tasks, threads and workspace data will be removed.`;
      if (confirm(confirmMsg)) {
        try {
          await request(`/api/workspaces/${workspace._id}`, { method: 'DELETE' });
          showToast(`Deleted workspace "${workspace.name}"`);
          state.workspaces = state.workspaces.filter((w) => w._id !== workspace._id);
          await loadWorkspaces();
          const nextWorkspace = state.workspaces[0];
          state.selectedWorkspaceId = nextWorkspace?._id || '';
          if (state.selectedWorkspaceId) localStorage.setItem('workspaceId', state.selectedWorkspaceId);
          else localStorage.removeItem('workspaceId');
          teardownYDoc();
          collab.activeDocumentId = '';
          state.selectedDocumentId = '';
          state.selectedChannelId = '';
          localStorage.removeItem('documentId');
          localStorage.removeItem('channelId');
          if (state.selectedWorkspaceId) {
            await loadWorkspaceData(state.selectedWorkspaceId);
          }
          navigate('home');
        } catch (err) {
          showToast(err.message, true);
        }
      }
      return;
    }

    // Sign out from General panel
    if (target.id === 'settingsSignOutBtn') {
      event.preventDefault();
      els.logoutBtn.click();
      return;
    }

    // Copy workspace ID from General panel
    if (target.id === 'settingsCopyWorkspaceIdBtn') {
      event.preventDefault();
      const workspace = selectedWorkspace();
      if (workspace?._id) {
        await copyText(workspace._id, 'Workspace ID copied');
      }
      return;
    }

    // Integrations learn more alert
    const integrationCard = target.closest('.integration-card');
    if (integrationCard) {
      event.preventDefault();
      const name = integrationCard.querySelector('.integration-card-title')?.textContent || 'Integration';
      showToast(`${name} integration is coming soon in a future update!`);
      return;
    }

    if (target.id === 'searchBtn') {
      const rawQuery = document.getElementById('searchInput').value.trim();
      if (!rawQuery) {
        document.getElementById('searchResults').innerHTML = emptyState({
          title: 'Search your workspace',
          body: 'Type a keyword to search documents, tasks, or doubts.',
          action: 'Create Note',
          actionId: 'emptySearchCreateNoteBtn',
          icon: '⌕'
        });
        return;
      }
      const query = encodeURIComponent(rawQuery);
      const results = await request(`/api/search/${state.selectedWorkspaceId}?q=${query}`);
      const hasDocuments = results.documents?.length;
      const hasMessages = results.messages?.length;
      if (!hasDocuments && !hasMessages) {
        document.getElementById('searchResults').innerHTML = emptyState({
          title: `No results for "${rawQuery}"`,
          body: 'Try a shorter keyword, create a note for this topic, or ask AI from the current document.',
          action: 'Create Note',
          actionId: 'emptySearchCreateNoteBtn',
          secondaryAction: 'Ask AI',
          secondaryActionId: 'emptySearchAskAiBtn',
          icon: '⌕'
        });
        return;
      }
      document.getElementById('searchResults').innerHTML = `
        <p>Documents</p>
        ${hasDocuments ? `<ul>${results.documents.map((doc) => `<li>${escapeHtml(doc.title)}</li>`).join('')}</ul>` : emptyState({ title: 'No matching documents', body: 'Messages may still match this search.', icon: '▤' })}
        <p>Messages</p>
        ${hasMessages ? `<ul>${results.messages.map((message) => `<li>#${escapeHtml(message.channelId)} ${escapeHtml(message.content)}</li>`).join('')}</ul>` : emptyState({ title: 'No matching messages', body: 'Try another keyword or ask a doubt from the document.', icon: '▱' })}
      `;
      return;
    }

    if (target.id === 'renameChannelBtn') {
      const channel = selectedChannel();
      if (!channel) return;
      await request(`/api/channels/${state.selectedWorkspaceId}/${channel._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: document.getElementById('channelRenameInput').value })
      });
      await loadChannels();
      await refreshToolView('channel');
      return showToast('Channel renamed');
    }

    if (target.id === 'archiveChannelBtn') {
      const channel = selectedChannel();
      if (!channel) return;
      await request(`/api/channels/${state.selectedWorkspaceId}/${channel._id}`, { method: 'DELETE' });
      await loadChannels();
      await refreshToolView('channel');
      return showToast('Channel archived');
    }

    const restoreButton = target.closest('[data-restore-doc]');
    if (restoreButton) {
      await request(`/api/documents/${restoreButton.dataset.restoreDoc}/restore`, { method: 'POST' });
      await loadDocuments();
      await refreshToolView('trash');
      return showToast('Document restored');
    }

    if (target.id === 'addCommentBtn') {
      const selection = getEditorSelection();
      await request(`/api/documents/${state.selectedDocumentId}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          body: document.getElementById('commentInput').value,
          rangeStart: selection.start,
          rangeEnd: selection.end
        })
      });
      await refreshToolView('comments');
      return showToast('Comment added');
    }

    if (target.id === 'uploadAttachmentBtn') {
      const file = document.getElementById('attachmentInput').files[0];
      if (!file) return;
      const dataBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await request(`/api/attachments/${state.selectedWorkspaceId}`, {
        method: 'POST',
        body: JSON.stringify({
          documentId: state.selectedDocumentId,
          filename: file.name,
          mimeType: file.type,
          dataBase64
        })
      });
      await refreshToolView('files');
      return showToast('File uploaded');
    }

    if (target.id === 'acceptInviteBtn') {
      const credential = parseInviteInput(document.getElementById('inviteTokenInput')?.value.trim() || '');
      activeJoinInvite = { credential };
      return acceptActiveInvite();
    }

    if (target.id === 'previewInviteBtn') {
      return openJoinWorkspaceFlow(document.getElementById('inviteTokenInput')?.value.trim() || '');
    }
  } catch (err) {
    showToast(err.message, true);
  }
};

els.toolPanel.addEventListener('click', handleToolPanelClick);
els.toolPanel.addEventListener('submit', async (event) => {
  const renameForm = event.target.closest('[data-workspace-rename-form]');
  if (!renameForm) return;
  event.preventDefault();
  if (state.demoMode) return showToast('Demo workspace settings are temporary. Sign up to create your own workspace.');

  const workspaceId = renameForm.dataset.workspaceRenameForm;
  const name = renameForm.querySelector('input')?.value.trim();
  if (!name) return showToast('Workspace name is required', true);

  try {
    await request(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name })
    });
    await loadWorkspaces();
    activeWorkspaceRenameId = '';
    activeWorkspaceMenuId = '';
    renderWorkspacesTool();
    showToast('Workspace renamed');
  } catch (err) {
    showToast(err.message, true);
  }
});
els.routePage.addEventListener('click', handleToolPanelClick);
els.routePage.addEventListener('change', async (event) => {
  if (event.target.id === 'membersRoleFilterSelect') {
    membersRoleFilter = event.target.value;
    renderMembersPage();
    return;
  }

  if (event.target.id === 'membersStatusFilterSelect') {
    membersStatusFilter = event.target.value;
    renderMembersPage();
    return;
  }

  if (event.target.id === 'tasksSortSelect') {
    taskSortField = event.target.value;
    renderTasksPage();
    return;
  }

  if (event.target.classList.contains('task-checkbox-v2')) {
    const taskId = event.target.dataset.checkTaskId;
    const checked = event.target.checked;
    const task = state.dashboardTasks.find(t => t._id === taskId) || state.documentTasks.find(t => t._id === taskId);
    if (!task) return;

    if (state.demoMode) {
      task.status = checked ? 'done' : 'todo';
      task.completedAt = checked ? new Date().toISOString() : null;
      if (checked) addActivity({ action: 'completed task', target: task.title });
      showToast(checked ? 'Task marked complete' : 'Task reopened');
      renderTasksPage();
      return;
    }

    try {
      const docId = task.documentId || task.document;
      const updated = await request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${docId}/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: checked ? 'done' : 'todo' })
      });
      state.dashboardTasks = state.dashboardTasks.map(t => t._id === taskId ? updated : t);
      state.documentTasks = state.documentTasks.map(t => t._id === taskId ? updated : t);
      if (updated.status === 'done') addActivity({ action: 'completed task', target: updated.title });
      showToast(checked ? 'Task marked complete' : 'Task reopened');
      renderTasksPage();
    } catch (err) {
      event.target.checked = !checked;
      showToast(err.message, true);
    }
    return;
  }

  const roleSelect = event.target.closest('[data-workspace-role-member]');
  if (!roleSelect) return;
  try {
    if (state.demoMode) {
      await renderWorkspaceSettingsPage();
      return showToast('Demo members are examples. Sign up to manage real roles.');
    }
    const workspace = selectedWorkspace();
    const memberId = roleSelect.dataset.workspaceRoleMember;
    if (!workspace?._id || !memberId) return showToast('Select a workspace first', true);
    await request(`/api/workspaces/${workspace._id}/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: roleSelect.value })
    });
    await loadWorkspaces();
    await renderWorkspaceSettingsPage();
    showToast('Member role updated');
  } catch (err) {
    await renderWorkspaceSettingsPage();
    showToast(err.message, true);
  }
});
els.routePage.addEventListener('click', async (event) => {
  if (await handleEmptyStateAction(event.target)) {
    event.stopPropagation();
    return;
  }

  if (event.target.closest('[data-mobile-menu-open]')) {
    document.body.classList.add('sidebar-open');
    return;
  }

  const demoButton = event.target.closest('[data-try-demo]');
  if (demoButton) {
    await enterDemoMode();
    return;
  }

  const dashboardAction = event.target.closest('[data-dashboard-action]');
  if (dashboardAction) {
    const action = dashboardAction.dataset.dashboardAction;
    if (action === 'new-document') return renderDashboardDocumentTool();
    if (action === 'new-task') return renderDashboardTaskTool();
    if (action === 'invite') {
      generatedInviteResult = null;
      return showInviteMemberModal();
    }
    if (action === 'activity') {
      const docId = state.selectedDocumentId || state.documents[0]?._id;
      if (docId) await loadDocument(docId);
      navigate('workspace');
      window.setTimeout(() => activateContextTab('activity'), 0);
      return;
    }
    if (action === 'ai') {
      const docId = state.selectedDocumentId || state.documents[0]?._id;
      if (docId) await loadDocument(docId);
      navigate('workspace');
      window.setTimeout(() => {
        activateContextTab('ai');
        setAiOutput('summarize', state.demoMode
          ? 'Try: What should I study today? I would start with CAP theorem, then revise ML evaluation metrics, then close the project proposal task.'
          : 'Ask AI is ready. Choose an action or select text in the document.');
      }, 0);
      return;
    }
  }

  if (event.target.closest('[data-start-doubt-from-page]')) {
    const docId = state.selectedDocumentId || state.documents[0]?._id;
    if (docId) await loadDocument(docId);
    navigate('workspace');
    window.setTimeout(startAskDoubt, 0);
    return;
  }

  if (event.target.closest('#dashboardEmptyNewDocBtn')) {
    renderDashboardDocumentTool();
    return;
  }

  if (event.target.closest('#dashboardEmptyTaskBtn')) {
    renderDashboardTaskTool();
    return;
  }

  if (event.target.closest('#dashboardEmptyInviteBtn')) {
    generatedInviteResult = null;
    showInviteMemberModal();
    return;
  }

  const dashboardTarget = event.target.closest('[data-dashboard-target]');
  if (dashboardTarget) {
    const target = dashboardTarget.dataset.dashboardTarget;
    if (target === 'documents') return navigate('workspace');
    if (target === 'chat') return navigate('chat');
    if (target === 'members') return navigate('members');
    if (target === 'threads') return navigate('threads');
    if (target === 'tasks') return navigate('tasks');
  }

  const dashboardTask = event.target.closest('[data-dashboard-task-id]');
  if (dashboardTask && event.target.matches('input[type="checkbox"]')) {
    const taskId = dashboardTask.dataset.dashboardTaskId;
    const checked = event.target.checked;
    const task = state.dashboardTasks.find((item) => item._id === taskId) || state.documentTasks.find((item) => item._id === taskId);
    if (!task) return;
    if (state.demoMode) {
      task.status = checked ? 'done' : 'todo';
      task.completedAt = checked ? new Date().toISOString() : null;
      renderHomePage();
      return;
    }
    try {
      const docId = task.documentId || state.selectedDocumentId || state.documents[0]?._id;
      const updatedTask = await request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${docId}/tasks/${task._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: checked ? 'done' : 'todo' })
      });
      state.dashboardTasks = state.dashboardTasks.map((item) => item._id === updatedTask._id ? updatedTask : item);
      state.documentTasks = state.documentTasks.map((item) => item._id === updatedTask._id ? updatedTask : item);
      renderHomePage();
    } catch (err) {
      event.target.checked = !checked;
      showToast(err.message, true);
    }
    return;
  }

  const doubtButton = event.target.closest('[data-dashboard-doubt-doc]');
  if (doubtButton) {
    const documentId = doubtButton.dataset.dashboardDoubtDoc;
    const threadId = doubtButton.dataset.dashboardDoubtThread;
    if (documentId) await loadDocument(documentId);
    state.selectedThreadId = threadId || '';
    state.threadFilter = 'all';
    navigate('workspace');
    window.setTimeout(() => activateContextTab('discussion'), 0);
    return;
  }

  const dashboardAi = event.target.closest('[data-dashboard-ai]');
  if (dashboardAi) {
    const docId = state.selectedDocumentId || state.documents[0]?._id;
    if (docId) await loadDocument(docId);
    navigate('workspace');
    window.setTimeout(() => {
      activateContextTab('ai');
      const responses = state.demoMode ? {
        today: 'Study plan: revise CAP theorem, finish the ML quiz task, then review project proposal notes.',
        summarize: demoAiResponse('summarize'),
        quiz: demoAiResponse('quiz'),
        'weak-topics': 'Weak topics to revisit: Paxos prepare phase, precision vs recall, and consistency tradeoffs during partitions.'
      } : {};
      setAiOutput(dashboardAi.dataset.dashboardAi, state.demoMode
        ? responses[dashboardAi.dataset.dashboardAi]
        : 'Dashboard AI suggestion selected. Run AI from this document to generate a live response.');
    }, 0);
    return;
  }

  const activityButton = event.target.closest('[data-activity-document]');
  if (activityButton) {
    const documentId = activityButton.dataset.activityDocument;
    if (documentId) await loadDocument(documentId);
    navigate('workspace');
    window.setTimeout(() => activateContextTab('activity'), 0);
    return;
  }

  const openThreadButton = event.target.closest('[data-open-thread-document]');
  if (openThreadButton) {
    const documentId = openThreadButton.dataset.openThreadDocument;
    const threadId = openThreadButton.dataset.openThreadId;
    if (currentRoute() === 'threads') {
      event.preventDefault();
      state.selectedThreadId = threadId || '';
      renderThreadsPage();
      return;
    }
    if (documentId) await loadDocument(documentId);
    state.selectedThreadId = threadId || '';
    state.threadFilter = 'all';
    navigate('workspace');
    window.setTimeout(() => activateContextTab('discussion'), 0);
    return;
  }

  const routeButton = event.target.closest('[data-route-go]');
  if (routeButton) {
    if (state.demoMode && ['login', 'signup'].includes(routeButton.dataset.routeGo)) {
      exitDemoMode();
    }
    closeToolPanel();
    navigate(routeButton.dataset.routeGo);
    return;
  }

  const createButton = event.target.closest('[data-create-document]');
  if (createButton) {
    els.newDocBtn.click();
    navigate('workspace');
    return;
  }

  const docButton = event.target.closest('[data-open-document]');
  if (docButton) {
    await loadDocument(docButton.dataset.openDocument);
    navigate('workspace');
  }
});

els.routePage.addEventListener('input', (event) => {
  if (event.target.id === 'membersSearchInput') {
    membersSearchQuery = event.target.value;
    renderMembersPage();
    return;
  }
  if (event.target.id === 'tasksSearchInput') {
    taskSearchQuery = event.target.value;
    renderTasksPage();
    return;
  }
  if (event.target.id === 'threadsSearchInput') {
    threadSearchQuery = event.target.value;
    renderThreadsPage();
    return;
  }
  if (event.target.id === 'chatSearchInput') {
    highlightSearchInDom(event.target.value);
    return;
  }
  if (event.target.id !== 'workspaceChatInput') return;
  publishChatTyping(true);
  scheduleChatTypingStop();
});

els.routePage.addEventListener('keydown', async (event) => {
  if (event.target.id === 'threadReplyInput') {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      document.getElementById('threadReplyComposerForm')?.requestSubmit();
    }
    return;
  }
  if (event.target.id === 'chatSearchInput') {
    if (event.key === 'Enter') {
      event.preventDefault();
      navigateSearchMatch(event.shiftKey ? 'prev' : 'next');
    }
    return;
  }
  if (event.target.id !== 'workspaceChatInput') return;
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    await sendWorkspaceChatMessage();
  }
});

const bootstrapAuthenticatedSession = async () => {
  try {
    await connectSocket();
  } catch (err) {
    console.warn('Realtime connection failed after sign in:', err.message);
  }

  try {
    await loadWorkspaces();
    if (state.token && !state.demoMode) await renderRoute();
  } catch (err) {
    render();
    showToast(`Signed in, but workspace loading failed: ${err.message}`, true);
  }
};

const completeAuthenticatedSession = (result) => {
  saveSession(result);
  showToast('Signed in');
  navigate(pendingInviteRoute() || 'home');
  void bootstrapAuthenticatedSession();
};

const handleAuthRouteSubmit = async (event) => {
  if (event.target.id === 'pageForgotPasswordForm') {
    event.preventDefault();
    const submitButton = document.getElementById('pageForgotPasswordSubmit');
    const resultBox = document.getElementById('passwordRecoveryResult');

    try {
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.querySelector('span').textContent = 'Creating token...';

      const result = await request('/api/auth/password/forgot', {
        method: 'POST',
        body: JSON.stringify({ email: document.getElementById('pageForgotEmailInput').value.trim() })
      }, false);

      resultBox.classList.remove('hidden');
      resultBox.innerHTML = `
        <strong>${escapeHtml(result.message || 'Password reset requested')}</strong>
        ${result.resetToken ? `
          <p>Development reset token:</p>
          <code>${escapeHtml(result.resetToken)}</code>
          <a class="primary" href="#/reset-password?token=${encodeURIComponent(result.resetToken)}">Use this token</a>
        ` : '<p>Check your email for reset instructions.</p>'}
      `;
      showToast('Password reset token created');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.querySelector('span').textContent = 'Create reset token';
      }
    }
    return true;
  }

  if (event.target.id === 'pageResetPasswordForm') {
    event.preventDefault();
    const submitButton = document.getElementById('pageResetPasswordSubmit');
    const resultBox = document.getElementById('passwordRecoveryResult');

    try {
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.querySelector('span').textContent = 'Resetting...';

      await request('/api/auth/password/reset', {
        method: 'POST',
        body: JSON.stringify({
          token: document.getElementById('pageResetTokenInput').value.trim(),
          password: document.getElementById('pageNewPasswordInput').value
        })
      }, false);

      resultBox.classList.remove('hidden');
      resultBox.innerHTML = `
        <strong>Password reset successful</strong>
        <p>You can now sign in with your new password.</p>
        <a class="primary" href="#/login">Back to login</a>
      `;
      showToast('Password reset successful');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.querySelector('span').textContent = 'Reset password';
      }
    }
    return true;
  }

  if (event.target.id !== 'pageAuthForm') return false;
  event.preventDefault();
  if (state.demoMode) exitDemoMode();

  const submitButton = document.getElementById('pageAuthSubmit');

  try {
    const mode = currentRoute() === 'signup' ? 'register' : 'login';
    const payload = {
      email: document.getElementById('pageEmailInput').value,
      password: document.getElementById('pagePasswordInput').value
    };
    if (mode === 'register') {
      const confirmPassword = document.getElementById('pageConfirmPasswordInput').value;
      if (payload.password !== confirmPassword) {
        showToast('Passwords do not match', true);
        return true;
      }
      payload.username = document.getElementById('pageUsernameInput').value;
    }

    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
    submitButton.querySelector('span').textContent = mode === 'register' ? 'Creating account...' : 'Signing in...';

    const result = await request(`/api/auth/${mode}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    completeAuthenticatedSession(result);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.removeAttribute('aria-busy');
      submitButton.querySelector('span').textContent = currentRoute() === 'signup' ? 'Create account' : 'Continue';
    }
  }
  return true;
};

els.routePage.addEventListener('submit', async (event) => {
  if (await handleAuthRouteSubmit(event)) return;

  if (event.target.id === 'workspaceChatForm') {
    event.preventDefault();
    await sendWorkspaceChatMessage();
    return;
  }
  if (event.target.id === 'threadReplyComposerForm') {
    event.preventDefault();
    const replyInput = document.getElementById('threadReplyInput');
    const text = replyInput?.value.trim();
    if (!text) return;

    const activeThread = state.workspaceThreads.find(t => t._id === state.selectedThreadId) || null;
    if (!activeThread) return;

    if (state.demoMode) {
      const reply = {
        _id: `demo-doc-reply-${Date.now()}`,
        sender: { _id: state.user.id, username: state.user.username, email: state.user.email },
        body: text,
        createdAt: new Date().toISOString()
      };
      activeThread.replies = [...(activeThread.replies || []), reply];
      state.documentMessages = state.documentMessages.map(item => item._id === activeThread._id ? { ...item, ...activeThread } : item);
      state.workspaceThreads = state.workspaceThreads.map(item => item._id === activeThread._id ? { ...item, ...activeThread } : item);
      addActivity({ action: 'replied to doubt on', target: activeThread.documentTitle || 'Document' });
      showToast('Demo reply added locally');
      renderThreadsPage();
    } else {
      try {
        const reply = await request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${activeThread.documentId}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            body: text,
            parentMessageId: activeThread._id
          })
        });
        activeThread.replies = [...(activeThread.replies || []), reply];
        state.documentMessages = state.documentMessages.map(item => item._id === activeThread._id ? { ...item, ...activeThread } : item);
        state.workspaceThreads = state.workspaceThreads.map(item => item._id === activeThread._id ? { ...item, ...activeThread } : item);
        addActivity({ action: 'replied to doubt on', target: activeThread.documentTitle || 'Document' });
        showToast('Reply sent!');
        renderThreadsPage();
      } catch (err) {
        showToast(err.message, true);
      }
    }
    return;
  }
});

els.routePage.addEventListener('click', async (event) => {
  // --- Tasks Upgraded Click Handlers ---
  const taskAddBtn = event.target.closest('#tasksPageAddTaskBtn, #tasksOpenEmptyAddTaskBtn');
  if (taskAddBtn) {
    event.preventDefault();
    await showAddTaskModal();
    return;
  }

  const tasksFilterChip = event.target.closest('[data-tasks-filter-tab]');
  if (tasksFilterChip) {
    event.preventDefault();
    taskFilterTab = tasksFilterChip.dataset.tasksFilterTab;
    renderTasksPage();
    return;
  }

  const tasksClearSearch = event.target.closest('#tasksClearSearchBtn');
  if (tasksClearSearch) {
    event.preventDefault();
    taskSearchQuery = '';
    renderTasksPage();
    return;
  }

  const tasksToggleBoard = event.target.closest('#tasksViewToggleBoardBtn');
  if (tasksToggleBoard) {
    event.preventDefault();
    taskViewMode = 'board';
    renderTasksPage();
    return;
  }

  const tasksToggleList = event.target.closest('#tasksViewToggleListBtn');
  if (tasksToggleList) {
    event.preventDefault();
    taskViewMode = 'list';
    renderTasksPage();
    return;
  }

  const taskMenuBtn = event.target.closest('[data-toggle-task-menu]');
  if (taskMenuBtn) {
    event.stopPropagation();
    const taskId = taskMenuBtn.dataset.toggleTaskMenu;
    activeTaskMoreMenuId = activeTaskMoreMenuId === taskId ? '' : taskId;
    renderTasksPage();
    return;
  }

  const taskEditBtn = event.target.closest('.task-action-edit');
  if (taskEditBtn) {
    event.preventDefault();
    const taskId = taskEditBtn.dataset.editTaskId;
    activeTaskMoreMenuId = '';
    await showEditTaskModal(taskId);
    return;
  }

  const taskCopyBtn = event.target.closest('.task-action-copy');
  if (taskCopyBtn) {
    event.preventDefault();
    const title = taskCopyBtn.dataset.copyTitle;
    navigator.clipboard.writeText(title).then(() => {
      showToast('Task title copied!');
    }).catch(() => {
      showToast('Failed to copy.');
    });
    activeTaskMoreMenuId = '';
    renderTasksPage();
    return;
  }

  const taskGoDocBtn = event.target.closest('.task-action-go-doc');
  if (taskGoDocBtn) {
    event.preventDefault();
    const docId = taskGoDocBtn.dataset.goDocId;
    if (docId) await loadDocument(docId);
    navigate('workspace');
    return;
  }

  const taskDeleteBtn = event.target.closest('.task-action-delete');
  if (taskDeleteBtn) {
    event.preventDefault();
    const taskId = taskDeleteBtn.dataset.deleteTaskId;
    const task = [...state.dashboardTasks, ...state.documentTasks].find(t => t._id === taskId);
    if (!task) return;
    
    if (confirm(`Are you sure you want to delete "${task.title}"?`)) {
      const docId = task.documentId || task.document;
      if (state.demoMode) {
        state.documentTasks = state.documentTasks.filter(t => t._id !== taskId);
        state.dashboardTasks = state.dashboardTasks.filter(t => t._id !== taskId);
        showToast('Demo task deleted locally');
        activeTaskMoreMenuId = '';
        renderTasksPage();
      } else {
        try {
          await request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${docId}/tasks/${taskId}`, {
            method: 'DELETE'
          });
          state.documentTasks = state.documentTasks.filter(t => t._id !== taskId);
          state.dashboardTasks = state.dashboardTasks.filter(t => t._id !== taskId);
          showToast('Task deleted successfully');
          activeTaskMoreMenuId = '';
          renderTasksPage();
        } catch (err) {
          showToast(err.message, true);
        }
      }
    }
    return;
  }

  // Doubt Center Actions
  const askDoubtAction = event.target.closest('.ask-doubt-action-btn');
  if (askDoubtAction) {
    event.preventDefault();
    showAskDoubtModal();
    return;
  }

  const threadsTabBtn = event.target.closest('[data-threads-tab]');
  if (threadsTabBtn) {
    event.preventDefault();
    threadFilterTab = threadsTabBtn.dataset.threadsTab;
    renderThreadsPage();
    return;
  }

  const clearThreadsSearch = event.target.closest('#threadsClearSearchBtn');
  if (clearThreadsSearch) {
    event.preventDefault();
    threadSearchQuery = '';
    renderThreadsPage();
    return;
  }

  const detailMore = event.target.closest('[data-detail-more-menu]');
  if (detailMore) {
    event.stopPropagation();
    const menu = document.getElementById('threadDetailMoreMenu');
    if (menu) menu.classList.toggle('hidden');
    return;
  }

  const detailOpenDoc = event.target.closest('[data-detail-action="open-doc"]');
  if (detailOpenDoc) {
    event.preventDefault();
    const docId = detailOpenDoc.dataset.docId;
    const threadId = detailOpenDoc.dataset.threadId;
    if (docId) await loadDocument(docId);
    state.selectedThreadId = threadId || '';
    state.threadFilter = 'all';
    navigate('workspace');
    window.setTimeout(() => activateContextTab('discussion'), 0);
    return;
  }

  const detailCopyLink = event.target.closest('[data-detail-action="copy-link"]');
  if (detailCopyLink) {
    event.preventDefault();
    const threadId = detailCopyLink.dataset.threadId;
    const shareUrl = `${window.location.origin}/#threads?threadId=${threadId}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast('Doubt link copied to clipboard!');
    }).catch(() => {
      showToast('Failed to copy link.');
    });
    const menu = document.getElementById('threadDetailMoreMenu');
    if (menu) menu.classList.add('hidden');
    return;
  }

  const detailDelete = event.target.closest('[data-detail-action="delete"]');
  if (detailDelete) {
    event.preventDefault();
    const docId = detailDelete.dataset.docId;
    const threadId = detailDelete.dataset.threadId;
    if (confirm('Are you sure you want to delete this doubt?')) {
      if (state.demoMode) {
        state.workspaceThreads = state.workspaceThreads.filter(t => t._id !== threadId);
        state.documentMessages = state.documentMessages.filter(t => t._id !== threadId);
        state.selectedThreadId = '';
        showToast('Demo doubt deleted locally');
        renderThreadsPage();
      } else {
        try {
          await request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${docId}/messages/${threadId}`, {
            method: 'DELETE'
          });
          state.workspaceThreads = state.workspaceThreads.filter(t => t._id !== threadId);
          state.documentMessages = state.documentMessages.filter(t => t._id !== threadId);
          state.selectedThreadId = '';
          showToast('Doubt deleted successfully!');
          renderThreadsPage();
        } catch (err) {
          showToast(err.message, true);
        }
      }
    }
    return;
  }

  const resolveToggle = event.target.closest('.resolve-toggle-btn');
  if (resolveToggle) {
    event.preventDefault();
    const threadId = resolveToggle.dataset.detailResolveId;
    const nextStatus = resolveToggle.dataset.nextStatus;
    const thread = state.workspaceThreads.find(t => t._id === threadId);
    if (!thread) return;

    if (state.demoMode) {
      thread.status = nextStatus;
      thread.resolvedAt = nextStatus === 'resolved' ? new Date().toISOString() : null;
      thread.resolvedBy = nextStatus === 'resolved' ? { username: state.user?.username || 'Alex Rivera' } : null;
      state.documentMessages = state.documentMessages.map(item => item._id === threadId ? { ...item, ...thread } : item);
      addActivity({ action: nextStatus === 'resolved' ? 'resolved doubt on' : 'reopened doubt on', target: thread.documentTitle || 'Document' });
      showToast(nextStatus === 'resolved' ? 'Doubt resolved' : 'Doubt reopened');
      renderThreadsPage();
    } else {
      try {
        const updated = await request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${thread.documentId}/messages/${threadId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: nextStatus })
        });
        state.workspaceThreads = state.workspaceThreads.map(item => item._id === threadId ? { ...item, ...updated } : item);
        state.documentMessages = state.documentMessages.map(item => item._id === threadId ? { ...item, ...updated } : item);
        addActivity({ action: nextStatus === 'resolved' ? 'resolved doubt on' : 'reopened doubt on', target: thread.documentTitle || 'Document' });
        showToast(nextStatus === 'resolved' ? 'Doubt resolved' : 'Doubt reopened');
        renderThreadsPage();
      } catch (err) {
        showToast(err.message, true);
      }
    }
    return;
  }

  const goToDocs = event.target.closest('.go-to-docs-btn');
  if (goToDocs) {
    event.preventDefault();
    navigate('workspace');
    return;
  }

  const askAiTutor = event.target.closest('.ask-ai-tutor-btn');
  if (askAiTutor) {
    event.preventDefault();
    const docId = askAiTutor.dataset.aiDocId;
    const threadId = askAiTutor.dataset.aiDoubtId;
    const thread = state.workspaceThreads.find(t => t._id === threadId);
    if (!thread) return;

    const cardBody = event.target.closest('.ai-card-body');
    if (cardBody) {
      cardBody.innerHTML = `<p style="display: flex; align-items: center; gap: 8px; font-weight: 500; color: var(--primary);">✦ AI is analyzing doubt and generating answer...</p>`;
    }

    if (state.demoMode) {
      window.setTimeout(() => {
        const responseText = `🤖 AI Companion:\n\nBased on model evaluation context, precision and recall target different errors:\n- **Precision** is key when false positives are costly (e.g. spam filters).\n- **Recall** is crucial when false negatives are dangerous (e.g. medical diagnoses).`;
        const reply = {
          _id: `demo-doc-reply-${Date.now()}`,
          sender: { _id: 'ai-companion', username: 'AI Companion', email: 'ai' },
          body: responseText,
          createdAt: new Date().toISOString()
        };
        thread.replies = [...(thread.replies || []), reply];
        state.documentMessages = state.documentMessages.map(item => item._id === threadId ? { ...item, ...thread } : item);
        showToast('AI reply added locally');
        renderThreadsPage();
      }, 800);
      return;
    }

    try {
      const result = await request('/api/ai/document-action', {
        method: 'POST',
        body: JSON.stringify({
          action: 'explain',
          text: `Question: ${thread.body}\nContext details: ${thread.linkedText || ''}`,
          workspaceId: state.selectedWorkspaceId,
          documentId: docId
        })
      });
      const explanationText = result.response;
      
      const reply = await request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${docId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body: `🤖 AI Companion:\n\n${explanationText}`,
          parentMessageId: threadId
        })
      });
      thread.replies = [...(thread.replies || []), reply];
      state.documentMessages = state.documentMessages.map(item => item._id === threadId ? { ...item, ...thread } : item);
      showToast('AI Tutor answered successfully!');
      renderThreadsPage();
    } catch (err) {
      showToast(err.message, true);
      renderThreadsPage();
    }
    return;
  }

  const composerFormat = event.target.closest('[data-composer-format]');
  if (composerFormat) {
    event.preventDefault();
    const format = composerFormat.dataset.composerFormat;
    applyComposerFormat(format);
    return;
  }

  const dropdownAction = event.target.closest('[data-dropdown-action]');
  if (dropdownAction) {
    event.preventDefault();
    const action = dropdownAction.dataset.dropdownAction;
    handleChatDropdownAction(action);
    const menu = document.getElementById('chatDropdownMenu');
    if (menu) menu.classList.add('hidden');
    return;
  }

  const searchPrev = event.target.closest('#chatSearchPrevBtn');
  if (searchPrev) {
    event.preventDefault();
    navigateSearchMatch('prev');
    return;
  }

  const searchNext = event.target.closest('#chatSearchNextBtn');
  if (searchNext) {
    event.preventDefault();
    navigateSearchMatch('next');
    return;
  }

  const searchClose = event.target.closest('#chatSearchCloseBtn');
  if (searchClose) {
    event.preventDefault();
    closeChatSearch();
    return;
  }

  const chatAction = event.target.closest('[data-chat-action]');
  if (chatAction) {
    event.preventDefault();
    const action = chatAction.dataset.chatAction;
    handleChatAction(action);
    return;
  }

  const emptyAction = event.target.closest('[data-empty-action]');
  if (emptyAction) {
    event.preventDefault();
    const action = emptyAction.dataset.emptyAction;
    handleChatEmptyAction(action);
    return;
  }

  const msgAction = event.target.closest('[data-msg-action]');
  if (msgAction) {
    event.preventDefault();
    const action = msgAction.dataset.msgAction;
    const msgArticle = event.target.closest('.workspace-chat-message');
    const msgId = msgArticle?.dataset.messageId;
    handleChatMessageAction(action, msgId, msgArticle);
    return;
  }

  if (event.target.id === 'pageForgotPasswordForm') {
    event.preventDefault();
    const submitButton = document.getElementById('pageForgotPasswordSubmit');
    const resultBox = document.getElementById('passwordRecoveryResult');

    try {
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.querySelector('span').textContent = 'Creating token...';

      const result = await request('/api/auth/password/forgot', {
        method: 'POST',
        body: JSON.stringify({ email: document.getElementById('pageForgotEmailInput').value.trim() })
      }, false);

      resultBox.classList.remove('hidden');
      resultBox.innerHTML = `
        <strong>${escapeHtml(result.message || 'Password reset requested')}</strong>
        ${result.resetToken ? `
          <p>Development reset token:</p>
          <code>${escapeHtml(result.resetToken)}</code>
          <a class="primary" href="#/reset-password?token=${encodeURIComponent(result.resetToken)}">Use this token</a>
        ` : '<p>Check your email for reset instructions.</p>'}
      `;
      showToast('Password reset token created');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.querySelector('span').textContent = 'Create reset token';
      }
    }
    return;
  }

  if (event.target.id === 'pageResetPasswordForm') {
    event.preventDefault();
    const submitButton = document.getElementById('pageResetPasswordSubmit');
    const resultBox = document.getElementById('passwordRecoveryResult');

    try {
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.querySelector('span').textContent = 'Resetting...';

      await request('/api/auth/password/reset', {
        method: 'POST',
        body: JSON.stringify({
          token: document.getElementById('pageResetTokenInput').value.trim(),
          password: document.getElementById('pageNewPasswordInput').value
        })
      }, false);

      resultBox.classList.remove('hidden');
      resultBox.innerHTML = `
        <strong>Password reset successful</strong>
        <p>You can now sign in with your new password.</p>
        <a class="primary" href="#/login">Back to login</a>
      `;
      showToast('Password reset successful');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.querySelector('span').textContent = 'Reset password';
      }
    }
    return;
  }

  if (event.target.id !== 'pageAuthForm') return;
  event.preventDefault();
  if (state.demoMode) exitDemoMode();

  const submitButton = document.getElementById('pageAuthSubmit');

  try {
    const mode = currentRoute() === 'signup' ? 'register' : 'login';
    const payload = {
      email: document.getElementById('pageEmailInput').value,
      password: document.getElementById('pagePasswordInput').value
    };
    if (mode === 'register') {
      const confirmPassword = document.getElementById('pageConfirmPasswordInput').value;
      if (payload.password !== confirmPassword) {
        return showToast('Passwords do not match', true);
      }
      payload.username = document.getElementById('pageUsernameInput').value;
    }

    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
    submitButton.querySelector('span').textContent = mode === 'register' ? 'Creating account...' : 'Signing in...';

    const result = await request(`/api/auth/${mode}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    completeAuthenticatedSession(result);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.removeAttribute('aria-busy');
      submitButton.querySelector('span').textContent = currentRoute() === 'signup' ? 'Create account' : 'Continue';
    }
  }
});

els.loginTab.addEventListener('click', () => {
  state.authMode = 'login';
  render();
});

els.registerTab.addEventListener('click', () => {
  state.authMode = 'register';
  render();
});

els.authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.demoMode) exitDemoMode();
  try {
    const payload = {
      email: els.emailInput.value,
      password: els.passwordInput.value
    };
    if (state.authMode === 'register') payload.username = els.usernameInput.value;

    const result = await request(`/api/auth/${state.authMode === 'register' ? 'register' : 'login'}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    completeAuthenticatedSession(result);
  } catch (err) {
    showToast(err.message, true);
  }
});

els.logoutBtn.addEventListener('click', async () => {
  if (state.demoMode) {
    clearSession();
    navigate('login');
    await renderRoute();
    showToast('Exited demo workspace');
    return;
  }

  const logoutRequest = state.token
    ? request('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) })
    : Promise.resolve();

  clearSession();
  navigate('login');
  await renderRoute();
  showToast('Logged out');
  logoutRequest.catch((err) => console.warn('Logout request failed:', err.message));
});

document.querySelector('.editor-toolbar')?.addEventListener('click', (event) => {
  event.preventDefault();
  els.documentEditor.focus();
});

els.workspaceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!els.workspaceNameInput.value.trim()) return;
  if (state.demoMode) {
    els.workspaceNameInput.value = '';
    return showToast('Demo mode uses the sample CS Final Year workspace. Sign up to create your own.');
  }

  try {
    const workspace = await request('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name: els.workspaceNameInput.value })
    });
    els.workspaceNameInput.value = '';
    state.selectedWorkspaceId = workspace._id;
    localStorage.setItem('workspaceId', workspace._id);
    await loadWorkspaces();
    await bootstrapWorkspace();
    showToast('Workspace created');
  } catch (err) {
    showToast(err.message, true);
  }
});

els.workspaceList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-workspace-id]');
  if (!button) return;
  if (state.demoMode) return;

  window.clearTimeout(autosaveTimer);
  if (state.selectedDocumentId) {
    await saveCurrentDocument({ silent: true }).catch(() => {});
  }
  state.selectedWorkspaceId = button.dataset.workspaceId;
  localStorage.setItem('workspaceId', state.selectedWorkspaceId);
  teardownYDoc();
  await Promise.all([loadChannels(), loadDocuments()]);
  render();
});

els.refreshWorkspacesBtn.addEventListener('click', () => loadWorkspaces().catch((err) => showToast(err.message, true)));

els.focusModeBtn.addEventListener('click', () => toggleFocusMode());

if (els.emptyActionBlank) {
  els.emptyActionBlank.addEventListener('click', () => {
    if (!selectedDocument()) return showToast('Create or select a document first', true);
    els.documentEditor.focus();
  });
}
if (els.emptyActionPaste) {
  els.emptyActionPaste.addEventListener('click', async () => {
    if (!selectedDocument()) return showToast('Create or select a document first', true);
    try {
      const text = await navigator.clipboard.readText();
      setEditorText(text);
      els.documentEditor.dispatchEvent(new Event('input'));
      els.documentEditor.focus();
    } catch (err) {
      els.documentEditor.focus();
    }
  });
}
els.mobileSidebarOpenBtn.addEventListener('click', () => document.body.classList.add('sidebar-open'));
els.mobileSidebarCloseBtn.addEventListener('click', () => document.body.classList.remove('sidebar-open'));
document.addEventListener('click', (event) => {
  if (activeTaskMoreMenuId) {
    const isMenuToggle = event.target.closest('[data-toggle-task-menu]');
    const isMenuCard = event.target.closest('.chat-dropdown-menu');
    if (!isMenuToggle && !isMenuCard) {
      activeTaskMoreMenuId = '';
      renderTasksPage();
    }
  }

  if (document.body.classList.contains('sidebar-open')) {
    const sidebar = document.querySelector('.sidebar');
    const openBtn = document.getElementById('mobileSidebarOpenBtn');
    if (sidebar && !sidebar.contains(event.target) && openBtn && !openBtn.contains(event.target)) {
      document.body.classList.remove('sidebar-open');
    }
  }
});
els.sidebarCollapseBtn?.addEventListener('click', () => toggleSidebarCollapse());
els.sidebarThemeToggleBtn?.addEventListener('click', () => toggleTheme());

els.channelForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.selectedWorkspaceId || !els.channelNameInput.value.trim()) return;
  if (state.demoMode) {
    const channel = {
      _id: `demo-thread-${Date.now()}`,
      slug: els.channelNameInput.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `thread-${Date.now()}`,
      name: els.channelNameInput.value.trim()
    };
    state.channels.unshift(channel);
    state.selectedChannelId = channel.slug;
    els.channelNameInput.value = '';
    render();
    return showToast('Demo thread created locally');
  }

  try {
    const channel = await request(`/api/channels/${state.selectedWorkspaceId}`, {
      method: 'POST',
      body: JSON.stringify({ name: els.channelNameInput.value })
    });
    els.channelNameInput.value = '';
    state.selectedChannelId = channel.slug;
    localStorage.setItem('channelId', channel.slug);
    await loadChannels();
    showToast('Channel created');
  } catch (err) {
    showToast(err.message, true);
  }
});

els.channelList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-channel-id]');
  if (!button) return;
  state.selectedChannelId = button.dataset.channelId;
  if (!state.demoMode) localStorage.setItem('channelId', state.selectedChannelId);
  await loadMessages();
  activateContextTab('discussion');
  render();
});

els.askDoubtBtn?.addEventListener('click', startAskDoubt);
els.askDoubtEditorBtn?.addEventListener('click', startAskDoubt);

els.messageList.addEventListener('click', async (event) => {
  const threadButton = event.target.closest('[data-thread-id]');
  if (threadButton) {
    state.selectedThreadId = threadButton.dataset.threadId;
    renderThreadList();
    return;
  }

  const resolveButton = event.target.closest('[data-resolve-thread]');
  if (!resolveButton || !state.selectedDocumentId) return;
  const threadId = resolveButton.dataset.resolveThread;
  const nextStatus = resolveButton.dataset.nextStatus;
  const thread = state.documentMessages.find((item) => item._id === threadId);
  if (!thread) return;

  if (state.demoMode) {
    thread.status = nextStatus;
    thread.resolvedAt = nextStatus === 'resolved' ? new Date().toISOString() : null;
    thread.resolvedBy = nextStatus === 'resolved' ? { username: state.user?.username || 'Alex Rivera' } : null;
    state.workspaceThreads = state.workspaceThreads.map((item) => item._id === thread._id ? { ...item, ...thread } : item);
    addActivity({ action: nextStatus === 'resolved' ? 'resolved doubt on' : 'reopened doubt on', target: selectedDocumentTitle() });
    renderThreadList();
    return;
  }

  try {
    const updatedThread = await request(`${getDocumentContextPath()}/messages/${threadId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus })
    });
    state.documentMessages = state.documentMessages.map((item) => item._id === updatedThread._id ? { ...item, ...updatedThread } : item);
    state.workspaceThreads = state.workspaceThreads.map((item) => item._id === updatedThread._id ? { ...item, ...updatedThread, documentTitle: selectedDocumentTitle(), documentId: state.selectedDocumentId } : item);
    addActivity({ action: nextStatus === 'resolved' ? 'resolved doubt on' : 'reopened doubt on', target: selectedDocumentTitle() });
    renderThreadList();
  } catch (err) {
    showToast(err.message, true);
  }
});

document.addEventListener('click', (event) => {
  const filterButton = event.target.closest('[data-thread-filter]');
  if (!filterButton) return;
  state.threadFilter = filterButton.dataset.threadFilter;
  if (selectedThread() && !filteredThreads().some((thread) => thread._id === state.selectedThreadId)) {
    state.selectedThreadId = '';
  }
  renderThreadList();
});

els.messageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.selectedWorkspaceId || !state.selectedDocumentId || !els.messageInput.value.trim()) return;
  const parentMessageId = state.selectedThreadId || null;
  const linkedText = parentMessageId ? '' : (state.pendingDoubtLinkedText || getSelectedEditorText());

  if (state.demoMode) {
    if (parentMessageId) {
      const thread = state.documentMessages.find((item) => item._id === parentMessageId);
      thread?.replies.push({
        _id: `demo-doc-reply-${Date.now()}`,
        sender: { _id: state.user.id, username: state.user.username, email: state.user.email },
        body: els.messageInput.value.trim(),
        createdAt: new Date().toISOString()
      });
    } else {
      const thread = {
        _id: `demo-doc-msg-${Date.now()}`,
        sender: { _id: state.user.id, username: state.user.username, email: state.user.email },
        body: els.messageInput.value.trim(),
        linkedText,
        status: 'open',
        replies: [],
        createdAt: new Date().toISOString()
      };
      state.documentMessages.unshift(thread);
      state.workspaceThreads.unshift({ ...thread, documentTitle: selectedDocumentTitle(), documentId: state.selectedDocumentId });
      state.selectedThreadId = thread._id;
    }
    els.messageInput.value = '';
    state.pendingDoubtLinkedText = '';
    addActivity({ action: parentMessageId ? 'replied to doubt on' : 'asked a doubt on', target: selectedDocumentTitle() });
    renderThreadList();
    return showToast(parentMessageId ? 'Demo reply added locally' : 'Demo doubt added locally');
  }

  try {
    const message = await request(`${getDocumentContextPath()}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: els.messageInput.value, parentMessageId, linkedText })
    });
    els.messageInput.value = '';
    state.pendingDoubtLinkedText = '';
    if (parentMessageId) {
      state.documentMessages = state.documentMessages.map((thread) => (
        thread._id === parentMessageId
          ? { ...thread, replies: [...(thread.replies || []), message] }
          : thread
      ));
      state.workspaceThreads = state.workspaceThreads.map((thread) => (
        thread._id === parentMessageId
          ? { ...thread, replies: [...(thread.replies || []), message] }
          : thread
      ));
    } else {
      state.documentMessages.unshift(message);
      state.workspaceThreads.unshift({ ...message, documentTitle: selectedDocumentTitle(), documentId: state.selectedDocumentId });
      state.selectedThreadId = message._id;
    }
    addActivity({ action: parentMessageId ? 'replied to doubt on' : 'asked a doubt on', target: selectedDocumentTitle() });
    renderThreadList();
  } catch (err) {
    showToast(err.message, true);
  }
});

const insertPlainTextAtCursor = (text = '') => {
  if (!text) return;

  if (isTextareaEditor()) {
    const value = getEditorText();
    const start = els.documentEditor.selectionStart || 0;
    const end = els.documentEditor.selectionEnd || start;
    const nextValue = `${value.slice(0, start)}${text}${value.slice(end)}`;
    els.documentEditor.value = nextValue;
    const cursor = start + text.length;
    els.documentEditor.setSelectionRange(cursor, cursor);
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !els.documentEditor.contains(selection.anchorNode)) {
    els.documentEditor.textContent += text;
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.setEndAfter(textNode);

  selection.removeAllRanges();
  selection.addRange(range);
};

els.documentEditor.addEventListener('paste', (event) => {
  event.preventDefault();

  const text = event.clipboardData?.getData('text/plain') || '';
  insertPlainTextAtCursor(text);
  applyEditorInputToYDoc();
  publishCursor();
  scheduleAutosave();
  updateEditorEmptyState();
});

els.documentEditor.addEventListener('input', () => {
  applyEditorInputToYDoc();
  publishCursor();
  publishTyping();
  scheduleAutosave();
  updateEditorEmptyState();
});

els.documentTitleInput.addEventListener('input', () => {
  const doc = selectedDocument();
  if (!doc) return;
  doc.title = els.documentTitleInput.value || 'Untitled document';
  refreshDocumentTitleChrome({ deferList: true });
  scheduleAutosave();
});

els.documentEditor.addEventListener('keyup', publishCursor);
els.documentEditor.addEventListener('click', () => {
  publishCursor();
  scheduleAiSelectionHintUpdate();
});
els.documentEditor.addEventListener('select', () => {
  publishCursor();
  scheduleAiSelectionHintUpdate();
});
document.addEventListener('selectionchange', scheduleAiSelectionHintUpdate);

els.refreshMessagesBtn.addEventListener('click', () => loadDocumentMessages().catch((err) => showToast(err.message, true)));

els.newDocBtn.addEventListener('click', async () => {
  if (!state.selectedWorkspaceId) return;
  if (state.demoMode) {
    createDemoDocument();
    return;
  }

  try {
    const doc = await createDocumentAndOpen('Untitled Page');
    if (!doc) return;
    showToast('Document created');
  } catch (err) {
    showToast(err.message, true);
  }
});

els.documentNewPageBtn?.addEventListener('click', () => {
  els.newDocBtn.click();
});

els.documentList.addEventListener('click', async (event) => {
  const deleteButton = event.target.closest('[data-delete-document]');
  if (deleteButton) {
    event.preventDefault();
    event.stopPropagation();
    await deleteDocumentById(deleteButton.dataset.deleteDocument);
    return;
  }
  if (event.target.closest('[data-new-document-inline]')) {
    els.newDocBtn.click();
    return;
  }
  const button = event.target.closest('[data-document-id]');
  if (!button) return;
  if (String(button.dataset.documentId) === String(state.selectedDocumentId)) return;
  try {
    startDocumentOpenProfile(button.dataset.documentId);
    window.clearTimeout(autosaveTimer);
    if (state.selectedDocumentId) {
      await saveCurrentDocumentIfDirty();
    }
    await loadDocument(button.dataset.documentId);
  } catch (err) {
    finishDocumentOpenProfile();
    showToast(err.message, true);
  }
});

els.documentList.addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  const row = event.target.closest('[data-document-id]');
  if (!row || event.target.closest('[data-delete-document]')) return;
  event.preventDefault();
  row.click();
});

els.demoAiPrompts?.addEventListener('click', (event) => {
  const promptButton = event.target.closest('[data-demo-ai]');
  if (!promptButton || !state.demoMode) return;
  activateContextTab('ai');
  const action = {
    explain: 'simple-explanation',
    exam: 'important-questions'
  }[promptButton.dataset.demoAi] || promptButton.dataset.demoAi;
  setAiOutput(action, demoAiResponse(action));
});

els.saveDocBtn.addEventListener('click', async () => {
  if (!state.selectedDocumentId) return;

  try {
    window.clearTimeout(autosaveTimer);
    await saveCurrentDocument();
    showToast('Document saved');
  } catch (err) {
    showToast(err.message, true);
  }
});

els.taskForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.selectedDocumentId || !els.taskInput.value.trim()) return;

  if (state.demoMode) {
    state.documentTasks.push({
      _id: `demo-task-${Date.now()}`,
      title: els.taskInput.value.trim(),
      status: 'todo',
      priority: 'medium',
      dueDate: new Date().toISOString(),
      assignee: { username: state.user?.username || 'Alex Rivera' }
    });
    state.dashboardTasks = state.documentTasks;
    els.taskInput.value = '';
    addActivity({ action: 'created task', target: state.documentTasks.at(-1)?.title || 'Untitled task' });
    renderTaskList();
    return showToast('Demo task added locally');
  }

  request(`${getDocumentContextPath()}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ title: els.taskInput.value.trim() })
  })
    .then((task) => {
      state.documentTasks.push(task);
      state.dashboardTasks.push(task);
      els.taskInput.value = '';
      addActivity({ action: 'created task', target: task.title || 'Untitled task' });
      renderTaskList();
    })
    .catch((err) => showToast(err.message, true));
});

els.taskList.addEventListener('change', (event) => {
  const checkbox = event.target.closest('input[type="checkbox"]');
  const taskRow = event.target.closest('[data-task-id]');
  if (!checkbox || !taskRow || !state.selectedDocumentId) return;

  const task = state.documentTasks.find((item) => item._id === taskRow.dataset.taskId);
  if (!task) return;
  if (state.demoMode) {
    task.status = checkbox.checked ? 'done' : 'todo';
    task.completedAt = checkbox.checked ? new Date().toISOString() : null;
    state.dashboardTasks = state.dashboardTasks.map((item) => item._id === task._id ? task : item);
    if (checkbox.checked) addActivity({ action: 'completed task', target: task.title || 'Untitled task' });
    renderTaskList();
    return;
  }
  request(`${getDocumentContextPath()}/tasks/${task._id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: checkbox.checked ? 'done' : 'todo' })
  })
    .then((updatedTask) => {
      state.documentTasks = state.documentTasks.map((item) => item._id === updatedTask._id ? updatedTask : item);
      state.dashboardTasks = state.dashboardTasks.map((item) => item._id === updatedTask._id ? updatedTask : item);
      if (updatedTask.status === 'done') addActivity({ action: 'completed task', target: updatedTask.title || 'Untitled task' });
      renderTaskList();
    })
    .catch((err) => {
      checkbox.checked = !checkbox.checked;
      showToast(err.message, true);
    });
});

els.taskList.addEventListener('click', (event) => {
  const deleteButton = event.target.closest('[data-delete-task]');
  if (!deleteButton || !state.selectedDocumentId) return;

  if (state.demoMode) {
    state.documentTasks = state.documentTasks.filter((task) => task._id !== deleteButton.dataset.deleteTask);
    state.dashboardTasks = state.dashboardTasks.filter((task) => task._id !== deleteButton.dataset.deleteTask);
    renderTaskList();
    return showToast('Demo task deleted locally');
  }

  request(`${getDocumentContextPath()}/tasks/${deleteButton.dataset.deleteTask}`, { method: 'DELETE' })
    .then(() => {
      state.documentTasks = state.documentTasks.filter((task) => task._id !== deleteButton.dataset.deleteTask);
      state.dashboardTasks = state.dashboardTasks.filter((task) => task._id !== deleteButton.dataset.deleteTask);
      renderTaskList();
    })
    .catch((err) => showToast(err.message, true));
});

els.runAiBtn.addEventListener('click', async () => {
  await runStudyAiAction(els.aiActionSelect.value || 'summarize');
});

els.aiOutput?.addEventListener('click', handleAiStudyOutputClick);

els.saveAiToDocumentBtn?.addEventListener('click', () => {
  saveAiOutputToDocument().catch((err) => showToast(err.message, true));
});

els.saveAiToLibraryBtn?.addEventListener('click', () => {
  saveCurrentAiResultToLibrary().catch((err) => showToast(err.message, true));
});

els.copyAiOutputBtn?.addEventListener('click', async () => {
  if (!state.lastAiOutput.trim()) return showToast('Generate study material first', true);
  try {
    await navigator.clipboard.writeText(state.lastAiOutput);
    showToast('AI result copied');
  } catch (err) {
    showToast('Copy failed. Select the text manually.', true);
  }
});

els.regenerateAiBtn?.addEventListener('click', () => {
  runStudyAiAction(state.lastAiAction || els.aiActionSelect.value || 'summarize').catch((err) => showToast(err.message, true));
});

els.createAiDocumentBtn?.addEventListener('click', () => {
  createAiOutputDocument().catch((err) => showToast(err.message, true));
});

const init = async () => {
  initResizableWorkspacePanels();
  applyPreferences();
  hydrateJoinRouteFromPath();

  if (state.demoMode) {
    await loadDemoWorkspaceModule();
    hydrateDemoWorkspace();
    loadDemoDocument(state.selectedDocumentId);
  }

  if (!location.hash) {
    navigate((state.token || state.demoMode) ? 'home' : 'login');
    return;
  }

  render();
  if (state.demoMode) {
    await renderRoute();
    return;
  }

  if (!state.token) {
    await renderRoute();
    return;
  }

  try {
    await connectSocket();
    await loadWorkspaces();
    await renderRoute();
  } catch (err) {
    showToast(err.message, true);
  }
};

// Close chat dropdown, members popover and search container when clicking outside or pressing Escape
document.addEventListener('click', (event) => {
  const dropdownMenu = document.getElementById('chatDropdownMenu');
  const moreBtn = document.querySelector('[data-chat-action="more"]');
  if (dropdownMenu && !dropdownMenu.classList.contains('hidden')) {
    if (!dropdownMenu.contains(event.target) && (!moreBtn || !moreBtn.contains(event.target))) {
      dropdownMenu.classList.add('hidden');
    }
  }

  const membersPopover = document.getElementById('chatMembersPopover');
  const membersBtn = document.querySelector('[data-chat-action="members"]');
  if (membersPopover && !membersPopover.classList.contains('hidden')) {
    if (!membersPopover.contains(event.target) && (!membersBtn || !membersBtn.contains(event.target))) {
      membersPopover.classList.add('hidden');
    }
  }

  const searchContainer = document.getElementById('chatHeaderSearchContainer');
  const searchBtn = document.querySelector('[data-chat-action="search"]');
  if (searchContainer && !searchContainer.classList.contains('hidden')) {
    if (!searchContainer.contains(event.target) && (!searchBtn || !searchBtn.contains(event.target))) {
      const clickedNav = event.target.closest('.chat-search-nav-btn') || event.target.closest('.chat-search-close-btn');
      if (!clickedNav) {
        closeChatSearch();
      }
    }
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeChatSearch();
    const dropdownMenu = document.getElementById('chatDropdownMenu');
    if (dropdownMenu) {
      dropdownMenu.classList.add('hidden');
    }
    const membersPopover = document.getElementById('chatMembersPopover');
    if (membersPopover) {
      membersPopover.classList.add('hidden');
    }
  }
});

// --- Workspace Members Event Listeners ---
els.routePage.addEventListener('click', async (event) => {
  const target = event.target;

  // 1. Members Tabs click
  const tabBtn = target.closest('[data-members-tab]');
  if (tabBtn) {
    event.preventDefault();
    membersActiveTab = tabBtn.dataset.membersTab;
    closeMembersActionMenu();
    renderMembersPage();
    return;
  }

  // 2. Open Invite Modal
  const inviteBtn = target.closest('#membersInviteMemberBtn, #emptyMembersInviteBtn, #dashboardEmptyInviteBtn');
  if (inviteBtn) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    generatedInviteResult = null;
    showInviteMemberModal();
    return;
  }

  // 3. Open Join Modal
  const joinBtn = target.closest('#membersJoinWorkspaceBtn, #emptyJoinWorkspaceBtn, #openJoinWorkspaceBtn');
  if (joinBtn) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    renderJoinWorkspaceTool();
    return;
  }

  // 4. Copy Workspace Generic Invite Page Link
  const copyLinkBtn = target.closest('#membersCopyWorkspaceInviteLinkBtn');
  if (copyLinkBtn) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    const inviteLink = `${location.origin}${location.pathname}#/invite`;
    await copyText(inviteLink, 'Invite page link copied');
    return;
  }

  // 5. Generate Invite Form Submit
  if (target.id === 'inviteCreateSubmitBtn') {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (state.demoMode) {
      generatedInviteResult = {
        code: 'NEXUS-DEMO-CODE',
        inviteLink: `${location.origin}${location.pathname}#/invite?code=NEXUS-DEMO-CODE`
      };
      showInviteMemberModal();
      return;
    }
    const workspace = selectedWorkspace();
    if (!workspace?._id) return showToast('Select a workspace first', true);
    const email = document.getElementById('inviteEmailInput')?.value.trim();
    const role = document.getElementById('inviteRoleInput')?.value || 'member';
    
    if (inviteRequestInFlight) return;
    inviteRequestInFlight = true;
    target.disabled = true;
    try {
      const result = await request(`/api/invites/${workspace._id}`, {
        method: 'POST',
        body: JSON.stringify({ email, role })
      });
      generatedInviteResult = {
        code: result.code || result.invite?.code || '',
        inviteLink: result.inviteLink || `${location.origin}${location.pathname}#/invite?token=${result.token}`
      };
      showInviteMemberModal();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      inviteRequestInFlight = false;
    }
    return;
  }

  // 6. Copy generated invite code/link
  const copyGenLink = target.closest('#copyGeneratedInviteLinkBtn');
  if (copyGenLink) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    const val = document.getElementById('generatedInviteLinkInput')?.value || '';
    await copyText(val, 'Invite link copied');
    return;
  }
  const copyGenCode = target.closest('#copyGeneratedInviteCodeBtn');
  if (copyGenCode) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    const val = document.getElementById('generatedInviteCodeInput')?.value || '';
    await copyText(val, 'Invite code copied');
    return;
  }

  // 7. Invite Modal Close/Done
  const inviteClose = target.closest('#inviteCloseBtn');
  if (inviteClose) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    generatedInviteResult = null;
    closeToolPanel();
    renderMembersPage();
    return;
  }

  // 8. Copy invite from Invites List
  const copyUrlBtn = target.closest('[data-copy-invite-url]');
  if (copyUrlBtn) {
    event.preventDefault();
    const val = copyUrlBtn.dataset.copyInviteUrl;
    await copyText(val, 'Invite link copied');
    return;
  }
  const copyCodeBtn = target.closest('[data-copy-invite-code]');
  if (copyCodeBtn) {
    event.preventDefault();
    const val = copyCodeBtn.dataset.copyInviteCode;
    await copyText(val, 'Invite code copied');
    return;
  }

  // 9. Revoke invite in Invites list
  const revokeBtn = target.closest('.revoke-invite-btn');
  if (revokeBtn) {
    event.preventDefault();
    const inviteId = revokeBtn.dataset.revokeInviteId;
    if (confirm('Revoke this invite? Anyone with the link or code will no longer be able to join.')) {
      if (state.demoMode) {
        showToast('Demo invite revoked locally');
        renderMembersPage();
        return;
      }
      try {
        await request(`/api/invites/${state.selectedWorkspaceId}/${inviteId}`, { method: 'DELETE' });
        showToast('Invite revoked');
        renderMembersPage();
      } catch (err) {
        showToast(err.message, true);
      }
    }
    return;
  }

  // 10. Toggle Member Actions Menu
  const menuTrigger = target.closest('.members-menu-trigger-btn');
  if (menuTrigger) {
    event.preventDefault();
    event.stopPropagation();
    const userId = menuTrigger.dataset.triggerMenuFor;
    openMembersActionMenu(userId, menuTrigger);
    return;
  }

  // 11. Members Actions Menu Item Click
  const menuAction = target.closest('.members-menu-action-btn');
  if (menuAction) {
    event.preventDefault();
    await handleMembersMenuAction(menuAction);
    return;
  }

  // 12. Active Session Card Doc Redirect Link
  const activeDocCard = target.closest('[data-active-doc-link]');
  if (activeDocCard) {
    event.preventDefault();
    const docId = activeDocCard.dataset.activeDocLink;
    if (docId) {
      await loadDocument(docId);
      navigate('workspace');
    }
    return;
  }

  // 13. Close action dropdowns when clicking outside
  const confirmRemoveBtn = target.closest('#confirmRemoveMemberBtn');
  if (confirmRemoveBtn) {
    event.preventDefault();
    const memberId = confirmRemoveBtn.dataset.confirmRemoveMember;
    const workspace = selectedWorkspace();
    const member = workspace?.members?.find((item) => memberUserId(item) === memberId);
    const displayName = member ? getMemberDisplayName(member) : 'Member';
    if (!member || membersRemovingMemberId) return;
    membersRemovingMemberId = memberId;
    confirmRemoveBtn.disabled = true;
    confirmRemoveBtn.setAttribute('aria-busy', 'true');
    confirmRemoveBtn.textContent = 'Removing...';
    try {
      await request(`/api/workspaces/${state.selectedWorkspaceId}/members/${memberId}`, { method: 'DELETE' });
      await loadWorkspaces();
      document.getElementById('membersRemoveModal')?.remove();
      membersRemoveCandidateId = '';
      showToast(`${displayName} removed from workspace.`);
      renderMembersPage();
    } catch (err) {
      showToast(err.message, true);
      confirmRemoveBtn.disabled = false;
      confirmRemoveBtn.removeAttribute('aria-busy');
      confirmRemoveBtn.textContent = 'Remove Member';
    } finally {
      membersRemovingMemberId = '';
    }
    return;
  }

  if (target.closest('[data-close-members-modal]') || target.classList.contains('members-modal-backdrop')) {
    document.getElementById('membersDetailsModal')?.remove();
    document.getElementById('membersRemoveModal')?.remove();
    membersRemoveCandidateId = '';
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (membersActiveMenuMemberId) closeMembersActionMenu();
    document.getElementById('membersDetailsModal')?.remove();
    document.getElementById('membersRemoveModal')?.remove();
    membersRemoveCandidateId = '';
  }
});

document.addEventListener('click', async (event) => {
  const confirmRemoveBtn = event.target.closest('#confirmRemoveMemberBtn');
  if (confirmRemoveBtn) {
    event.preventDefault();
    const memberId = confirmRemoveBtn.dataset.confirmRemoveMember;
    const workspace = selectedWorkspace();
    const member = workspace?.members?.find((item) => memberUserId(item) === memberId);
    const displayName = member ? getMemberDisplayName(member) : 'Member';
    if (!member || membersRemovingMemberId) return;
    membersRemovingMemberId = memberId;
    confirmRemoveBtn.disabled = true;
    confirmRemoveBtn.setAttribute('aria-busy', 'true');
    confirmRemoveBtn.textContent = 'Removing...';
    try {
      await request(`/api/workspaces/${state.selectedWorkspaceId}/members/${memberId}`, { method: 'DELETE' });
      await loadWorkspaces();
      document.getElementById('membersRemoveModal')?.remove();
      membersRemoveCandidateId = '';
      showToast(`${displayName} removed from workspace.`);
      renderMembersPage();
    } catch (err) {
      showToast(err.message, true);
      confirmRemoveBtn.disabled = false;
      confirmRemoveBtn.removeAttribute('aria-busy');
      confirmRemoveBtn.textContent = 'Remove Member';
    } finally {
      membersRemovingMemberId = '';
    }
    return;
  }

  if (event.target.closest('[data-close-members-modal]') || event.target.classList.contains('members-modal-backdrop')) {
    document.getElementById('membersDetailsModal')?.remove();
    document.getElementById('membersRemoveModal')?.remove();
    membersRemoveCandidateId = '';
    return;
  }

  const menuAction = event.target.closest('#membersActionPortal .members-menu-action-btn');
  if (menuAction) {
    event.preventDefault();
    await handleMembersMenuAction(menuAction);
    return;
  }

  if (
    membersActiveMenuMemberId
    && !event.target.closest('#membersActionPortal')
    && !event.target.closest('.members-menu-trigger-btn')
  ) {
    closeMembersActionMenu();
  }
});

window.addEventListener('resize', () => {
  if (membersActiveMenuMemberId) closeMembersActionMenu();
});

window.addEventListener('scroll', () => {
  if (membersActiveMenuMemberId) closeMembersActionMenu();
}, true);

els.routePage.addEventListener('click', (event) => {
  if (event.target.id === 'closeMemberDetailsBtn') {
    closeToolPanel();
  }
});

// --- Settings Page Event Listeners & Delegations ---
els.routePage.addEventListener('input', (event) => {
  const target = event.target;
  if (target.id === 'settingsWorkspaceNameInput') {
    settingsWorkspaceName = target.value;
    updateSaveButtonState();
  } else if (target.id === 'settingsWorkspaceDescriptionInput') {
    settingsWorkspaceDescription = target.value;
    updateSaveButtonState();
  }
});

els.routePage.addEventListener('change', (event) => {
  const target = event.target;
  if (target.id === 'settingsDensitySelect') {
    settingsDensity = target.value;
    updateSaveButtonState();
  } else if (target.id === 'settingsReduceMotionInput') {
    settingsReduceMotion = target.checked;
    updateSaveButtonState();
  } else if (target.id === 'settingsEmailNotificationsInput') {
    settingsEmailNotifications = target.checked;
    updateSaveButtonState();
  } else if (target.id === 'settingsTaskNotificationsInput') {
    settingsTaskNotifications = target.checked;
    updateSaveButtonState();
  } else if (target.id === 'settingsDiscussionNotificationsInput') {
    settingsDiscussionNotifications = target.checked;
    updateSaveButtonState();
  } else if (target.id === 'settingsMentionNotificationsInput') {
    settingsMentionNotifications = target.checked;
    updateSaveButtonState();
  } else if (target.id === 'settingsInviteNotificationsInput') {
    settingsInviteNotifications = target.checked;
    updateSaveButtonState();
  }
});

els.routePage.addEventListener('click', (event) => {
  const target = event.target;
  const themeCard = target.closest('.theme-select-card');
  if (themeCard) {
    event.preventDefault();
    const val = themeCard.dataset.themeVal;
    settingsTheme = val;
    
    // Update theme card active styles in DOM
    themeCard.parentNode.querySelectorAll('.theme-select-card').forEach(card => {
      card.classList.toggle('active', card.dataset.themeVal === val);
    });
    
    // Preview theme instantly
    document.body.dataset.theme = val === 'system' 
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') 
      : val;
      
    updateSaveButtonState();
  }
});


const exposeLazyRouteShellBindings = () => {
  Object.defineProperties(globalThis, {
    request: { configurable: true, get: () => request },
    resolveStartupSurface: { configurable: true, get: () => resolveStartupSurface },
    API_BASE: { configurable: true, get: () => API_BASE },
    Y_TEXT_KEY: { configurable: true, get: () => Y_TEXT_KEY },
    yjsModulePromise: { configurable: true, get: () => socketState.yjsModulePromise, set: (value) => { socketState.yjsModulePromise = value; } },
    socketClientPromise: { configurable: true, get: () => socketState.socketClientPromise, set: (value) => { socketState.socketClientPromise = value; } },
    demoWorkspacePromise: { configurable: true, get: () => demoWorkspacePromise, set: (value) => { demoWorkspacePromise = value; } },
    Y: { configurable: true, get: () => socketState.Y, set: (value) => { socketState.Y = value; } },
    socketIo: { configurable: true, get: () => socketState.socketIo, set: (value) => { socketState.socketIo = value; } },
    demoWorkspaceModule: { configurable: true, get: () => demoWorkspaceModule, set: (value) => { demoWorkspaceModule = value; } },
    autosaveTimer: { configurable: true, get: () => autosaveTimer, set: (value) => { autosaveTimer = value; } },
    typingTimer: { configurable: true, get: () => socketState.typingTimer, set: (value) => { socketState.typingTimer = value; } },
    chatTypingTimer: { configurable: true, get: () => socketState.chatTypingTimer, set: (value) => { socketState.chatTypingTimer = value; } },
    lastChatTypingPublishAt: { configurable: true, get: () => socketState.lastChatTypingPublishAt, set: (value) => { socketState.lastChatTypingPublishAt = value; } },
    dashboardHydrationTimer: { configurable: true, get: () => dashboardHydrationTimer, set: (value) => { dashboardHydrationTimer = value; } },
    aiSelectionHintTimer: { configurable: true, get: () => aiSelectionHintTimer, set: (value) => { aiSelectionHintTimer = value; } },
    titleUiTimer: { configurable: true, get: () => titleUiTimer, set: (value) => { titleUiTimer = value; } },
    lastCursorPublishAt: { configurable: true, get: () => socketState.lastCursorPublishAt, set: (value) => { socketState.lastCursorPublishAt = value; } },
    lastTypingPublishAt: { configurable: true, get: () => socketState.lastTypingPublishAt, set: (value) => { socketState.lastTypingPublishAt = value; } },
    aiGenerationInFlight: { configurable: true, get: () => aiGenerationInFlight, set: (value) => { aiGenerationInFlight = value; } },
    flashcardProgressSaveTimer: { configurable: true, get: () => flashcardProgressSaveTimer, set: (value) => { flashcardProgressSaveTimer = value; } },
    documentCreateInFlight: { configurable: true, get: () => documentCreateInFlight, set: (value) => { documentCreateInFlight = value; } },
    activeDocumentOpenProfile: { configurable: true, get: () => activeDocumentOpenProfile, set: (value) => { activeDocumentOpenProfile = value; } },
    overlayScrollLocked: { configurable: true, get: () => modalState.overlayScrollLocked, set: (value) => { modalState.overlayScrollLocked = value; } },
    overlayScrollY: { configurable: true, get: () => modalState.overlayScrollY, set: (value) => { modalState.overlayScrollY = value; } },
    activeWorkspaceMenuId: { configurable: true, get: () => activeWorkspaceMenuId, set: (value) => { activeWorkspaceMenuId = value; } },
    activeWorkspaceRenameId: { configurable: true, get: () => activeWorkspaceRenameId, set: (value) => { activeWorkspaceRenameId = value; } },
    pendingWorkspaceDeleteId: { configurable: true, get: () => pendingWorkspaceDeleteId, set: (value) => { pendingWorkspaceDeleteId = value; } },
    pendingWorkspaceInvites: { configurable: true, get: () => pendingWorkspaceInvites, set: (value) => { pendingWorkspaceInvites = value; } },
    latestCreatedInvite: { configurable: true, get: () => inviteState.latestCreatedInvite, set: (value) => { inviteState.latestCreatedInvite = value; } },
    activeJoinInvite: { configurable: true, get: () => inviteState.activeJoinInvite, set: (value) => { inviteState.activeJoinInvite = value; } },
    inviteRequestInFlight: { configurable: true, get: () => inviteState.inviteRequestInFlight, set: (value) => { inviteState.inviteRequestInFlight = value; } },
    activeDocumentLoadToken: { configurable: true, get: () => activeDocumentLoadToken, set: (value) => { activeDocumentLoadToken = value; } },
    deletingDocumentIds: { configurable: true, get: () => deletingDocumentIds },
    membersActiveTab: { configurable: true, get: () => membersActiveTab, set: (value) => { membersActiveTab = value; } },
    membersSearchQuery: { configurable: true, get: () => membersSearchQuery, set: (value) => { membersSearchQuery = value; } },
    membersRoleFilter: { configurable: true, get: () => membersRoleFilter, set: (value) => { membersRoleFilter = value; } },
    membersStatusFilter: { configurable: true, get: () => membersStatusFilter, set: (value) => { membersStatusFilter = value; } },
    membersActiveMenuMemberId: { configurable: true, get: () => membersActiveMenuMemberId, set: (value) => { membersActiveMenuMemberId = value; } },
    membersActionMenuRect: { configurable: true, get: () => membersActionMenuRect, set: (value) => { membersActionMenuRect = value; } },
    membersDetailsModalMemberId: { configurable: true, get: () => membersDetailsModalMemberId, set: (value) => { membersDetailsModalMemberId = value; } },
    membersRemoveCandidateId: { configurable: true, get: () => membersRemoveCandidateId, set: (value) => { membersRemoveCandidateId = value; } },
    membersRemovingMemberId: { configurable: true, get: () => membersRemovingMemberId, set: (value) => { membersRemovingMemberId = value; } },
    inviteExpiryOption: { configurable: true, get: () => inviteExpiryOption, set: (value) => { inviteExpiryOption = value; } },
    settingsWorkspaceName: { configurable: true, get: () => settingsWorkspaceName, set: (value) => { settingsWorkspaceName = value; } },
    settingsWorkspaceDescription: { configurable: true, get: () => settingsWorkspaceDescription, set: (value) => { settingsWorkspaceDescription = value; } },
    settingsTheme: { configurable: true, get: () => settingsTheme, set: (value) => { settingsTheme = value; } },
    settingsDensity: { configurable: true, get: () => settingsDensity, set: (value) => { settingsDensity = value; } },
    settingsReduceMotion: { configurable: true, get: () => settingsReduceMotion, set: (value) => { settingsReduceMotion = value; } },
    settingsEmailNotifications: { configurable: true, get: () => settingsEmailNotifications, set: (value) => { settingsEmailNotifications = value; } },
    settingsTaskNotifications: { configurable: true, get: () => settingsTaskNotifications, set: (value) => { settingsTaskNotifications = value; } },
    settingsDiscussionNotifications: { configurable: true, get: () => settingsDiscussionNotifications, set: (value) => { settingsDiscussionNotifications = value; } },
    settingsMentionNotifications: { configurable: true, get: () => settingsMentionNotifications, set: (value) => { settingsMentionNotifications = value; } },
    settingsInviteNotifications: { configurable: true, get: () => settingsInviteNotifications, set: (value) => { settingsInviteNotifications = value; } },
    settingsSaveInProgress: { configurable: true, get: () => settingsSaveInProgress, set: (value) => { settingsSaveInProgress = value; } },
    selectedCommandIndex: { configurable: true, get: () => selectedCommandIndex, set: (value) => { selectedCommandIndex = value; } },
    threadFilterTab: { configurable: true, get: () => threadFilterTab, set: (value) => { threadFilterTab = value; } },
    threadSearchQuery: { configurable: true, get: () => threadSearchQuery, set: (value) => { threadSearchQuery = value; } },
    taskSearchQuery: { configurable: true, get: () => taskSearchQuery, set: (value) => { taskSearchQuery = value; } },
    taskFilterTab: { configurable: true, get: () => taskFilterTab, set: (value) => { taskFilterTab = value; } },
    taskSortField: { configurable: true, get: () => taskSortField, set: (value) => { taskSortField = value; } },
    taskViewMode: { configurable: true, get: () => taskViewMode, set: (value) => { taskViewMode = value; } },
    activeTaskMoreMenuId: { configurable: true, get: () => activeTaskMoreMenuId, set: (value) => { activeTaskMoreMenuId = value; } },
    AUTOSAVE_DELAY_MS: { configurable: true, get: () => AUTOSAVE_DELAY_MS },
    CURSOR_PUBLISH_INTERVAL_MS: { configurable: true, get: () => CURSOR_PUBLISH_INTERVAL_MS },
    TYPING_PUBLISH_INTERVAL_MS: { configurable: true, get: () => TYPING_PUBLISH_INTERVAL_MS },
    CHAT_TYPING_PUBLISH_INTERVAL_MS: { configurable: true, get: () => CHAT_TYPING_PUBLISH_INTERVAL_MS },
    GENERAL_CHAT_CHANNEL: { configurable: true, get: () => GENERAL_CHAT_CHANNEL },
    MAX_DOCUMENT_TEXT_CHARS: { configurable: true, get: () => MAX_DOCUMENT_TEXT_CHARS },
    MAX_DOCUMENT_TEXT_BYTES: { configurable: true, get: () => MAX_DOCUMENT_TEXT_BYTES },
    loadYjs: { configurable: true, get: () => loadYjs },
    loadSocketClient: { configurable: true, get: () => loadSocketClient },
    loadDemoWorkspaceModule: { configurable: true, get: () => loadDemoWorkspaceModule },
    requireDemoWorkspaceModule: { configurable: true, get: () => requireDemoWorkspaceModule },
    startDocumentOpenProfile: { configurable: true, get: () => startDocumentOpenProfile },
    recordDocumentOpenMeasure: { configurable: true, get: () => recordDocumentOpenMeasure },
    finishDocumentOpenProfile: { configurable: true, get: () => finishDocumentOpenProfile },
    els: { configurable: true, get: () => els },
    showToast: { configurable: true, get: () => showToast },
    copyText: { configurable: true, get: () => copyText },
    formatInviteRole: { configurable: true, get: () => formatInviteRole },
    formatInviteExpiry: { configurable: true, get: () => formatInviteExpiry },
    parseInviteInput: { configurable: true, get: () => parseInviteInput },
    inviteCredentialQuery: { configurable: true, get: () => inviteCredentialQuery },
    inviteCredentialStorageValue: { configurable: true, get: () => inviteCredentialStorageValue },
    readPendingInviteCredential: { configurable: true, get: () => readPendingInviteCredential },
    storePendingInviteCredential: { configurable: true, get: () => storePendingInviteCredential },
    clearPendingInviteCredential: { configurable: true, get: () => clearPendingInviteCredential },
    inviteLinkForToken: { configurable: true, get: () => inviteLinkForToken },
    pendingInviteRoute: { configurable: true, get: () => pendingInviteRoute },
    hydrateJoinRouteFromPath: { configurable: true, get: () => hydrateJoinRouteFromPath },
    traceWorkspaceDelete: { configurable: true, get: () => traceWorkspaceDelete },
    setAutosaveStatus: { configurable: true, get: () => setAutosaveStatus },
    PANEL_RESIZE_CONFIG: { configurable: true, get: () => PANEL_RESIZE_CONFIG },
    clamp: { configurable: true, get: () => clamp },
    readStoredPanelWidth: { configurable: true, get: () => readStoredPanelWidth },
    setPanelWidth: { configurable: true, get: () => setPanelWidth },
    panelResizeEnabled: { configurable: true, get: () => panelResizeEnabled },
    safePanelMax: { configurable: true, get: () => safePanelMax },
    clampPanelWidthsToViewport: { configurable: true, get: () => clampPanelWidthsToViewport },
    initResizableWorkspacePanels: { configurable: true, get: () => initResizableWorkspacePanels },
    syncOverlayScrollLock: { configurable: true, get: () => syncOverlayScrollLock },
    persistPreferences: { configurable: true, get: () => persistPreferences },
    applyPreferences: { configurable: true, get: () => applyPreferences },
    toggleTheme: { configurable: true, get: () => toggleTheme },
    saveSession: { configurable: true, get: () => saveSession },
    clearSession: { configurable: true, get: () => clearSession },
    selectedDocumentTitle: { configurable: true, get: () => selectedDocumentTitle },
    currentRoute: { configurable: true, get: () => currentRoute },
    routeQuery: { configurable: true, get: () => routeQuery },
    navigate: { configurable: true, get: () => navigate },
    hydrateDemoWorkspace: { configurable: true, get: () => hydrateDemoWorkspace },
    loadDemoDocument: { configurable: true, get: () => loadDemoDocument },
    enterDemoMode: { configurable: true, get: () => enterDemoMode },
    exitDemoMode: { configurable: true, get: () => exitDemoMode },
    saveDemoDocument: { configurable: true, get: () => saveDemoDocument },
    createDemoDocument: { configurable: true, get: () => createDemoDocument },
    demoAiResponse: { configurable: true, get: () => demoAiResponse },
    setRouteChrome: { configurable: true, get: () => setRouteChrome },
    normalizeContextTab: { configurable: true, get: () => normalizeContextTab },
    activateContextTab: { configurable: true, get: () => activateContextTab },
    openCommandPalette: { configurable: true, get: () => openCommandPalette },
    closeCommandPalette: { configurable: true, get: () => closeCommandPalette },
    renderCommandResults: { configurable: true, get: () => renderCommandResults },
    commandPaletteRuntime: { configurable: true, get: () => commandPaletteRuntime },
    openCommandPaletteFeature: { configurable: true, get: () => openCommandPaletteFeature },
    toggleFocusMode: { configurable: true, get: () => toggleFocusMode },
    toggleSidebarCollapse: { configurable: true, get: () => toggleSidebarCollapse },
    emptyState: { configurable: true, get: () => emptyState },
    loadingRows: { configurable: true, get: () => loadingRows },
    errorState: { configurable: true, get: () => errorState },
    setLoading: { configurable: true, get: () => setLoading },
    setError: { configurable: true, get: () => setError },
    isTextareaEditor: { configurable: true, get: () => isTextareaEditor },
    getEditorText: { configurable: true, get: () => getEditorText },
    updateEditorEmptyState: { configurable: true, get: () => updateEditorEmptyState },
    getEditorHtml: { configurable: true, get: () => getEditorHtml },
    htmlToPlainText: { configurable: true, get: () => htmlToPlainText },
    setEditorText: { configurable: true, get: () => setEditorText },
    setEditorHtml: { configurable: true, get: () => setEditorHtml },
    insertStarterOutline: { configurable: true, get: () => insertStarterOutline },
    getEditorSelection: { configurable: true, get: () => getEditorSelection },
    getSelectedEditorText: { configurable: true, get: () => getSelectedEditorText },
    selectedAiSource: { configurable: true, get: () => selectedAiSource },
    getAiSourceText: { configurable: true, get: () => getAiSourceText },
    updateAiSelectionHint: { configurable: true, get: () => updateAiSelectionHint },
    scheduleAiSelectionHintUpdate: { configurable: true, get: () => scheduleAiSelectionHintUpdate },
    aiActionLabel: { configurable: true, get: () => aiActionLabel },
    aiActionToMaterialType: { configurable: true, get: () => aiActionToMaterialType },
    materialTypeToAiAction: { configurable: true, get: () => materialTypeToAiAction },
    materialTypeLabel: { configurable: true, get: () => materialTypeLabel },
    currentAiMaterialTitle: { configurable: true, get: () => currentAiMaterialTitle },
    setAiOutput: { configurable: true, get: () => setAiOutput },
    updateLibrarySaveButton: { configurable: true, get: () => updateLibrarySaveButton },
    setAiGenerating: { configurable: true, get: () => setAiGenerating },
    renderAiEmptyState: { configurable: true, get: () => renderAiEmptyState },
    isMine: { configurable: true, get: () => isMine },
    filteredThreads: { configurable: true, get: () => filteredThreads },
    selectedThread: { configurable: true, get: () => selectedThread },
    refreshDocumentTitleChrome: { configurable: true, get: () => refreshDocumentTitleChrome },
    renderTaskList: { configurable: true, get: () => renderTaskList },
    getQuizProgressFromSession: { configurable: true, get: () => getQuizProgressFromSession },
    getFlashcardProgressFromSession: { configurable: true, get: () => getFlashcardProgressFromSession },
    buildStudyMaterialPayload: { configurable: true, get: () => buildStudyMaterialPayload },
    materialMetaText: { configurable: true, get: () => materialMetaText },
    renderStudyLibrary: { configurable: true, get: () => renderStudyLibrary },
    renderActiveContextPanel: { configurable: true, get: () => renderActiveContextPanel },
    renderThreadList: { configurable: true, get: () => renderThreadList },
    setThreadComposer: { configurable: true, get: () => setThreadComposer },
    startAskDoubt: { configurable: true, get: () => startAskDoubt },
    renderMessageFormContext: { configurable: true, get: () => renderMessageFormContext },
    renderSessionChrome: { configurable: true, get: () => renderSessionChrome },
    renderWorkspace: { configurable: true, get: () => renderWorkspace },
    renderChannels: { configurable: true, get: () => renderChannels },
    renderDocumentRow: { configurable: true, get: () => renderDocumentRow },
    renderDocuments: { configurable: true, get: () => renderDocuments },
    updateActiveDocumentSelection: { configurable: true, get: () => updateActiveDocumentSelection },
    renderEditor: { configurable: true, get: () => renderEditor },
    renderContextPanel: { configurable: true, get: () => renderContextPanel },
    render: { configurable: true, get: () => render },
    setMainMode: { configurable: true, get: () => setMainMode },
    lazyRouteModule: { configurable: true, get: () => lazyRouteModule },
    renderAuthPage: { configurable: true, get: () => renderAuthPage },
    renderPasswordRecoveryPage: { configurable: true, get: () => renderPasswordRecoveryPage },
    getDashboardData: { configurable: true, get: () => getDashboardData },
    renderHomePage: { configurable: true, get: () => renderHomePage },
    renderChatPage: { configurable: true, get: () => renderChatPage },
    renderChatMessages: { configurable: true, get: () => renderChatMessages },
    applyComposerFormat: { configurable: true, get: () => applyComposerFormat },
    showChatModal: { configurable: true, get: () => showChatModal },
    highlightSearchInDom: { configurable: true, get: () => highlightSearchInDom },
    handleChatDropdownAction: { configurable: true, get: () => handleChatDropdownAction },
    handleChatAction: { configurable: true, get: () => handleChatAction },
    handleChatEmptyAction: { configurable: true, get: () => handleChatEmptyAction },
    renderThreadListSection: { configurable: true, get: () => renderThreadListSection },
    renderThreadDetailHtml: { configurable: true, get: () => renderThreadDetailHtml },
    renderThreadsPage: { configurable: true, get: () => renderThreadsPage },
    getFilteredTasks: { configurable: true, get: () => getFilteredTasks },
    renderTaskCardHtml: { configurable: true, get: () => renderTaskCardHtml },
    showAddTaskModal: { configurable: true, get: () => showAddTaskModal },
    showEditTaskModal: { configurable: true, get: () => showEditTaskModal },
    renderTasksPage: { configurable: true, get: () => renderTasksPage },
    renderMembersPage: { configurable: true, get: () => renderMembersPage },
    renderSettingsContent: { configurable: true, get: () => renderSettingsContent },
    renderSettingsPage: { configurable: true, get: () => renderSettingsPage },
    renderWorkspaceSettingsPage: { configurable: true, get: () => renderWorkspaceSettingsPage },
    renderWorkspacePage: { configurable: true, get: () => renderWorkspacePage },
    getInitials: { configurable: true, get: () => getInitials },
    formatRelativeTime: { configurable: true, get: () => formatRelativeTime },
    formatChatTime: { configurable: true, get: () => formatChatTime },
    activeChatChannel: { configurable: true, get: () => activeChatChannel },
    chatSenderName: { configurable: true, get: () => chatSenderName },
    syncUnreadBadge: { configurable: true, get: () => syncUnreadBadge },
    clearChatUnread: { configurable: true, get: () => clearChatUnread },
    currentChatPreview: { configurable: true, get: () => currentChatPreview },
    chatOnlineCount: { configurable: true, get: () => chatOnlineCount },
    highlightActiveMatch: { configurable: true, get: () => highlightActiveMatch },
    updateSearchMatchesCounter: { configurable: true, get: () => updateSearchMatchesCounter },
    navigateSearchMatch: { configurable: true, get: () => navigateSearchMatch },
    closeChatSearch: { configurable: true, get: () => closeChatSearch },
    handleChatMessageAction: { configurable: true, get: () => handleChatMessageAction },
    renderChatTypingIndicator: { configurable: true, get: () => renderChatTypingIndicator },
    getTimeGreeting: { configurable: true, get: () => getTimeGreeting },
    isDueToday: { configurable: true, get: () => isDueToday },
    formatTaskDue: { configurable: true, get: () => formatTaskDue },
    getWorkspaceMembers: { configurable: true, get: () => getWorkspaceMembers },
    getUserDisplayName: { configurable: true, get: () => getUserDisplayName },
    getMemberDisplayName: { configurable: true, get: () => getMemberDisplayName },
    getMemberName: { configurable: true, get: () => getMemberName },
    collaborationPeople: { configurable: true, get: () => collaborationPeople },
    memberUserId: { configurable: true, get: () => memberUserId },
    isWorkspaceOwner: { configurable: true, get: () => isWorkspaceOwner },
    isCurrentUserWorkspaceAdmin: { configurable: true, get: () => isCurrentUserWorkspaceAdmin },
    displayWorkspaceRole: { configurable: true, get: () => displayWorkspaceRole },
    memberActionPolicy: { configurable: true, get: () => memberActionPolicy },
    closeMembersActionMenu: { configurable: true, get: () => closeMembersActionMenu },
    renderMembersActionMenu: { configurable: true, get: () => renderMembersActionMenu },
    openMembersActionMenu: { configurable: true, get: () => openMembersActionMenu },
    showMemberDetailsModal: { configurable: true, get: () => showMemberDetailsModal },
    showRemoveMemberModal: { configurable: true, get: () => showRemoveMemberModal },
    handleMembersMenuAction: { configurable: true, get: () => handleMembersMenuAction },
    addActivity: { configurable: true, get: () => addActivity },
    renderActivityList: { configurable: true, get: () => renderActivityList },
    updateTypingStatus: { configurable: true, get: () => updateTypingStatus },
    getActivityIcon: { configurable: true, get: () => getActivityIcon },
    getFilteredWorkspaceThreads: { configurable: true, get: () => getFilteredWorkspaceThreads },
    showAskDoubtModal: { configurable: true, get: () => showAskDoubtModal },
    renderEmptyDetailHtml: { configurable: true, get: () => renderEmptyDetailHtml },
    sortTasks: { configurable: true, get: () => sortTasks },
    getTaskStats: { configurable: true, get: () => getTaskStats },
    isMemberOnline: { configurable: true, get: () => isMemberOnline },
    getMemberActivityText: { configurable: true, get: () => getMemberActivityText },
    syncSettingsFormState: { configurable: true, get: () => syncSettingsFormState },
    isSettingsDirty: { configurable: true, get: () => isSettingsDirty },
    updateSaveButtonState: { configurable: true, get: () => updateSaveButtonState },
    renderInvitePage: { configurable: true, get: () => renderInvitePage },
    renderRoute: { configurable: true, get: () => renderRoute },
    setRouteChrome: { configurable: true, get: () => setRouteChrome },
    escapeHtml: { configurable: true, get: () => escapeHtml },
    parseMarkdownToHtml: { configurable: true, get: () => parseMarkdownToHtml },
    renderMarkdown: { configurable: true, get: () => renderMarkdown },
    cleanAiLine: { configurable: true, get: () => cleanAiLine },
    stripAiLabel: { configurable: true, get: () => stripAiLabel },
    splitAiSections: { configurable: true, get: () => splitAiSections },
    parseQuizOutput: { configurable: true, get: () => parseQuizOutput },
    parseFlashcardsOutput: { configurable: true, get: () => parseFlashcardsOutput },
    buildAiStudySession: { configurable: true, get: () => buildAiStudySession },
    renderAiStudyOutput: { configurable: true, get: () => renderAiStudyOutput },
    renderStructuredAiOutput: { configurable: true, get: () => renderStructuredAiOutput },
    renderQuizSession: { configurable: true, get: () => renderQuizSession },
    renderFlashcardSession: { configurable: true, get: () => renderFlashcardSession },
    handleAiStudyOutputClick: { configurable: true, get: () => handleAiStudyOutputClick },
    uint8ToBase64: { configurable: true, get: () => uint8ToBase64 },
    base64ToUint8: { configurable: true, get: () => base64ToUint8 },
    setCollabStatus: { configurable: true, get: () => setCollabStatus },
    connectSocket: { configurable: true, get: () => connectSocket },
    disconnectSocket: { configurable: true, get: () => disconnectSocket },
    teardownYDoc: { configurable: true, get: () => teardownYDoc },
    setupYDoc: { configurable: true, get: () => setupYDoc },
    joinDocumentRoom: { configurable: true, get: () => joinDocumentRoom },
    joinedChannelWorkspaceId: { configurable: true, get: () => socketState.joinedChannelWorkspaceId, set: (value) => { socketState.joinedChannelWorkspaceId = value; } },
    joinedChannelId: { configurable: true, get: () => socketState.joinedChannelId, set: (value) => { socketState.joinedChannelId = value; } },
    joinChannelRoom: { configurable: true, get: () => joinChannelRoom },
    joinedWorkspacePresenceId: { configurable: true, get: () => socketState.joinedWorkspacePresenceId, set: (value) => { socketState.joinedWorkspacePresenceId = value; } },
    joinWorkspaceChat: { configurable: true, get: () => joinWorkspaceChat },
    publishChatTyping: { configurable: true, get: () => publishChatTyping },
    scheduleChatTypingStop: { configurable: true, get: () => scheduleChatTypingStop },
    publishCursor: { configurable: true, get: () => publishCursor },
    publishTyping: { configurable: true, get: () => publishTyping },
    applyEditorInputToYDoc: { configurable: true, get: () => applyEditorInputToYDoc },
    renderPresence: { configurable: true, get: () => renderPresence },
    loadWorkspaces: { configurable: true, get: () => loadWorkspaces },
    loadChannels: { configurable: true, get: () => loadChannels },
    loadMessages: { configurable: true, get: () => loadMessages },
    ensureChatReady: { configurable: true, get: () => ensureChatReady },
    loadChatMessages: { configurable: true, get: () => loadChatMessages },
    sendWorkspaceChatMessage: { configurable: true, get: () => sendWorkspaceChatMessage },
    getDocumentContextPath: { configurable: true, get: () => getDocumentContextPath },
    loadDocumentTasks: { configurable: true, get: () => loadDocumentTasks },
    loadDocumentMessages: { configurable: true, get: () => loadDocumentMessages },
    loadStudyMaterialsForDocument: { configurable: true, get: () => loadStudyMaterialsForDocument },
    upsertStudyMaterial: { configurable: true, get: () => upsertStudyMaterial },
    saveCurrentAiResultToLibrary: { configurable: true, get: () => saveCurrentAiResultToLibrary },
    updateStudyMaterialProgress: { configurable: true, get: () => updateStudyMaterialProgress },
    scheduleFlashcardProgressSave: { configurable: true, get: () => scheduleFlashcardProgressSave },
    openStudyMaterial: { configurable: true, get: () => openStudyMaterial },
    deleteStudyMaterial: { configurable: true, get: () => deleteStudyMaterial },
    backgroundDocumentBatch: { configurable: true, get: () => backgroundDocumentBatch },
    loadDashboardTasks: { configurable: true, get: () => loadDashboardTasks },
    loadWorkspaceThreads: { configurable: true, get: () => loadWorkspaceThreads },
    scheduleDashboardDataLoad: { configurable: true, get: () => scheduleDashboardDataLoad },
    loadDocuments: { configurable: true, get: () => loadDocuments },
    loadDocument: { configurable: true, get: () => loadDocument },
    saveCurrentDocument: { configurable: true, get: () => saveCurrentDocument },
    saveCurrentDocumentIfDirty: { configurable: true, get: () => saveCurrentDocumentIfDirty },
    clearActiveDocumentAfterDelete: { configurable: true, get: () => clearActiveDocumentAfterDelete },
    deleteDocumentById: { configurable: true, get: () => deleteDocumentById },
    createDocumentAndOpen: { configurable: true, get: () => createDocumentAndOpen },
    runStudyAiAction: { configurable: true, get: () => runStudyAiAction },
    saveAiOutputToDocument: { configurable: true, get: () => saveAiOutputToDocument },
    createAiOutputDocument: { configurable: true, get: () => createAiOutputDocument },
    scheduleAutosave: { configurable: true, get: () => scheduleAutosave },
    createDefaultChannel: { configurable: true, get: () => createDefaultChannel },
    createDefaultDocument: { configurable: true, get: () => createDefaultDocument },
    bootstrapWorkspace: { configurable: true, get: () => bootstrapWorkspace },
    renderToolPanel: { configurable: true, get: () => renderToolPanel },
    closeToolPanel: { configurable: true, get: () => closeToolPanel },
    renderWorkspacesTool: { configurable: true, get: () => renderWorkspacesTool },
    renderInviteResultTool: { configurable: true, get: () => renderInviteResultTool },
    renderJoinWorkspaceTool: { configurable: true, get: () => renderJoinWorkspaceTool },
    showInviteMemberModal: { configurable: true, get: () => showInviteMemberModal },
    previewInviteCredential: { configurable: true, get: () => previewInviteCredential },
    openJoinWorkspaceFlow: { configurable: true, get: () => openJoinWorkspaceFlow },
    acceptActiveInvite: { configurable: true, get: () => acceptActiveInvite },
    renderDashboardDocumentTool: { configurable: true, get: () => renderDashboardDocumentTool },
    renderDashboardTaskTool: { configurable: true, get: () => renderDashboardTaskTool },
    renderMembersTool: { configurable: true, get: () => renderMembersTool },
    renderProfileTool: { configurable: true, get: () => renderProfileTool },
    renderSearchTool: { configurable: true, get: () => renderSearchTool },
    renderChannelTool: { configurable: true, get: () => renderChannelTool },
    renderTrashTool: { configurable: true, get: () => renderTrashTool },
    renderCommentsTool: { configurable: true, get: () => renderCommentsTool },
    renderFilesTool: { configurable: true, get: () => renderFilesTool },
    renderVersionsTool: { configurable: true, get: () => renderVersionsTool },
    renderAuditTool: { configurable: true, get: () => renderAuditTool },
    openTool: { configurable: true, get: () => openTool },
    createTemplateDocument: { configurable: true, get: () => createTemplateDocument },
    handleEmptyStateAction: { configurable: true, get: () => handleEmptyStateAction },
    refreshToolView: { configurable: true, get: () => refreshToolView },
    handleToolPanelClick: { configurable: true, get: () => handleToolPanelClick },
    insertPlainTextAtCursor: { configurable: true, get: () => insertPlainTextAtCursor },
    init: { configurable: true, get: () => init },
    ensureActiveContextData: { configurable: true, get: () => ensureActiveContextData },
    collab: { configurable: true, get: () => collab },
    documentKey: { configurable: true, get: () => documentKey },
    isDemoMode: { configurable: true, get: () => isDemoMode },
    selectedChannel: { configurable: true, get: () => selectedChannel },
    selectedDocument: { configurable: true, get: () => selectedDocument },
    selectedWorkspace: { configurable: true, get: () => selectedWorkspace },
    setDocuments: { configurable: true, get: () => setDocuments },
    state: { configurable: true, get: () => state },
    upsertDocument: { configurable: true, get: () => upsertDocument }
  });
};

exposeLazyRouteShellBindings();

init();
