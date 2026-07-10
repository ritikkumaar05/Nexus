// import './styles/workspace.css';
import './styles/shared-shell.css';
import { createApiClient } from './services/api.js';
import { configureRouterRuntime, currentRoute, routeQuery, navigate, renderRoute } from './services/router.js';
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
import { uiState } from './state/uiState.js';
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
import {
  getEditorStudyStats,
  htmlToPlainText,
  sanitizeEditorHtml
} from './features/editor/content.js';
import {
  focusEditorTextRange,
  getEditorSelectionRange,
  getSelectedTextFromEditor
} from './features/editor/selection.js';
import { createEditorCommands } from './features/editor/commands.js';
import { createAiStudyOutput } from './features/ai/studyOutput.js';
import { configureChatFeatureRuntime } from './features/chat/featureRuntime.js';
import { createChatRuntime, searchState } from './features/chat/runtime.js';
import { createChatSession } from './features/chat/session.js';
import { createAccountSecurity } from './features/settings/accountSecurity.js';
import { settingsState } from './features/settings/state.js';
import { createSettingsRuntime, setSettingsRuntime } from './features/settings/runtime.js';
import { membersState } from './features/members/state.js';
import { createMembersRuntime, setMembersRuntime } from './features/members/runtime.js';
import { workspaceUiState } from './features/workspaces/state.js';
import { createTaskPanel } from './features/tasks/panel.js';
import { createThreadPanel } from './features/threads/panel.js';
import {
  demoAiResponse,
  demoRuntime,
  loadDemoWorkspaceModule,
  requireDemoWorkspaceModule
} from './features/demo/runtime.js';
import { createDemoSession } from './features/demo/session.js';
import {
  escapeHtml,
  formatChatTime,
  formatRelativeTime,
  friendlyUiMessage,
  getInitials,
  isValidSignupUsername,
  markdownFileName
} from './utils/text.js';

const API_BASE = localStorage.getItem('apiBase') || import.meta.env.VITE_API_BASE || 'http://localhost:5000';
const Y_TEXT_KEY = 'content';
let request;

let autosaveTimer = null;
let dashboardHydrationTimer = null;
let aiSelectionHintTimer = null;
let titleUiTimer = null;
let emailVerificationResendTimer = null;
let aiGenerationInFlight = false;
let flashcardProgressSaveTimer = null;
let documentCreateInFlight = false;
let workspaceCreateInFlight = false;
let activeDocumentOpenProfile = null;
let savedEditorRange = null;
let workspaceThreadsLoadSeq = 0;
let workspaceThreadsRequestKey = '';
let workspaceThreadsRequestPromise = null;
let workspaceThreadsLoadedKey = '';

let activeWorkspaceMenuId = '';
let activeWorkspaceRenameId = '';
let generatedInviteResult = null;
let activeDocumentLoadToken = 0;
const deletingDocumentIds = new Set();

const AUTOSAVE_DELAY_MS = 2800;
const CURSOR_PUBLISH_INTERVAL_MS = 300;
const TYPING_PUBLISH_INTERVAL_MS = 1000;
const CHAT_TYPING_PUBLISH_INTERVAL_MS = 1200;
const GENERAL_CHAT_CHANNEL = 'general';
const MAX_DOCUMENT_TEXT_CHARS = 200_000;
const MAX_DOCUMENT_TEXT_BYTES = 850_000;
const TASK_CACHE_TTL_MS = 45_000;

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

const clearInlineErrors = (form) => {
  form?.querySelectorAll('.field-error-text').forEach((node) => node.remove());
  form?.querySelectorAll('[aria-invalid="true"]').forEach((field) => field.removeAttribute('aria-invalid'));
};

const showInlineError = (field, message) => {
  if (!field) return;
  const container = field.closest('label, .form-field-v2, .workspace-create-field, .profile-input-field') || field.parentElement;
  field.setAttribute('aria-invalid', 'true');
  const error = document.createElement('span');
  error.className = 'field-error-text';
  error.textContent = message;
  container?.appendChild(error);
};

