// Lazily loaded route module. Shared shell bindings are exposed by app.js.

const app = () => globalThis;

export const renderThreadListSection = (threadsList, title, isResolvedSection = false) => {
  if (threadsList.length === 0) {
    if (isResolvedSection) {
      return `
        <div class="thread-section-header">
          <h3>Resolved</h3>
        </div>
        <p class="empty-section-text">No resolved doubts yet</p>
      `;
    } else {
      return `
        <div class="thread-section-header">
          <h3>${title}</h3>
        </div>
        <div class="threads-small-empty-state">
          <p class="empty-title">No unresolved doubts</p>
          <p class="empty-desc">Ask a question from any note and keep the answer linked.</p>
          <button class="primary ask-doubt-action-btn" type="button">Ask Doubt</button>
        </div>
      `;
    }
  }

  return `
    <div class="thread-section-header">
      <h3>${title}</h3>
      <span class="section-count">${threadsList.length}</span>
    </div>
    ${threadsList.map(thread => {
      const senderName = thread.sender?.username || thread.sender?.email || 'Member';
      const initials = app().getInitials(senderName);
      const replyCount = thread.replies?.length || 0;
      const isActive = thread._id === app().state.selectedThreadId;
      const docTitle = thread.documentTitle || 'Document';
      const timeStr = app().formatChatTime(thread.createdAt);
      
      return `
        <button class="thread-list-card ${isActive ? 'active' : ''} ${thread.status === 'resolved' ? 'resolved' : ''}" data-open-thread-document="${thread.documentId}" data-open-thread-id="${thread._id}" type="button">
          <div class="card-head">
            <span class="doc-badge" title="Linked Note">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
              ${app().escapeHtml(docTitle)}
            </span>
            <span class="time-label">${app().escapeHtml(timeStr)}</span>
          </div>
          <strong class="card-title">${app().escapeHtml(thread.body)}</strong>
          <div class="card-footer">
            <div class="author-info">
              <span class="avatar-circle">${app().escapeHtml(initials)}</span>
              <span class="author-name">${app().escapeHtml(senderName)}</span>
            </div>
            <span class="replies-count">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 3px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}
            </span>
          </div>
        </button>
      `;
    }).join('')}
  `;
};


