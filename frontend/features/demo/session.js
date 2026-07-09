export const createDemoSession = ({
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
  setEditorHtml,
  setEditorText,
  getEditorText,
  getEditorHtml,
  selectedDocument,
  setAutosaveStatus,
  setCollabStatus,
  renderAiEmptyState,
  renderPresence,
  render,
  showToast,
  navigate,
  upsertDocument,
  addActivity,
  markLectureMilestone,
  refreshLectureProgress
}) => {
  const hydrateDemoWorkspace = ({ selectedDocumentId = state.selectedDocumentId } = {}) => {
    const { createDemoState, DEMO_WORKSPACE_ID } = requireDemoWorkspaceModule();
    const demo = createDemoState();
    const documentId = demo.documents.some((doc) => String(doc._id) === String(selectedDocumentId))
      ? selectedDocumentId
      : 'demo-doc-os-deadlocks';

    state.user = demo.user;
    state.workspaces = demo.workspaces.map((workspace) => ({
      ...workspace,
      members: (workspace.members || []).slice(0, 3)
    }));
    state.channels = demo.channels.slice(0, 5);
    setDocuments(demo.documents.slice(0, 8));
    state.messages = demo.messages.slice();
    state.chatMessages = demo.messages.slice();
    state.documentMessages = demo.documentMessages.slice(0, 5);
    state.workspaceThreads = state.documentMessages
      .slice(0, 5)
      .map((thread) => ({ ...thread, documentTitle: 'Lecture 5: Deadlocks', documentId: 'demo-doc-os-deadlocks' }));
    state.presence = demo.presence.slice(0, 3);
    state.activityItems = demo.activityItems.slice(0, 5);
    state.typingUsers = [{ userId: 'demo-user-priya', email: 'Priya Sharma' }];
    state.selectedWorkspaceId = DEMO_WORKSPACE_ID;
    state.selectedChannelId = GENERAL_CHAT_CHANNEL;
    state.selectedDocumentId = documentId;
    setWorkspaceTasks(demo.documentTasks.slice(0, 5), { workspaceId: DEMO_WORKSPACE_ID });
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
    els.documentTitleInput.value = doc.title || 'Untitled Lecture';
    setEditorHtml(doc.contentHtml || '', doc.plainTextContent || '');
    state.lastSavedTitle = els.documentTitleInput.value;
    state.lastSavedText = doc.plainTextContent || '';
    state.lastSavedHtml = doc.contentHtml || '';
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
    state.csrfToken = '';
    localStorage.removeItem('token');
    localStorage.removeItem('csrfToken');
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
    resetTaskStore();
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
    doc.title = els.documentTitleInput.value || 'Untitled lecture';
    doc.plainTextContent = getEditorText();
    doc.contentHtml = getEditorHtml();
    doc.updatedAt = new Date().toISOString();
    state.lastSavedTitle = doc.title;
    state.lastSavedText = doc.plainTextContent;
    state.lastSavedHtml = doc.contentHtml || '';
    state.saveStatus = 'saved';
    setAutosaveStatus(silent ? 'Demo autosaved locally' : 'Demo saved locally');
    if (!silent) addActivity({ action: 'studied', target: doc.title || 'Untitled lecture', documentId: doc._id });
    if (doc.plainTextContent.trim().length >= 40) {
      markLectureMilestone(doc._id, 'notesAdded', {
        message: 'Notes added',
        show: !silent
      });
    } else {
      refreshLectureProgress(doc._id);
    }
    if (!silent) showToast('Demo changes are temporary. Create an account to save your own workspace.');
    render();
    return doc;
  };

  const createDemoDocument = () => {
    const doc = {
      _id: `demo-doc-${Date.now()}`,
      title: 'Untitled Lecture',
      category: 'Operating Systems',
      progress: 0,
      revisionStatus: 'New lecture',
      plainTextContent: '',
      updatedAt: new Date().toISOString()
    };
    upsertDocument(doc, { prepend: true });
    loadDemoDocument(doc._id);
    addActivity({ action: 'created lecture', target: doc.title, documentId: doc._id });
    showToast('Demo lecture created locally');
  };

  return {
    hydrateDemoWorkspace,
    loadDemoDocument,
    enterDemoMode,
    exitDemoMode,
    saveDemoDocument,
    createDemoDocument
  };
};
