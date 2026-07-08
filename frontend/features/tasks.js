// Lazily loaded route module. Shared shell bindings are exposed by app.js.

export const getFilteredTasks = (tasks) => {
  let list = [...tasks];
  const currentUserId = String(state.user?.id || state.user?._id || '');

  if (taskSearchQuery.trim()) {
    const q = taskSearchQuery.toLowerCase().trim();
    list = list.filter(t => {
      const titleMatch = (t.title || '').toLowerCase().includes(q);
      const descMatch = (t.description || '').toLowerCase().includes(q);
      const priorityMatch = (t.priority || '').toLowerCase().includes(q);
      const statusMatch = (t.status || '').toLowerCase().includes(q);
      
      const assigneeName = t.assignee?.username || t.assignee?.email || '';
      const assigneeMatch = assigneeName.toLowerCase().includes(q);

      const docTitle = t.documentTitle || '';
      const docMatch = docTitle.toLowerCase().includes(q);

      return titleMatch || descMatch || priorityMatch || statusMatch || assigneeMatch || docMatch;
    });
  }

  if (taskFilterTab === 'mine') {
    list = list.filter(t => {
      const assId = t.assignee?._id || t.assignee;
      return assId && String(assId) === currentUserId;
    });
  } else if (taskFilterTab === 'due_soon') {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const threeDaysLater = new Date(now);
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);
    list = list.filter(t => {
      if (t.status === 'done' || t.status === 'completed') return false;
      if (!t.dueDate) return false;
      const d = new Date(t.dueDate);
      return d >= now && d <= threeDaysLater;
    });
  } else if (taskFilterTab === 'overdue') {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    list = list.filter(t => {
      if (t.status === 'done' || t.status === 'completed') return false;
      if (!t.dueDate) return false;
      const d = new Date(t.dueDate);
      d.setHours(0, 0, 0, 0);
      return d < now;
    });
  }

  list = sortTasks(list, taskSortField);
  return list;
};


export const renderTaskCardHtml = (task) => {
  const isDone = task.status === 'done' || task.status === 'completed';
  const priorityLabels = { high: 'High', medium: 'Medium', low: 'Low' };
  const priorityLabel = priorityLabels[task.priority] || 'Medium';
  const assigneeName = task.assignee?.username || task.assignee?.email || '';
  const assigneeInitials = assigneeName ? getInitials(assigneeName) : '';
  
  let dueBadgeClass = 'due-date-badge';
  let dueLabel = 'No due date';
  if (task.dueDate) {
    const due = new Date(task.dueDate);
    dueLabel = due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const dDate = new Date(task.dueDate);
    dDate.setHours(0, 0, 0, 0);
    
    if (!isDone) {
      if (dDate < now) {
        dueBadgeClass += ' overdue';
        dueLabel = `Overdue: ${dueLabel}`;
      } else {
        const diffTime = dDate - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays <= 3) {
          dueBadgeClass += ' due-soon';
          if (diffDays === 0) dueLabel = 'Due Today';
          else if (diffDays === 1) dueLabel = 'Due Tomorrow';
          else dueLabel = `Due in ${diffDays} days`;
        }
      }
    }
  }

  const isMenuOpen = activeTaskMoreMenuId === task._id;

  const priorityCardClass = task.priority === 'high' ? 'priority-high-card' : task.priority === 'low' ? 'priority-low-card' : 'priority-medium-card';

  return `
    <article class="task-page-card task-card-v2 ${isDone ? 'completed' : ''} ${priorityCardClass}" draggable="true" data-task-id="${task._id}" data-doc-id="${task.documentId || ''}">
      <div class="card-top-badges">
        <div class="left-badges">
          <span class="priority-badge priority-${task.priority || 'medium'}">${priorityLabel}</span>
          ${task.documentId ? `
            <span class="doc-link-badge" title="Linked to: ${escapeHtml(task.documentTitle)}">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
              ${escapeHtml(task.documentTitle)}
            </span>
          ` : ''}
        </div>
        <div class="card-actions-wrapper">
          <button class="icon-button task-menu-toggle-btn" data-toggle-task-menu="${task._id}" type="button" title="More options">⋯</button>
          <div class="chat-dropdown-menu ${isMenuOpen ? '' : 'hidden'}" style="top: 24px; right: 0; width: 160px; z-index: 10;">
            <button class="chat-dropdown-item task-action-edit" data-edit-task-id="${task._id}" type="button">Edit Task</button>
            <button class="chat-dropdown-item task-action-copy" data-copy-title="${escapeHtml(task.title)}" type="button">Copy Title</button>
            ${task.documentId ? `
              <button class="chat-dropdown-item task-action-go-doc" data-go-doc-id="${task.documentId}" type="button">Open Note</button>
            ` : ''}
            <button class="chat-dropdown-item delete-action task-action-delete" data-delete-task-id="${task._id}" type="button">Delete Task</button>
          </div>
        </div>
      </div>

      <div class="task-title-row">
        <input type="checkbox" class="task-checkbox-v2" ${isDone ? 'checked' : ''} data-check-task-id="${task._id}" />
        <strong>${escapeHtml(task.title)}</strong>
      </div>

      ${task.description ? `
        <small class="task-desc-preview">${escapeHtml(task.description)}</small>
      ` : ''}

      <div class="card-footer-info">
        <span class="${dueBadgeClass}">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${escapeHtml(dueLabel)}
        </span>
        <div class="assignee-info">
          ${assigneeName ? `
            <span class="assignee-avatar" title="${escapeHtml(assigneeName)}">${escapeHtml(assigneeInitials)}</span>
            <span class="assignee-name" title="${escapeHtml(assigneeName)}">${escapeHtml(assigneeName)}</span>
          ` : `
            <span class="assignee-name unassigned">Unassigned</span>
          `}
        </div>
      </div>
    </article>
  `;
};