export const renderThreadDetailHtml = (thread) => {
  const senderName = thread.sender?.username || thread.sender?.email || 'Member';
  const initials = app().getInitials(senderName);
  const timeStr = new Date(thread.createdAt).toLocaleString();
  const isResolved = thread.status === 'resolved';

  const hasAiReply = (thread.replies || []).find(r => r.sender?.username?.toLowerCase().includes('ai') || r.sender?.email?.toLowerCase().includes('ai') || r.body.startsWith('🤖 AI'));

  return `
    <div class="thread-detail-header-row">
      <div class="detail-header-left">
        <span class="status-badge ${isResolved ? 'resolved' : 'unresolved'}">
          ${isResolved ? '● Resolved' : '● Unresolved'}
        </span>
        <h2>Doubt Detail</h2>
      </div>
      <div class="detail-header-actions">
        <button class="subtle-btn" data-detail-more-menu="${thread._id}" type="button" title="More options">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
        </button>
        <button class="primary resolve-toggle-btn" data-detail-resolve-id="${thread._id}" data-next-status="${isResolved ? 'open' : 'resolved'}" type="button">
          ${isResolved ? 'Reopen Doubt' : 'Resolve Doubt'}
        </button>

        <!-- Detail More Dropdown Options Menu -->
        <div id="threadDetailMoreMenu" class="chat-dropdown-menu hidden" style="top: 48px; right: 160px; width: 180px;">
          <button class="chat-dropdown-item" data-detail-action="open-doc" data-doc-id="${thread.documentId}" data-thread-id="${thread._id}" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Open Document
          </button>
          <button class="chat-dropdown-item" data-detail-action="copy-link" data-thread-id="${thread._id}" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy Doubt Link
          </button>
          <button class="chat-dropdown-item delete-action" data-detail-action="delete" data-doc-id="${thread.documentId}" data-thread-id="${thread._id}" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Delete Doubt
          </button>
        </div>
      </div>
    </div>

    <div class="thread-detail-scrollable">
      <div class="detail-main-question">
        <div class="detail-author-row">
          <span class="avatar-circle big">${app().escapeHtml(initials)}</span>
          <div class="author-meta">
            <span class="author-name">${app().escapeHtml(senderName)}</span>
            <span class="time-label">Asked on ${app().escapeHtml(timeStr)}</span>
          </div>
        </div>
        <h1 class="question-body">${app().escapeHtml(thread.body)}</h1>
      </div>

      <div class="detail-context-card">
        <div class="context-card-header">
          <div class="context-title-group">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z"/></svg>
            <span>Linked Context Notes</span>
          </div>
          <button class="context-open-link" data-detail-action="open-doc" data-doc-id="${thread.documentId}" data-thread-id="${thread._id}">
            Open Document →
          </button>
        </div>
        <div class="context-card-body">
          <strong>Document:</strong> <span>${app().escapeHtml(thread.documentTitle || 'Untitled Page')}</span>
          ${thread.linkedText ? `
            <div class="context-quote">
              <span class="quote-icon">“</span>
              <p>${app().escapeHtml(thread.linkedText)}</p>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="detail-ai-tutor-card">
        <div class="ai-card-header">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z"/></svg>
          <span>AI Study Companion</span>
        </div>
        <div class="ai-card-body">
          ${hasAiReply ? `
            <p>${app().escapeHtml(hasAiReply.body)}</p>
          ` : `
            <p>Need some quick explanation or guidance? Ask the AI Tutor to analyze this doubt and suggest answers instantly.</p>
            <button class="subtle-btn ask-ai-tutor-btn" data-ai-doubt-id="${thread._id}" data-ai-doc-id="${thread.documentId}" type="button">
              ✦ Ask AI Tutor
            </button>
          `}
        </div>
      </div>

      <div class="detail-replies-list">
        <h3>Discussion (${(thread.replies || []).length})</h3>
        <div class="replies-container">
          ${(thread.replies || []).map(reply => {
            const replySender = reply.sender?.username || reply.sender?.email || 'Member';
            const replyInitials = app().getInitials(replySender);
            const replyTime = app().formatChatTime(reply.createdAt);
            const isReplyAi = replySender.toLowerCase().includes('ai') || reply.body.startsWith('🤖 AI');

            return `
              <div class="reply-row ${isReplyAi ? 'ai-reply' : ''}">
                <span class="avatar-circle">${app().escapeHtml(replyInitials)}</span>
                <div class="reply-content">
                  <div class="reply-meta">
                    <strong>${app().escapeHtml(replySender)}</strong>
                    <span class="time-label">${app().escapeHtml(replyTime)}</span>
                  </div>
                  <p>${app().escapeHtml(reply.body)}</p>
                </div>
              </div>
            `;
          }).join('') || '<p class="no-replies-text">No replies yet. Start the discussion by posting an answer below!</p>'}
        </div>
      </div>
    </div>

    <div class="detail-reply-composer">
      <form id="threadReplyComposerForm" class="composer-form-wrapper">
        <textarea id="threadReplyInput" rows="1" placeholder="Write an answer or reply..." required></textarea>
        <button type="submit" class="send-btn" id="threadReplySendBtn" disabled>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </form>
    </div>
  `;
};


export const renderThreadsPage = () => {
  app().setMainMode('feature');
  app().setRouteChrome('threads');

  const searchInputBefore = document.getElementById('threadsSearchInput');
  const wasSearchFocused = (document.activeElement === searchInputBefore);
  const searchValLen = searchInputBefore ? searchInputBefore.value.length : 0;

  const replyInputBefore = document.getElementById('threadReplyInput');
  const wasReplyFocused = (document.activeElement === replyInputBefore);

  const filteredList = app().getFilteredWorkspaceThreads();
  let activeThread = filteredList.find(t => t._id === app().state.selectedThreadId) || null;
  if (!activeThread && filteredList.length > 0) {
    activeThread = filteredList[0];
    app().state.selectedThreadId = activeThread._id;
  }

  const unresolvedThreads = filteredList.filter(t => t.status !== 'resolved');
  const resolvedThreads = filteredList.filter(t => t.status === 'resolved');

  let leftListHtml = '';
  
  const activeFilterTab = app().threadFilterTab;
  const searchQuery = app().threadSearchQuery || '';

  if (activeFilterTab === 'unresolved') {
    leftListHtml = renderThreadListSection(unresolvedThreads, 'Unresolved');
  } else if (activeFilterTab === 'resolved') {
    leftListHtml = renderThreadListSection(resolvedThreads, 'Resolved');
  } else {
    leftListHtml = `
      ${renderThreadListSection(unresolvedThreads, 'Unresolved')}
      ${renderThreadListSection(resolvedThreads, 'Resolved', true)}
    `;
  }

  let rightDetailHtml = '';
  if (activeThread) {
    rightDetailHtml = renderThreadDetailHtml(activeThread);
  } else {
    rightDetailHtml = app().renderEmptyDetailHtml(app().state.workspaceThreads.length > 0);
  }

  app().els.routePage.innerHTML = `
    <div class="threads-page">
      <section class="threads-list-pane">
        <div class="threads-pane-header">
          <div class="threads-header-titles">
            <h2>Doubts</h2>
            <p>Track questions across your workspace</p>
          </div>
          <button class="primary ask-doubt-action-btn" type="button" title="Ask a new doubt">+ Ask Doubt</button>
        </div>

        <div class="threads-search-container">
          <svg xmlns="http://www.w3.org/2000/svg" class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" id="threadsSearchInput" placeholder="Search doubts..." value="${app().escapeHtml(searchQuery)}" />
          ${searchQuery ? '<button type="button" class="clear-search-btn" id="threadsClearSearchBtn">×</button>' : ''}
        </div>

        <div class="threads-filter-chips">
          <button class="filter-chip ${activeFilterTab === 'all' ? 'active' : ''}" data-threads-tab="all" type="button">All</button>
          <button class="filter-chip ${activeFilterTab === 'unresolved' ? 'active' : ''}" data-threads-tab="unresolved" type="button">Unresolved</button>
          <button class="filter-chip ${activeFilterTab === 'resolved' ? 'active' : ''}" data-threads-tab="resolved" type="button">Resolved</button>
          <button class="filter-chip ${activeFilterTab === 'mine' ? 'active' : ''}" data-threads-tab="mine" type="button">Mine</button>
        </div>

        <div class="threads-list-scrollable">
          ${leftListHtml}
        </div>
      </section>

      <section class="thread-detail-pane">
        ${rightDetailHtml}
      </section>
    </div>
  `;

  const replyInput = document.getElementById('threadReplyInput');
  const replySendBtn = document.getElementById('threadReplySendBtn');
  if (replyInput && replySendBtn) {
    const handleReplyInput = () => {
      const hasText = replyInput.value.trim().length > 0;
      replySendBtn.disabled = !hasText;
      replyInput.style.height = 'auto';
      replyInput.style.height = Math.min(replyInput.scrollHeight, 120) + 'px';
    };
    replyInput.addEventListener('input', handleReplyInput);
    handleReplyInput();
  }

  const detailScroll = document.querySelector('.thread-detail-scrollable');
  if (detailScroll) {
    detailScroll.scrollTop = detailScroll.scrollHeight;
  }

  if (wasSearchFocused) {
    const searchInputAfter = document.getElementById('threadsSearchInput');
    if (searchInputAfter) {
      searchInputAfter.focus();
      searchInputAfter.setSelectionRange(searchValLen, searchValLen);
    }
  }

  if (wasReplyFocused) {
    const replyInputAfter = document.getElementById('threadReplyInput');
    if (replyInputAfter) {
      replyInputAfter.focus();
    }
  }
};

