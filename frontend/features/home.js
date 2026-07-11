// Lazily loaded route module. Shared shell bindings are exposed by app.js.
import { membersRuntime } from './members/runtime.js';

export const getDashboardData = () => {
  const memberRuntime = membersRuntime();
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
  const members = memberRuntime.getWorkspaceMembers();
  const activeMembers = memberRuntime.collaborationPeople().filter((person) => person.online).slice(0, 5);
  const chatPreview = demo
    ? { sender: 'Priya Sharma', content: 'Class starts at 10 AM. I uploaded the notes from yesterday.', time: new Date().toISOString() }
    : currentChatPreview();
  const doubts = demo
    ? [
        {
          title: 'Why does circular wait create a deadlock?',
          documentId: 'demo-doc-os-deadlocks',
          documentTitle: 'Lecture 5: Deadlocks',
          meta: '2 replies · Blocking revision'
        },
        {
          title: 'Is Banker algorithm prevention or avoidance?',
          documentId: 'demo-doc-os-deadlocks',
          documentTitle: 'Lecture 5: Deadlocks',
          meta: 'Resolved · saved to lecture'
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
      documents: state.documents.length,
      tasksDue: demo ? 5 : todayTasks.length,
      collaborators: demo ? state.presence.length : (activeMembers.length || state.presence.length),
      doubts: demo ? 1 : state.workspaceThreads.filter((thread) => thread.status !== 'resolved').length
    }
  };
};

const learningCoachData = ({ recentDocuments = [], todayTasks = [], doubts = [], stats = {} }) => {
  const progressSummary = calculateWorkspaceLearningProgress();
  const docs = progressSummary.lectures || [];
  const courses = progressSummary.courseProgress || [];
  // activeLectures = lectures with progress > 5% (have real content)
  const activeLectures = docs.filter((doc) => Number(doc.progress) > 5);
  const revisionQueue = activeLectures
    .filter((doc) => Number(doc.progress) < 90)
    .sort((a, b) => Number(a.progress) - Number(b.progress))
    .slice(0, 5);
  // Prefer in-progress lectures over brand-new ones for the "next lecture" suggestion
  const nextLecture = revisionQueue[0] || recentDocuments[0] || docs[0] || null;
  const completedYesterday = state.demoMode ? 2 : Math.min(2, state.activityItems.filter((item) => /completed|generated|edited|revised/i.test(item.action || '')).length);

  return {
    examLabel: state.demoMode ? 'OS midterm' : selectedWorkspace()?.name || 'Next exam',
    examInDays: state.demoMode ? 12 : null,
    courses,
    progress: progressSummary.overallProgress,
    lecturesLeft: activeLectures.filter((doc) => Number(doc.progress) < 90).length,
    activeLectures: activeLectures.length,
    nextLecture,
    revisionQueue,
    masteredLectures: progressSummary.masteredLectures,
    inProgressLectures: progressSummary.inProgressLectures,
    notStartedLectures: progressSummary.notStartedLectures,
    totalLectures: progressSummary.totalLectures,
    completedTasks: progressSummary.completedTasks,
    pendingTasks: progressSummary.pendingTasks,
    studyStreak: progressSummary.studyStreak,
    longestStreak: progressSummary.longestStreak,
    streakActiveToday: progressSummary.streakActiveToday,
    completedYesterday,
    blockerCount: doubts.filter((doubt) => !/resolved/i.test(doubt.meta || '')).length
  };
};

const renderProgressBar = (value = 0) => `
  <div class="learning-progress-bar" aria-label="Learning progress">
    <span style="width:${Math.max(4, Math.min(100, Number(value) || 0))}%"></span>
  </div>
`;

const renderLectureProgressList = (lectures = []) => lectures.map((lecture) => `
  <button class="lecture-progress-row" data-open-document="${escapeHtml(lecture._id || '')}" type="button">
    <span>
      <strong>${escapeHtml(lecture.title || 'Untitled lecture')}</strong>
      <small>${escapeHtml(lecture.category || 'Course')} · ${lecture.progress >= 90 ? 'Ready for revision' : lecture.progress >= 30 ? 'In progress' : 'Not started'}</small>
    </span>
    <em>${Number.isFinite(Number(lecture.progress)) ? `${Number(lecture.progress)}%` : '0%'}</em>
  </button>
`).join('');

const renderCourseProgress = (courses = []) => courses.map((course) => `
  <div class="course-progress-row">
    <strong>${escapeHtml(course.course)}</strong>
    <span>${course.progress}%</span>
  </div>
`).join('');