const focusFirstInvalid = (form) => {
  const invalid = form?.querySelector('[aria-invalid="true"], input:invalid, textarea:invalid, select:invalid');
  invalid?.focus?.();
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
  editorAutosaveIndicator: document.getElementById('editorAutosaveIndicator'),
  editorAttachmentInput: document.getElementById('editorAttachmentInput'),
  emptyActionBlank: document.getElementById('emptyActionBlank'),
  emptyActionPaste: document.getElementById('emptyActionPaste'),
  documentEditor: document.getElementById('documentEditor'),
  documentBreadcrumb: document.getElementById('documentBreadcrumb'),
  editorFloatingToolbar: document.getElementById('editorFloatingToolbar'),
  editorHeadingSelect: document.getElementById('editorHeadingSelect'),
  editorHighlightInput: document.getElementById('editorHighlightInput'),
  editorImageInput: document.getElementById('editorImageInput'),
  editorLastEdited: document.getElementById('editorLastEdited'),
  editorReadingProgress: document.getElementById('editorReadingProgress'),
  editorReadingTime: document.getElementById('editorReadingTime'),
  editorTextColorInput: document.getElementById('editorTextColorInput'),
  editorWordCount: document.getElementById('editorWordCount'),
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
  const value = String(text || '');
  if (!value) {
    showToast('Nothing to copy', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    showToast(successMessage);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    showToast(copied ? successMessage : value, !copied);
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
  if (els.editorAutosaveIndicator) {
    els.editorAutosaveIndicator.textContent = message || 'Saved';
    els.editorAutosaveIndicator.dataset.saveState = status;
  }
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
    min: 340,
    max: 440,
    defaultWidth: 380,
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
    let dragMax = config.max;
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
      dragMax = config.max;
    };

    const applyPendingWidth = () => {
      frame = 0;
      setPanelWidth(config, pendingWidth);
    };

    function onPointerMove(event) {
      if (startLayoutRect && panelKey === 'documents') {
        pendingWidth = clamp(event.clientX - startLayoutRect.left, config.min, dragMax);
      } else if (startLayoutRect && panelKey === 'ai') {
        pendingWidth = clamp(startLayoutRect.right - event.clientX, config.min, dragMax);
      } else {
        pendingWidth = clamp(startWidth + ((event.clientX - startX) * config.direction), config.min, dragMax);
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
      dragMax = safePanelMax(panelKey);
      pendingWidth = startWidth;
      document.body.classList.add('is-resizing-panels');
      handle.classList.add('active');
      handle.setAttribute('aria-valuemin', String(config.min));
      handle.setAttribute('aria-valuemax', String(dragMax));
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
  const themeSetting = localStorage.getItem('theme') || state.preferences?.theme || 'light';
  
  // Apply theme to document element
  document.documentElement.dataset.theme = themeSetting;
  document.documentElement.classList.toggle('light', themeSetting === 'light');
  document.documentElement.classList.toggle('dark', themeSetting === 'dark');
  if (themeSetting === 'system') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('light', !isDark);
    document.documentElement.classList.toggle('dark', isDark);
  }

  // Apply to body for legacy CSS support
  document.body.dataset.theme = themeSetting;
  document.body.classList.toggle('light', themeSetting === 'light');
  document.body.classList.toggle('dark', themeSetting === 'dark');
  if (themeSetting === 'system') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.classList.toggle('light', !isDark);
    document.body.classList.toggle('dark', isDark);
  }

  document.body.dataset.density = state.preferences?.density || 'comfortable';
  document.body.classList.toggle('reduce-motion', Boolean(state.preferences?.reduceMotion));
  
  // Don't collapse sidebar if we're on the Documents workspace
  if (!document.body.classList.contains('document-workspace-screen')) {
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    document.body.classList.toggle('sidebar-collapsed', isCollapsed);
  }
};

const toggleTheme = () => {
  const current = localStorage.getItem('theme') || state.preferences?.theme || 'light';
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
  localStorage.setItem('theme', newTheme);
  persistPreferences();
  applyPreferences();
  showToast(`Theme changed to ${newTheme}`);
};

const saveSession = ({ token, user, csrfToken }) => {
  state.token = token;
  state.user = user;
  state.csrfToken = csrfToken || state.csrfToken || '';
  localStorage.setItem('user', JSON.stringify(user));
  if (state.csrfToken) localStorage.setItem('csrfToken', state.csrfToken);
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
};

({ request } = createApiClient({
  apiBase: API_BASE,
  getToken: () => state.token,
  getCsrfToken: () => state.csrfToken,
  onRefresh: saveSession
}));

const clearSession = () => {
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
  resetTaskStore();
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

const selectedDocumentTitle = () => selectedDocument()?.title || els.documentTitleInput?.value || 'Untitled lecture';

/* ─────────────────────────────────────────────────────────────────────────
   LEARNING MILESTONE PERSISTENCE
   The backend Document schema has no learningMilestones field, so all
   milestone data lives only in memory and is lost on page refresh.
   We persist to localStorage keyed by documentId so progress survives
   browser restarts without any backend changes.
   ─────────────────────────────────────────────────────────────────────── */
const MILESTONES_STORE_KEY = 'nexus_learning_milestones';

/** Load the full milestone map from localStorage. Shape: { [docId]: { [key]: true } } */
const loadAllMilestones = () => {
  try {
    const raw = localStorage.getItem(MILESTONES_STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
};

/** Persist a single document's milestone flags into the store. */
const saveMilestonesForDoc = (docId, flags = {}) => {
  if (!docId) return;
  try {
    const all = loadAllMilestones();
    all[String(docId)] = { ...(all[String(docId)] || {}), ...flags };
    localStorage.setItem(MILESTONES_STORE_KEY, JSON.stringify(all));
  } catch { /* quota — ignore */ }
};

/** Read persisted milestone flags for a single document. */
const loadMilestonesForDoc = (docId) => {
  if (!docId) return {};
  try { return loadAllMilestones()[String(docId)] || {}; } catch { return {}; }
};

const LECTURE_PROGRESS_MILESTONES = [
  { key: 'created',           label: 'Lecture created',               weight: 5  },
  { key: 'notesAdded',        label: 'Notes/content added',           weight: 15 },
  { key: 'aiExplanation',     label: 'AI explanation used',           weight: 10 },
  { key: 'summaryGenerated',  label: 'Lecture summary generated',     weight: 10 },
  { key: 'flashcardsGenerated', label: 'Flashcards generated',        weight: 15 },
  { key: 'quizGenerated',     label: 'Quiz generated',                weight: 15 },
  { key: 'revisionGenerated', label: 'Revision questions generated',  weight: 10 },
  { key: 'doubtResolved',     label: 'Doubt created and resolved',    weight: 10 },
  { key: 'taskCreated',       label: 'Study task created',            weight: 10 },
  { key: 'allTasksCompleted', label: 'All linked tasks completed',    weight: 10 }
];

const taskDocumentId = (task = {}) => String(task.documentId || task.document || task.docId || task.pageId || state.selectedDocumentId || '');

const taskId = (task = {}) => String(task?._id || task?.id || '');

const taskDocumentTitle = (task = {}) => {
  if (task.documentTitle) return task.documentTitle;
  const docId = taskDocumentId(task);
  return state.documents.find((doc) => documentKey(doc) === docId)?.title || 'Note';
};

const normalizeTask = (task = {}) => {
  const id = taskId(task);
  if (!id) return null;
  const documentId = taskDocumentId(task);
  return {
    ...task,
    _id: id,
    documentId,
    documentTitle: taskDocumentTitle({ ...task, documentId }),
    status: task.status || 'todo',
    priority: task.priority || 'medium'
  };
};

const workspaceTaskList = () => state.taskStore.ids
  .map((id) => state.taskStore.byId[id])
  .filter(Boolean);

const syncLegacyTaskViews = () => {
  const tasks = workspaceTaskList();
  state.dashboardTasks = tasks;
  state.documentTasks = state.selectedDocumentId
    ? tasks.filter((task) => taskDocumentId(task) === String(state.selectedDocumentId))
    : [];
  return tasks;
};

const setWorkspaceTasks = (tasks = [], { workspaceId = state.selectedWorkspaceId } = {}) => {
  const byId = {};
  const ids = [];
  tasks.forEach((task) => {
    const normalized = normalizeTask(task);
    if (!normalized || byId[normalized._id]) return;
    byId[normalized._id] = normalized;
    ids.push(normalized._id);
  });
  state.taskStore.byId = byId;
  state.taskStore.ids = ids;
  state.taskStore.loadedWorkspaceId = workspaceId || '';
  state.taskStore.loadedAt = Date.now();
  state.taskStore.error = '';
  return syncLegacyTaskViews();
};

const resetTaskStore = () => {
  state.taskStore.byId = {};
  state.taskStore.ids = [];
  state.taskStore.loadedWorkspaceId = '';
  state.taskStore.loading = false;
  state.taskStore.loadedAt = 0;
  state.taskStore.error = '';
  state.documentTasks = [];
  state.dashboardTasks = [];
};

const upsertTaskInStore = (task = {}) => {
  const normalized = normalizeTask(task);
  if (!normalized) return null;
  state.taskStore.byId[normalized._id] = {
    ...(state.taskStore.byId[normalized._id] || {}),
    ...normalized
  };
  if (!state.taskStore.ids.includes(normalized._id)) {
    state.taskStore.ids.unshift(normalized._id);
  }
  state.taskStore.loadedWorkspaceId = state.selectedWorkspaceId || state.taskStore.loadedWorkspaceId;
  state.taskStore.loadedAt = Date.now();
  syncLegacyTaskViews();
  return state.taskStore.byId[normalized._id];
};

const removeTaskFromStore = (taskIdValue) => {
  const id = String(taskIdValue || '');
  if (!id) return;
  delete state.taskStore.byId[id];
  state.taskStore.ids = state.taskStore.ids.filter((item) => item !== id);
  state.taskStore.loadedWorkspaceId = state.selectedWorkspaceId || state.taskStore.loadedWorkspaceId;
  state.taskStore.loadedAt = Date.now();
  syncLegacyTaskViews();
};

const selectedDocumentTasks = () => workspaceTaskList()
  .filter((task) => taskDocumentId(task) === String(state.selectedDocumentId || ''));

// FIX: removed the state.selectedDocumentId fallback from threadDocumentId.
// Using it caused threads with no documentId to be attributed to whatever
// document happened to be open, polluting the wrong lecture's progress.
const threadDocumentId = (thread = {}) => String(thread.documentId || thread.document || thread.docId || '');

const materialDocumentId = (material = {}) => String(material.documentId || material.document || material.docId || '');

const allKnownTasks = () => {
  const storeTasks = workspaceTaskList();
  if (storeTasks.length || state.taskStore.loadedWorkspaceId === state.selectedWorkspaceId) return storeTasks;
  const seen = new Set();
  return [...state.dashboardTasks, ...state.documentTasks].filter((task) => {
    const key = String(task._id || task.id || `${taskDocumentId(task)}:${task.title}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const allKnownThreads = () => {
  const seen = new Set();
  return [...state.workspaceThreads, ...state.documentMessages].filter((thread) => {
    const key = String(thread._id || thread.id || `${threadDocumentId(thread)}:${thread.body}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const allKnownStudyMaterials = () => {
  const seen = new Set();
  return [...state.demoStudyMaterials, ...state.studyMaterials].filter((material) => {
    const key = String(material._id || material.id || `${materialDocumentId(material)}:${material.type}:${material.title}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const studyMaterialMatchesAction = (material = {}, actions = []) => {
  const type = String(material.type || material.materialType || '').toLowerCase();
  const action = String(material.action || material.aiAction || material.sourceAction || '').toLowerCase();
  const title = String(material.title || '').toLowerCase();
  return actions.some((value) => type === value || action === value || title.includes(value.replace(/_/g, ' ')));
};

const lectureMilestoneFlags = (doc = selectedDocument()) => {
  const docId = String(doc?._id || '');
  // Merge in-memory flags with the persisted localStorage flags so progress
  // survives page refreshes (backend Document schema has no milestones field).
  const inMemory = doc?.learningMilestones || {};
  const persisted = loadMilestonesForDoc(docId);
  const stored = { ...persisted, ...inMemory };

  // Use live editor text only for the currently open document.
  const text = String(doc?.plainTextContent || (docId === String(state.selectedDocumentId) ? getEditorText() : '') || '').trim();
  const tasks = allKnownTasks().filter((task) => taskDocumentId(task) === docId);
  const threads = allKnownThreads().filter((thread) => threadDocumentId(thread) === docId);
  const materials = allKnownStudyMaterials().filter((material) => materialDocumentId(material) === docId);

  // FIX: raised notesAdded threshold from 40 to 200 characters.
  // 40 chars is a single sentence; 200 chars represents a real paragraph of notes.
  const NOTES_THRESHOLD = 200;

  return {
    created:            Boolean(docId),
    notesAdded:         Boolean(stored.notesAdded)        || text.length >= NOTES_THRESHOLD,
    aiExplanation:      Boolean(stored.aiExplanation)     || materials.some((m) => studyMaterialMatchesAction(m, ['explanation', 'simple-explanation'])),
    summaryGenerated:   Boolean(stored.summaryGenerated)  || materials.some((m) => studyMaterialMatchesAction(m, ['summary', 'summarize'])),
    flashcardsGenerated:Boolean(stored.flashcardsGenerated)||materials.some((m) => studyMaterialMatchesAction(m, ['flashcards'])),
    quizGenerated:      Boolean(stored.quizGenerated)     || materials.some((m) => studyMaterialMatchesAction(m, ['quiz'])),
    revisionGenerated:  Boolean(stored.revisionGenerated) || materials.some((m) => studyMaterialMatchesAction(m, ['important_questions', 'important-questions'])),
    doubtResolved:      Boolean(stored.doubtResolved)     || threads.some((thread) => thread.status === 'resolved'),
    taskCreated:        Boolean(stored.taskCreated)       || tasks.length > 0,
    allTasksCompleted:  Boolean(stored.allTasksCompleted) || (tasks.length > 0 && tasks.every((task) => task.status === 'done'))
  };
};

const calculateLectureLearningProgress = (doc = selectedDocument()) => {
  const flags = lectureMilestoneFlags(doc);
  const milestones = LECTURE_PROGRESS_MILESTONES.map((milestone) => ({
    ...milestone,
    complete: Boolean(flags[milestone.key])
  }));
  const score = milestones.reduce((sum, milestone) => sum + (milestone.complete ? milestone.weight : 0), 0);
  return { score: Math.min(100, score), milestones };
};

const setLectureProgressSnapshot = (docId = state.selectedDocumentId) => {
  const doc = state.documents.find((item) => documentKey(item) === String(docId));
  if (!doc) return null;
  const progress = calculateLectureLearningProgress(doc);
  doc.progress = progress.score;
  doc.learningProgress = progress;
  return progress;
};

const markLectureMilestone = (docId, milestoneKey, { message = '', show = true } = {}) => {
  const doc = state.documents.find((item) => documentKey(item) === String(docId || state.selectedDocumentId));
  if (!doc || !milestoneKey) return null;
  const before = calculateLectureLearningProgress(doc).score;
  const newFlags = { [milestoneKey]: true };
  doc.learningMilestones = { ...(doc.learningMilestones || {}), ...newFlags };
  // Persist so progress survives page refreshes (backend has no milestones field)
  saveMilestonesForDoc(doc._id, newFlags);
  const progress = setLectureProgressSnapshot(doc._id);
  if (show && progress && progress.score > before) {
    const readyForRevision = progress.score >= 90 && before < 90;
    showToast(readyForRevision
      ? `${doc.category || doc.title || 'This lecture'} is ready for final revision (${progress.score}%).`
      : `${message || 'Lecture progress updated'} — Revision progress is now ${progress.score}%.`);
  }
  return progress;
};

const refreshLectureProgress = (docId = state.selectedDocumentId, { message = '', show = false } = {}) => {
  const doc = state.documents.find((item) => documentKey(item) === String(docId));
  if (!doc) return null;
  const before = Number(doc.progress || 0);
  const progress = setLectureProgressSnapshot(doc._id);
  if (show && progress && progress.score > before) {
    const readyForRevision = progress.score >= 90 && before < 90;
    showToast(readyForRevision
      ? `${doc.category || doc.title || 'This lecture'} is ready for final revision (${progress.score}%).`
      : `${message || 'Lecture progress updated'} — Revision progress is now ${progress.score}%.`);
  }
  return progress;
};

/* ─────────────────────────────────────────────────────────────────────────
   STREAK ENGINE
   Persists { count, longestStreak, lastActiveDate } in localStorage.

   Rules:
     • A "study day" = any day the user performs a real learning action
       (edit, AI, task, doubt, lecture creation).  This is tracked by
       calling updateStreak() inside addActivity().
     • On load: if lastActiveDate was TODAY → streak already counted for today.
     • On load: if lastActiveDate was YESTERDAY → streak is still alive.
     • On load: if gap > 1 day → streak resets to 0 (broken).
     • Demo mode always returns a fixed demo streak (5 days).
   ─────────────────────────────────────────────────────────────────────── */
const STREAK_KEY = 'nexus_study_streak';

/** Return today's date as a UTC YYYY-MM-DD string (timezone-safe comparison). */
const todayDateStr = () => new Date().toISOString().slice(0, 10);

/** Diff in whole calendar days between two YYYY-MM-DD strings. */
const daysBetween = (a, b) => {
  const msPerDay = 86_400_000;
  return Math.round((new Date(b) - new Date(a)) / msPerDay);
};

/**
 * Read the persisted streak record.
 * Returns { count, longestStreak, lastActiveDate, activeToday }
 */
const readStreakRecord = () => {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (!raw) return { count: 0, longestStreak: 0, lastActiveDate: null, activeToday: false };
    const rec = JSON.parse(raw);
    return {
      count: Number(rec.count) || 0,
      longestStreak: Number(rec.longestStreak) || 0,
      lastActiveDate: rec.lastActiveDate || null,
      activeToday: rec.lastActiveDate === todayDateStr()
    };
  } catch {
    return { count: 0, longestStreak: 0, lastActiveDate: null, activeToday: false };
  }
};

/**
 * Write a streak record to localStorage.
 */
const writeStreakRecord = (rec) => {
  try { localStorage.setItem(STREAK_KEY, JSON.stringify(rec)); } catch { /* quota error — ignore */ }
};

/**
 * Call on each real learning action (hooked into addActivity).
 * Increments streak for today if not yet counted; resets if gap > 1 day.
 * Returns the updated record.
 */
const updateStreak = () => {
  if (state.demoMode) return; // demo mode uses fixed values
  const today = todayDateStr();
  const rec = readStreakRecord();

  if (rec.lastActiveDate === today) {
    // Already counted today — nothing to change
    return rec;
  }

  let newCount;
  if (!rec.lastActiveDate) {
    // First ever activity
    newCount = 1;
  } else {
    const gap = daysBetween(rec.lastActiveDate, today);
    if (gap === 1) {
      // Consecutive day — extend streak
      newCount = rec.count + 1;
    } else {
      // Gap > 1 day — streak broken, start fresh
      newCount = 1;
    }
  }

  const newRecord = {
    count: newCount,
    longestStreak: Math.max(newCount, rec.longestStreak || 0),
    lastActiveDate: today,
    activeToday: true
  };
  writeStreakRecord(newRecord);
  return newRecord;
};

/**
 * Read current streak, applying expiry logic:
 *   - If lastActiveDate is today or yesterday → streak is valid.
 *   - If gap > 1 day → streak is 0 (broken, but we don't overwrite storage
 *     until the user acts again).
 * This way the UI always shows the correct live streak on page load.
 */
const computeStudyStreak = () => {
  if (state.demoMode) return { currentStreak: 5, longestStreak: 12, activeToday: true };
  const today = todayDateStr();
  const rec = readStreakRecord();
  if (!rec.lastActiveDate) return { currentStreak: 0, longestStreak: 0, activeToday: false };

  const gap = daysBetween(rec.lastActiveDate, today);
  if (gap === 0) {
    // User already did something today
    return { currentStreak: rec.count, longestStreak: rec.longestStreak, activeToday: true };
  } else if (gap === 1) {
    // Yesterday was the last active day — streak still alive, awaiting today's action
    return { currentStreak: rec.count, longestStreak: rec.longestStreak, activeToday: false };
  } else {
    // Gap > 1 day — streak is broken
    return { currentStreak: 0, longestStreak: rec.longestStreak, activeToday: false };
  }
};

const calculateWorkspaceLearningProgress = () => {
  const lectures = state.documents.map((doc) => {
    const progress = calculateLectureLearningProgress(doc);
    doc.progress = progress.score;
    doc.learningProgress = progress;
    return { ...doc, learningProgress: progress, progress: progress.score };
  });
  const totalLectures = lectures.length;

  // FIX: Only include lectures that have some real content (progress > 5%)
  // in the workspace average. Newly created empty lectures only have
  // created=true (5%), so including them drags the overall score down
  // even though the user hasn't started them yet.
  const activeLectures = lectures.filter((doc) => doc.progress > 5);
  const overallProgress = activeLectures.length
    ? Math.round(activeLectures.reduce((sum, doc) => sum + doc.progress, 0) / activeLectures.length)
    : 0;

  const tasks = allKnownTasks();
  const completedTasks = tasks.filter((task) => task.status === 'done').length;
  const pendingTasks = tasks.filter((task) => task.status !== 'done').length;
  const courseProgress = Object.entries(lectures.reduce((groups, lecture) => {
    const course = lecture.category || lecture.title?.split(':')[0]?.trim() || 'Notes';
    groups[course] = [...(groups[course] || []), lecture.progress];
    return groups;
  }, {})).map(([course, values]) => ({
    course,
    progress: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  }));

  const streak = computeStudyStreak();

  return {
    overallProgress,
    totalLectures,
    masteredLectures: lectures.filter((doc) => doc.progress >= 90).length,
    inProgressLectures: lectures.filter((doc) => doc.progress >= 30 && doc.progress < 90).length,
    notStartedLectures: lectures.filter((doc) => doc.progress < 30).length,
    completedTasks,
    pendingTasks,
    studyStreak: streak.currentStreak,
    longestStreak: streak.longestStreak,
    streakActiveToday: streak.activeToday,
    lectures,
    courseProgress
  };
};

const {
  hydrateDemoWorkspace,
  loadDemoDocument,
  enterDemoMode,
  exitDemoMode,
  saveDemoDocument,
  createDemoDocument
} = createDemoSession({
  GENERAL_CHAT_CHANNEL,
  state,
  els,
  requireDemoWorkspaceModule,
  loadDemoWorkspaceModule,
  disconnectSocket,
  teardownYDoc,
  setDocuments,
  setWorkspaceTasks,
  resetTaskStore,
  setEditorHtml: (...args) => setEditorHtml(...args),
  setEditorText: (...args) => setEditorText(...args),
  getEditorText: (...args) => getEditorText(...args),
  getEditorHtml: (...args) => getEditorHtml(...args),
  selectedDocument,
  setAutosaveStatus,
  setCollabStatus: (...args) => setCollabStatus(...args),
  renderAiEmptyState: (...args) => renderAiEmptyState(...args),
  renderPresence: (...args) => renderPresence(...args),
  render: (...args) => render(...args),
  showToast,
  navigate,
  upsertDocument,
  addActivity: (...args) => addActivity(...args),
  markLectureMilestone,
  refreshLectureProgress
});

const setRouteChrome = (route) => {
  document.querySelectorAll('[data-route-link]').forEach((link) => {
    link.classList.toggle('active', link.dataset.routeLink === route);
  });
};

const normalizeContextTab = (tab = 'ai') => ({
  discussion: 'threads',
  thread: 'threads',
  activity: 'ai',
  progress: 'ai'
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

const focusNexusMentor = () => {
  activateContextTab('ai');
  window.setTimeout(() => {
    const input = document.getElementById('aiPromptInput');
    input?.focus();
    input?.select?.();
  }, 0);
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
  uiState.selectedCommandIndex = 0;
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
    .filter((doc) => !query || (doc.title || 'Untitled Lecture').toLowerCase().includes(query))
    .slice(0, 5)
    .map((doc) => ({
      type: 'Lecture',
      label: doc.title || 'Untitled Lecture',
      subtitle: doc.updatedAt ? `Last studied ${formatRelativeTime(doc.updatedAt)}` : 'Workspace lecture',
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
    { type: 'Action', label: 'Create new lecture', subtitle: 'Start a living lecture in this workspace', action: 'Run', attrs: 'data-command-action="new-document"' },
    { type: 'Action', label: 'Toggle focus mode', subtitle: 'Distraction-free learning environment', action: 'Run', attrs: 'data-command-action="focus"' },
    { type: 'Action', label: 'Open tutor panel', subtitle: 'Summaries, quizzes, flashcards, and explanations', action: 'Run', attrs: 'data-command-action="ai"' }
  ].filter((item) => !query || item.label.toLowerCase().includes(query));

  const items = [...docMatches, ...channelMatches, ...actions];
  
  if (uiState.selectedCommandIndex >= items.length) {
    uiState.selectedCommandIndex = 0;
  }
  if (uiState.selectedCommandIndex < 0) {
    uiState.selectedCommandIndex = Math.max(0, items.length - 1);
  }

  if (items.length === 0) {
    els.commandResults.innerHTML = `
      <div class="command-empty-state">
        <span class="empty-icon-bubble">⌕</span>
        <h3>No results found</h3>
        <p>Try searching for a lecture title, doubt, channel name, or action keyword.</p>
        <div class="command-empty-quick-actions">
          <button class="quick-action-btn" data-command-action="new-document" type="button">
            <span>Create new lecture</span>
            <kbd>↵</kbd>
          </button>
          <button class="quick-action-btn" data-command-action="ai" type="button">
            <span>Ask tutor</span>
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
    if (item.type === 'Lecture' || item.type === 'Document') groupName = 'Lectures';
    else if (item.type === 'Discussion') groupName = 'Discussions';
    else if (item.type === 'Action') groupName = 'Actions';

    if (groupName !== lastGroup) {
      html += `<div class="command-group-title">${groupName}</div>`;
      lastGroup = groupName;
    }

    const isSelected = index === uiState.selectedCommandIndex;
    const selectedClass = isSelected ? 'selected' : '';
    
    let iconSvg = '';
    if (item.type === 'Lecture' || item.type === 'Document') {
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
  const active = document.body.classList.contains('focus-mode');
  els.focusModeBtn.textContent = active ? 'Exit focus' : 'Focus';
  els.focusModeBtn.setAttribute('aria-label', active ? 'Exit focus mode' : 'Focus mode');
  els.focusModeBtn.title = active ? 'Exit focus mode' : 'Focus mode';
  const toolbarFocusBtn = document.getElementById('focusModeToolbarBtn');
  if (toolbarFocusBtn) toolbarFocusBtn.textContent = active ? 'Exit' : 'Focus';
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
  if (key === 'threads' && currentRoute() === 'threads' && document.querySelector('.threads-page')) return renderThreadsPage();
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

const editorUsesRichContent = () => Boolean(els.documentEditor && els.documentEditor.tagName !== 'TEXTAREA');

const getEditorText = () => {
  if (!els.documentEditor) return '';
  return editorUsesRichContent() ? (els.documentEditor.innerText || '') : (els.documentEditor.value || '');
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

const getEditorHtml = () => {
  if (!els.documentEditor) return '';
  return editorUsesRichContent() ? sanitizeEditorHtml(els.documentEditor.innerHTML || '') : '';
};

const setEditorText = (value = '') => {
  if (!els.documentEditor) return;
  const nextValue = String(value);
  if (!editorUsesRichContent()) {
    els.documentEditor.value = nextValue;
    updateEditorEmptyState();
    updateEditorStudyStats();
    return;
  }
  if (els.documentEditor.innerText === nextValue) {
    updateEditorEmptyState();
    updateEditorStudyStats();
    return;
  }
  const escaped = escapeHtml(nextValue)
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br>') || '<br>'}</p>`)
    .join('');
  els.documentEditor.innerHTML = nextValue.trim() ? escaped : '';
  updateEditorEmptyState();
  updateEditorStudyStats();
};

const setEditorHtml = (html = '', fallbackText = '') => {
  if (!els.documentEditor || !editorUsesRichContent()) {
    setEditorText(fallbackText || htmlToPlainText(html));
    return;
  }
  const sanitized = sanitizeEditorHtml(html);
  if (sanitized.trim()) {
    els.documentEditor.innerHTML = sanitized;
  } else if (/<\/?(span|mark|u|strong|em|s|h1|h2|h3|blockquote|pre|table|div|a)\b/i.test(fallbackText || '')) {
    els.documentEditor.innerHTML = sanitizeEditorHtml(fallbackText);
  } else {
    setEditorText(fallbackText || htmlToPlainText(html));
    return;
  }
  updateEditorEmptyState();
  updateEditorStudyStats();
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
  return getEditorSelectionRange(els.documentEditor, getEditorText().length);
};

const getSelectedEditorText = () => {
  return getSelectedTextFromEditor(els.documentEditor);
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
  aiSelectionHintTimer = window.setTimeout(() => {
    updateAiSelectionHint();
    updateFloatingSelectionToolbar();
  }, 80);
};

const editorSelectionRange = () => {
  const { start, end } = getEditorSelection();
  return {
    start: Math.min(start, end),
    end: Math.max(start, end)
  };
};

const focusEditorRange = (start, end = start) => {
  focusEditorTextRange(els.documentEditor, start, end);
};

const replaceEditorRange = (start, end, replacement, { selectInserted = false } = {}) => {
  const value = getEditorText();
  const nextValue = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
  setEditorText(nextValue);
  const nextStart = start;
  const nextEnd = start + replacement.length;
  applyEditorInputToYDoc();
  publishCursor();
  scheduleAutosave();
  updateEditorEmptyState();
  updateEditorStudyStats();
  focusEditorRange(selectInserted ? nextStart : nextEnd, selectInserted ? nextEnd : nextEnd);
};

const selectedOrPlaceholder = (placeholder = 'selected text') => {
  const selected = getSelectedEditorText();
  return selected || placeholder;
};

const saveEditorSelection = () => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !els.documentEditor?.contains(selection.anchorNode)) return;
  const newRange = selection.getRangeAt(0);
  if (document.activeElement !== els.documentEditor) {
    if (savedEditorRange && !savedEditorRange.collapsed && newRange.collapsed) {
      return;
    }
  }
  savedEditorRange = newRange.cloneRange();
};

const restoreEditorSelection = () => {
  if (!savedEditorRange || !els.documentEditor) return false;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedEditorRange);
  els.documentEditor.focus();
  return true;
};

const commitRichEditorChange = () => {
  if (!els.documentEditor) return;
  els.documentEditor.innerHTML = sanitizeEditorHtml(els.documentEditor.innerHTML);
  applyEditorInputToYDoc();
  publishCursor();
  publishTyping();
  scheduleAutosave();
  updateEditorEmptyState();
  updateEditorStudyStats();
  saveEditorSelection();
};

const updateEditorStudyStats = () => {
  const text = getEditorText();
  const scrollContainer = document.querySelector('.editor-pane') || els.documentEditor;
  const { words, readTime, progress } = getEditorStudyStats({
    text,
    scrollHeight: scrollContainer?.scrollHeight || 0,
    clientHeight: scrollContainer?.clientHeight || 0,
    scrollTop: scrollContainer?.scrollTop || 0
  });
  if (els.editorWordCount) els.editorWordCount.textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
  if (els.editorReadingTime) els.editorReadingTime.textContent = `${readTime} min read`;
  if (els.editorReadingProgress) els.editorReadingProgress.textContent = `${progress}% read`;
  if (els.editorLastEdited) {
    const doc = selectedDocument();
    els.editorLastEdited.textContent = doc?.updatedAt ? `Edited ${formatRelativeTime(doc.updatedAt)}` : 'Not edited';
  }
};

const updateFloatingSelectionToolbar = () => {
  if (!els.editorFloatingToolbar || !els.documentEditor) return;
  const selectedText = getSelectedEditorText();
  const selection = window.getSelection();
  if (!selectedText || !selection?.rangeCount || !els.documentEditor.contains(selection.anchorNode)) {
    els.editorFloatingToolbar.classList.add('hidden');
    return;
  }
  const selectionRect = selection.getRangeAt(0).getBoundingClientRect();
  const editorRect = els.documentEditor.getBoundingClientRect();
  const toolbar = els.editorFloatingToolbar;
  toolbar.classList.remove('hidden');
  const top = Math.max(12, (selectionRect.top || editorRect.top) - 48);
  const left = Math.min(window.innerWidth - 12, Math.max(12, (selectionRect.left || editorRect.left) + ((selectionRect.width || editorRect.width) / 2)));
  toolbar.style.top = `${top}px`;
  toolbar.style.left = `${left}px`;
};

const {
  bindEditorCommandHandlers,
  handleEditorCommand,
  handleSelectionToolbarAction,
  insertRichHtml
} = createEditorCommands({
  els,
  state,
  selectedDocument,
  selectedOrPlaceholder,
  restoreEditorSelection,
  getSelectedEditorText,
  sanitizeEditorHtml,
  commitRichEditorChange,
  escapeHtml,
  updateEditorStudyStats,
  scheduleAutosave: (...args) => scheduleAutosave(...args),
  updateAiSelectionHint,
  activateContextTab,
  renderMessageFormContext: (...args) => renderMessageFormContext(...args),
  showAskDoubtModal,
  showToast,
  runStudyAiAction: (...args) => runStudyAiAction(...args),
  toggleFocusMode,
  saveEditorSelection,
  markdownFileName
});

const aiActionLabel = (action = '') => ({
  summarize: 'Summary',
  quiz: 'Quiz',
  flashcards: 'Flashcards',
  'simple-explanation': 'Simple Explanation',
  'important-questions': 'Revision Questions'
}[action] || 'Study Material');

const aiLoadingCopy = (action = 'summarize') => ({
  summarize: {
    title: 'Building your personalized summary...',
    steps: ['Reading this lecture', 'Finding the main ideas', 'Connecting related concepts']
  },
  quiz: {
    title: 'Preparing revision questions...',
    steps: ['Reading this lecture', 'Choosing exam-worthy concepts', 'Checking for clear answers']
  },
  flashcards: {
    title: 'Creating flashcards from key concepts...',
    steps: ['Finding definitions and contrasts', 'Keeping cards focused', 'Preparing quick revision prompts']
  },
  'simple-explanation': {
    title: 'Explaining this from the ground up...',
    steps: ['Understanding today\'s topic', 'Finding prerequisites', 'Removing unnecessary jargon']
  },
  'important-questions': {
    title: 'Preparing revision questions...',
    steps: ['Finding likely exam areas', 'Connecting related concepts', 'Turning weak spots into questions']
  }
}[action] || {
  title: 'Preparing your study material...',
  steps: ['Reading this lecture', 'Checking learning context', 'Building a focused response']
});

const aiEvidenceItems = () => [
  selectedAiSource() === 'selection' ? 'Selected text' : 'Current lecture',
  state.studyMaterials?.length ? 'Saved study material' : '',
  state.activityItems?.length ? 'Recent learning activity' : ''
].filter(Boolean).slice(0, 3);

const renderAiEvidence = () => {
  const items = aiEvidenceItems();
  if (!items.length) return '';
  return `
    <div class="study-context-evidence" aria-label="Context used by Nexus Mentor">
      <span>Based on</span>
      ${items.map((item) => `<strong>${escapeHtml(item)}</strong>`).join('')}
    </div>
  `;
};

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

const {
  cleanAiLine,
  stripAiLabel,
  splitAiSections,
  buildAiStudySession,
  renderAiStudyOutput,
  renderStructuredAiOutput,
  handleAiStudyOutputClick
} = createAiStudyOutput({
  state,
  els,
  escapeHtml,
  renderMarkdown: (...args) => renderMarkdown(...args),
  renderAiEvidence,
  aiActionLabel,
  selectedAiSource,
  updateLibrarySaveButton: (...args) => updateLibrarySaveButton(...args),
  updateStudyMaterialProgress: (...args) => updateStudyMaterialProgress(...args),
  getQuizProgressFromSession: (...args) => getQuizProgressFromSession(...args),
  scheduleFlashcardProgressSave: (...args) => scheduleFlashcardProgressSave(...args),
  showToast
});

const setAiOutput = (action, output, structured = null) => {
  state.lastAiAction = action;
  state.lastAiOutput = output;
  state.aiStructuredOutput = structured;
  state.aiStudySession = buildAiStudySession(action, output, structured);
  state.currentAiResultSavedId = '';
  const milestoneKey = {
    summarize: 'summaryGenerated',
    'simple-explanation': 'aiExplanation',
    explain: 'aiExplanation',
    flashcards: 'flashcardsGenerated',
    quiz: 'quizGenerated',
    'important-questions': 'revisionGenerated'
  }[action];
  if (milestoneKey && state.selectedDocumentId) {
    markLectureMilestone(state.selectedDocumentId, milestoneKey, {
      message: `${aiActionLabel(action)} generated`
    });
  }
  renderAiStudyOutput();
};

const updateLibrarySaveButton = () => {
  const hasOutput = Boolean(state.lastAiOutput.trim());
  if (els.copyAiOutputBtn) {
    els.copyAiOutputBtn.disabled = !hasOutput;
    els.copyAiOutputBtn.title = hasOutput ? 'Copy mentor output' : 'Generate mentor output first';
  }
  if (els.regenerateAiBtn) {
    els.regenerateAiBtn.disabled = !hasOutput || aiGenerationInFlight;
    els.regenerateAiBtn.title = hasOutput ? 'Regenerate this mentor output' : 'Generate mentor output first';
  }
  if (!els.saveAiToLibraryBtn) return;
  const saved = Boolean(state.currentAiResultSavedId);
  const sessionType = state.aiStudySession?.type;
  els.saveAiToLibraryBtn.disabled = state.studyMaterialSaving || !hasOutput || (saved && !['quiz', 'flashcards'].includes(sessionType));
  if (state.studyMaterialSaving) {
    els.saveAiToLibraryBtn.textContent = 'Saving...';
  } else if (saved) {
    els.saveAiToLibraryBtn.textContent = 'Saved';
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
  updateLibrarySaveButton();
};

const renderAiEmptyState = (doc = selectedDocument()) => {
  state.aiStudySession = null;
  els.aiOutput.innerHTML = emptyState({
    title: doc ? 'Ask Nexus Mentor' : 'Open a note to use Nexus Mentor',
    body: doc
      ? 'Ask a question about this lecture, or choose a study action when you want a summary, quiz, or flashcards.'
      : 'Select or create a document first. AI works best after you add lecture notes or a study outline.',
    action: doc ? 'Ask a question' : 'Create a note',
    actionId: doc ? 'emptyAiAskBtn' : 'emptyAiCreateNoteBtn',
    secondaryAction: '',
    secondaryActionId: '',
    icon: '✦',
    className: 'ai-empty-state'
  });
  updateLibrarySaveButton();
};

const {
  bindThreadPanelHandlers,
  filteredThreads,
  isMine,
  renderMessageFormContext,
  renderThreadList,
  selectedThread,
  setThreadComposer,
  startAskDoubt
} = createThreadPanel({
  els,
  state,
  selectedDocument,
  loadingRows,
  errorState,
  emptyState,
  escapeHtml,
  showAskDoubtModal,
  selectedDocumentTitle,
  getSelectedEditorText,
  addActivity: (...args) => addActivity(...args),
  markLectureMilestone,
  refreshLectureProgress,
  getDocumentContextPath: (...args) => getDocumentContextPath(...args),
  request: (...args) => request(...args),
  showToast
});

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
  if (activeDocumentTitle && doc) activeDocumentTitle.textContent = doc.title || 'Untitled Lecture';
};

const {
  bindTaskPanelHandlers,
  renderTaskList
} = createTaskPanel({
  els,
  state,
  selectedDocument,
  loadingRows,
  errorState,
  emptyState,
  escapeHtml,
  upsertTaskInStore,
  removeTaskFromStore,
  addActivity: (...args) => addActivity(...args),
  markLectureMilestone,
  refreshLectureProgress,
  allKnownTasks,
  taskDocumentId,
  getDocumentContextPath: (...args) => getDocumentContextPath(...args),
  request: (...args) => request(...args),
  showToast
});

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
  const session = state.aiStudySession || buildAiStudySession(action, state.lastAiOutput, state.aiStructuredOutput);
  let content = { action, output: state.lastAiOutput, structured: state.aiStructuredOutput };
  if (session?.type === 'quiz') {
    content = {
      action,
      output: state.lastAiOutput,
      structured: state.aiStructuredOutput,
      session: {
        type: 'quiz',
        questions: session.questions || []
      }
    };
  } else if (session?.type === 'flashcards') {
    content = {
      action,
      output: state.lastAiOutput,
      structured: state.aiStructuredOutput,
      session: {
        type: 'flashcards',
        cards: session.cards || []
      }
    };
  } else if (session?.type === 'structured') {
    content = {
      action,
      output: state.lastAiOutput,
      structured: state.aiStructuredOutput,
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
  if (activeTab === 'members') renderPresence();
  if (activeTab === 'ai') updateLibrarySaveButton();
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
      body: 'Bring notes, tasks, doubts, and Nexus Mentor into one place.',
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
  const title = item.title?.trim() || 'Untitled Lecture';
  const id = documentKey(item);
  const isActive = id === String(state.selectedDocumentId);
  const isDeleting = deletingDocumentIds.has(id);
  return `
    <div class="document-row ${isActive ? 'active' : ''} ${isDeleting ? 'is-deleting' : ''}" data-document-id="${escapeHtml(id)}" role="button" tabindex="0" aria-label="Open lecture ${escapeHtml(title)}">
      <span class="document-row-title">${escapeHtml(title)}</span>
      <button class="document-delete-button" data-delete-document="${escapeHtml(id)}" aria-label="Delete lecture ${escapeHtml(title)}" title="Delete ${escapeHtml(title)}" type="button" ${isDeleting ? 'disabled' : ''}>
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
  if (state.loading.documents) {
    els.documentList.innerHTML = loadingRows(5);
  } else if (state.errors.documents) {
    els.documentList.innerHTML = errorState(state.errors.documents);
  } else {
    if (state.documents.length) {
      const groupedDocuments = state.documents.reduce((groups, item) => {
        const category = item.category || 'Lectures';
        groups[category] = [...(groups[category] || []), item];
        return groups;
      }, {});
      els.documentList.innerHTML = `${Object.entries(groupedDocuments)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, items]) => `
        <div class="document-folder-title">${escapeHtml(category)}</div>
        ${items.map(renderDocumentRow).join('')}
      `).join('')}`;
    } else {
      els.documentList.innerHTML = emptyState({
        title: 'No lectures yet',
        body: 'Create your first living lecture and Nexus will organize notes, doubts, tasks, and revision around it.',
        action: '+ New Lecture',
        actionId: 'emptyNewDocBtn',
        secondaryAction: 'Use Template',
        secondaryActionId: 'emptyTemplateDocBtn',
        icon: '▤',
        hint: 'Start with one lecture, topic, or exam unit.'
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
  const documentTitle = doc?.title || els.documentTitleInput.value || 'Current lecture';
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
    els.documentTitleInput.placeholder = 'Select a lecture';
    els.documentEditor.setAttribute('contenteditable', 'false');
    els.documentEditor.dataset.placeholder = 'Select a lecture to start studying';
    setEditorText('');
    state.lastAiAction = '';
    state.lastAiOutput = '';
    state.aiStructuredOutput = null;
    state.aiStudySession = null;
    renderAiEmptyState(null);
  } else {
    els.documentTitleInput.placeholder = 'Untitled lecture';
    els.documentEditor.setAttribute('contenteditable', 'true');
    els.documentEditor.dataset.placeholder = 'Paste lecture notes, mark doubts, or ask the tutor to create a study outline...';
  }

  const contextTitle = doc ? `"${doc.title || 'Untitled lecture'}"` : 'the current lecture';
  els.aiContextLabel.textContent = doc
    ? `The tutor already knows ${contextTitle}, selected text, saved study material, open doubts, and tasks.`
    : 'Select a lecture to use the tutor with learning context.';
  els.tasksContextLabel.textContent = doc
    ? `Tasks are scoped to ${contextTitle} so revision work stays attached.`
    : 'Select a lecture to see lecture tasks.';
  els.discussionContextLabel.textContent = doc
    ? `Doubts stay linked to paragraphs inside ${contextTitle}.`
    : 'Select a lecture to ask and resolve doubts.';
  els.membersContextLabel.textContent = doc
    ? `Presence while studying ${contextTitle}.`
    : 'Open a lecture to see live collaborators.';
  if (els.libraryContextLabel) {
    els.libraryContextLabel.textContent = doc
      ? `Saved quizzes, flashcards, explanations, and revision questions for ${contextTitle}.`
      : 'Open a lecture to view saved study material.';
  }

  renderActiveContextPanel();
  updateEditorStudyStats();
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
    if (els.focusModeBtn) {
      els.focusModeBtn.textContent = 'Focus';
      els.focusModeBtn.setAttribute('aria-label', 'Focus mode');
      els.focusModeBtn.title = 'Focus mode';
    }
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
const renderEmailVerificationPage = async (...args) => (await lazyRouteModule('auth')).renderEmailVerificationPage(...args);
const renderOAuthCallbackPage = async (...args) => (await lazyRouteModule('auth')).renderOAuthCallbackPage(...args);
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
const showEmojiPicker = async (...args) => (await lazyRouteModule('chat')).showEmojiPicker(...args);
const toggleReaction = async (...args) => (await lazyRouteModule('chat')).toggleReaction(...args);
const renderThreadListSection = async (...args) => (await lazyRouteModule('threads')).renderThreadListSection(...args);
const renderThreadDetailHtml = async (...args) => (await lazyRouteModule('threads')).renderThreadDetailHtml(...args);
const renderThreadsPage = async (...args) => (await lazyRouteModule('threads')).renderThreadsPage(...args);
const getFilteredTasks = async (...args) => (await lazyRouteModule('tasks')).getFilteredTasks(...args);
const renderTaskCardHtml = async (...args) => (await lazyRouteModule('tasks')).renderTaskCardHtml(...args);
const showAddTaskModal = async (...args) => (await lazyRouteModule('tasks')).showAddTaskModal(...args);
const showEditTaskModal = async (...args) => (await lazyRouteModule('tasks')).showEditTaskModal(...args);
const renderTasksBoard = async (...args) => (await lazyRouteModule('tasks')).renderTasksBoard(...args);
const renderTasksPage = async (...args) => (await lazyRouteModule('tasks')).renderTasksPage(...args);
const renderMembersPage = async (...args) => (await lazyRouteModule('members')).renderMembersPage(...args);
const renderSettingsContent = async (...args) => (await lazyRouteModule('settings')).renderSettingsContent(...args);
const renderSettingsPage = async (...args) => (await lazyRouteModule('settings')).renderSettingsPage(...args);
const renderWorkspaceSettingsPage = async (...args) => (await lazyRouteModule('settings')).renderWorkspaceSettingsPage(...args);
const renderWorkspacePage = async (...args) => (await lazyRouteModule('documentsWorkspace')).renderWorkspacePage(...args);
const {
  activeChatChannel,
  chatSenderName,
  syncUnreadBadge,
  clearChatUnread,
  currentChatPreview,
  chatOnlineCount,
  highlightActiveMatch,
  updateSearchMatchesCounter,
  navigateSearchMatch,
  closeChatSearch,
  handleChatMessageAction,
  renderChatTypingIndicator
} = createChatRuntime({
  state,
  els,
  searchState,
  GENERAL_CHAT_CHANNEL,
  collaborationPeople: (...args) => collaborationPeople(...args),
  selectedWorkspace,
  showToast,
  showEmojiPicker: (...args) => showEmojiPicker(...args),
  highlightSearchInDom: (...args) => highlightSearchInDom(...args)
});

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

const membersUi = {
  get activeMenuMemberId() { return membersState.activeMenuMemberId; },
  set activeMenuMemberId(value) { membersState.activeMenuMemberId = value; },
  get actionMenuRect() { return membersState.actionMenuRect; },
  set actionMenuRect(value) { membersState.actionMenuRect = value; }
};

const {
  getWorkspaceMembers,
  getUserDisplayName,
  getMemberDisplayName,
  getMemberName,
  collaborationPeople,
  memberUserId,
  isWorkspaceOwner,
  isCurrentUserWorkspaceAdmin,
  displayWorkspaceRole,
  memberActionPolicy,
  closeMembersActionMenu,
  renderMembersActionMenu,
  openMembersActionMenu,
  handleMembersMenuAction,
  isMemberOnline,
  getMemberActivityText
} = setMembersRuntime(createMembersRuntime({
  state,
  membersUi,
  selectedWorkspace,
  selectedDocumentTitle,
  escapeHtml,
  copyText,
  request: (...args) => request(...args),
  loadWorkspaces: (...args) => loadWorkspaces(...args),
  renderMembersPage: (...args) => renderMembersPage(...args),
  showMemberDetailsModal,
  showRemoveMemberModal,
  showToast
}));

const addActivity = ({ actor = state.user?.username || state.user?.email || 'You', action, target, documentId = state.selectedDocumentId }) => {
  if (!action || !target) return;
  // Advance the study streak whenever a real learning action happens
  updateStreak();
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

const currentUserIdentity = () => ({
  id: String(state.user?.id || state.user?._id || ''),
  email: String(state.user?.email || '').toLowerCase()
});

const isCurrentPresenceUser = (user = {}) => {
  const currentUser = currentUserIdentity();
  const presenceUserId = String(user.userId || user.id || user._id || '');
  const presenceEmail = String(user.email || '').toLowerCase();
  return Boolean(
    (currentUser.id && presenceUserId && presenceUserId === currentUser.id) ||
    (currentUser.email && presenceEmail && presenceEmail === currentUser.email)
  );
};

const updateTypingStatus = () => {
  if (!els.typingStatus) return;
  const names = state.typingUsers
    .filter((user) => !isCurrentPresenceUser(user))
    .map((user) => user.username || user.email || user.userId || 'Someone');
  if (names.length) {
    els.typingStatus.textContent = `${names.slice(0, 2).join(', ')} ${names.length === 1 ? 'is' : 'are'} typing...`;
    els.typingStatus.classList.add('active');
    return;
  }
  const otherPeople = state.presence.filter((user) => !isCurrentPresenceUser(user));
  if (otherPeople.length === 1) {
    const person = otherPeople[0]?.username || otherPeople[0]?.email?.split('@')[0] || 'Someone';
    els.typingStatus.textContent = `${person} is also editing.`;
  } else if (otherPeople.length > 1) {
    els.typingStatus.textContent = `${otherPeople.length} people are also editing.`;
  } else {
    els.typingStatus.textContent = 'You are editing this document.';
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
  if (uiState.threadFilterTab === 'unresolved') {
    list = list.filter(t => t.status !== 'resolved');
  } else if (uiState.threadFilterTab === 'resolved') {
    list = list.filter(t => t.status === 'resolved');
  } else if (uiState.threadFilterTab === 'mine') {
    const currentUserId = state.user?.id || state.user?._id;
    list = list.filter(t => {
      const senderId = t.sender?._id || t.sender;
      return String(senderId) === String(currentUserId);
    });
  }

  // 2. Filter by search query
  if (uiState.threadSearchQuery.trim()) {
    const q = uiState.threadSearchQuery.toLowerCase().trim();
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

const settingsForm = {
  get workspaceName() { return settingsState.workspaceName; },
  set workspaceName(value) { settingsState.workspaceName = value; },
  get workspaceDescription() { return settingsState.workspaceDescription; },
  set workspaceDescription(value) { settingsState.workspaceDescription = value; },
  get theme() { return settingsState.theme; },
  set theme(value) { settingsState.theme = value; },
  get density() { return settingsState.density; },
  set density(value) { settingsState.density = value; },
  get reduceMotion() { return settingsState.reduceMotion; },
  set reduceMotion(value) { settingsState.reduceMotion = value; },
  get emailNotifications() { return settingsState.emailNotifications; },
  set emailNotifications(value) { settingsState.emailNotifications = value; },
  get taskNotifications() { return settingsState.taskNotifications; },
  set taskNotifications(value) { settingsState.taskNotifications = value; },
  get discussionNotifications() { return settingsState.discussionNotifications; },
  set discussionNotifications(value) { settingsState.discussionNotifications = value; },
  get mentionNotifications() { return settingsState.mentionNotifications; },
  set mentionNotifications(value) { settingsState.mentionNotifications = value; },
  get inviteNotifications() { return settingsState.inviteNotifications; },
  set inviteNotifications(value) { settingsState.inviteNotifications = value; },
  get saveInProgress() { return settingsState.saveInProgress; },
  set saveInProgress(value) { settingsState.saveInProgress = value; }
};

const {
  syncSettingsFormState,
  isSettingsDirty,
  updateSaveButtonState,
  saveSettings
} = setSettingsRuntime(createSettingsRuntime({
  state,
  settingsForm,
  selectedWorkspace,
  applyPreferences,
  persistPreferences,
  request: (...args) => request(...args),
  loadWorkspaces: (...args) => loadWorkspaces(...args),
  renderSettingsPage: (...args) => renderSettingsPage(...args),
  showToast
}));

const {
  refreshAccountSecurity,
  closeAccountSecurityModal,
  loadGoogleIdentityToken,
  showAccountPasswordModal,
  showAccountDeleteModal
} = createAccountSecurity({
  state,
  els,
  request
});

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
    const label = isCurrentPresenceUser(user) ? 'You' : (user.email || user.userId || 'Collaborator');
    const status = user.cursor ? 'Editing' : 'Online';
    return `<span class="presence-pill" title="${escapeHtml(`${label} · ${status}`)}"><strong>${escapeHtml(getInitials(label))}</strong><span>${escapeHtml(status)}</span></span>`;
  }).join('');

  const peopleFallback = collaborationPeople().slice(0, 8);
  els.memberPresenceList.innerHTML = (state.presence.length ? state.presence.map((user) => {
    const label = isCurrentPresenceUser(user) ? 'You' : (user.email || user.userId || 'Collaborator');
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
    .filter((user) => !isCurrentPresenceUser(user) && user.cursor)
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
    resetTaskStore();
  }

  render();
};

const loadChannels = async () => {
  if (state.demoMode) {
    if (!state.channels.some((channel) => channel.slug === state.selectedChannelId)) {
      state.selectedChannelId = state.channels.some((channel) => channel.slug === GENERAL_CHAT_CHANNEL)
        ? GENERAL_CHAT_CHANNEL
        : state.channels[0]?.slug || '';
    }
    state.chatMessages = state.messages.slice();
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

const {
  ensureChatReady,
  loadChatMessages,
  sendWorkspaceChatMessage
} = createChatSession({
  state,
  collab,
  GENERAL_CHAT_CHANNEL,
  request,
  activeChatChannel,
  collaborationPeople,
  loadChannels,
  joinChannelRoom,
  joinWorkspaceChat,
  publishChatTyping,
  setError,
  renderChatPage,
  showToast
});

const getDocumentContextPath = () => {
  if (!state.selectedWorkspaceId || !state.selectedDocumentId) return '';
  return `/api/workspaces/${state.selectedWorkspaceId}/documents/${state.selectedDocumentId}`;
};

const loadDocumentTasks = async () => {
  if (state.demoMode) {
    state.documentTasks = selectedDocumentTasks();
    renderTaskList();
    return;
  }
  state.documentTasks = selectedDocumentTasks();
  if (!state.selectedWorkspaceId || !state.selectedDocumentId) return;
  const workspaceId = state.selectedWorkspaceId;
  const documentId = state.selectedDocumentId;
  setLoading('tasks', true, { scoped: true });
  try {
    const tasks = await request(`/api/workspaces/${workspaceId}/documents/${documentId}/tasks`);
    if (workspaceId !== state.selectedWorkspaceId || documentId !== state.selectedDocumentId) return;
    tasks.forEach((task) => upsertTaskInStore(task));
    state.documentTasks = selectedDocumentTasks();
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
  if (!payload) return showToast('Generate mentor output first', true);
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
  state.aiStructuredOutput = material.content?.structured || null;
  state.aiStudySession = material.content?.session || buildAiStudySession(action, state.lastAiOutput, state.aiStructuredOutput);
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
    inviteState.inviteRequestInFlight = false;
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
  if (clear) {
    resetTaskStore();
    if (currentRoute() === 'tasks') renderTasksBoard();
  }
  if (state.demoMode) {
    syncLegacyTaskViews();
    return;
  }
  if (!state.selectedWorkspaceId || state.documents.length === 0) return;

  const workspaceId = state.selectedWorkspaceId;
  const cacheIsWarm = state.taskStore.loadedWorkspaceId === workspaceId
    && state.taskStore.loadedAt
    && (Date.now() - state.taskStore.loadedAt < TASK_CACHE_TTL_MS);
  if (!clear && cacheIsWarm) {
    syncLegacyTaskViews();
    return;
  }

  state.taskStore.loading = true;
  state.taskStore.error = '';
  try {
    const tasks = await request(`/api/workspaces/${workspaceId}/tasks`);
    if (workspaceId !== state.selectedWorkspaceId) return;
    setWorkspaceTasks(tasks, { workspaceId });
  } catch (err) {
    const docs = backgroundDocumentBatch(limit);
    const taskResults = await Promise.allSettled(docs.map((doc) => (
      request(`/api/workspaces/${workspaceId}/documents/${doc._id}/tasks`)
    )));
    if (workspaceId !== state.selectedWorkspaceId) return;
    const tasks = taskResults
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value || []);
    setWorkspaceTasks(tasks, { workspaceId });
    state.taskStore.error = err.message;
  } finally {
    if (workspaceId === state.selectedWorkspaceId) {
      state.taskStore.loading = false;
    }
  }
};

const fetchWorkspaceThreadsForDocuments = async (docs = [], { limitPerDocument = 80 } = {}) => {
  const documentIds = docs.map((doc) => documentKey(doc)).filter(Boolean);
  if (!documentIds.length) return [];

  const query = new URLSearchParams({
    documentIds: documentIds.join(','),
    limit: String(limitPerDocument)
  });

  try {
    return await request(`/api/workspaces/${state.selectedWorkspaceId}/thread-summaries?${query.toString()}`);
  } catch (err) {
    const threadResults = await Promise.allSettled(docs.map(async (doc) => {
      const threads = await request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${doc._id}/messages`);
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

const loadWorkspaceThreads = async ({ limit = 8, clear = false, force = false } = {}) => {
  if (clear) {
    state.workspaceThreads = [];
    workspaceThreadsLoadedKey = '';
  }
  if (state.demoMode) {
    state.workspaceThreads = state.documentMessages.map((thread) => ({
      ...thread,
      documentId: state.selectedDocumentId,
      documentTitle: selectedDocumentTitle()
    }));
    state.loading.threads = false;
    setError('threads');
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
  setError('threads');
  setLoading('threads', true);

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
      if (loadSeq === workspaceThreadsLoadSeq) setError('threads', err.message);
      throw err;
    })
    .finally(() => {
      if (workspaceThreadsRequestKey === requestKey) {
        workspaceThreadsRequestKey = '';
        workspaceThreadsRequestPromise = null;
      }
      if (loadSeq === workspaceThreadsLoadSeq) {
        setLoading('threads', false);
      }
    });

  return workspaceThreadsRequestPromise;
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
  dashboardHydrationTimer = window.setTimeout(async () => {
    if (workspaceId !== state.selectedWorkspaceId) return;
    try {
      const route = currentRoute();
      await Promise.allSettled([
        loadDashboardTasks({ limit: route === 'tasks' ? state.documents.length : 8 }),
        loadWorkspaceThreads({ limit: route === 'threads' ? state.documents.length : 8 })
      ]);
      if (workspaceId !== state.selectedWorkspaceId) return;
      const currentRouteNow = currentRoute();
      if (currentRouteNow === 'home') renderHomePage();
      if (currentRouteNow === 'threads') renderThreadsPage();
      if (currentRouteNow === 'tasks') renderTasksBoard();
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
    renderDocuments();
    setError('documents');
  } catch (err) {
    setError('documents', err.message);
    throw err;
  } finally {
    state.loading.documents = false;
    renderDocuments();
  }
  const savedDocumentId = localStorage.getItem('documentId') || '';
  state.selectedDocumentId = state.documents.some((document) => String(document._id) === String(savedDocumentId))
    ? savedDocumentId
    : state.documents[0]?._id || '';

  if (state.selectedDocumentId) {
    localStorage.setItem('documentId', state.selectedDocumentId);
    resetTaskStore();
    state.workspaceThreads = [];
    workspaceThreadsLoadedKey = '';
    workspaceThreadsLoadSeq += 1;
    scheduleDashboardDataLoad();
    await loadDocument(state.selectedDocumentId);
  } else {
    localStorage.removeItem('documentId');
    teardownYDoc();
    resetTaskStore();
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
  state.documentTasks = selectedDocumentTasks();
  state.documentMessages = [];
  state.studyMaterials = [];
  localStorage.setItem('documentId', doc._id);
  upsertDocument(doc, { prepend: true });
  renderDocuments();
  els.documentTitleInput.value = doc.title || 'Untitled Lecture';
  setEditorHtml(doc.contentHtml || '', doc.plainTextContent || '');
  state.lastSavedTitle = els.documentTitleInput.value;
  state.lastSavedText = doc.plainTextContent || '';
  state.lastSavedHtml = doc.contentHtml || '';
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

  const title = els.documentTitleInput.value || 'Untitled lecture';
  const plainTextContent = getEditorText();
  const contentHtml = getEditorHtml();
  const plainTextBytes = new TextEncoder().encode(plainTextContent).byteLength;
  if (plainTextContent.length > MAX_DOCUMENT_TEXT_CHARS || plainTextBytes > MAX_DOCUMENT_TEXT_BYTES) {
    const err = new Error('This document is too large to save. Shorten it before switching documents or leaving the page.');
    err.code = 'DOCUMENT_TOO_LARGE';
    state.saveStatus = 'error';
    setAutosaveStatus('Document too large to save');
    if (!silent) showToast(err.message, true);
    throw err;
  }
  if (title === state.lastSavedTitle && plainTextContent === state.lastSavedText && contentHtml === (state.lastSavedHtml || '')) {
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
      markLectureMilestone(doc._id, 'notesAdded', {
        message: 'Notes added',
        show: !silent
      });
    } else {
      refreshLectureProgress(doc._id);
    }
    setAutosaveStatus(silent ? 'Saved just now' : 'Saved');
    if (!silent) addActivity({ action: 'edited', target: doc.title || 'Untitled lecture', documentId: doc._id });
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
      const latestTitle = els.documentTitleInput.value || 'Untitled lecture';
      const latestText = getEditorText();
      const latestHtml = getEditorHtml();
      if (latestTitle !== state.lastSavedTitle || latestText !== state.lastSavedText || latestHtml !== (state.lastSavedHtml || '')) {
        scheduleAutosave();
      }
    }
  }
};

const saveCurrentDocumentIfDirty = async () => {
  const saveStartedAt = performance.now();
  if (!state.selectedDocumentId) return null;
  const title = els.documentTitleInput.value || 'Untitled lecture';
  const plainTextContent = getEditorText();
  const contentHtml = getEditorHtml();
  try {
    const titleChanged = title !== state.lastSavedTitle;
    const contentChanged = plainTextContent !== state.lastSavedText;
    const htmlChanged = contentHtml !== (state.lastSavedHtml || '');
    console.log('[dirty-check]', {
      documentId: state.selectedDocumentId,
      titleChanged,
      contentChanged,
      editorLength: plainTextContent.length,
      lastSavedLength: state.lastSavedText.length,
      action: titleChanged || contentChanged || htmlChanged ? 'save' : 'skip'
    });
    if (!titleChanged && !contentChanged && !htmlChanged) return selectedDocument();
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
  state.lastSavedHtml = '';
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

  const title = doc.title?.trim() || 'Untitled Lecture';
  const confirmed = window.confirm(`Are you sure you want to delete "${title}" lecture?`);
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
    showToast('Lecture deleted');
  } catch (err) {
    showToast(err.message || 'Document delete failed', true);
  } finally {
    deletingDocumentIds.delete(id);
    renderDocuments();
  }
};

const createDocumentAndOpen = async (title = 'Untitled Lecture') => {
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
    renderDocuments();
    return doc;
  } finally {
    documentCreateInFlight = false;
  }
};

const runStudyAiAction = async (action, mentorPrompt = '') => {
  if (aiGenerationInFlight) {
    showToast('AI is already generating. Give it a moment.');
    return null;
  }

  const doc = selectedDocument();
  if (!doc) return showToast('Open a document before using AI', true);

  const text = getAiSourceText();
  if (!text) return showToast(selectedAiSource() === 'selection' ? 'Select some text first' : 'Add document text before running AI', true);
  if (text.length < 80) showToast('This note is short. Add more detail for better results.');

  els.aiActionSelect.value = action;
  activateContextTab('ai');
  state.aiStudySession = null;
  setAiGenerating(true);
  const loadingCopy = mentorPrompt
    ? {
        title: 'Thinking through your question...',
        steps: ['Reading your question', 'Checking this lecture', 'Preparing a focused answer']
      }
    : aiLoadingCopy(action);
  els.aiOutput.innerHTML = `
    <div class="ai-loading-card">
      <span>✦</span>
      <strong>${escapeHtml(loadingCopy.title)}</strong>
      <small>${escapeHtml(loadingCopy.steps.join(' • '))}</small>
    </div>
  `;

  if (state.demoMode) {
    window.setTimeout(() => {
      setAiOutput(action, demoAiResponse(action));
      addActivity({ action: `generated ${aiActionLabel(action).toLowerCase()} from`, target: selectedDocumentTitle() });
      setAiGenerating(false);
    }, 350);
    return null;
  }

  try {
    await saveCurrentDocument({ silent: true });
    const result = await request('/api/ai/document-action', {
      method: 'POST',
      body: JSON.stringify({
        action,
        selectedText: selectedAiSource() === 'selection' ? text : '',
        workspaceId: state.selectedWorkspaceId,
        documentId: state.selectedDocumentId,
        source: selectedAiSource(),
        instructions: mentorPrompt,
        difficulty: 'medium',
        questionCount: 10
      })
    });
    setAiOutput(action, result.response, result.structured || null);
    addActivity({ action: `generated ${aiActionLabel(action).toLowerCase()} from`, target: selectedDocumentTitle() });
    return result.response;
  } catch (err) {
    const message = friendlyUiMessage(err.message, { isError: true });
    els.aiOutput.innerHTML = emptyState({
      title: 'AI could not finish that request',
      body: message,
      action: 'Try Again',
      actionId: 'emptyAiRetryBtn',
      icon: '!',
      className: 'ai-empty-state'
    });
    showToast(message, true);
    return null;
  } finally {
    setAiGenerating(false);
  }
};

const saveAiOutputToDocument = async () => {
  if (!state.selectedDocumentId || !state.lastAiOutput.trim()) return showToast('Generate mentor output first', true);
  const stamp = new Date().toLocaleDateString();
  const block = `\n\n---\nAI ${aiActionLabel(state.lastAiAction)}\nGenerated on ${stamp}\n\n${state.lastAiOutput.trim()}\n`;
  setEditorText(`${getEditorText()}${block}`);
  applyEditorInputToYDoc();
  await saveCurrentDocument();
  showToast('Mentor output saved below your notes');
};

const createAiOutputDocument = async () => {
  if (!state.lastAiOutput.trim()) return showToast('Generate mentor output first', true);
  if (!state.selectedWorkspaceId) return showToast('Select a workspace first', true);
  const title = `${selectedDocumentTitle()} - ${aiActionLabel(state.lastAiAction)}`;

  if (state.demoMode) {
    const doc = {
      _id: `demo-ai-doc-${Date.now()}`,
      title,
      category: 'Mentor Study Material',
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
  const title = els.documentTitleInput.value || 'Untitled lecture';
  const plainTextContent = getEditorText();
  const contentHtml = getEditorHtml();
  if (title === state.lastSavedTitle && plainTextContent === state.lastSavedText && contentHtml === (state.lastSavedHtml || '')) {
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

const createWorkspaceAndOpen = async (name, { closePanel = false, route = 'home' } = {}) => {
  const workspaceName = String(name || '').trim();
  if (!workspaceName) {
    showToast('Workspace name is required', true);
    return null;
  }
  if (state.demoMode) {
    showToast('Demo mode uses the sample workspace. Sign up to create your own.');
    return null;
  }
  if (workspaceCreateInFlight) {
    showToast('Workspace is already being created');
    return null;
  }

  workspaceCreateInFlight = true;
  try {
    window.clearTimeout(autosaveTimer);
    if (state.selectedDocumentId) await saveCurrentDocumentIfDirty().catch(() => {});

    const workspace = await request('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name: workspaceName })
    });

    state.selectedWorkspaceId = workspace._id;
    state.selectedDocumentId = '';
    state.selectedChannelId = '';
    state.chatMessages = [];
    resetTaskStore();
    state.documentMessages = [];
    state.workspaceThreads = [];
    localStorage.setItem('workspaceId', workspace._id);
    localStorage.removeItem('documentId');
    localStorage.removeItem('channelId');
    teardownYDoc();

    if (closePanel) closeToolPanel();
    await loadWorkspaces();
    await bootstrapWorkspace();
    navigate(route);
    showToast('Workspace created');
    return workspace;
  } catch (err) {
    showToast(friendlyUiMessage(err.message, { isError: true }), true);
    return null;
  } finally {
    workspaceCreateInFlight = false;
  }
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
  workspaceUiState.pendingWorkspaceDeleteId = '';
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
      action: 'Try Demo Workspace',
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
        <input id="dashboardDocumentTitleInput" placeholder="Untitled Lecture" />
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
          <p class="muted-copy">${state.user?.emailVerified ? 'Email verified.' : 'Email verification is required before signing in.'}</p>
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
            <p>Password recovery is handled through a secure email reset link.</p>
          </div>
        </div>
        <div class="profile-field-stack">
          <p class="muted-copy">Use the Forgot password link on the sign-in screen when you cannot access this account.</p>
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
    window.setTimeout(() => document.getElementById('toolWorkspaceNameInput')?.focus(), 0);
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
    inviteState.latestCreatedInvite = null;
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

  if (id === 'emptyAiCreateNoteBtn') {
    els.newDocBtn.click();
    return true;
  }

  if (id === 'emptyAiAskBtn') {
    focusNexusMentor();
    return true;
  }

  if (id === 'emptyAiRunBtn') {
    await runStudyAiAction(els.aiActionSelect?.value || 'summarize');
    return true;
  }

  if (id === 'emptyAiRetryBtn') {
    await runStudyAiAction(state.lastAiAction || els.aiActionSelect?.value || 'summarize');
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

  const focusMentorButton = event.target.closest('[data-focus-ai-prompt]');
  if (focusMentorButton) {
    focusNexusMentor();
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
    await renderSettingsPage();
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
  uiState.selectedCommandIndex = 0;
  renderCommandResults();
});

els.commandInput.addEventListener('keydown', async (event) => {
  if (els.commandPalette.classList.contains('hidden')) return;

  const query = els.commandInput.value.trim().toLowerCase();
  
  const sortedDocs = [...state.documents]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));

  const docMatches = sortedDocs
    .filter((doc) => !query || (doc.title || 'Untitled Lecture').toLowerCase().includes(query))
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
      uiState.selectedCommandIndex = (uiState.selectedCommandIndex + 1) % totalLength;
      renderCommandResults();
    }
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (totalLength > 0) {
      uiState.selectedCommandIndex = (uiState.selectedCommandIndex - 1 + totalLength) % totalLength;
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
    if (idx !== uiState.selectedCommandIndex) {
      uiState.selectedCommandIndex = idx;
      const activeItems = els.commandResults.querySelectorAll('.command-item');
      activeItems.forEach((el, index) => {
        el.classList.toggle('selected', index === uiState.selectedCommandIndex);
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
    if (uiState.activeTaskMoreMenuId) {
      uiState.activeTaskMoreMenuId = '';
      renderTasksBoard();
    }
  }
});

const refreshToolView = async (tool) => {
  await openTool(tool);
};

const rememberCreatedInvite = (result = {}) => {
  const invite = result.invite || result.invitation || {};
  const token = result.token || invite.token || '';
  const code = result.code || invite.code || '';
  const inviteLink = result.inviteLink
    || (token ? `${location.origin}${location.pathname}#/invite?token=${encodeURIComponent(token)}` : '')
    || (code ? `${location.origin}${location.pathname}#/invite?code=${encodeURIComponent(code)}` : '');

  inviteState.latestCreatedInvite = {
    ...result,
    invite,
    code,
    inviteLink
  };

  const inviteId = String(invite._id || invite.id || result._id || result.id || '');
  if (inviteId) {
    const cachedInvite = {
      ...invite,
      _id: invite._id || invite.id || result._id || result.id,
      token,
      code,
      createdAt: invite.createdAt || result.createdAt || new Date().toISOString()
    };
    const cachedEmail = String(cachedInvite.email || '').toLowerCase();
    workspaceUiState.pendingWorkspaceInvites = [
      cachedInvite,
      ...workspaceUiState.pendingWorkspaceInvites.filter((item) => {
        const itemId = String(item._id || item.id || '');
        const itemEmail = String(item.email || '').toLowerCase();
        return itemId !== inviteId && (!cachedEmail || itemEmail !== cachedEmail);
      })
    ];
  }

  return inviteState.latestCreatedInvite;
};

const handleToolPanelClick = async (event) => {
  const target = event.target;

  if (target.closest('#closeToolPanelBtn')) {
    closeToolPanel();
    return;
  }

  try {
    const copyGeneratedInviteLink = target.closest('#copyGeneratedInviteLinkBtn');
    if (copyGeneratedInviteLink) {
      const value = document.getElementById('generatedInviteLinkInput')?.value || '';
      await copyText(value, 'Invite link copied');
      return;
    }

    const copyGeneratedInviteCode = target.closest('#copyGeneratedInviteCodeBtn');
    if (copyGeneratedInviteCode) {
      const value = document.getElementById('generatedInviteCodeInput')?.value || '';
      await copyText(value, 'Invite code copied');
      return;
    }

    if (target.closest('[data-copy-invite-link]')) {
      const latestInvite = inviteState.latestCreatedInvite || {};
      const invite = latestInvite.invite || latestInvite.invitation || {};
      const token = latestInvite.token || invite.token || '';
      const inviteLink = token ? inviteLinkForToken(token) : latestInvite.inviteLink || '';
      if (!inviteLink) return showToast('Invite link is not available', true);
      await copyText(inviteLink, 'Invite link copied');
      return;
    }

    if (target.closest('[data-copy-invite-code]')) {
      const latestInvite = inviteState.latestCreatedInvite || {};
      const invite = latestInvite.invite || latestInvite.invitation || {};
      const code = latestInvite.code || invite.code || '';
      if (!code) return showToast('Invite code is not available', true);
      await copyText(code, 'Invite code copied');
      return;
    }

    if (target.id === 'doneInviteResultBtn' || target.id === 'cancelJoinWorkspaceBtn') {
      closeToolPanel();
      return;
    }

    const inviteCreateSubmit = target.closest('#inviteCreateSubmitBtn');
    if (inviteCreateSubmit) {
      if (state.demoMode) {
        rememberCreatedInvite({
          code: 'NEXUS-DEMO-CODE',
          inviteLink: `${location.origin}${location.pathname}#/invite?code=NEXUS-DEMO-CODE`
        });
        showInviteMemberModal();
        return;
      }

      const workspace = selectedWorkspace();
      if (!workspace?._id) return showToast('Select a workspace first', true);
      const email = document.getElementById('inviteEmailInput')?.value.trim();
      const role = document.getElementById('inviteRoleInput')?.value || 'member';
      if (inviteState.inviteRequestInFlight) return;

      inviteState.inviteRequestInFlight = true;
      inviteCreateSubmit.disabled = true;
      inviteCreateSubmit.setAttribute('aria-busy', 'true');
      try {
        const result = await request(`/api/invites/${workspace._id}`, {
          method: 'POST',
          body: JSON.stringify({ email, role })
        });
        rememberCreatedInvite(result);
        showInviteMemberModal();
        showToast('Invite created');
      } catch (err) {
        showToast(friendlyUiMessage(err.message, { isError: true }), true);
        inviteCreateSubmit.disabled = false;
        inviteCreateSubmit.removeAttribute('aria-busy');
      } finally {
        inviteState.inviteRequestInFlight = false;
      }
      return;
    }

    const inviteClose = target.closest('#inviteCloseBtn');
    if (inviteClose) {
      inviteState.latestCreatedInvite = null;
      generatedInviteResult = null;
      closeToolPanel();
      if (currentRoute() === 'members') await renderMembersPage();
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
      workspaceUiState.pendingWorkspaceDeleteId = '';
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
      if (inviteState.inviteRequestInFlight) return;
      inviteState.inviteRequestInFlight = true;
      target.disabled = true;
      const result = await request(`/api/invites/${workspace._id}`, {
        method: 'POST',
        body: JSON.stringify({ email, role })
      });
      inviteState.inviteRequestInFlight = false;
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
      workspaceUiState.pendingWorkspaceDeleteId = '';
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
      workspaceUiState.pendingWorkspaceDeleteId = deleteWorkspaceButton.dataset.deleteWorkspaceId;
      activeWorkspaceMenuId = '';
      activeWorkspaceRenameId = '';
      if (currentRoute() === 'workspace-settings') await renderWorkspaceSettingsPage();
      else renderWorkspacesTool();
      return;
    }

    if (target.closest('[data-cancel-workspace-delete]')) {
      workspaceUiState.pendingWorkspaceDeleteId = '';
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
      workspaceUiState.pendingWorkspaceDeleteId = '';
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
      clearInlineErrors(target.closest('.workspace-create-card'));
      const input = document.getElementById('toolWorkspaceNameInput');
      const name = input?.value.trim();
      if (!name) {
        showInlineError(input, 'Name this workspace so you can find it later.');
        input?.focus();
        return showToast('Workspace name is required', true);
      }
      try {
        target.disabled = true;
        target.setAttribute('aria-busy', 'true');
        await createWorkspaceAndOpen(name, { closePanel: true });
      } finally {
        target.disabled = false;
        target.removeAttribute('aria-busy');
      }
      return;
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
      if (inviteState.inviteRequestInFlight) return;
      inviteState.inviteRequestInFlight = true;
      target.disabled = true;
      const result = await request(`/api/invites/${state.selectedWorkspaceId}`, {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('inviteEmailInput').value,
          role: document.getElementById('inviteRoleInput').value
        })
      });
      inviteState.inviteRequestInFlight = false;
      renderInviteResultTool(result);
      return;
    }

    if (target.id === 'dashboardCreateDocumentBtn') {
      const title = document.getElementById('dashboardDocumentTitleInput').value.trim() || 'Untitled Lecture';
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
        addActivity({ action: 'created lecture', target: title, documentId: doc._id });
        return showToast('Demo document created locally');
      }

      const doc = await createDocumentAndOpen(title);
      if (!doc) return;
      closeToolPanel();
      navigate('workspace');
      addActivity({ action: 'created lecture', target: title, documentId: doc._id });
      return showToast('Lecture created');
    }

    if (target.id === 'dashboardCreateTaskBtn') {
      if (!state.selectedWorkspaceId) return showToast('Select a workspace first', true);
      const doc = selectedDocument() || state.documents[0];
      if (!doc) return showToast('Create a lecture before adding tasks', true);
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
          documentId: doc._id,
          assignee: { username: state.user?.username || 'Alex Rivera' }
        };
        upsertTaskInStore(task);
        closeToolPanel();
        addActivity({ action: 'created task', target: title, documentId: doc._id });
        markLectureMilestone(doc._id, 'taskCreated', { message: 'Study task created' });
        renderHomePage();
        return showToast('Demo task added locally');
      }

      const task = await request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${doc._id}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ title, priority, dueDate })
      });
      upsertTaskInStore(task);
      closeToolPanel();
      addActivity({ action: 'created task', target: title, documentId: doc._id });
      markLectureMilestone(doc._id, 'taskCreated', { message: 'Study task created' });
      renderHomePage();
      return showToast('Task created');
    }

    if (target.id === 'changePasswordBtn') {
      await request('/api/account/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: document.getElementById('currentPasswordInput').value,
          newPassword: document.getElementById('newPasswordInput').value
        })
      });
      return showToast('Password changed');
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
      await saveSettings();
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
      showToast(`${name} can be connected from the deployment environment.`);
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
          body: 'Try a shorter keyword, create a note for this topic, or ask Nexus Mentor from the current document.',
          action: 'Create Note',
          actionId: 'emptySearchCreateNoteBtn',
          secondaryAction: 'Ask Mentor',
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
    membersState.roleFilter = event.target.value;
    renderMembersPage();
    return;
  }

  if (event.target.id === 'membersStatusFilterSelect') {
    membersState.statusFilter = event.target.value;
    renderMembersPage();
    return;
  }

  if (event.target.id === 'tasksSortSelect') {
    uiState.taskSortField = event.target.value;
    renderTasksBoard();
    return;
  }

  if (event.target.classList.contains('task-checkbox-v2')) {
    const taskId = event.target.dataset.checkTaskId;
    const checked = event.target.checked;
    const task = state.taskStore.byId[taskId]
      || state.dashboardTasks.find(t => t._id === taskId)
      || state.documentTasks.find(t => t._id === taskId);
    if (!task) return;
    const previousTask = { ...task };
    const optimisticTask = {
      ...task,
      status: checked ? 'done' : 'todo',
      completedAt: checked ? new Date().toISOString() : null
    };
    upsertTaskInStore(optimisticTask);
    if (checked) addActivity({ action: 'completed task', target: optimisticTask.title });
    refreshLectureProgress(taskDocumentId(optimisticTask), {
      message: 'All linked tasks completed',
      show: checked
    });
    showToast(checked ? 'Task marked complete' : 'Task reopened');
    await renderTasksBoard();

    if (state.demoMode) {
      return;
    }

    try {
      const docId = optimisticTask.documentId || optimisticTask.document;
      const updated = await request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${docId}/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: checked ? 'done' : 'todo' })
      });
      upsertTaskInStore(updated);
    } catch (err) {
      upsertTaskInStore(previousTask);
      await renderTasksBoard();
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

  const googleButton = event.target.closest('[data-google-auth]');
  if (googleButton) {
    googleButton.disabled = true;
    googleButton.setAttribute('aria-busy', 'true');
    showToast('Opening Google Sign-In...');
    window.location.href = `${API_BASE}/api/auth/google/start`;
    return;
  }

  const dashboardAction = event.target.closest('[data-dashboard-action]');
  if (dashboardAction) {
    const action = dashboardAction.dataset.dashboardAction;
    if (action === 'new-document') return renderDashboardDocumentTool();
    if (action === 'new-task') return renderDashboardTaskTool();
    if (action === 'invite') {
      generatedInviteResult = null;
      inviteState.latestCreatedInvite = null;
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
          ? 'Try: What should I study today? I would revise Deadlocks, answer the circular wait doubt, then take the OS scheduling quiz.'
          : 'Nexus Mentor is ready. Ask a question or choose a study action for this lecture.');
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
    inviteState.latestCreatedInvite = null;
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
    const task = state.taskStore.byId[taskId]
      || state.dashboardTasks.find((item) => item._id === taskId)
      || state.documentTasks.find((item) => item._id === taskId);
    if (!task) return;
    const previousTask = { ...task };
    const optimisticTask = {
      ...task,
      status: checked ? 'done' : 'todo',
      completedAt: checked ? new Date().toISOString() : null
    };
    upsertTaskInStore(optimisticTask);
    refreshLectureProgress(taskDocumentId(optimisticTask), {
      message: 'All linked tasks completed',
      show: checked
    });
    renderHomePage();

    if (state.demoMode) {
      return;
    }
    try {
      const docId = optimisticTask.documentId || state.selectedDocumentId || state.documents[0]?._id;
      const updatedTask = await request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${docId}/tasks/${optimisticTask._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: checked ? 'done' : 'todo' })
      });
      upsertTaskInStore(updatedTask);
    } catch (err) {
      upsertTaskInStore(previousTask);
      renderHomePage();
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
        today: 'Study plan: revise Deadlocks, review Banker algorithm, then answer five OS revision questions.',
        summarize: demoAiResponse('summarize'),
        quiz: demoAiResponse('quiz'),
        'weak-topics': 'Weak topics to revisit: circular wait, safe state, and the difference between deadlock prevention and avoidance.'
      } : {};
      setAiOutput(dashboardAi.dataset.dashboardAi, state.demoMode
        ? responses[dashboardAi.dataset.dashboardAi]
        : 'Nexus Mentor is ready for this lecture. Ask a question or choose a study action.');
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

  const authCreateWorkspaceCta = event.target.closest('[data-auth-create-workspace]');
  if (authCreateWorkspaceCta) {
    event.preventDefault();
    if (state.token && !state.demoMode) {
      await openTool('workspaces');
      return;
    }
    if (state.demoMode) exitDemoMode();
    if (currentRoute() !== 'signup') {
      navigate('signup');
      await renderRoute();
    } else {
      renderAuthPage('signup');
    }
    window.setTimeout(() => {
      const firstSignupField = document.getElementById('pageUsernameInput')
        || document.getElementById('pageEmailInput');
      firstSignupField?.focus();
      firstSignupField?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
    return;
  }

  const resendOtpButton = event.target.closest('#pageResendOtpInlineBtn');
  if (resendOtpButton) {
    event.preventDefault();
    const emailInput = document.getElementById('pageVerifyEmailInput');
    clearInlineErrors(document.getElementById('pageVerifyEmailForm'));
    const email = emailInput?.value.trim().toLowerCase() || '';
    if (!email) {
      showInlineError(emailInput, 'Enter the email address you used to create your account.');
      emailInput?.focus();
      return;
    }
    if (!emailInput.validity.valid) {
      showInlineError(emailInput, 'Enter a valid email address.');
      emailInput.focus();
      return;
    }
    resendOtpButton.disabled = true;
    try {
      await requestVerificationOtp(email);
    } catch (err) {
      resendOtpButton.disabled = false;
      showToast(friendlyUiMessage(err.message, { isError: true }), true);
    }
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
    membersState.searchQuery = event.target.value;
    renderMembersPage();
    return;
  }
  if (event.target.id === 'tasksSearchInput') {
    uiState.taskSearchQuery = event.target.value;
    renderTasksBoard();
    return;
  }
  if (event.target.id === 'threadsSearchInput') {
    uiState.threadSearchQuery = event.target.value;
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

const restoreSessionFromRefresh = async () => {
  if (state.token || !state.csrfToken) return false;

  try {
    const result = await request('/api/auth/refresh', {
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

const completeOAuthCallback = async () => {
  const handoffToken = routeQuery().get('token') || '';
  const error = routeQuery().get('error') || '';

  if (error) {
    showToast(error, true);
    navigate('login');
    return false;
  }

  if (!handoffToken) {
    showToast('Google sign-in could not be completed.', true);
    navigate('login');
    return false;
  }

  try {
    const result = await request('/api/auth/google/complete', {
      method: 'POST',
      body: JSON.stringify({ token: handoffToken })
    }, false);
    completeAuthenticatedSession(result);
    return true;
  } catch (err) {
    showToast(friendlyUiMessage(err.message, { isError: true }), true);
    navigate('login');
    return false;
  }
};

const setPendingVerificationEmail = (email = '') => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (normalizedEmail) sessionStorage.setItem('nexusPendingVerificationEmail', normalizedEmail);
  else sessionStorage.removeItem('nexusPendingVerificationEmail');
};

const startVerificationResendCountdown = (seconds = 60) => {
  window.clearInterval(emailVerificationResendTimer);
  const resendButtons = [
    document.getElementById('pageResendOtpInlineBtn'),
    document.getElementById('pageResendVerificationSubmit')
  ].filter(Boolean);
  const countdown = document.getElementById('verificationResendCountdown');
  let remaining = seconds;

  const renderCountdown = () => {
    resendButtons.forEach((button) => {
      button.disabled = remaining > 0;
      button.setAttribute('aria-disabled', remaining > 0 ? 'true' : 'false');
    });
    if (countdown) {
      countdown.classList.toggle('hidden', remaining <= 0);
      countdown.textContent = remaining > 0
        ? `You can resend OTP in ${remaining}s.`
        : 'You can resend OTP now.';
    }
  };

  renderCountdown();
  emailVerificationResendTimer = window.setInterval(() => {
    remaining -= 1;
    renderCountdown();
    if (remaining <= 0) {
      window.clearInterval(emailVerificationResendTimer);
      emailVerificationResendTimer = null;
    }
  }, 1000);
};

const requestVerificationOtp = async (email, { startCountdown = true } = {}) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    showToast('Enter the email address for your Nexus account.', true);
    return false;
  }
  await request('/api/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email: normalizedEmail })
  }, false);
  setPendingVerificationEmail(normalizedEmail);
  if (startCountdown) startVerificationResendCountdown(60);
  showToast('If the account is unverified, a new OTP has been sent.');
  return true;
};

const handleAuthRouteSubmit = async (event) => {
  if (event.target.id === 'pageForgotPasswordForm') {
    event.preventDefault();
    const submitButton = document.getElementById('pageForgotPasswordSubmit');
    const resultBox = document.getElementById('passwordRecoveryResult');

    try {
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.querySelector('span').textContent = 'Sending...';

      const result = await request('/api/auth/password/forgot', {
        method: 'POST',
        body: JSON.stringify({ email: document.getElementById('pageForgotEmailInput').value.trim() })
      }, false);

      resultBox.classList.remove('hidden');
      resultBox.innerHTML = `
        <strong>${escapeHtml(result.message || 'Password reset requested')}</strong>
        <p>Check your email for reset instructions.</p>
      `;
      showToast('Password reset email sent');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.querySelector('span').textContent = 'Send reset email';
      }
    }
    return true;
  }

  if (event.target.id === 'pageResetPasswordForm') {
    event.preventDefault();
    const submitButton = document.getElementById('pageResetPasswordSubmit');
    const resultBox = document.getElementById('passwordRecoveryResult');

    try {
      const resetToken = document.getElementById('pageResetTokenInput').value.trim();
      const newPassword = document.getElementById('pageNewPasswordInput').value;
      const confirmPassword = document.getElementById('pageConfirmNewPasswordInput').value;
      if (!resetToken) {
        throw new Error('Use the latest password reset link from your email.');
      }
      if (newPassword !== confirmPassword) {
        throw new Error('Passwords do not match.');
      }

      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.querySelector('span').textContent = 'Resetting...';

      await request('/api/auth/password/reset', {
        method: 'POST',
        body: JSON.stringify({
          token: resetToken,
          password: newPassword
        })
      }, false);

      document.getElementById('pageResetTokenInput').value = '';
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/reset-password`);
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

  if (event.target.id === 'pageVerifyEmailForm') {
    event.preventDefault();
    const submitButton = document.getElementById('pageVerifyEmailSubmit');
    const resultBox = document.getElementById('emailVerificationResult');
    const emailInput = document.getElementById('pageVerifyEmailInput');
    const otpInput = document.getElementById('pageVerifyOtpInput');
    clearInlineErrors(event.target);

    const email = emailInput?.value.trim().toLowerCase() || '';
    const otp = otpInput?.value.trim() || '';
    let hasError = false;
    if (!email) {
      showInlineError(emailInput, 'Enter the email address you used to create your account.');
      hasError = true;
    } else if (!emailInput.validity.valid) {
      showInlineError(emailInput, 'Enter a valid email address.');
      hasError = true;
    }
    if (!/^\d{6}$/.test(otp)) {
      showInlineError(otpInput, 'Enter the 6-digit OTP from your email.');
      hasError = true;
    }
    if (hasError) {
      focusFirstInvalid(event.target);
      return true;
    }

    try {
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.querySelector('span').textContent = 'Verifying...';
      await request('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ email, otp })
      }, false);

      setPendingVerificationEmail('');
      window.clearInterval(emailVerificationResendTimer);
      resultBox.classList.remove('hidden');
      resultBox.innerHTML = `
        <strong>Email verified successfully</strong>
        <p>You can now sign in to Nexus.</p>
        <a class="primary" href="#/login">Back to login</a>
      `;
      showToast('Email verified successfully');
    } catch (err) {
      showToast(friendlyUiMessage(err.message, { isError: true }), true);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.querySelector('span').textContent = 'Verify OTP';
      }
    }
    return true;
  }

  if (event.target.id === 'pageResendVerificationForm') {
    event.preventDefault();
    const submitButton = document.getElementById('pageResendVerificationSubmit');
    const resultBox = document.getElementById('emailVerificationResult');
    const emailInput = document.getElementById('pageResendEmailInput');
    clearInlineErrors(event.target);

    const email = emailInput?.value.trim().toLowerCase() || '';
    if (!email) {
      showInlineError(emailInput, 'Enter the email address you used to create your account.');
      focusFirstInvalid(event.target);
      return true;
    }
    if (!emailInput.validity.valid) {
      showInlineError(emailInput, 'Enter a valid email address.');
      focusFirstInvalid(event.target);
      return true;
    }

    try {
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.querySelector('span').textContent = 'Sending...';
      const result = await request('/api/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email })
      }, false);
      setPendingVerificationEmail(email);
      startVerificationResendCountdown(60);

      resultBox.classList.remove('hidden');
      resultBox.innerHTML = `
        <strong>${escapeHtml(result.message || 'If the account is unverified, a new OTP has been sent.')}</strong>
        <p>Check your email for the latest 6-digit OTP.</p>
        <a class="primary" href="#/verify-email">Enter OTP</a>
      `;
      showToast('Verification OTP sent');
    } catch (err) {
      showToast(friendlyUiMessage(err.message, { isError: true }), true);
    } finally {
      if (submitButton) {
        if (!emailVerificationResendTimer) submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.querySelector('span').textContent = 'Resend verification OTP';
      }
    }
    return true;
  }

  if (event.target.id !== 'pageAuthForm') return false;
  event.preventDefault();
  if (state.demoMode) exitDemoMode();

  const submitButton = document.getElementById('pageAuthSubmit');
  const form = event.target;
  clearInlineErrors(form);

  try {
    const mode = currentRoute() === 'signup' ? 'register' : 'login';
    const emailInput = document.getElementById('pageEmailInput');
    const passwordInput = document.getElementById('pagePasswordInput');
    const payload = {
      email: emailInput.value.trim(),
      password: passwordInput.value
    };
    let hasError = false;
    if (!payload.email) {
      showInlineError(emailInput, 'Enter the email address for your Nexus account.');
      hasError = true;
    } else if (!emailInput.validity.valid) {
      showInlineError(emailInput, 'Enter a valid email address.');
      hasError = true;
    }
    if (!payload.password) {
      showInlineError(passwordInput, 'Enter your password.');
      hasError = true;
    } else if (mode === 'register' && payload.password.length < 8) {
      showInlineError(passwordInput, 'Use at least 8 characters.');
      hasError = true;
    }
    if (mode === 'register') {
      const usernameInput = document.getElementById('pageUsernameInput');
      const confirmPasswordInput = document.getElementById('pageConfirmPasswordInput');
      const confirmPassword = confirmPasswordInput.value;
	      payload.username = usernameInput.value.trim();
	      if (!payload.username) {
	        showInlineError(usernameInput, 'Choose a username for your profile.');
	        hasError = true;
	      } else if (!isValidSignupUsername(payload.username)) {
	        showInlineError(usernameInput, 'Use 3-50 letters, numbers, underscores, or hyphens.');
	        hasError = true;
	      }
	      if (payload.password !== confirmPassword) {
	        showInlineError(confirmPasswordInput, 'Passwords do not match.');
	        hasError = true;
      }
    }
    if (hasError) {
      focusFirstInvalid(form);
      showToast('Please fix the highlighted fields.', true);
      return true;
    }

    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
    submitButton.querySelector('span').textContent = mode === 'register' ? 'Creating account...' : 'Signing in...';

    const result = await request(`/api/auth/${mode}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (mode === 'register') {
      setPendingVerificationEmail(payload.email);
      showToast('Account created. Enter the OTP sent to your email.');
      navigate('verify-email');
      window.setTimeout(() => startVerificationResendCountdown(60), 0);
      return true;
    }
    completeAuthenticatedSession(result);
  } catch (err) {
    const message = friendlyUiMessage(err.message, { isError: true });
    showToast(message, true);
    const emailInput = document.getElementById('pageEmailInput');
    const passwordInput = document.getElementById('pagePasswordInput');
	    const usernameInput = document.getElementById('pageUsernameInput');
	    if (/username/i.test(message) && usernameInput) {
	      showInlineError(usernameInput, message);
	    } else if (/email|registered|credentials|password|sign in/i.test(message)) {
	      showInlineError(/password/i.test(message) ? passwordInput : emailInput, message);
	    }
    if (/verify your email/i.test(message) && emailInput?.value) {
      setPendingVerificationEmail(emailInput.value);
      let verifyAction = document.getElementById('authVerifyEmailAction');
      if (!verifyAction) {
        verifyAction = document.createElement('div');
        verifyAction.id = 'authVerifyEmailAction';
        verifyAction.className = 'password-recovery-result';
        submitButton?.insertAdjacentElement('afterend', verifyAction);
      }
      verifyAction.innerHTML = `
        <strong>Email verification required</strong>
        <p>Enter the OTP sent to ${escapeHtml(emailInput.value.trim())} to finish setup.</p>
        <a class="primary" href="#/verify-email">Verify Email</a>
      `;
    }
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
    uiState.taskFilterTab = tasksFilterChip.dataset.tasksFilterTab;
    await renderTasksBoard();
    return;
  }

  const tasksClearSearch = event.target.closest('#tasksClearSearchBtn');
  if (tasksClearSearch) {
    event.preventDefault();
    uiState.taskSearchQuery = '';
    await renderTasksBoard();
    return;
  }

  const tasksToggleBoard = event.target.closest('#tasksViewToggleBoardBtn');
  if (tasksToggleBoard) {
    event.preventDefault();
    uiState.taskViewMode = 'board';
    await renderTasksBoard();
    return;
  }

  const tasksToggleList = event.target.closest('#tasksViewToggleListBtn');
  if (tasksToggleList) {
    event.preventDefault();
    uiState.taskViewMode = 'list';
    await renderTasksBoard();
    return;
  }

  const taskMenuBtn = event.target.closest('[data-toggle-task-menu]');
  if (taskMenuBtn) {
    event.stopPropagation();
    const taskId = taskMenuBtn.dataset.toggleTaskMenu;
    uiState.activeTaskMoreMenuId = uiState.activeTaskMoreMenuId === taskId ? '' : taskId;
    await renderTasksBoard();
    return;
  }

  const taskEditBtn = event.target.closest('.task-action-edit');
  if (taskEditBtn) {
    event.preventDefault();
    const taskId = taskEditBtn.dataset.editTaskId;
    uiState.activeTaskMoreMenuId = '';
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
    uiState.activeTaskMoreMenuId = '';
    await renderTasksBoard();
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
    const task = state.taskStore.byId[taskId] || [...state.dashboardTasks, ...state.documentTasks].find(t => t._id === taskId);
    if (!task) return;
    
    if (confirm(`Are you sure you want to delete "${task.title}"?`)) {
      const docId = task.documentId || task.document;
      const previousTask = { ...task };
      removeTaskFromStore(taskId);
      uiState.activeTaskMoreMenuId = '';
      await renderTasksBoard();
      if (state.demoMode) {
        showToast('Demo task deleted locally');
      } else {
        try {
          await request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${docId}/tasks/${taskId}`, {
            method: 'DELETE'
          });
          showToast('Task deleted successfully');
        } catch (err) {
          upsertTaskInStore(previousTask);
          await renderTasksBoard();
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
    uiState.threadFilterTab = threadsTabBtn.dataset.threadsTab;
    renderThreadsPage();
    return;
  }

  const clearThreadsSearch = event.target.closest('#threadsClearSearchBtn');
  if (clearThreadsSearch) {
    event.preventDefault();
    uiState.threadSearchQuery = '';
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
      if (nextStatus === 'resolved') {
        markLectureMilestone(thread.documentId || state.selectedDocumentId, 'doubtResolved', { message: 'Doubt resolved' });
      } else {
        refreshLectureProgress(thread.documentId || state.selectedDocumentId);
      }
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
        if (nextStatus === 'resolved') {
          markLectureMilestone(thread.documentId || state.selectedDocumentId, 'doubtResolved', { message: 'Doubt resolved' });
        } else {
          refreshLectureProgress(thread.documentId || state.selectedDocumentId);
        }
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
      cardBody.innerHTML = `<p style="display: flex; align-items: center; gap: 8px; font-weight: 500; color: var(--primary);">✦ Nexus Mentor is reading the linked lecture context...</p>`;
    }

    if (state.demoMode) {
      window.setTimeout(() => {
        const responseText = `Nexus Mentor:\n\nBased on the Deadlocks lecture, circular wait matters because each process holds one resource while waiting for the next process in the cycle.\n\n- If the cycle stays unbroken, no process can move forward.\n- Deadlock prevention breaks at least one necessary condition, such as circular wait.\n- Banker's algorithm is different: it avoids unsafe states before the cycle becomes permanent.`;
        const reply = {
          _id: `demo-doc-reply-${Date.now()}`,
          sender: { _id: 'nexus-mentor', username: 'Nexus Mentor', email: 'mentor@nexus.local' },
          body: responseText,
          createdAt: new Date().toISOString()
        };
        thread.replies = [...(thread.replies || []), reply];
        state.documentMessages = state.documentMessages.map(item => item._id === threadId ? { ...item, ...thread } : item);
        showToast('Nexus Mentor added an answer');
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
          body: `Nexus Mentor:\n\n${explanationText}`,
          parentMessageId: threadId
        })
      });
      thread.replies = [...(thread.replies || []), reply];
      state.documentMessages = state.documentMessages.map(item => item._id === threadId ? { ...item, ...thread } : item);
      showToast('Nexus Mentor added an answer');
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
    handleChatMessageAction(action, msgId, msgArticle, event.target);
    return;
  }

  // --- Emoji Reaction Chips Click ---
  const reactionChip = event.target.closest('.chat-reaction-chip:not(.add-reaction-chip-btn)');
  if (reactionChip) {
    event.preventDefault();
    const emoji = reactionChip.dataset.emoji;
    const msgArticle = reactionChip.closest('.workspace-chat-message');
    const msgId = msgArticle?.dataset.messageId;
    if (msgId && emoji) {
      toggleReaction(msgId, emoji);
    }
    return;
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
  clearInlineErrors(event.target);
  try {
    const payload = {
      email: els.emailInput.value.trim(),
      password: els.passwordInput.value
    };
    let hasError = false;
    if (!payload.email) {
      showInlineError(els.emailInput, 'Enter your email address.');
      hasError = true;
    } else if (!els.emailInput.validity.valid) {
      showInlineError(els.emailInput, 'Enter a valid email address.');
      hasError = true;
    }
	    if (!payload.password) {
	      showInlineError(els.passwordInput, 'Enter your password.');
	      hasError = true;
	    } else if (state.authMode === 'register' && payload.password.length < 8) {
	      showInlineError(els.passwordInput, 'Use at least 8 characters.');
	      hasError = true;
	    }
	    if (state.authMode === 'register') {
	      payload.username = els.usernameInput.value.trim();
	      if (!payload.username) {
	        showInlineError(els.usernameInput, 'Choose a username.');
	        hasError = true;
	      } else if (!isValidSignupUsername(payload.username)) {
	        showInlineError(els.usernameInput, 'Use 3-50 letters, numbers, underscores, or hyphens.');
	        hasError = true;
	      }
	    }
    if (hasError) {
      focusFirstInvalid(event.target);
      return showToast('Please fix the highlighted fields.', true);
    }

    const authButton = event.target.querySelector('button[type="submit"]');
    authButton.disabled = true;
    authButton.setAttribute('aria-busy', 'true');

    const mode = state.authMode === 'register' ? 'register' : 'login';
    const result = await request(`/api/auth/${mode}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (mode === 'register') {
      setPendingVerificationEmail(payload.email);
      showToast('Account created. Enter the OTP sent to your email.');
      navigate('verify-email');
      window.setTimeout(() => startVerificationResendCountdown(60), 0);
      return;
    }
    completeAuthenticatedSession(result);
	  } catch (err) {
	    const message = friendlyUiMessage(err.message, { isError: true });
	    showToast(message, true);
	    if (/username/i.test(message) && els.usernameInput) {
	      showInlineError(els.usernameInput, message);
	    } else if (/email|registered|credentials|password|sign in/i.test(message)) {
	      showInlineError(/password/i.test(message) ? els.passwordInput : els.emailInput, message);
	    }
	    if (/verify your email/i.test(message) && els.emailInput?.value) {
	      setPendingVerificationEmail(els.emailInput.value);
	      navigate('verify-email');
    }
  } finally {
    const authButton = event.target.querySelector('button[type="submit"]');
    if (authButton) {
      authButton.disabled = false;
      authButton.removeAttribute('aria-busy');
    }
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

bindEditorCommandHandlers();

els.workspaceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearInlineErrors(event.target);
  const createButton = event.target.querySelector('button[type="submit"], .primary');
  const workspaceName = els.workspaceNameInput.value.trim();
  if (!workspaceName) {
    showInlineError(els.workspaceNameInput, 'Name this workspace so you can find it later.');
    focusFirstInvalid(event.target);
    return showToast('Workspace name is required.', true);
  }
  if (state.demoMode) {
    els.workspaceNameInput.value = '';
    return showToast('Demo mode uses the sample CS Final Year workspace. Sign up to create your own.');
  }

  try {
    if (createButton) {
      createButton.disabled = true;
      createButton.setAttribute('aria-busy', 'true');
    }
    const workspace = await createWorkspaceAndOpen(workspaceName);
    if (workspace) els.workspaceNameInput.value = '';
  } catch (err) {
    showToast(friendlyUiMessage(err.message, { isError: true }), true);
  } finally {
    if (createButton) {
      createButton.disabled = false;
      createButton.removeAttribute('aria-busy');
    }
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
  if (uiState.activeTaskMoreMenuId) {
    const isMenuToggle = event.target.closest('[data-toggle-task-menu]');
    const isMenuCard = event.target.closest('.chat-dropdown-menu');
    if (!isMenuToggle && !isMenuCard) {
      uiState.activeTaskMoreMenuId = '';
      renderTasksBoard();
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

bindThreadPanelHandlers();

const insertPlainTextAtCursor = (text = '') => {
  if (!text) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !els.documentEditor.contains(selection.anchorNode)) {
    els.documentEditor.append(document.createTextNode(text));
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

  const html = event.clipboardData?.getData('text/html') || '';
  const text = event.clipboardData?.getData('text/plain') || '';
  if (editorUsesRichContent() && html) {
    insertRichHtml(html);
    return;
  }
  if (editorUsesRichContent()) {
    insertRichHtml(escapeHtml(text).replace(/\n/g, '<br>'));
  } else {
    insertPlainTextAtCursor(text);
  }
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
  updateEditorStudyStats();
  saveEditorSelection();
  updateFloatingSelectionToolbar();
});

els.documentTitleInput.addEventListener('input', () => {
  const doc = selectedDocument();
  if (!doc) return;
  doc.title = els.documentTitleInput.value || 'Untitled lecture';
  refreshDocumentTitleChrome({ deferList: true });
  scheduleAutosave();
});

els.documentEditor.addEventListener('keyup', publishCursor);
els.documentEditor.addEventListener('keyup', () => {
  saveEditorSelection();
  updateEditorStudyStats();
  scheduleAiSelectionHintUpdate();
});
els.documentEditor.addEventListener('scroll', updateEditorStudyStats);
document.querySelector('.editor-pane')?.addEventListener('scroll', updateEditorStudyStats);
els.documentEditor.addEventListener('click', (event) => {
  publishCursor();
  saveEditorSelection();
  scheduleAiSelectionHintUpdate();

  const checkbox = event.target.closest('.checklist input[type="checkbox"]');
  const li = event.target.closest('.checklist li');
  if (checkbox) {
    event.preventDefault();
    event.stopPropagation();
    if (checkbox.hasAttribute('checked')) {
      checkbox.removeAttribute('checked');
      checkbox.checked = false;
    } else {
      checkbox.setAttribute('checked', 'checked');
      checkbox.checked = true;
    }
    commitRichEditorChange();
  } else if (li && event.target === li) {
    const cb = li.querySelector('input[type="checkbox"]');
    if (cb) {
      if (cb.hasAttribute('checked')) {
        cb.removeAttribute('checked');
        cb.checked = false;
      } else {
        cb.setAttribute('checked', 'checked');
        cb.checked = true;
      }
      commitRichEditorChange();
    }
  }
});
els.documentEditor.addEventListener('mouseup', () => {
  saveEditorSelection();
  scheduleAiSelectionHintUpdate();
});
els.documentEditor.addEventListener('select', () => {
  publishCursor();
  saveEditorSelection();
  scheduleAiSelectionHintUpdate();
});
document.addEventListener('selectionchange', () => {
  saveEditorSelection();
  scheduleAiSelectionHintUpdate();
});
window.addEventListener('resize', updateFloatingSelectionToolbar);

els.refreshMessagesBtn.addEventListener('click', () => loadDocumentMessages().catch((err) => showToast(err.message, true)));

els.newDocBtn.addEventListener('click', async () => {
  if (!state.selectedWorkspaceId) return;
  if (state.demoMode) {
    createDemoDocument();
    return;
  }

  try {
    const doc = await createDocumentAndOpen('Untitled Lecture');
    if (!doc) return;
    showToast('Lecture created');
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
    showToast('Lecture saved');
  } catch (err) {
    showToast(err.message, true);
  }
});

bindTaskPanelHandlers();

els.runAiBtn.addEventListener('click', async () => {
  await runStudyAiAction(els.aiActionSelect.value || 'summarize');
});

document.getElementById('aiPromptForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('aiPromptInput');
  const prompt = input?.value.trim() || '';
  if (!prompt) return;
  const lowerPrompt = prompt.toLowerCase();
  const action = lowerPrompt.includes('quiz') || lowerPrompt.includes('test')
    ? 'quiz'
    : lowerPrompt.includes('flashcard') || lowerPrompt.includes('card')
      ? 'flashcards'
      : lowerPrompt.includes('question') || lowerPrompt.includes('exam')
        ? 'important-questions'
        : lowerPrompt.includes('explain') || lowerPrompt.includes('why') || lowerPrompt.includes('how')
          ? 'simple-explanation'
          : 'summarize';
  input.value = '';
  await runStudyAiAction(action, prompt);
});

els.aiOutput?.addEventListener('click', handleAiStudyOutputClick);

els.saveAiToDocumentBtn?.addEventListener('click', () => {
  saveAiOutputToDocument().catch((err) => showToast(err.message, true));
});

els.saveAiToLibraryBtn?.addEventListener('click', () => {
  saveCurrentAiResultToLibrary().catch((err) => showToast(err.message, true));
});

els.copyAiOutputBtn?.addEventListener('click', async () => {
  if (!state.lastAiOutput.trim()) return showToast('Generate mentor output first', true);
  try {
    await navigator.clipboard.writeText(state.lastAiOutput);
    showToast('Mentor output copied');
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
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');

  if (state.demoMode) {
    await loadDemoWorkspaceModule();
    hydrateDemoWorkspace();
    loadDemoDocument(state.selectedDocumentId);
  }

  if (!state.demoMode && !state.token && state.csrfToken) {
    await restoreSessionFromRefresh();
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
    membersState.activeTab = tabBtn.dataset.membersTab;
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
    inviteState.latestCreatedInvite = null;
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
      rememberCreatedInvite({
        code: 'NEXUS-DEMO-CODE',
        inviteLink: `${location.origin}${location.pathname}#/invite?code=NEXUS-DEMO-CODE`
      });
      showInviteMemberModal();
      return;
    }
    const workspace = selectedWorkspace();
    if (!workspace?._id) return showToast('Select a workspace first', true);
    const email = document.getElementById('inviteEmailInput')?.value.trim();
    const role = document.getElementById('inviteRoleInput')?.value || 'member';
    
    if (inviteState.inviteRequestInFlight) return;
    inviteState.inviteRequestInFlight = true;
    target.disabled = true;
    try {
      const result = await request(`/api/invites/${workspace._id}`, {
        method: 'POST',
        body: JSON.stringify({ email, role })
      });
      rememberCreatedInvite(result);
      showInviteMemberModal();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      inviteState.inviteRequestInFlight = false;
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
    inviteState.latestCreatedInvite = null;
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
    if (!member || membersState.removingMemberId) return;
    membersState.removingMemberId = memberId;
    confirmRemoveBtn.disabled = true;
    confirmRemoveBtn.setAttribute('aria-busy', 'true');
    confirmRemoveBtn.textContent = 'Removing...';
    try {
      await request(`/api/workspaces/${state.selectedWorkspaceId}/members/${memberId}`, { method: 'DELETE' });
      await loadWorkspaces();
      document.getElementById('membersRemoveModal')?.remove();
      membersState.removeCandidateId = '';
      showToast(`${displayName} removed from workspace.`);
      renderMembersPage();
    } catch (err) {
      showToast(err.message, true);
      confirmRemoveBtn.disabled = false;
      confirmRemoveBtn.removeAttribute('aria-busy');
      confirmRemoveBtn.textContent = 'Remove Member';
    } finally {
      membersState.removingMemberId = '';
    }
    return;
  }

  if (target.closest('[data-close-members-modal]') || target.classList.contains('members-modal-backdrop')) {
    document.getElementById('membersDetailsModal')?.remove();
    document.getElementById('membersRemoveModal')?.remove();
    membersState.removeCandidateId = '';
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (membersState.activeMenuMemberId) closeMembersActionMenu();
    document.getElementById('membersDetailsModal')?.remove();
    document.getElementById('membersRemoveModal')?.remove();
    membersState.removeCandidateId = '';
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
    if (!member || membersState.removingMemberId) return;
    membersState.removingMemberId = memberId;
    confirmRemoveBtn.disabled = true;
    confirmRemoveBtn.setAttribute('aria-busy', 'true');
    confirmRemoveBtn.textContent = 'Removing...';
    try {
      await request(`/api/workspaces/${state.selectedWorkspaceId}/members/${memberId}`, { method: 'DELETE' });
      await loadWorkspaces();
      document.getElementById('membersRemoveModal')?.remove();
      membersState.removeCandidateId = '';
      showToast(`${displayName} removed from workspace.`);
      renderMembersPage();
    } catch (err) {
      showToast(err.message, true);
      confirmRemoveBtn.disabled = false;
      confirmRemoveBtn.removeAttribute('aria-busy');
      confirmRemoveBtn.textContent = 'Remove Member';
    } finally {
      membersState.removingMemberId = '';
    }
    return;
  }

  if (event.target.closest('[data-close-members-modal]') || event.target.classList.contains('members-modal-backdrop')) {
    document.getElementById('membersDetailsModal')?.remove();
    document.getElementById('membersRemoveModal')?.remove();
    membersState.removeCandidateId = '';
    return;
  }

  const menuAction = event.target.closest('#membersActionPortal .members-menu-action-btn');
  if (menuAction) {
    event.preventDefault();
    await handleMembersMenuAction(menuAction);
    return;
  }

  if (
    membersState.activeMenuMemberId
    && !event.target.closest('#membersActionPortal')
    && !event.target.closest('.members-menu-trigger-btn')
  ) {
    closeMembersActionMenu();
  }
});

window.addEventListener('resize', () => {
  if (membersState.activeMenuMemberId) closeMembersActionMenu();
});

window.addEventListener('scroll', () => {
  if (membersState.activeMenuMemberId) closeMembersActionMenu();
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
    settingsState.workspaceName = target.value;
    updateSaveButtonState();
  } else if (target.id === 'settingsWorkspaceDescriptionInput') {
    settingsState.workspaceDescription = target.value;
    updateSaveButtonState();
  }
});

