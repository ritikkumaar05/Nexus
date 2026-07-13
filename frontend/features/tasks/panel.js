export const createTaskPanel = ({
  els,
  state,
  selectedDocument,
  loadingRows,
  errorState,
  emptyState,
  escapeHtml,
  upsertTaskInStore,
  removeTaskFromStore,
  addActivity,
  markLectureMilestone,
  refreshLectureProgress,
  allKnownTasks,
  taskDocumentId,
  getDocumentContextPath,
  request,
  showToast
}) => {
  const renderTaskList = () => {
    const doc = selectedDocument();
    if (state.loading.tasks) {
      els.taskList.innerHTML = loadingRows(3);
      return;
    }
    if (state.errors.tasks) {
      els.taskList.innerHTML = errorState(state.errors.tasks);
      return;
    }
    els.taskList.innerHTML = doc && state.documentTasks.length ? state.documentTasks.map((task) => `
      <label data-task-id="${task._id}" class="${task.status === 'done' ? 'done' : ''}">
        <input type="checkbox" ${task.status === 'done' ? 'checked' : ''} />
        <span>${escapeHtml(task.title)}</span>
        <small>${escapeHtml(task.priority || 'medium')}</small>
        <button class="task-delete" type="button" data-delete-task="${task._id}" title="Delete task">×</button>
      </label>
    `).join('') : emptyState({
      title: doc ? 'No tasks yet' : 'No document selected',
      body: doc ? 'Break your study goals into small tasks and track progress with your team.' : 'Select a document to see its task list.',
      action: doc ? '+ Add Task' : '',
      actionId: doc ? 'emptyPanelAddTaskBtn' : '',
      icon: '✓',
      hint: doc ? 'Try: revise notes, prepare quiz, complete assignment.' : ''
    });
  };

  const bindTaskPanelHandlers = () => {
    els.taskForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!state.selectedDocumentId || !els.taskInput.value.trim()) return;

      if (state.demoMode) {
        const task = {
          _id: `demo-task-${Date.now()}`,
          title: els.taskInput.value.trim(),
          status: 'todo',
          priority: 'medium',
          dueDate: new Date().toISOString(),
          documentId: state.selectedDocumentId,
          assignee: { username: state.user?.username || 'Ritik Kumar' }
        };
        upsertTaskInStore(task);
        els.taskInput.value = '';
        addActivity({ action: 'created task', target: task.title || 'Untitled task' });
        markLectureMilestone(state.selectedDocumentId, 'taskCreated', { message: 'Study task created' });
        renderTaskList();
        return showToast('Demo task added locally');
      }

      request(`${getDocumentContextPath()}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ title: els.taskInput.value.trim() })
      })
        .then((task) => {
          upsertTaskInStore(task);
          els.taskInput.value = '';
          addActivity({ action: 'created task', target: task.title || 'Untitled task' });
          markLectureMilestone(state.selectedDocumentId, 'taskCreated', { message: 'Study task created' });
          renderTaskList();
        })
        .catch((err) => showToast(err.message, true));
    });

    els.taskList.addEventListener('change', (event) => {
      const checkbox = event.target.closest('input[type="checkbox"]');
      const taskRow = event.target.closest('[data-task-id]');
      if (!checkbox || !taskRow || !state.selectedDocumentId) return;

      const task = state.taskStore.byId[taskRow.dataset.taskId] || state.documentTasks.find((item) => item._id === taskRow.dataset.taskId);
      if (!task) return;
      const previousTask = { ...task };
      const optimisticTask = {
        ...task,
        status: checkbox.checked ? 'done' : 'todo',
        completedAt: checkbox.checked ? new Date().toISOString() : null
      };
      upsertTaskInStore(optimisticTask);
      if (checkbox.checked) addActivity({ action: 'completed task', target: optimisticTask.title || 'Untitled task' });
      refreshLectureProgress(state.selectedDocumentId, {
        message: 'All linked tasks completed',
        show: checkbox.checked
      });
      if (checkbox.checked) {
        const docTasks = allKnownTasks().filter((t) => taskDocumentId(t) === state.selectedDocumentId);
        if (docTasks.length > 0 && docTasks.every((t) => t.status === 'done')) {
          markLectureMilestone(state.selectedDocumentId, 'allTasksCompleted', { message: 'All study tasks completed' });
        }
      }
      renderTaskList();

      if (state.demoMode) {
        return;
      }
      request(`${getDocumentContextPath()}/tasks/${task._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: checkbox.checked ? 'done' : 'todo' })
      })
        .then((updatedTask) => {
          upsertTaskInStore(updatedTask);
          renderTaskList();
        })
        .catch((err) => {
          upsertTaskInStore(previousTask);
          renderTaskList();
          showToast(err.message, true);
        });
    });

    els.taskList.addEventListener('click', (event) => {
      const deleteButton = event.target.closest('[data-delete-task]');
      if (!deleteButton || !state.selectedDocumentId) return;

      if (state.demoMode) {
        removeTaskFromStore(deleteButton.dataset.deleteTask);
        renderTaskList();
        return showToast('Demo task deleted locally');
      }

      request(`${getDocumentContextPath()}/tasks/${deleteButton.dataset.deleteTask}`, { method: 'DELETE' })
        .then(() => {
          removeTaskFromStore(deleteButton.dataset.deleteTask);
          renderTaskList();
        })
        .catch((err) => showToast(err.message, true));
    });
  };

  return {
    bindTaskPanelHandlers,
    renderTaskList
  };
};
