/**
 * ============================================================================
 * REAL-TIME SOCKET CONTROLLER
 * ============================================================================
 * Directs the bidirectional flows for live typing and fast chat relays.
 */

const Y = require('yjs');
const { Channel, Message, Workspace, Document, User } = require('../models');
const { isValidObjectId, isNonEmptyString, normalizeString } = require('../utils/validation');
const { validateAccessToken } = require('../utils/sessionAuth');
const {
  canChatInWorkspace,
  canEditWorkspaceContent,
  canViewWorkspace
} = require('../utils/permissions');

const MAX_CHAT_MESSAGE_CHARS = 4000;
const Y_TEXT_KEY = 'content';

const documentPresence = new Map();
const workspacePresence = new Map();
const documentCache = new Map();

// Active users tracking map: roomName -> Map(userId -> Set(socketId))
const activeRoomUsers = new Map();

const getDisplayName = (user) => {
  return user?.username || user?.name || user?.firstName || (user?.email ? user.email.split('@')[0] : null) || 'Someone';
};

const trackRoomJoin = (room, userId, socketId) => {
  if (!activeRoomUsers.has(room)) {
    activeRoomUsers.set(room, new Map());
  }
  const roomUsers = activeRoomUsers.get(room);
  if (!roomUsers.has(userId)) {
    roomUsers.set(userId, new Set());
  }
  const userSockets = roomUsers.get(userId);
  const isNewUser = userSockets.size === 0;
  userSockets.add(socketId);
  return isNewUser;
};

const trackRoomLeave = (room, userId, socketId) => {
  const roomUsers = activeRoomUsers.get(room);
  if (!roomUsers) return false;
  const userSockets = roomUsers.get(userId);
  if (!userSockets) return false;

  userSockets.delete(socketId);
  if (userSockets.size === 0) {
    roomUsers.delete(userId);
    if (roomUsers.size === 0) {
      activeRoomUsers.delete(room);
    }
    return true; // user left room completely
  }
  return false;
};

const clearSocketFromAllRooms = (io, socketId, userId) => {
  for (const [room, roomUsers] of activeRoomUsers.entries()) {
    if (roomUsers.has(userId)) {
      trackRoomLeave(room, userId, socketId);
    }
  }
};

const getChannelRoom = (workspaceId, channelId) => `workspace:${workspaceId}:channel:${channelId}`;
const getWorkspacePresenceRoom = (workspaceId) => `workspace:${workspaceId}:presence`;

const toBase64 = (uint8Array) => Buffer.from(uint8Array).toString('base64');

const fromBase64 = (value) => new Uint8Array(Buffer.from(value, 'base64'));

const getSocketToken = (socket) => {
  const authToken = socket.handshake.auth?.token;
  const queryToken = socket.handshake.query?.token;
  const header = socket.handshake.headers?.authorization;
  const headerToken = header?.startsWith('Bearer ') ? header.slice(7) : null;

  return authToken || queryToken || headerToken;
};

const canAccessWorkspace = async (workspaceId, userId) => {
  if (!isValidObjectId(workspaceId)) return false;
  const workspace = await Workspace.findOne({ _id: workspaceId, 'members.user': userId });
  return Boolean(workspace && canViewWorkspace(workspace, userId));
};

const canAccessDocument = async (documentId, userId) => {
  if (!isValidObjectId(documentId)) return false;

  // SECURITY FIX 2:
  // Sockets must not allow users to join deleted documents.
  const doc = await Document.findOne({
    _id: documentId,
    deletedAt: null
  }).select('workspace');

  if (!doc) return false;

  return canAccessWorkspace(doc.workspace, userId);
};

const getWritableWorkspace = async (workspaceId, userId) => {
  if (!isValidObjectId(workspaceId)) return null;
  const workspace = await Workspace.findOne({ _id: workspaceId, 'members.user': userId });
  return workspace && canChatInWorkspace(workspace, userId) ? workspace : null;
};