els.routePage.addEventListener('change', (event) => {
  const target = event.target;
  if (target.id === 'settingsDensitySelect') {
    settingsState.density = target.value;
    updateSaveButtonState();
  } else if (target.id === 'settingsReduceMotionInput') {
    settingsState.reduceMotion = target.checked;
    updateSaveButtonState();
  } else if (target.id === 'settingsEmailNotificationsInput') {
    settingsState.emailNotifications = target.checked;
    updateSaveButtonState();
  } else if (target.id === 'settingsTaskNotificationsInput') {
    settingsState.taskNotifications = target.checked;
    updateSaveButtonState();
  } else if (target.id === 'settingsDiscussionNotificationsInput') {
    settingsState.discussionNotifications = target.checked;
    updateSaveButtonState();
  } else if (target.id === 'settingsMentionNotificationsInput') {
    settingsState.mentionNotifications = target.checked;
    updateSaveButtonState();
  } else if (target.id === 'settingsInviteNotificationsInput') {
    settingsState.inviteNotifications = target.checked;
    updateSaveButtonState();
  }
});

els.routePage.addEventListener('click', (event) => {
  const target = event.target;
  if (target.closest('[data-account-security-close]')) {
    event.preventDefault();
    closeAccountSecurityModal();
    return;
  }
  const passwordAction = target.closest('[data-account-password-action]');
  if (passwordAction) {
    event.preventDefault();
    showAccountPasswordModal(passwordAction.dataset.accountPasswordAction);
    return;
  }
  if (target.closest('[data-account-delete-start]')) {
    event.preventDefault();
    showAccountDeleteModal('primary');
    return;
  }
  const themeCard = target.closest('.theme-select-card');
  if (themeCard) {
    event.preventDefault();
    const val = themeCard.dataset.themeVal;
    settingsState.theme = val;
    state.preferences.theme = val;
    localStorage.setItem('theme', val);
    persistPreferences();
    applyPreferences();
    
    // Update theme card active styles in DOM
    themeCard.parentNode.querySelectorAll('.theme-select-card').forEach(card => {
      card.classList.toggle('active', card.dataset.themeVal === val);
    });
    
    updateSaveButtonState();
  }
});