export const renderHomePage = () => {
  setMainMode('feature');
  setRouteChrome('home');
  const dashboard = getDashboardData();
  const { workspace, recentDocuments, todayTasks, completedTasks, activeMembers, doubts, stats } = dashboard;
  if (state.loading.workspaces) {
    els.routePage.innerHTML = `
      <div class="dashboard-shell dashboard-shell-v2 nexus-dashboard" aria-busy="true">
        <header class="home-welcome-header">
          <div class="welcome-copy">
            <span class="eyebrow">Nexus Workspace</span>
            <h2>Getting your study workspace ready...</h2>
            <p>Opening your notes, tasks, doubts, and recent study context.</p>
          </div>
        </header>
        <div class="home-grid">
          <div class="home-main-col">${loadingRows(5)}</div>
          <div class="home-side-col">${loadingRows(4)}</div>
        </div>
      </div>
    `;
    return;
  }
  if (!workspace && !state.loading.workspaces) {
    els.routePage.innerHTML = `
      <div class="dashboard-shell dashboard-shell-v2">
        ${emptyState({
          title: 'Create your first study workspace',
          body: 'Organize notes, tasks, doubts, and Nexus Mentor in one calm place.',
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
    }).catch((err) => {
      if (err?.status !== 429) console.warn('Failed to load chat preview:', err);
    });
  }

  const userName = state.demoMode ? 'Alex' : (state.user?.username || state.user?.email?.split('@')[0] || '');
  const greeting = getTimeGreeting(userName);
  const coach = learningCoachData({ recentDocuments, todayTasks, doubts, stats });
  const primaryDoc = coach.nextLecture || recentDocuments[0];
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
          <span class="eyebrow">Learning Operating System</span>
          <h2>${escapeHtml(greeting)}</h2>
          <p>${state.demoMode ? 'Your Semester 5 study coach is already organized around lectures, progress, doubts, and revision.' : 'Here is what to study next and what needs attention.'}</p>
        </div>
        <div class="header-stats-row">
          <span class="stat-pill"><span class="pill-icon">◆</span> ${coach.examInDays ? `${coach.examLabel} in ${coach.examInDays} days` : 'Study path ready'}</span>
          <span class="stat-pill"><span class="pill-icon">📚</span> ${coach.totalLectures} lectures</span>
          <span class="stat-pill"><span class="pill-icon">✅</span> ${coach.completedTasks} tasks complete</span>
          <span class="stat-pill streak-pill ${coach.streakActiveToday ? 'streak-active' : coach.studyStreak > 0 ? 'streak-alive' : 'streak-zero'}">
            <span class="pill-icon">🔥</span>
            ${coach.studyStreak === 0
              ? 'Start your streak today'
              : coach.streakActiveToday
                ? `${coach.studyStreak} day streak · studied today!`
                : `${coach.studyStreak} day streak · study today to keep it`
            }
          </span>
        </div>
      </header>

      ${state.demoMode ? `
        <section class="judge-tour-card" aria-label="Five-minute judge tour">
          <div>
            <span class="judge-tour-kicker">Five-minute tour</span>
            <h3>See the living lecture loop</h3>
            <p>Open Deadlocks, select the circular wait paragraph, ask Nexus Mentor to explain it, review the attached doubt, then take the quiz. The demo shows Nexus organizing progress instead of files.</p>
          </div>
          <div class="judge-tour-actions">
            <button data-open-document="${escapeHtml(primaryDoc?._id || state.selectedDocumentId || '')}" type="button">Open lecture</button>
            <button data-dashboard-action="ai" type="button">Ask Mentor</button>
            <button data-dashboard-target="tasks" type="button">Tasks</button>
            <button data-dashboard-target="chat" type="button">Chat</button>
          </div>
        </section>
      ` : ''}

      <div class="home-grid">
        <!-- LEFT COLUMN (MAIN FLOW) -->
        <div class="home-main-col">
          <article class="card-v3 learning-coach-card">
            <div class="learning-coach-main">
              <span class="doc-badge">Overall Workspace Progress</span>
              <h3>${coach.progress}% study progress</h3>
              <p>${primaryDoc ? `Next lecture to move forward: ${escapeHtml(primaryDoc.title || 'Untitled lecture')} · ${Number(primaryDoc.progress || 0)}% complete` : 'Add one lecture and Nexus will organize notes, doubts, tasks, quizzes, and revision around it.'}</p>
              ${renderProgressBar(coach.progress)}
              <div class="course-progress-list">
                ${renderCourseProgress(coach.courses)}
              </div>
            </div>
            <div class="learning-coach-metrics">
              <span><strong>${coach.totalLectures}</strong><small>Total lectures</small></span>
              <span><strong>${coach.masteredLectures}</strong><small>Ready ≥90%</small></span>
              <span><strong>${coach.inProgressLectures}</strong><small>In progress 30–89%</small></span>
              <span><strong>${coach.notStartedLectures}</strong><small>Not started &lt;30%</small></span>
              <span><strong>${coach.completedTasks}</strong><small>Completed tasks</small></span>
              <span><strong>${coach.pendingTasks}</strong><small>Pending tasks</small></span>
            </div>
          </article>

          <!-- SECTION 2 — CONTINUE WORKING -->
          ${primaryDoc ? `
            <article class="card-v3 continue-working-card" data-open-document="${escapeHtml(primaryDoc._id)}">
              <div class="continue-working-content">
                <span class="doc-badge">Living Lecture</span>
                <div class="continue-working-title-row">
                  <span class="doc-icon-large">▣</span>
                  <div>
                    <h3>${escapeHtml(primaryDoc.title || 'Untitled Document')}</h3>
                    <p>${escapeHtml(primaryDoc.category || 'Course')} · ${Number(primaryDoc.progress || 0)}% study progress</p>
                  </div>
                </div>
              </div>
              <button class="continue-btn" type="button">
                Continue Studying <span class="arrow">→</span>
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
                    <p>Write notes, generate flashcards, and study with Nexus Mentor.</p>
                  </div>
                </div>
              </div>
              <button class="continue-btn" type="button">
                + Create Note <span class="arrow">→</span>
              </button>
            </article>
          `}

          <article class="card-v3 revision-map-card">
            <div class="card-header-v3">
              <h3>Lecture Mastery Map</h3>
              <span class="chat-channel-badge">${coach.lecturesLeft} left to review</span>
            </div>
            <div class="revision-map-list">
              ${renderLectureProgressList(coach.revisionQueue.length ? coach.revisionQueue : recentDocuments.slice(0, 4)) || `
                <div class="empty-focus-state">
                  <span class="empty-icon">✓</span>
                  <h4>No revision queue yet</h4>
                  <p>Open a lecture and Nexus will start building revision context.</p>
                </div>
              `}
            </div>
          </article>

          <!-- SECTION 3 — TODAY'S FOCUS -->
          <article class="card-v3 focus-card">
            <div class="card-header-v3">
              <h3>Today's Study Plan</h3>
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
                  <p>Create a study task or let Nexus Mentor draft a plan from your current lecture.</p>
                  <div class="empty-actions-row">
                    <button class="empty-state-btn primary" data-dashboard-action="new-task">+ Add Study Task</button>
                    <button class="empty-state-btn" data-dashboard-action="ai">Generate with Mentor</button>
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
                  <span class="empty-icon">↗</span>
                  <h4>No activity yet</h4>
                  <p>Lecture revisions, quiz attempts, doubts, and mentor actions will appear here.</p>
                  <div class="empty-actions-row">
                    <button class="empty-state-btn primary" data-dashboard-action="new-document">+ Create Lecture</button>
                    <button class="empty-state-btn" data-dashboard-action="invite">👥 Invite Member</button>
                  </div>
                </div>
              `}
            </div>
          </article>
        </div>

        <!-- RIGHT COLUMN (UTILITIES) -->
        <div class="home-side-col">
          <article class="card-v3 blockers-card">
            <div class="card-header-v3">
              <h3>What Is Blocking You</h3>
              <a href="#/threads" class="view-all-link" data-dashboard-target="threads">Open Doubts →</a>
            </div>
            <div class="doubt-list">
              ${doubts.slice(0, 3).map((doubt) => `
                <button class="doubt-card" data-open-document="${escapeHtml(doubt.documentId || '')}" type="button">
                  <strong>${escapeHtml(doubt.title)}</strong>
                  <small>${escapeHtml(doubt.documentTitle || 'Lecture')}</small>
                  <em>${escapeHtml(doubt.meta || '')}</em>
                </button>
              `).join('') || `
                <div class="empty-chat-state">
                  <span class="empty-icon">✓</span>
                  <h4>No unresolved doubts yet</h4>
                  <p>Doubts attached to paragraphs will stay here until resolved.</p>
                </div>
              `}
            </div>
          </article>

          <!-- SECTION 5 — QUICK ACTIONS -->
          <article class="card-v3 quick-actions-card">
            <div class="card-header-v3">
              <h3>Study Actions</h3>
            </div>
            <div class="quick-actions-grid">
              <button class="action-btn-large" data-dashboard-action="new-document" type="button">
                <span class="action-icon">＋</span>
                <strong>New Lecture</strong>
              </button>
              <button class="action-btn-large" data-dashboard-target="chat" type="button">
                <span class="action-icon">💬</span>
                <strong>Open Chat</strong>
              </button>
              <button class="action-btn-large" data-dashboard-action="ai" type="button">
                <span class="action-icon">🤖</span>
                <strong>Ask Mentor</strong>
              </button>
              <button class="action-btn-large" data-dashboard-action="new-task" type="button">
                <span class="action-icon">✅</span>
                <strong>Add Task</strong>
              </button>
            </div>
          </article>

          <!-- SECTION 7 — NEXUS MENTOR -->
          <article class="card-v3 ai-coach-card">
            <div class="card-header-v3">
              <h3>Nexus Mentor</h3>
              <span class="chat-channel-badge">Lecture-aware</span>
            </div>
            <div class="ai-coach-suggestions">
              <button class="ai-coach-chip" data-dashboard-ai="summarize" type="button">
                <span>Summarize this lecture</span>
                <span class="chip-arrow">→</span>
              </button>
              <button class="ai-coach-chip" data-dashboard-ai="quiz" type="button">
                <span>Quiz weak concepts</span>
                <span class="chip-arrow">→</span>
              </button>
              <button class="ai-coach-chip" data-dashboard-action="ai" type="button">
                <span>Create revision questions</span>
                <span class="chip-arrow">→</span>
              </button>
            </div>
            <div class="ai-coach-actions">
              <button class="ai-coach-btn primary" data-dashboard-action="ai" type="button">
                <span>Ask Mentor</span>
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