const getEditableDocumentWorkspace = async (documentId, userId) => {
  if (!isValidObjectId(documentId)) return null;

  // SECURITY FIX 2:
  // A deleted document should not be editable through real-time sockets.
  const doc = await Document.findOne({
    _id: documentId,
    deletedAt: null
  }).select('workspace');

  if (!doc) return null;

  const workspace = await Workspace.findOne({ _id: doc.workspace, 'members.user': userId });
  return workspace && canEditWorkspaceContent(workspace, userId) ? workspace : null;
};

const loadYDocument = async (documentId) => {
  if (documentCache.has(documentId)) {
    return documentCache.get(documentId);
  }

  // SECURITY FIX 2:
  // Do not load deleted documents into the Yjs cache.
  const docRecord = await Document.findOne({
    _id: documentId,
    deletedAt: null
  }).select('binaryUpdate plainTextContent');

  if (!docRecord) return null;

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText(Y_TEXT_KEY);

  if (docRecord.binaryUpdate?.length) {
    Y.applyUpdate(ydoc, new Uint8Array(docRecord.binaryUpdate));
  } else if (docRecord.plainTextContent) {
    ytext.insert(0, docRecord.plainTextContent);
    docRecord.binaryUpdate = Buffer.from(Y.encodeStateAsUpdate(ydoc));
    await docRecord.save();
  }

  documentCache.set(documentId, ydoc);
  return ydoc;
};
const persistYDocument = async (documentId, ydoc, userId) => {
  const ytext = ydoc.getText(Y_TEXT_KEY);

  // SECURITY FIX 2:
  // Never persist real-time edits into a deleted document.
  await Document.findOneAndUpdate(
    {
      _id: documentId,
      deletedAt: null
    },
    {
      $set: {
        binaryUpdate: Buffer.from(Y.encodeStateAsUpdate(ydoc)),
        plainTextContent: ytext.toString(),
        lastEditedBy: userId
      }
    }
  );
};

const getPresenceList = (documentId) => Array.from(documentPresence.get(documentId)?.values() || []);
const getWorkspacePresenceList = (workspaceId) => {
  const socketUsers = Array.from(workspacePresence.get(String(workspaceId))?.values() || []);
  const byUser = new Map();
  socketUsers.forEach((user) => {
    if (user?.userId) byUser.set(String(user.userId), user);
  });
  return Array.from(byUser.values());
};

const broadcastPresence = (io, documentId) => {
  io.to(documentId).emit('presence-update', {
    documentId,
    users: getPresenceList(documentId)
  });
};

const broadcastWorkspacePresence = (io, workspaceId) => {
  const users = getWorkspacePresenceList(workspaceId);
  io.to(getWorkspacePresenceRoom(workspaceId)).emit('workspace-presence-update', {
    workspaceId,
    users,
    onlineCount: users.length
  });
};

const removeSocketPresence = (io, socketId) => {
  for (const [documentId, users] of documentPresence.entries()) {
    if (users.delete(socketId)) {
      if (users.size === 0) {
        documentPresence.delete(documentId);
      }
      broadcastPresence(io, documentId);
    }
  }
  for (const [workspaceId, users] of workspacePresence.entries()) {
    if (users.delete(socketId)) {
      if (users.size === 0) {
        workspacePresence.delete(workspaceId);
      }
      broadcastWorkspacePresence(io, workspaceId);
    }
  }
};

const getActiveChannel = (workspaceId, channelId) => Channel.findOne({
  workspace: workspaceId,
  slug: channelId,
  archivedAt: null
});