els.routePage.addEventListener('submit', async (event) => {
  if (event.target.id === 'accountPasswordForm') {
    event.preventDefault();
    const form = event.target;
    const mode = form.dataset.passwordMode || 'set';
    const submitButton = form.querySelector('button[type="submit"]');
    const newPassword = document.getElementById('accountNewPasswordInput')?.value || '';
    const confirmPassword = document.getElementById('accountConfirmPasswordInput')?.value || '';
    if (newPassword !== confirmPassword) {
      return showToast('Passwords do not match.', true);
    }
    try {
      submitButton.disabled = true;
      if (mode === 'change') {
        await request('/api/account/change-password', {
          method: 'POST',
          body: JSON.stringify({
            currentPassword: document.getElementById('accountCurrentPasswordInput')?.value || '',
            newPassword,
            confirmPassword
          })
        });
        showToast('Password changed. Other sessions were revoked.');
      } else {
        const result = await request('/api/account/set-password', {
          method: 'POST',
          body: JSON.stringify({ password: newPassword, confirmPassword })
        });
        if (result?.user) {
          state.user = result.user;
          localStorage.setItem('user', JSON.stringify(result.user));
          renderSessionChrome();
        }
        showToast('Password set. Email/password sign-in is now enabled.');
      }
      closeAccountSecurityModal();
      await refreshAccountSecurity();
      await renderSettingsPage();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
    return;
  }

  if (event.target.id === 'accountDeleteRequestForm') {
    event.preventDefault();
    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const security = state.accountSecurity?.data || {};
    const hasPassword = Boolean(security.password?.hasPassword ?? state.user?.hasPassword);
    try {
      submitButton.disabled = true;
      const googleIdToken = hasPassword ? '' : await loadGoogleIdentityToken();
      await request('/api/account/delete/request', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: document.getElementById('accountDeletePasswordInput')?.value || '',
          googleIdToken
        })
      });
      showToast('Deletion OTP sent to your email.');
      showAccountDeleteModal('confirm');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
    return;
  }

  if (event.target.id === 'accountDeleteConfirmForm') {
    event.preventDefault();
    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');
    if (!document.getElementById('accountDeleteFinalInput')?.checked) {
      return showToast('Confirm that account deletion cannot be undone.', true);
    }
    try {
      submitButton.disabled = true;
      await request('/api/account/delete/confirm', {
        method: 'POST',
        body: JSON.stringify({
          otp: document.getElementById('accountDeleteOtpInput')?.value.trim() || '',
          confirmation: document.getElementById('accountDeleteConfirmationInput')?.value.trim() || ''
        })
      });
      closeAccountSecurityModal();
      clearSession();
      navigate('login');
      await renderRoute();
      showToast('Account deleted.');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }
});


