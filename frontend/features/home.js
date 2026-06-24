// Lazily loaded route module. Shared shell bindings are exposed by app.js.

export const getDashboardData = () => {
  const demo = state.demoMode;
  const workspace = selectedWorkspace();
  const recentDocuments = [...state.documents]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    .slice(0, 5);
  const todayTasks = [...(state.dashboardTasks.length ? state.dashboardTasks : state.documentTasks)]
    .filter((task) => task.status !== 'done' && (demo || isDueToday(task) || !task.dueDate))
    .slice(0, 6);
  const completedTasks = [...(state.dashboardTasks.length ? state.dashboardTasks : state.documentTasks)]
    .filter((task) => task.status === 'done')
    .slice(0, 2);
  const members = getWorkspaceMembers();
  const activeMembers = collaborationPeople().filter((person) => person.online).slice(0, 5);
  const chatPreview = demo
    ? { sender: 'Priya Sharma', content: 'Class starts at 10 AM. I uploaded the notes from yesterday.', time: new Date().toISOString() }
    : currentChatPreview();
  const doubts = demo
    ? [
        {
          title: 'Can someone explain Paxos prepare phase?',
          documentId: 'demo-doc-ds-lecture',
          documentTitle: 'Distributed Systems Notes',
          meta: '3 replies · Unresolved'
        },
        {
          title: 'What is the difference between precision and recall?',
          documentId: 'demo-doc-ml-guide',
          documentTitle: 'ML Study Guide',
          meta: 'Resolved'
        }
      ]
    : state.workspaceThreads.filter((thread) => thread.status !== 'resolved').slice(0, 4).map((thread) => ({
        title: thread.body,
        documentId: thread.documentId,
        threadId: thread._id,
        documentTitle: thread.documentTitle || selectedDocumentTitle(),
        meta: `${thread.replies?.length || 0} replies · Unresolved`
      }));

  return {
    workspace,
    recentDocuments,
    todayTasks,
    completedTasks,
    activeMembers,
    chatPreview,
    doubts,
    stats: {
      documents: demo ? 24 : state.documents.length,
      tasksDue: demo ? 5 : todayTasks.length,
      collaborators: demo ? 3 : (activeMembers.length || state.presence.length),
      doubts: demo ? 8 : state.workspaceThreads.filter((thread) => thread.status !== 'resolved').length
    }
  };
};


