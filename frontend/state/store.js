export const state = {
  token: '',
  csrfToken: localStorage.getItem('csrfToken') || '',
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  demoMode: sessionStorage.getItem('demoMode') === 'true',
  authMode: 'login',
  workspaces: [],
  channels: [],
  documents: [],
  messages: [],
  chatMessages: [],
  chatLoadedKey: '',
  chatTypingUsers: [],
  chatOnlineUsers: [],
  unreadChatCount: Number(localStorage.getItem('chatUnreadCount') || 0),
  documentMessages: [],
  workspaceThreads: [],
  taskStore: {
    byId: {},
    ids: [],
    loadedWorkspaceId: '',
    loading: false,
    loadedAt: 0,
    error: ''
  },
  documentTasks: [],
  dashboardTasks: [],
  studyMaterials: [],
  demoStudyMaterials: [],
  selectedStudyMaterialId: '',
  currentAiResultSavedId: '',
  studyMaterialSaving: false,
  selectedThreadId: '',
  threadFilter: 'open',
  pendingDoubtLinkedText: '',
  activityItems: [],
  typingUsers: [],
  lastAiAction: '',
  lastAiOutput: '',
  aiStructuredOutput: null,
  aiStudySession: null,
  activeContextTab: 'ai',
  contextLoadedFor: {
    tasks: '',
    threads: '',
    library: ''
  },
  activeSettingsTab: localStorage.getItem('settingsTab') || 'general',
  accountSecurity: {
    loading: false,
    loaded: false,
    error: '',
    data: null
  },
  preferences: (() => {
    const prefs = JSON.parse(localStorage.getItem('nexusPreferences') || '{"theme":"light","density":"comfortable","reduceMotion":false,"emailNotifications":true,"taskNotifications":true,"discussionNotifications":true}');
    const theme = localStorage.getItem('theme');
    if (theme) {
      prefs.theme = theme;
    }
    return prefs;
  })(),
  selectedWorkspaceId: localStorage.getItem('workspaceId') || '',
  selectedChannelId: localStorage.getItem('channelId') || '',
  selectedDocumentId: localStorage.getItem('documentId') || '',
  saveStatus: 'saved',
  pendingSavePromise: null,
  saveQueued: false,
  lastSavedText: '',
  lastSavedTitle: '',
  socketConnected: false,
  presence: [],
  loading: {
    workspaces: false,
    documents: false,
    channels: false,
    chat: false,
    messages: false,
    threads: false,
    tasks: false,
    studyMaterials: false,
    document: false
  },
  errors: {}
};

export const collab = {
  socket: null,
  ydoc: null,
  ytext: null,
  activeDocumentId: '',
  applyingRemote: false,
  localInput: false
};

export const selectedWorkspace = () => state.workspaces.find((workspace) => workspace._id === state.selectedWorkspaceId);

export const selectedChannel = () => state.channels.find((channel) => channel.slug === state.selectedChannelId);

export const documentKey = (document = {}) => document?._id ? String(document._id) : '';

export const selectedDocument = () => state.documents.find((document) => documentKey(document) === String(state.selectedDocumentId));

export const dedupeDocuments = (documents = []) => {
  const seen = new Set();
  return documents.filter((document) => {
    const key = documentKey(document);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const setDocuments = (documents = []) => {
  state.documents = dedupeDocuments(documents);
};

export const upsertDocument = (document, { prepend = false } = {}) => {
  if (!document || !documentKey(document)) return;
  const key = documentKey(document);
  const existing = state.documents.find((item) => documentKey(item) === key) || {};
  const merged = { ...existing, ...document };
  const others = state.documents.filter((item) => documentKey(item) !== key);
  state.documents = prepend ? [merged, ...others] : dedupeDocuments([...others, merged]);
};

export const isDemoMode = () => state.demoMode;