configureRouterRuntime({
  shell: {
    render,
    resolveStartupSurface,
    showToast
  },
  auth: {
    renderAuthPage,
    renderPasswordRecoveryPage,
    renderEmailVerificationPage,
    renderOAuthCallbackPage,
    completeOAuthCallback
  },
  routes: {
    renderInvitePage,
    renderHomePage,
    renderChatPage,
    renderThreadsPage,
    renderTasksPage,
    renderTasksBoard,
    renderMembersPage,
    renderSettingsPage,
    renderWorkspaceSettingsPage,
    renderWorkspacePage
  },
  data: {
    loadWorkspaceThreads,
    loadDashboardTasks,
    loadWorkspaces
  },
  demo: {
    exitDemoMode
  }
});

configureChatFeatureRuntime({
  shell: {
    setMainMode,
    setRouteChrome,
    els,
    loadingRows,
    emptyState,
    showToast
  },
  session: {
    ensureChatReady
  },
  chat: {
    activeChatChannel,
    chatOnlineCount,
    clearChatUnread,
    isMine,
    chatSenderName,
    updateSearchMatchesCounter,
    highlightActiveMatch
  },
  data: {
    request
  },
  markdown: {
    parseMarkdownToHtml
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
    demoWorkspacePromise: { configurable: true, get: () => demoRuntime.workspacePromise, set: (value) => { demoRuntime.workspacePromise = value; } },
    Y: { configurable: true, get: () => socketState.Y, set: (value) => { socketState.Y = value; } },
    socketIo: { configurable: true, get: () => socketState.socketIo, set: (value) => { socketState.socketIo = value; } },
    demoWorkspaceModule: { configurable: true, get: () => demoRuntime.workspaceModule, set: (value) => { demoRuntime.workspaceModule = value; } },
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
    latestCreatedInvite: { configurable: true, get: () => inviteState.latestCreatedInvite, set: (value) => { inviteState.latestCreatedInvite = value; } },
    activeJoinInvite: { configurable: true, get: () => inviteState.activeJoinInvite, set: (value) => { inviteState.activeJoinInvite = value; } },
    inviteRequestInFlight: { configurable: true, get: () => inviteState.inviteRequestInFlight, set: (value) => { inviteState.inviteRequestInFlight = value; } },
    activeDocumentLoadToken: { configurable: true, get: () => activeDocumentLoadToken, set: (value) => { activeDocumentLoadToken = value; } },
    deletingDocumentIds: { configurable: true, get: () => deletingDocumentIds },
    selectedCommandIndex: { configurable: true, get: () => uiState.selectedCommandIndex, set: (value) => { uiState.selectedCommandIndex = value; } },
    threadFilterTab: { configurable: true, get: () => uiState.threadFilterTab, set: (value) => { uiState.threadFilterTab = value; } },
    threadSearchQuery: { configurable: true, get: () => uiState.threadSearchQuery, set: (value) => { uiState.threadSearchQuery = value; } },
    taskSearchQuery: { configurable: true, get: () => uiState.taskSearchQuery, set: (value) => { uiState.taskSearchQuery = value; } },
    taskFilterTab: { configurable: true, get: () => uiState.taskFilterTab, set: (value) => { uiState.taskFilterTab = value; } },
    taskSortField: { configurable: true, get: () => uiState.taskSortField, set: (value) => { uiState.taskSortField = value; } },
    taskViewMode: { configurable: true, get: () => uiState.taskViewMode, set: (value) => { uiState.taskViewMode = value; } },
    activeTaskMoreMenuId: { configurable: true, get: () => uiState.activeTaskMoreMenuId, set: (value) => { uiState.activeTaskMoreMenuId = value; } },
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
    friendlyUiMessage: { configurable: true, get: () => friendlyUiMessage },
    clearInlineErrors: { configurable: true, get: () => clearInlineErrors },
    showInlineError: { configurable: true, get: () => showInlineError },
    focusFirstInvalid: { configurable: true, get: () => focusFirstInvalid },
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
    LECTURE_PROGRESS_MILESTONES: { configurable: true, get: () => LECTURE_PROGRESS_MILESTONES },
    calculateLectureLearningProgress: { configurable: true, get: () => calculateLectureLearningProgress },
    calculateWorkspaceLearningProgress: { configurable: true, get: () => calculateWorkspaceLearningProgress },
    taskId: { configurable: true, get: () => taskId },
    normalizeTask: { configurable: true, get: () => normalizeTask },
    workspaceTaskList: { configurable: true, get: () => workspaceTaskList },
    syncLegacyTaskViews: { configurable: true, get: () => syncLegacyTaskViews },
    setWorkspaceTasks: { configurable: true, get: () => setWorkspaceTasks },
    upsertTaskInStore: { configurable: true, get: () => upsertTaskInStore },
    removeTaskFromStore: { configurable: true, get: () => removeTaskFromStore },
    selectedDocumentTasks: { configurable: true, get: () => selectedDocumentTasks },
    markLectureMilestone: { configurable: true, get: () => markLectureMilestone },
    refreshLectureProgress: { configurable: true, get: () => refreshLectureProgress },
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
    editorUsesRichContent: { configurable: true, get: () => editorUsesRichContent },
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
    renderEmailVerificationPage: { configurable: true, get: () => renderEmailVerificationPage },
    renderOAuthCallbackPage: { configurable: true, get: () => renderOAuthCallbackPage },
    completeOAuthCallback: { configurable: true, get: () => completeOAuthCallback },
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
    showEmojiPicker: { configurable: true, get: () => showEmojiPicker },
    toggleReaction: { configurable: true, get: () => toggleReaction },
    renderThreadListSection: { configurable: true, get: () => renderThreadListSection },
    renderThreadDetailHtml: { configurable: true, get: () => renderThreadDetailHtml },
    renderThreadsPage: { configurable: true, get: () => renderThreadsPage },
    getFilteredTasks: { configurable: true, get: () => getFilteredTasks },
    renderTaskCardHtml: { configurable: true, get: () => renderTaskCardHtml },
    showAddTaskModal: { configurable: true, get: () => showAddTaskModal },
    showEditTaskModal: { configurable: true, get: () => showEditTaskModal },
    renderTasksBoard: { configurable: true, get: () => renderTasksBoard },
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
    addActivity: { configurable: true, get: () => addActivity },
    renderActivityList: { configurable: true, get: () => renderActivityList },
    updateTypingStatus: { configurable: true, get: () => updateTypingStatus },
    getActivityIcon: { configurable: true, get: () => getActivityIcon },
    getFilteredWorkspaceThreads: { configurable: true, get: () => getFilteredWorkspaceThreads },
    showAskDoubtModal: { configurable: true, get: () => showAskDoubtModal },
    renderEmptyDetailHtml: { configurable: true, get: () => renderEmptyDetailHtml },
    sortTasks: { configurable: true, get: () => sortTasks },
    getTaskStats: { configurable: true, get: () => getTaskStats },
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