const setupEditorSockets = (io) => {
  io.use(async (socket, next) => {
    try {
      const token = getSocketToken(socket);
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const { verified } = await validateAccessToken(token);
      const user = await User.findById(verified.id).select('username email');
      if (!user) {
        return next(new Error('User not found'));
      }

      socket.data.user = {
        id: user._id.toString(),
        email: user.email,
        username: user.username
      };
      return next();
    } catch (err) {
      return next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Join a scoped workspace, document, or channel room
    socket.on('join-room', async ({ roomId, workspaceId } = {}) => {
      const normalizedRoomId = normalizeString(roomId);
      const normalizedWorkspaceId = normalizeString(workspaceId);
      const userId = socket.data.user.id;

      try {
        if (!isNonEmptyString(normalizedRoomId)) {
          return socket.emit('operation-error', { message: 'Room ID is required' });
        }

        let allowed = false;
        if (isValidObjectId(normalizedRoomId)) {
          allowed = await canAccessDocument(normalizedRoomId, userId)
            || await canAccessWorkspace(normalizedRoomId, userId);
        } else if (normalizedWorkspaceId) {
          const channel = await getActiveChannel(normalizedWorkspaceId, normalizedRoomId);
          allowed = Boolean(channel) && await canAccessWorkspace(normalizedWorkspaceId, userId);
        }

        if (!allowed) {
          return socket.emit('operation-error', { message: 'Access denied for room' });
        }

        const roomToJoin = isValidObjectId(normalizedRoomId)
          ? normalizedRoomId
          : getChannelRoom(normalizedWorkspaceId, normalizedRoomId);

        // Leave any other channel rooms in this workspace first to keep client room maps clean
        const oldChannelRooms = Array.from(socket.rooms).filter(r => r.startsWith(`workspace:${normalizedWorkspaceId}:channel:`));
        for (const r of oldChannelRooms) {
          socket.leave(r);
          trackRoomLeave(r, userId, socket.id);
        }

        socket.join(roomToJoin);
        
        const isNewUserInRoom = trackRoomJoin(roomToJoin, userId, socket.id);
        if (isNewUserInRoom) {
          const displayName = getDisplayName(socket.data.user);
          socket.to(roomToJoin).emit('user-joined', {
            userId,
            username: displayName,
            email: socket.data.user.email
          });
        }
      } catch (err) {
        console.error('Socket room join error:', err);
        socket.emit('operation-error', { message: 'Unable to join room' });
      }
    });

    socket.on('join-workspace-chat', async ({ workspaceId } = {}) => {
      const normalizedWorkspaceId = normalizeString(workspaceId);
      const userId = socket.data.user.id;

      try {
        if (!isValidObjectId(normalizedWorkspaceId)) {
          return socket.emit('operation-error', { message: 'Valid workspace is required' });
        }
        if (!await canAccessWorkspace(normalizedWorkspaceId, userId)) {
          return socket.emit('operation-error', { message: 'Access denied for workspace' });
        }

        const room = getWorkspacePresenceRoom(normalizedWorkspaceId);
        socket.join(room);
        if (!workspacePresence.has(normalizedWorkspaceId)) {
          workspacePresence.set(normalizedWorkspaceId, new Map());
        }
        workspacePresence.get(normalizedWorkspaceId).set(socket.id, {
          socketId: socket.id,
          userId,
          email: socket.data.user.email,
          username: socket.data.user.username
        });
        broadcastWorkspacePresence(io, normalizedWorkspaceId);
      } catch (err) {
        console.error('Socket workspace chat join error:', err);
        socket.emit('operation-error', { message: 'Unable to join workspace chat' });
      }
    });

    socket.on('leave-workspace-chat', ({ workspaceId } = {}) => {
      const normalizedWorkspaceId = normalizeString(workspaceId);
      if (!isValidObjectId(normalizedWorkspaceId)) return;
      socket.leave(getWorkspacePresenceRoom(normalizedWorkspaceId));
      const users = workspacePresence.get(normalizedWorkspaceId);
      if (!users) return;
      users.delete(socket.id);
      if (users.size === 0) workspacePresence.delete(normalizedWorkspaceId);
      broadcastWorkspacePresence(io, normalizedWorkspaceId);
    });

    socket.on('chat-typing', async ({ workspaceId, channelId, typing } = {}) => {
      const normalizedWorkspaceId = normalizeString(workspaceId);
      const normalizedChannelId = normalizeString(channelId);
      const userId = socket.data.user.id;

      if (!isValidObjectId(normalizedWorkspaceId) || !isNonEmptyString(normalizedChannelId)) return;
      const channel = await getActiveChannel(normalizedWorkspaceId, normalizedChannelId);
      if (!channel || !await canAccessWorkspace(normalizedWorkspaceId, userId)) return;

      socket.to(getChannelRoom(normalizedWorkspaceId, normalizedChannelId)).emit('chat-typing', {
        workspaceId: normalizedWorkspaceId,
        channelId: normalizedChannelId,
        user: {
          userId,
          email: socket.data.user.email,
          username: socket.data.user.username
        },
        typing: Boolean(typing)
      });
    });

    // Handle instant chat message distribution
    socket.on('send-chat-message', async (messageData) => {
      const { workspaceId } = messageData || {};
      const channelId = normalizeString(messageData?.channelId);
      const content = typeof messageData?.content === 'string' ? messageData.content.trim() : '';

      try {
        if (!isValidObjectId(workspaceId) || !isNonEmptyString(channelId)) {
          return socket.emit('operation-error', { message: 'Valid workspace and channel are required' });
        }

        if (!isNonEmptyString(content)) {
          return socket.emit('operation-error', { message: 'Message content is required' });
        }

        if (content.length > MAX_CHAT_MESSAGE_CHARS) {
          return socket.emit('operation-error', { message: 'Message content is too large' });
        }

        const workspace = await getWritableWorkspace(workspaceId, socket.data.user.id);
        if (!workspace) {
          return socket.emit('operation-error', { message: 'Access denied for workspace' });
        }
        const channel = await getActiveChannel(workspaceId, channelId);
        if (!channel) {
          return socket.emit('operation-error', { message: 'Channel not found' });
        }

        const newMessage = new Message({
          workspace: workspaceId,
          channelId: channelId,
          sender: socket.data.user.id,
          content: content
        });
        
        const savedMessage = await newMessage.save();
        const populatedMessage = await savedMessage.populate('sender', 'username');

        // Instantly forward to everyone connected to this workspace channel
        io.to(getChannelRoom(workspaceId, channelId)).emit('receive-chat-message', populatedMessage);
      } catch (err) {
        console.error('Socket DB Save Error:', err);
        socket.emit('operation-error', { message: 'Message delivery failed' });
      }
    });

    // Handle emoji reactions
    socket.on('react-chat-message', async ({ workspaceId, channelId, messageId, emoji } = {}) => {
      try {
        if (!isValidObjectId(workspaceId) || !isNonEmptyString(channelId) || !isValidObjectId(messageId)) {
          return socket.emit('operation-error', { message: 'Invalid reaction parameters' });
        }

        const message = await Message.findOne({ _id: messageId, workspace: workspaceId });
        if (!message) return;

        const userId = socket.data.user.id;

        if (!message.reactions) {
          message.reactions = [];
        }

        let reaction = message.reactions.find(r => r.emoji === emoji);
        if (reaction) {
          const userIndex = reaction.users.indexOf(userId);
          if (userIndex > -1) {
            reaction.users.splice(userIndex, 1);
          } else {
            reaction.users.push(userId);
          }
        } else {
          message.reactions.push({ emoji, users: [userId] });
        }

        // Filter out empty reactions
        message.reactions = message.reactions.filter(r => r.users && r.users.length > 0);

        await message.save();

        // Broadcast the update to the workspace channel room
        io.to(getChannelRoom(workspaceId, channelId)).emit('chat-message-reaction-updated', {
          messageId,
          reactions: message.reactions
        });
      } catch (err) {
        console.error('Socket Reaction Error:', err);
      }
    });

    // Handle collaborative real-time writing (Yjs diff broadcasts)
    socket.on('join-document', async ({ documentId } = {}) => {
      try {
        if (!isValidObjectId(documentId)) {
          return socket.emit('operation-error', { message: 'Valid document ID is required' });
        }

        const workspace = await getEditableDocumentWorkspace(documentId, socket.data.user.id);
        if (!workspace) {
          return socket.emit('operation-error', { message: 'Access denied for document' });
        }

        socket.join(documentId);
        const ydoc = await loadYDocument(documentId);
        if (!ydoc) {
          return socket.emit('operation-error', { message: 'Document not found' });
        }

        if (!documentPresence.has(documentId)) {
          documentPresence.set(documentId, new Map());
        }
        documentPresence.get(documentId).set(socket.id, {
          socketId: socket.id,
          userId: socket.data.user.id,
          email: socket.data.user.email,
          cursor: null
        });

        socket.emit('document-synced', {
          documentId,
          updateBase64: toBase64(Y.encodeStateAsUpdate(ydoc)),
          text: ydoc.getText(Y_TEXT_KEY).toString(),
          users: getPresenceList(documentId)
        });
        broadcastPresence(io, documentId);
      } catch (err) {
        console.error('Socket document join error:', err);
        socket.emit('operation-error', { message: 'Document sync failed' });
      }
    });

    socket.on('yjs-update', async (data) => {
      const { documentId, updateBase64 } = data || {};

      try {
        if (!isValidObjectId(documentId)) {
          return socket.emit('operation-error', { message: 'Valid document ID is required' });
        }
        if (!isNonEmptyString(updateBase64)) {
          return socket.emit('operation-error', { message: 'Valid Yjs update is required' });
        }

        const workspace = await getEditableDocumentWorkspace(documentId, socket.data.user.id);
        if (!workspace) {
          return socket.emit('operation-error', { message: 'Access denied for document' });
        }

        const ydoc = await loadYDocument(documentId);
        if (!ydoc) {
          return socket.emit('operation-error', { message: 'Document not found' });
        }

        const update = fromBase64(updateBase64);
        Y.applyUpdate(ydoc, update);
        await persistYDocument(documentId, ydoc, socket.data.user.id);

        socket.to(documentId).emit('yjs-update', {
          documentId,
          updateBase64
        });
      } catch (err) {
        console.error('Socket document update error:', err);
        socket.emit('operation-error', { message: 'Document update failed' });
      }
    });

    socket.on('cursor-update', ({ documentId, cursor } = {}) => {
      if (!isValidObjectId(documentId)) return;

      const users = documentPresence.get(documentId);
      const user = users?.get(socket.id);
      if (!user) return;

      user.cursor = {
        start: Number(cursor?.start) || 0,
        end: Number(cursor?.end) || 0
      };
      socket.to(documentId).emit('cursor-update', {
        documentId,
        user
      });
      broadcastPresence(io, documentId);
    });

    socket.on('typing-update', ({ documentId, typing } = {}) => {
      if (!isValidObjectId(documentId)) return;
      const users = documentPresence.get(documentId);
      const user = users?.get(socket.id);
      if (!user) return;

      socket.to(documentId).emit('typing-update', {
        documentId,
        user: {
          userId: user.userId,
          email: user.email
        },
        typing: Boolean(typing)
      });
    });

    socket.on('leave-document', ({ documentId } = {}) => {
      if (!isValidObjectId(documentId)) return;

      socket.leave(documentId);
      const users = documentPresence.get(documentId);
      if (!users) return;

      users.delete(socket.id);
      if (users.size === 0) {
        documentPresence.delete(documentId);
      }
      broadcastPresence(io, documentId);
    });

    socket.on('document-update', async ({ documentId, updateBinary } = {}) => {
      if (!updateBinary) return;
      socket.emit('operation-error', {
        message: 'Legacy document-update is no longer used. Send yjs-update instead.'
      });
    });

    socket.on('disconnect', () => {
      removeSocketPresence(io, socket.id);
      if (socket.data.user?.id) {
        clearSocketFromAllRooms(io, socket.id, socket.data.user.id);
      }
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
};

module.exports = setupEditorSockets;
