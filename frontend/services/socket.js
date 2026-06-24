import { state, collab, selectedDocument } from '../state/store.js';

export const socketState = {
  yjsModulePromise: null,
  socketClientPromise: null,
  Y: null,
  socketIo: null,
  joinedChannelWorkspaceId: null,
  joinedChannelId: null,
  joinedWorkspacePresenceId: null,
  lastCursorPublishAt: 0,
  lastTypingPublishAt: 0,
  lastChatTypingPublishAt: 0,
  typingTimer: null,
  chatTypingTimer: null
};

const setCollabStatus = (message) => {
  if (globalThis.els?.collabStatus) {
    globalThis.els.collabStatus.textContent = message;
  }
};

export const loadYjs = async () => {
  if (!socketState.yjsModulePromise) {
    socketState.yjsModulePromise = import('yjs');
  }
  socketState.Y = socketState.Y || await socketState.yjsModulePromise;
  return socketState.Y;
};

export const loadSocketClient = async () => {
  if (!socketState.socketClientPromise) {
    socketState.socketClientPromise = import('socket.io-client');
  }
  socketState.socketIo = socketState.socketIo || (await socketState.socketClientPromise).io;
  return socketState.socketIo;
};

const base64ToUint8 = (value) => {
  return globalThis.base64ToUint8(value);
};

const uint8ToBase64 = (uint8Array) => {
  return globalThis.uint8ToBase64(uint8Array);
};

