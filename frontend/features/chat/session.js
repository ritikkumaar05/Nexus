export const createChatSession = ({
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
}) => {
  const ensureChatReady = async () => {
    if (state.demoMode) {
      if (!state.selectedChannelId) state.selectedChannelId = GENERAL_CHAT_CHANNEL;
      state.chatMessages = state.messages.slice();
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
    const chatKey = `${state.selectedWorkspaceId}:${state.selectedChannelId}`;
    if (state.chatLoadedKey !== chatKey) await loadChatMessages();
  };

  const loadChatMessages = async () => {
    if (state.demoMode) {
      state.chatMessages = state.messages.slice();
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
      state.chatLoadedKey = `${state.selectedWorkspaceId}:${channel.slug}`;
      setError('chat');
    } catch (err) {
      if (err?.status === 429) {
        setError('chat');
        return;
      }
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
    if (!state.selectedWorkspaceId || !channel.slug || (!content && !state.attachedFile)) return;

    const fileInput = document.getElementById('chatFileInput');
    const previewContainer = document.getElementById('chatAttachmentPreview');
    const sendBtn = document.getElementById('workspaceChatSendBtn');

    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.setAttribute('aria-busy', 'true');
    }

    window.chatForceScrollBottom = true;
    publishChatTyping(false);

    let messageContent = content;

    try {
      if (state.attachedFile) {
        const file = state.attachedFile;
        if (state.demoMode) {
          const mockAttachmentId = `demo-attach-${Date.now()}-${Math.random()}`;
          state.demoAttachments = state.demoAttachments || [];
          state.demoAttachments.push({
            _id: mockAttachmentId,
            filename: file.name,
            mimeType: file.type,
            size: file.size,
            dataUrl: file.dataUrl
          });

          const formatBytes = (bytes) => {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
          };

          const fileLink = `[📎 ${file.name} (${file.type}, ${formatBytes(file.size)})](${file.dataUrl})`;
          messageContent = messageContent ? `${messageContent}\n\n${fileLink}` : fileLink;
        } else {
          const attachment = await request(`/api/attachments/${state.selectedWorkspaceId}`, {
            method: 'POST',
            body: JSON.stringify({
              filename: file.name,
              mimeType: file.type,
              dataBase64: file.base64
            })
          });

          const formatBytes = (bytes) => {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
          };

          const downloadUrl = `/api/attachments/${state.selectedWorkspaceId}/${attachment._id}/download`;
          const fileLink = `[📎 ${file.name} (${file.type}, ${formatBytes(file.size)})](${downloadUrl})`;
          messageContent = messageContent ? `${messageContent}\n\n${fileLink}` : fileLink;
        }

        state.attachedFile = null;
        if (fileInput) fileInput.value = '';
        if (previewContainer) {
          previewContainer.innerHTML = '';
          previewContainer.classList.add('hidden');
        }
      }

      if (state.demoMode) {
        const message = {
          _id: `demo-chat-${Date.now()}`,
          workspace: state.selectedWorkspaceId,
          channelId: channel.slug,
          sender: { _id: state.user?.id, username: state.user?.username || 'You' },
          content: messageContent,
          createdAt: new Date().toISOString()
        };
        state.messages.push(message);
        state.chatMessages.push(message);
        if (input) input.value = '';
        renderChatPage();
        return;
      }

      if (collab.socket?.connected) {
        collab.socket.emit('send-chat-message', {
          workspaceId: state.selectedWorkspaceId,
          channelId: channel.slug,
          content: messageContent
        });
        if (input) input.value = '';
        return;
      }

      const message = await request(`/api/messages/${state.selectedWorkspaceId}/${channel.slug}`, {
        method: 'POST',
        body: JSON.stringify({ content: messageContent })
      });
      state.messages.push(message);
      state.chatMessages.push(message);
      if (input) input.value = '';
      renderChatPage();
    } catch (err) {
      showToast(err.message || 'File upload failed', true);
    } finally {
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.removeAttribute('aria-busy');
      }
    }
  };

  return {
    ensureChatReady,
    loadChatMessages,
    sendWorkspaceChatMessage
  };
};