export const renderHomePage = () => {
  setMainMode('feature');
  setRouteChrome('home');
  const dashboard = getDashboardData();
  const { workspace, recentDocuments, todayTasks, completedTasks, activeMembers, doubts, stats } = dashboard;
  if (!workspace && !state.loading.workspaces) {
    els.routePage.innerHTML = `
      <div class="dashboard-shell dashboard-shell-v2">
        ${emptyState({
          title: 'Create your first study workspace',
          body: 'Organize notes, tasks, doubts, and AI study tools in one calm place.',
          action: 'Create Workspace',
          actionId: 'emptyHomeCreateWorkspaceBtn',
          secondaryAction: 'Try Demo Workspace',
          secondaryActionId: 'emptyHomeTryDemoBtn',
          icon: '▣',
          hint: 'A workspace can be one subject, exam, project, or study group.',
          className: 'empty-state-hero'
        })}
      </div>
    `;
    return;
  }

  // Load chat messages asynchronously if they are not loaded
  if (!state.demoMode && state.selectedWorkspaceId && !state.chatMessages.length && !state.loading.chat) {
    ensureChatReady().then(() => {
      if (currentRoute() === 'home') {
        renderHomePage();
      }
    }).catch((err) => console.warn('Failed to load chat preview:', err));
  }

  const userName = state.demoMode ? 'Alex' : (state.user?.username || state.user?.email?.split('@')[0] || '');
  const greeting = getTimeGreeting(userName);
  const primaryDoc = recentDocuments[0];
  const focusTasks = todayTasks.slice(0, 3);

  const activeChannel = activeChatChannel() || { name: 'general', slug: 'general' };
  const chatPreviewMessages = (state.chatMessages.length
    ? state.chatMessages
    : (state.demoMode ? state.messages : []))
    .filter((msg) => msg.channelId === activeChannel.slug || msg.channelId === 'general')
    .slice(-2);

  els.routePage.innerHTML = `
    <div class="dashboard-shell dashboard-shell-v2 nexus-dashboard">
      <!-- SECTION 1 — WELCOME HEADER -->
      <header class="home-welcome-header">
        <div class="welcome-copy">
          <span class="eyebrow">Nexus Workspace</span>
          <h2>${escapeHtml(greeting)}</h2>
          <p>Continue where you left off.</p>
        </div>
        <div class="header-stats-row">
          <span class="stat-pill"><span class="pill-icon">🔥</span> 5-day streak</span>
          <span class="stat-pill"><span class="pill-icon">📄</span> ${stats.documents} documents</span>
          <span class="stat-pill"><span class="pill-icon">👥</span> ${stats.collaborators} online</span>
          <span class="stat-pill"><span class="pill-icon">📋</span> ${stats.tasksDue || 0} pending tasks</span>
        </div>
      </header>

      <div class="home-grid">
        <!-- LEFT COLUMN (MAIN FLOW) -->
        <div class="home-main-col">
          <!-- SECTION 2 — CONTINUE WORKING -->
          ${primaryDoc ? `
            <article class="card-v3 continue-working-card" data-open-document="${escapeHtml(primaryDoc._id)}">
              <div class="continue-working-content">
                <span class="doc-badge">Last Active Document</span>
                <div class="continue-working-title-row">
                  <span class="doc-icon-large">📄</span>
                  <div>
                    <h3>${escapeHtml(primaryDoc.title || 'Untitled Document')}</h3>
                    <p>Last edited ${formatRelativeTime(primaryDoc.updatedAt || primaryDoc.createdAt)}</p>
                  </div>
                </div>
              </div>
              <button class="continue-btn" type="button">
                Continue Editing <span class="arrow">→</span>
              </button>
            </article>
          ` : `
            <article class="card-v3 continue-working-card empty-continue-card" data-dashboard-action="new-document">
              <div class="continue-working-content">
                <span class="doc-badge">Get Started</span>
                <div class="continue-working-title-row">
                  <span class="doc-icon-large">📄</span>
                  <div>
                    <h3>Create your first study note</h3>
                    <p>Write notes, generate flashcards, and study with AI.</p>
                  </div>
                </div>
              </div>
              <button class="continue-btn" type="button">
                + Create Note <span class="arrow">→</span>
              </button>
            </article>
          `}

          <!-- SECTION 3 — TODAY'S FOCUS -->
          <article class="card-v3 focus-card">
            <div class="card-header-v3">
              <h3>Today's Focus</h3>
              <a href="#/tasks" class="view-all-link" data-dashboard-target="tasks">View All →</a>
            </div>
            <div class="focus-tasks-list">
              ${focusTasks.map((task) => `
                <label class="focus-task-item ${task.status === 'done' ? 'done' : ''}" data-dashboard-task-id="${task._id}">
                  <input type="checkbox" ${task.status === 'done' ? 'checked' : ''} />
                  <div class="task-checkbox-custom"></div>
                  <span class="task-title">${escapeHtml(task.title)}</span>
                </label>
              `).join('') || `
                <div class="empty-focus-state">
                  <span class="empty-icon">✓</span>
                  <h4>No focus tasks yet</h4>
                  <p>Create a study task or let AI generate a plan for this workspace.</p>
                  <div class="empty-actions-row">
                    <button class="empty-state-btn primary" data-dashboard-action="new-task">+ Add Study Task</button>
                    <button class="empty-state-btn" data-dashboard-action="ai">🪄 Generate with AI</button>
                  </div>
                </div>
              `}
            </div>
          </article>

          <!-- SECTION 4 — RECENT ACTIVITY -->
          <article class="card-v3 activity-card">
            <div class="card-header-v3">
              <h3>Recent Activity</h3>
            </div>
            <div class="activity-feed-list">
              ${state.activityItems.slice(0, 4).map((item) => `
                <div class="activity-feed-item" data-activity-document="${escapeHtml(item.documentId || '')}">
                  <span class="activity-icon-bubble">${getActivityIcon(item.action)}</span>
                  <div class="activity-info">
                    <p><strong>${escapeHtml(item.actor)}</strong> ${escapeHtml(item.action)} <span>${escapeHtml(item.target)}</span></p>
                    <small>${escapeHtml(item.time)}</small>
                  </div>
                </div>
              `).join('') || `
                <div class="empty-activity-state">
                  <span class="empty-icon">📈</span>
                  <h4>No activity yet</h4>
                  <p>Document edits, task updates, chats, and AI actions will appear here.</p>
                  <div class="empty-actions-row">
                    <button class="empty-state-btn primary" data-dashboard-action="new-document">+ Create Note</button>
                    <button class="empty-state-btn" data-dashboard-action="invite">👥 Invite Member</button>
                  </div>
                </div>
              `}
            </div>
          </article>
        </div>

        <!-- RIGHT COLUMN (UTILITIES) -->
        <div class="home-side-col">
          <!-- SECTION 5 — QUICK ACTIONS -->
          <article class="card-v3 quick-actions-card">
            <div class="card-header-v3">
              <h3>Quick Actions</h3>
            </div>
            <div class="quick-actions-grid">
              <button class="action-btn-large" data-dashboard-action="new-document" type="button">
                <span class="action-icon">＋</span>
                <strong>New Note</strong>
              </button>
              <button class="action-btn-large" data-dashboard-target="chat" type="button">
                <span class="action-icon">💬</span>
                <strong>Open Chat</strong>
              </button>
              <button class="action-btn-large" data-dashboard-action="ai" type="button">
                <span class="action-icon">🤖</span>
                <strong>Ask AI</strong>
              </button>
              <button class="action-btn-large" data-dashboard-action="new-task" type="button">
                <span class="action-icon">✅</span>
                <strong>Add Task</strong>
              </button>
            </div>
          </article>

          <!-- SECTION 7 — AI STUDY COACH -->
          <article class="card-v3 ai-coach-card">
            <div class="card-header-v3">
              <h3>AI Study Coach</h3>
              <span class="chat-channel-badge">Gemini AI</span>
            </div>
            <div class="ai-coach-suggestions">
              <button class="ai-coach-chip" data-dashboard-ai="summarize" type="button">
                <span>Summarize active note</span>
                <span class="chip-arrow">→</span>
              </button>
              <button class="ai-coach-chip" data-dashboard-ai="quiz" type="button">
                <span>Quiz me on notes</span>
                <span class="chip-arrow">→</span>
              </button>
              <button class="ai-coach-chip" data-dashboard-action="ai" type="button">
                <span>Create a focus plan</span>
                <span class="chip-arrow">→</span>
              </button>
            </div>
            <div class="ai-coach-actions">
              <button class="ai-coach-btn primary" data-dashboard-action="ai" type="button">
                <span>Ask AI</span>
              </button>
              <button class="ai-coach-btn secondary" data-dashboard-target="chat" type="button">
                <span>Chat</span>
              </button>
            </div>
          </article>

          <!-- SECTION 6 — CHAT PREVIEW -->
          <article class="card-v3 chat-preview-card" data-dashboard-target="chat">
            <div class="card-header-v3">
              <h3>Workspace Chat</h3>
              <span class="chat-channel-badge"># ${escapeHtml(activeChannel.name || 'general')}</span>
            </div>
            <div class="chat-preview-body">
              ${chatPreviewMessages.length ? chatPreviewMessages.map((msg) => {
                const senderName = msg.sender?.username || msg.sender?.email?.split('@')[0] || 'Aman';
                const content = msg.content || msg.body || '';
                return `
                  <div class="chat-preview-msg">
                    <strong>${escapeHtml(senderName)}:</strong>
                    <span>${escapeHtml(content)}</span>
                  </div>
                `;
              }).join('') : `
                <div class="empty-chat-state">
                  <span class="empty-icon">💬</span>
                  <h4>Start the workspace conversation</h4>
                  <p>Ask a question, share an update, or discuss notes with your team.</p>
                  <div class="empty-actions-row">
                    <button class="empty-state-btn primary" data-dashboard-target="chat">Open Chat →</button>
                  </div>
                </div>
              `}
            </div>
            <button class="chat-preview-link-btn" type="button">
              Open Chat <span class="arrow">→</span>
            </button>
          </article>
        </div>
      </div>
    </div>
  `;
};

let threadSearchQuery = '';