export const showAddTaskModal = async () => {
  const docs = state.documents || [];
  if (!docs.length) {
    return showToast('Create a document first before creating a task.', true);
  }
  const members = selectedWorkspace()?.members || [];
  const currentDocId = state.selectedDocumentId || docs[0]?._id;

  const modalHtml = `
    <form id="addTaskModalForm" novalidate style="display: flex; flex-direction: column; gap: 16px;">
      <div class="form-field-v2">
        <label>Task Title *</label>
        <input type="text" id="addTaskModalTitle" placeholder="e.g. Revise Banker algorithm examples" required />
      </div>
      <div class="form-field-v2">
        <label>Description (Optional)</label>
        <textarea id="addTaskModalDesc" rows="3" placeholder="Provide task details..."></textarea>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div class="form-field-v2">
          <label>Priority</label>
          <select id="addTaskModalPriority">
            <option value="low">Low</option>
            <option value="medium" selected>Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div class="form-field-v2">
          <label>Due Date</label>
          <input type="date" id="addTaskModalDueDate" />
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div class="form-field-v2">
          <label>Assignee</label>
          <select id="addTaskModalAssignee">
            <option value="">Unassigned</option>
            ${members.map(m => {
              const name = m.user?.username || m.user?.email || 'Teammate';
              const id = m.user?._id || m.user?.id || m.user;
              return `<option value="${id}">${escapeHtml(name)}</option>`;
            }).join('')}
          </select>
        </div>
        <div class="form-field-v2">
          <label>Linked Document *</label>
          <select id="addTaskModalDoc" required>
            ${docs.map(d => `
              <option value="${d._id}" ${d._id === currentDocId ? 'selected' : ''}>${escapeHtml(d.title || 'Untitled Document')}</option>
            `).join('')}
          </select>
        </div>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;">
        <button type="button" class="btn-cancel-modal" id="cancelAddTaskModalBtn" style="background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 8px 16px; color: var(--text); font-size: 14px; font-weight: 500; cursor: pointer;">Cancel</button>
        <button type="submit" id="submitAddTaskModalBtn" style="background: var(--primary); border: none; border-radius: 6px; padding: 8px 16px; color: white; font-size: 14px; font-weight: 500; cursor: pointer;">Create Task</button>
      </div>
    </form>
  `;

  await showChatModal('Add Task', modalHtml);

  const cancelBtn = document.getElementById('cancelAddTaskModalBtn');
  cancelBtn?.addEventListener('click', () => {
    document.getElementById('chatOverlayModal')?.remove();
  });

  const form = document.getElementById('addTaskModalForm');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('submitAddTaskModalBtn');
    clearInlineErrors(form);
    if (submitBtn) submitBtn.disabled = true;

    const titleInput = document.getElementById('addTaskModalTitle');
    const title = titleInput.value.trim();
    const description = document.getElementById('addTaskModalDesc').value.trim();
    const priority = document.getElementById('addTaskModalPriority').value;
    const dueDateVal = document.getElementById('addTaskModalDueDate').value;
    const assignee = document.getElementById('addTaskModalAssignee').value || null;
    const docId = document.getElementById('addTaskModalDoc').value;

    if (!title) {
      if (submitBtn) submitBtn.disabled = false;
      showInlineError(titleInput, 'Give this task a short action title.');
      focusFirstInvalid(form);
      return showToast('Please add a task title.', true);
    }

    const payload = {
      title,
      description,
      priority,
      dueDate: dueDateVal ? new Date(dueDateVal).toISOString() : null,
      assignee,
      status: 'todo'
    };

    if (state.demoMode) {
      const selectedDoc = docs.find(d => d._id === docId);
      const task = {
        _id: `demo-task-${Date.now()}`,
        ...payload,
        documentId: docId,
        documentTitle: selectedDoc?.title || 'Document',
        creator: state.user?.id || 'demo-user',
        createdAt: new Date().toISOString()
      };
      if (assignee) {
        const member = members.find(m => (m.user?._id || m.user?.id || m.user) === assignee);
        task.assignee = member ? member.user : { username: 'Teammate' };
      }
      upsertTaskInStore(task);
      addActivity({ action: 'created task', target: task.title });
      markLectureMilestone(docId, 'taskCreated', { message: 'Study task created' });
      showToast('Demo task created locally');
      document.getElementById('chatOverlayModal')?.remove();
      renderTasksBoard();
      return;
    }

    try {
      const task = await request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${docId}/tasks`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      upsertTaskInStore(task);
      addActivity({ action: 'created task', target: task.title });
      markLectureMilestone(docId, 'taskCreated', { message: 'Study task created' });
      showToast('Task created successfully!');
      document.getElementById('chatOverlayModal')?.remove();
      renderTasksBoard();
    } catch (err) {
      showToast(friendlyUiMessage(err.message, { isError: true }), true);
      if (submitBtn) submitBtn.disabled = false;
    }
  });
};


export const showEditTaskModal = async (taskId) => {
  const allTasks = workspaceTaskList();
  const task = allTasks.find(t => t._id === taskId);
  if (!task) return;

  const docs = state.documents || [];
  const members = selectedWorkspace()?.members || [];
  
  let dateStr = '';
  if (task.dueDate) {
    dateStr = new Date(task.dueDate).toISOString().split('T')[0];
  }

  const assigneeId = task.assignee?._id || task.assignee || '';

  const modalHtml = `
    <form id="editTaskModalForm" novalidate style="display: flex; flex-direction: column; gap: 16px;">
      <div class="form-field-v2">
        <label>Task Title *</label>
        <input type="text" id="editTaskModalTitle" value="${escapeHtml(task.title)}" placeholder="Task title" required />
      </div>
      <div class="form-field-v2">
        <label>Description (Optional)</label>
        <textarea id="editTaskModalDesc" rows="3" placeholder="Provide task details...">${escapeHtml(task.description || '')}</textarea>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div class="form-field-v2">
          <label>Priority</label>
          <select id="editTaskModalPriority">
            <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Low</option>
            <option value="medium" ${task.priority === 'medium' || !task.priority ? 'selected' : ''}>Medium</option>
            <option value="high" ${task.priority === 'high' ? 'selected' : ''}>High</option>
          </select>
        </div>
        <div class="form-field-v2">
          <label>Due Date</label>
          <input type="date" id="editTaskModalDueDate" value="${dateStr}" />
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div class="form-field-v2">
          <label>Assignee</label>
          <select id="editTaskModalAssignee">
            <option value="">Unassigned</option>
            ${members.map(m => {
              const name = m.user?.username || m.user?.email || 'Teammate';
              const id = m.user?._id || m.user?.id || m.user;
              return `<option value="${id}" ${String(id) === String(assigneeId) ? 'selected' : ''}>${escapeHtml(name)}</option>`;
            }).join('')}
          </select>
        </div>
        <div class="form-field-v2">
          <label>Linked Document (Immutable)</label>
          <select id="editTaskModalDoc" disabled>
            ${docs.map(d => `
              <option value="${d._id}" ${d._id === (task.documentId || task.document) ? 'selected' : ''}>${escapeHtml(d.title || 'Untitled Document')}</option>
            `).join('')}
          </select>
        </div>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;">
        <button type="button" class="btn-cancel-modal" id="cancelEditTaskModalBtn" style="background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 8px 16px; color: var(--text); font-size: 14px; font-weight: 500; cursor: pointer;">Cancel</button>
        <button type="submit" id="submitEditTaskModalBtn" style="background: var(--primary); border: none; border-radius: 6px; padding: 8px 16px; color: white; font-size: 14px; font-weight: 500; cursor: pointer;">Save Changes</button>
      </div>
    </form>
  `;

  await showChatModal('Edit Task', modalHtml);

  const cancelBtn = document.getElementById('cancelEditTaskModalBtn');
  cancelBtn?.addEventListener('click', () => {
    document.getElementById('chatOverlayModal')?.remove();
  });

  const form = document.getElementById('editTaskModalForm');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('submitEditTaskModalBtn');
    clearInlineErrors(form);
    if (submitBtn) submitBtn.disabled = true;

    const titleInput = document.getElementById('editTaskModalTitle');
    const title = titleInput.value.trim();
    const description = document.getElementById('editTaskModalDesc').value.trim();
    const priority = document.getElementById('editTaskModalPriority').value;
    const dueDateVal = document.getElementById('editTaskModalDueDate').value;
    const assignee = document.getElementById('editTaskModalAssignee').value || null;

    if (!title) {
      if (submitBtn) submitBtn.disabled = false;
      showInlineError(titleInput, 'Give this task a short action title.');
      focusFirstInvalid(form);
      return showToast('Please add a task title.', true);
    }

    const payload = {
      title,
      description,
      priority,
      dueDate: dueDateVal ? new Date(dueDateVal).toISOString() : null,
      assignee
    };

    const docId = task.documentId || task.document;

    if (state.demoMode) {
      const updated = {
        ...task,
        ...payload
      };
      if (assignee) {
        const member = members.find(m => (m.user?._id || m.user?.id || m.user) === assignee);
        updated.assignee = member ? member.user : { username: 'Teammate' };
      } else {
        updated.assignee = null;
      }
      upsertTaskInStore(updated);
      showToast('Demo task updated locally');
      document.getElementById('chatOverlayModal')?.remove();
      renderTasksBoard();
      return;
    }

    try {
      const updatedTask = await request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${docId}/tasks/${task._id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      upsertTaskInStore(updatedTask);
      showToast('Task updated successfully!');
      document.getElementById('chatOverlayModal')?.remove();
      renderTasksBoard();
    } catch (err) {
      showToast(friendlyUiMessage(err.message, { isError: true }), true);
      if (submitBtn) submitBtn.disabled = false;
    }
  });
};

const taskIsDone = (task = {}) => task.status === 'done' || task.status === 'completed';

const renderTasksSkeleton = () => `
  <div class="tasks-loading-stack" aria-label="Preparing task board">
    ${loadingRows(4)}
  </div>
`;

const getRenderableTasks = () => workspaceTaskList().map((task) => normalizeTask(task)).filter(Boolean);

const getTasksViewData = () => {
  const allTasks = getRenderableTasks();
  const stats = getTaskStats(allTasks);
  const filteredTasks = getFilteredTasks(allTasks);
  return {
    allTasks,
    stats,
    filteredTasks,
    openTasks: filteredTasks.filter(t => !taskIsDone(t)),
    completedTasks: filteredTasks.filter(t => taskIsDone(t))
  };
};

const renderTasksColumnsHtml = ({ openTasks, completedTasks }) => {
  const openEmptyHtml = `
    <div class="tasks-compact-empty">
      <div class="empty-icon-wrap">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12h6M9 8h6M9 16h4"/></svg>
      </div>
      <h4>No open tasks</h4>
      <p>Plan your study session, assign work, or create a task from a document.</p>
      <button class="btn-empty-add" id="tasksOpenEmptyAddTaskBtn" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add Task
      </button>
    </div>
  `;

  const completedEmptyHtml = `
    <div class="tasks-compact-empty">
      <div class="empty-icon-wrap">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>
      </div>
      <h4>Nothing completed yet</h4>
      <p>Completed tasks appear here once your team finishes work.</p>
    </div>
  `;

  const openColLabel  = taskViewMode === 'list' ? 'Open Tasks'      : 'Open';
  const doneColLabel  = taskViewMode === 'list' ? 'Completed Tasks'  : 'Completed';
  const isInitialLoading = state.taskStore.loading && !openTasks.length && !completedTasks.length;

  const colHeadHtml = (label, count, colKey) => `
    <div class="tasks-column-head" data-col="${colKey}">
      <div class="col-head-left">
        <div class="col-icon">
          ${colKey === 'open'
            ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12h6M9 8h6M9 16h4"/></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>`
          }
        </div>
        <h3>${label}</h3>
      </div>
      <span class="col-badge">${count}</span>
    </div>
  `;

  return `
    <section class="tasks-column" data-task-column-status="open">
      ${colHeadHtml(openColLabel, openTasks.length, 'open')}
      <div class="tasks-column-body-v2">
        ${isInitialLoading ? renderTasksSkeleton() : (openTasks.map(t => renderTaskCardHtml(t)).join('') || openEmptyHtml)}
      </div>
    </section>
    <section class="tasks-column" data-task-column-status="completed">
      ${colHeadHtml(doneColLabel, completedTasks.length, 'done')}
      <div class="tasks-column-body-v2">
        ${isInitialLoading ? renderTasksSkeleton() : (completedTasks.map(t => renderTaskCardHtml(t)).join('') || completedEmptyHtml)}
      </div>
    </section>
  `;
};

const bindTaskDragAndDrop = () => {
  const boardEl = document.querySelector('.tasks-board, .tasks-list');
  if (!boardEl) return;

  const cards = boardEl.querySelectorAll('.task-page-card');
  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.dataset.taskId);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });
  });

  const columns = boardEl.querySelectorAll('.tasks-column');
  columns.forEach(column => {
    column.addEventListener('dragover', (e) => {
      e.preventDefault();
      column.classList.add('drag-hover');
    });
    column.addEventListener('dragleave', () => {
      column.classList.remove('drag-hover');
    });
    column.addEventListener('drop', async (e) => {
      e.preventDefault();
      column.classList.remove('drag-hover');
      const taskId = e.dataTransfer.getData('text/plain');
      const targetStatus = column.dataset.taskColumnStatus;
      if (taskId && targetStatus) {
        await moveTaskStatus(taskId, targetStatus);
      }
    });
  });
};

export const renderTasksBoard = () => {
  const boardEl = document.querySelector('.tasks-board, .tasks-list');
  if (!boardEl) return renderTasksPage();

  const { stats, openTasks, completedTasks } = getTasksViewData();
  const nextClassName = taskViewMode === 'list' ? 'tasks-list' : 'tasks-board';
  boardEl.className = nextClassName;
  boardEl.innerHTML = renderTasksColumnsHtml({ openTasks, completedTasks });

  const statValues = {
    open: stats.open,
    'due-soon': stats.dueSoon,
    done: stats.completed,
    mine: stats.assignedToMe
  };
  Object.entries(statValues).forEach(([key, value]) => {
    const statCount = document.querySelector(`[data-stat="${key}"] .stat-count`);
    if (statCount) statCount.textContent = String(value);
  });

  bindTaskDragAndDrop();
};

export const renderTasksPage = () => {
  setMainMode('feature');
  setRouteChrome('tasks');

  const workspace = selectedWorkspace();
  const { stats, openTasks, completedTasks } = getTasksViewData();
  const contentHtml = renderTasksColumnsHtml({ openTasks, completedTasks });

  els.routePage.innerHTML = `
    <div class="tasks-page-v2">
      <header class="page-heading-v2">
        <div>
          <h2>Tasks</h2>
          <p>Plan, assign, and finish study work across ${escapeHtml(workspace?.name || 'this workspace')}.</p>
        </div>
        <button class="btn-add-task primary" id="tasksPageAddTaskBtn" type="button">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Task
        </button>
      </header>

      <!-- Stats Row -->
      <section class="tasks-stats-row">
        <div class="tasks-stat-card" data-stat="open">
          <div class="stat-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12h6M9 8h6M9 16h4"/></svg>
          </div>
          <div class="stat-info">
            <span class="stat-label">Open</span>
            <strong class="stat-count">${stats.open}</strong>
          </div>
        </div>
        <div class="tasks-stat-card" data-stat="due-soon">
          <div class="stat-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div class="stat-info">
            <span class="stat-label">Due Soon</span>
            <strong class="stat-count">${stats.dueSoon}</strong>
          </div>
        </div>
        <div class="tasks-stat-card" data-stat="done">
          <div class="stat-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>
          </div>
          <div class="stat-info">
            <span class="stat-label">Completed</span>
            <strong class="stat-count">${stats.completed}</strong>
          </div>
        </div>
        <div class="tasks-stat-card" data-stat="mine">
          <div class="stat-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <div class="stat-info">
            <span class="stat-label">Assigned to Me</span>
            <strong class="stat-count">${stats.assignedToMe}</strong>
          </div>
        </div>
      </section>

      <!-- Toolbar -->
      <section class="tasks-toolbar">
        <div class="tasks-search-wrapper">
          <svg xmlns="http://www.w3.org/2000/svg" class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" id="tasksSearchInput" placeholder="Search tasks..." value="${escapeHtml(taskSearchQuery)}" />
          ${taskSearchQuery ? '<button type="button" class="clear-search-btn" id="tasksClearSearchBtn" title="Clear search">×</button>' : ''}
        </div>

        <div class="tasks-filters-group">
          <div class="tasks-filter-chips">
            <button class="filter-chip ${taskFilterTab === 'all' ? 'active' : ''}" data-tasks-filter-tab="all" type="button">All</button>
            <button class="filter-chip ${taskFilterTab === 'mine' ? 'active' : ''}" data-tasks-filter-tab="mine" type="button">Mine</button>
            <button class="filter-chip ${taskFilterTab === 'due_soon' ? 'active' : ''}" data-tasks-filter-tab="due_soon" type="button">Due Soon</button>
            <button class="filter-chip ${taskFilterTab === 'overdue' ? 'active' : ''}" data-tasks-filter-tab="overdue" type="button">Overdue</button>
          </div>

          <div class="tasks-dropdowns">
            <label class="toolbar-select-label">
              Sort:
              <select id="tasksSortSelect">
                <option value="priority"  ${taskSortField === 'priority'  ? 'selected' : ''}>Priority</option>
                <option value="dueDate"   ${taskSortField === 'dueDate'   ? 'selected' : ''}>Due Date</option>
                <option value="createdAt" ${taskSortField === 'createdAt' ? 'selected' : ''}>Created</option>
              </select>
            </label>
            <div class="tasks-view-toggle">
              <button class="icon-btn ${taskViewMode === 'board' ? 'active' : ''}" id="tasksViewToggleBoardBtn" type="button" title="Board View">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                Board
              </button>
              <button class="icon-btn ${taskViewMode === 'list' ? 'active' : ''}" id="tasksViewToggleListBtn" type="button" title="List View">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                List
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Tasks Content Layout -->
      <div class="${taskViewMode === 'list' ? 'tasks-list' : 'tasks-board'}">
        ${contentHtml}
      </div>
    </div>
  `;

  bindTaskDragAndDrop();
};

export const moveTaskStatus = async (taskId, columnStatus) => {
  const newStatus = columnStatus === 'completed' ? 'done' : 'todo';
  
  const allTasks = workspaceTaskList();
  const task = allTasks.find(t => t._id === taskId);
  if (!task) return;
  
  if (task.status === newStatus) return; // no change
  
  // Optimistic UI update
  const previousTask = { ...task };
  const optimisticTask = {
    ...task,
    status: newStatus,
    completedAt: newStatus === 'done' ? new Date().toISOString() : null
  };
  
  upsertTaskInStore(optimisticTask);
  refreshLectureProgress(optimisticTask.documentId || optimisticTask.document || state.selectedDocumentId, {
    message: 'All linked tasks completed',
    show: newStatus === 'done'
  });
  
  renderTasksBoard();
  
  if (state.demoMode) {
    showToast('Task updated locally');
    return;
  }
  
  try {
    const docId = optimisticTask.documentId || optimisticTask.document;
    const updatedTask = await request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${docId}/tasks/${optimisticTask._id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus })
    });
    upsertTaskInStore(updatedTask);
    showToast('Task status updated!');
  } catch (err) {
    showToast(err.message, true);
    upsertTaskInStore(previousTask);
    renderTasksBoard();
  }
};
