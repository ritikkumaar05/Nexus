export const createThreadPanel = ({
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
  addActivity,
  markLectureMilestone,
  refreshLectureProgress,
  getDocumentContextPath,
  request,
  showToast
}) => {
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

  const setThreadComposer = () => {
    const thread = selectedThread();
    if (!els.messageInput || !els.messageForm) return;
    els.messageInput.placeholder = thread ? `Reply to: ${thread.body.slice(0, 42)}...` : 'Ask a doubt...';
    els.messageForm.querySelector('button').textContent = thread ? 'Reply' : 'Post';
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

  const bindThreadPanelHandlers = () => {
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
        if (nextStatus === 'resolved') {
          markLectureMilestone(state.selectedDocumentId, 'doubtResolved', { message: 'Doubt resolved' });
        } else {
          refreshLectureProgress(state.selectedDocumentId);
        }
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
        if (nextStatus === 'resolved') {
          markLectureMilestone(state.selectedDocumentId, 'doubtResolved', { message: 'Doubt resolved' });
        } else {
          refreshLectureProgress(state.selectedDocumentId);
        }
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
            documentId: state.selectedDocumentId,
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
        refreshLectureProgress(state.selectedDocumentId);
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
        refreshLectureProgress(state.selectedDocumentId);
        renderThreadList();
      } catch (err) {
        showToast(err.message, true);
      }
    });
  };

  return {
    bindThreadPanelHandlers,
    filteredThreads,
    isMine,
    renderMessageFormContext,
    renderThreadList,
    selectedThread,
    setThreadComposer,
    startAskDoubt
  };
};