export const connectSocket = async () => {
  if (!state.token || collab.socket) return;
  const io = await loadSocketClient();

  collab.socket = io(globalThis.API_BASE, {
    auth: { token: state.token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000
  });

  collab.socket.on('connect', () => {
    state.socketConnected = true;
    setCollabStatus('Live collaboration connected');
    socketState.joinedChannelWorkspaceId = null;
    socketState.joinedChannelId = null;
    socketState.joinedWorkspacePresenceId = null;
    if (collab.activeDocumentId) collab.activeDocumentId = null;
    
    joinChannelRoom();
    joinWorkspaceChat();
    if (state.selectedDocumentId) joinDocumentRoom(state.selectedDocumentId);
  });

  collab.socket.on('disconnect', () => {
    state.socketConnected = false;
    setCollabStatus('Offline. Changes will resync after reconnect.');
  });

  collab.socket.on('operation-error', ({ message }) => {
    globalThis.showToast(message || 'Realtime operation failed', true);
  });

  collab.socket.on('document-synced', ({ documentId, updateBase64, text, users }) => {
    if (documentId !== state.selectedDocumentId || !collab.ydoc) return;

    collab.applyingRemote = true;
    try {
      if (updateBase64) {
        socketState.Y.applyUpdate(collab.ydoc, base64ToUint8(updateBase64), 'remote');
      } else if (collab.ytext.length === 0 && text) {
        collab.ydoc.transact(() => {
          collab.ytext.insert(0, text);
        }, 'remote');
      }

      const syncedText = collab.ytext.toString();
      globalThis.setEditorText(syncedText);
      state.lastSavedText = syncedText;
      const doc = selectedDocument();
      if (doc) doc.plainTextContent = syncedText;
      state.presence = users || [];
      globalThis.renderPresence();
      setCollabStatus(`Live with ${state.presence.length} collaborator(s)`);
    } finally {
      collab.applyingRemote = false;
    }
  });

  collab.socket.on('yjs-update', ({ documentId, updateBase64 }) => {
    if (documentId !== state.selectedDocumentId || !collab.ydoc || !updateBase64) return;

    collab.applyingRemote = true;
    try {
      socketState.Y.applyUpdate(collab.ydoc, base64ToUint8(updateBase64), 'remote');
    } finally {
      collab.applyingRemote = false;
    }
  });

  collab.socket.on('presence-update', ({ documentId, users }) => {
    if (documentId !== state.selectedDocumentId) return;
    state.presence = users || [];
    globalThis.renderPresence();
    setCollabStatus(`Live with ${state.presence.length} collaborator(s)`);
  });

  collab.socket.on('typing-update', ({ documentId, user, typing }) => {
    if (documentId !== state.selectedDocumentId || !user) return;
    state.typingUsers = typing
      ? [...state.typingUsers.filter((item) => item.userId !== user.userId), user]
      : state.typingUsers.filter((item) => item.userId !== user.userId);
    globalThis.updateTypingStatus();
  });

  collab.socket.on('workspace-presence-update', ({ workspaceId, users }) => {
    if (workspaceId !== state.selectedWorkspaceId) return;
    state.chatOnlineUsers = users || [];
    globalThis.renderWorkspace();
  });

  collab.socket.on('chat-typing', ({ workspaceId, channelId, user, typing }) => {
    if (workspaceId !== state.selectedWorkspaceId || channelId !== globalThis.activeChatChannel().slug || !user) return;
    state.chatTypingUsers = typing
      ? [...state.chatTypingUsers.filter((item) => item.userId !== user.userId), user]
      : state.chatTypingUsers.filter((item) => item.userId !== user.userId);
    if (globalThis.currentRoute() === 'chat') globalThis.renderChatTypingIndicator();
  });

  collab.socket.on('user-joined', ({ userId, username, email }) => {
    const displayName = username || (email ? email.split('@')[0] : null) || userId || 'Someone';
    globalThis.addActivity({ actor: displayName, action: 'joined', target: globalThis.selectedWorkspace()?.name || 'the workspace' });
    globalThis.showToast(`${displayName} joined the workspace`);

    const systemMsg = {
      _id: `system-join-${Date.now()}-${Math.random()}`,
      workspace: state.selectedWorkspaceId,
      channelId: globalThis.activeChatChannel().slug,
      isSystem: true,
      content: `${displayName} joined the workspace`,
      createdAt: new Date().toISOString()
    };

    const duplicate = state.chatMessages.some(
      (m) => m.isSystem && m.content === systemMsg.content && (Date.now() - new Date(m.createdAt).getTime() < 5000)
    );

    if (!duplicate) {
      state.chatMessages.push(systemMsg);
      if (globalThis.currentRoute() === 'chat') {
        globalThis.renderChatPage();
      }
    }
  });

  collab.socket.on('receive-chat-message', (message) => {
    if (String(message.workspace || message.workspaceId) !== String(state.selectedWorkspaceId)) return;
    if (message.channelId !== globalThis.activeChatChannel().slug) return;
    state.messages.push(message);
    state.chatMessages.push(message);
    state.chatTypingUsers = state.chatTypingUsers.filter((item) => String(item.userId) !== String(message.sender?._id || message.sender));
    if (globalThis.currentRoute() === 'chat') {
      globalThis.renderChatPage();
    } else {
      state.unreadChatCount = Number(state.unreadChatCount || 0) + 1;
      globalThis.syncUnreadBadge();
      if (globalThis.currentRoute() === 'home') globalThis.renderHomePage();
    }
  });
};

export const disconnectSocket = () => {
  if (!collab.socket) return;
  collab.socket.disconnect();
  collab.socket = null;
  state.socketConnected = false;
  setCollabStatus('Offline');
};

export const teardownYDoc = () => {
  if (collab.ydoc) {
    collab.ydoc.destroy();
  }

  collab.ydoc = null;
  collab.ytext = null;
  collab.activeDocumentId = '';
  state.presence = [];
  state.typingUsers = [];
  globalThis.renderPresence();
};

export const setupYDoc = async (documentId) => {
  const setupStartedAt = performance.now();
  await loadYjs();
  if (collab.socket?.connected && collab.activeDocumentId && collab.activeDocumentId !== documentId) {
    collab.socket.emit('leave-document', { documentId: collab.activeDocumentId });
  }

  teardownYDoc();

  collab.ydoc = new socketState.Y.Doc();
  collab.ytext = collab.ydoc.getText(globalThis.Y_TEXT_KEY);
  collab.activeDocumentId = documentId;

  collab.ytext.observe(() => {
    if (collab.localInput) return;
    const nextValue = collab.ytext.toString();
    if (globalThis.getEditorText() === nextValue) return;
    collab.applyingRemote = true;
    try {
      globalThis.setEditorText(nextValue);
    } finally {
      collab.applyingRemote = false;
    }
  });

  collab.ydoc.on('update', (update, origin) => {
    if (origin === 'remote' || collab.applyingRemote || !collab.socket?.connected) return;
    collab.socket.emit('yjs-update', {
      documentId,
      updateBase64: uint8ToBase64(update)
    });
  });

  globalThis.recordDocumentOpenMeasure('setupYDoc', setupStartedAt);
};

export const joinDocumentRoom = (documentId) => {
  if (!collab.socket?.connected || !documentId) return;
  collab.socket.emit('join-document', { documentId });
  setCollabStatus('Syncing collaborative document...');
};

export const joinChannelRoom = () => {
  if (!collab.socket?.connected || !state.selectedWorkspaceId || !state.selectedChannelId) return;
  if (socketState.joinedChannelWorkspaceId === state.selectedWorkspaceId && socketState.joinedChannelId === state.selectedChannelId) return;

  collab.socket.emit('join-room', {
    workspaceId: state.selectedWorkspaceId,
    roomId: state.selectedChannelId
  });
  socketState.joinedChannelWorkspaceId = state.selectedWorkspaceId;
  socketState.joinedChannelId = state.selectedChannelId;
};

export const joinWorkspaceChat = () => {
  if (!collab.socket?.connected || !state.selectedWorkspaceId) return;
  if (socketState.joinedWorkspacePresenceId === state.selectedWorkspaceId) return;

  collab.socket.emit('join-workspace-chat', {
    workspaceId: state.selectedWorkspaceId
  });
  socketState.joinedWorkspacePresenceId = state.selectedWorkspaceId;
};

export const publishChatTyping = (typing = true) => {
  const channel = globalThis.activeChatChannel();
  if (!collab.socket?.connected || !state.selectedWorkspaceId || !channel.slug) return;
  const now = Date.now();
  if (typing && now - socketState.lastChatTypingPublishAt < globalThis.CHAT_TYPING_PUBLISH_INTERVAL_MS) return;
  socketState.lastChatTypingPublishAt = now;
  collab.socket.emit('chat-typing', {
    workspaceId: state.selectedWorkspaceId,
    channelId: channel.slug,
    typing
  });
};

export const scheduleChatTypingStop = () => {
  window.clearTimeout(socketState.chatTypingTimer);
  socketState.chatTypingTimer = window.setTimeout(() => publishChatTyping(false), 1600);
};

export const publishCursor = () => {
  if (!collab.socket?.connected || !state.selectedDocumentId) return;
  const now = Date.now();
  if (now - socketState.lastCursorPublishAt < globalThis.CURSOR_PUBLISH_INTERVAL_MS) return;
  socketState.lastCursorPublishAt = now;

  collab.socket.emit('cursor-update', {
    documentId: state.selectedDocumentId,
    cursor: {
      ...globalThis.getEditorSelection()
    }
  });
};

export const publishTyping = () => {
  if (!collab.socket?.connected || !state.selectedDocumentId) return;
  const now = Date.now();
  if (now - socketState.lastTypingPublishAt >= globalThis.TYPING_PUBLISH_INTERVAL_MS) {
    socketState.lastTypingPublishAt = now;
    collab.socket.emit('typing-update', {
      documentId: state.selectedDocumentId,
      typing: true
    });
  }
  window.clearTimeout(socketState.typingTimer);
  socketState.typingTimer = window.setTimeout(() => {
    if (!collab.socket?.connected || !state.selectedDocumentId) return;
    collab.socket.emit('typing-update', {
      documentId: state.selectedDocumentId,
      typing: false
    });
  }, 1400);
};

export const applyEditorInputToYDoc = () => {
  if (!collab.ydoc || !collab.ytext || !state.selectedDocumentId) return;

  const currentValue = collab.ytext.toString();
  const nextValue = globalThis.getEditorText();
  if (currentValue === nextValue) return;

  let start = 0;
  while (start < currentValue.length && start < nextValue.length && currentValue[start] === nextValue[start]) {
    start += 1;
  }

  let currentEnd = currentValue.length;
  let nextEnd = nextValue.length;
  while (currentEnd > start && nextEnd > start && currentValue[currentEnd - 1] === nextValue[nextEnd - 1]) {
    currentEnd -= 1;
    nextEnd -= 1;
  }

  const deleteCount = currentEnd - start;
  const insertText = nextValue.slice(start, nextEnd);

  collab.localInput = true;
  try {
    collab.ydoc.transact(() => {
      if (deleteCount > 0) collab.ytext.delete(start, deleteCount);
      if (insertText) collab.ytext.insert(start, insertText);
    }, 'local-input');
  } finally {
    collab.localInput = false;
  }
};
