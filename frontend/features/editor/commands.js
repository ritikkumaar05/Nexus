export const createEditorCommands = ({
  els,
  state,
  selectedDocument,
  selectedOrPlaceholder,
  restoreEditorSelection,
  getSelectedEditorText,
  sanitizeEditorHtml,
  commitRichEditorChange,
  escapeHtml,
  updateEditorStudyStats,
  scheduleAutosave,
  updateAiSelectionHint,
  activateContextTab,
  renderMessageFormContext,
  showAskDoubtModal,
  showToast,
  runStudyAiAction,
  toggleFocusMode,
  saveEditorSelection,
  markdownFileName
}) => {
  const execRichCommand = (command, value = null) => {
    restoreEditorSelection();
    els.documentEditor.focus();
    if (['foreColor', 'hiliteColor', 'backColor'].includes(command)) {
      document.execCommand('styleWithCSS', false, true);
    }
    const applied = document.execCommand(command, false, value);
    if (command === 'hiliteColor' && !applied) {
      document.execCommand('backColor', false, value);
    }
    commitRichEditorChange();
  };

  const insertRichHtml = (html = '') => {
    restoreEditorSelection();
    els.documentEditor.focus();
    document.execCommand('insertHTML', false, sanitizeEditorHtml(html));
    commitRichEditorChange();
  };

  const setAiSourceToSelection = () => {
    const selectionRadio = document.querySelector('input[name="aiSource"][value="selection"]');
    if (selectionRadio) selectionRadio.checked = true;
    updateAiSelectionHint();
  };

  const createTaskFromSelection = () => {
    const selected = selectedOrPlaceholder('selected lecture section');
    if (!els.taskInput || !els.taskForm) return;
    els.taskInput.value = `Revise: ${selected.replace(/\s+/g, ' ').slice(0, 90)}`;
    activateContextTab('tasks');
    els.taskForm.requestSubmit?.();
    showToast('Study task created from selected text');
  };

  const startDiscussionFromSelection = () => {
    const selected = selectedOrPlaceholder('selected lecture section');
    state.pendingDoubtLinkedText = selected;
    activateContextTab('threads');
    renderMessageFormContext();
    if (els.messageInput) {
      els.messageInput.value = `Discussion: ${selected.replace(/\s+/g, ' ').slice(0, 120)}`;
      els.messageInput.focus();
    }
    showToast('Discussion context attached to the selected text');
  };

  const createDoubtFromSelection = () => {
    state.pendingDoubtLinkedText = selectedOrPlaceholder('selected lecture section');
    showAskDoubtModal();
  };

  const markSelectionImportant = () => {
    const selected = selectedOrPlaceholder('important concept');
    restoreEditorSelection();
    if (getSelectedEditorText()) execRichCommand('hiliteColor', '#fef3c7');
    else insertRichHtml(`<mark style="background-color:#fef3c7">${escapeHtml(selected)}</mark>`);
    showToast('Marked as important');
  };

  const runSelectionStudyAction = (action) => {
    if (!getSelectedEditorText()) return showToast('Select lecture text first', true);
    setAiSourceToSelection();
    return runStudyAiAction(action);
  };

  const handleSelectionToolbarAction = (action) => {
    const map = {
      explain: 'simple-explanation',
      summarize: 'summarize',
      flashcards: 'flashcards',
      quiz: 'quiz'
    };
    if (map[action]) return runSelectionStudyAction(map[action]);
    if (action === 'task') return createTaskFromSelection();
    if (action === 'discussion') return startDiscussionFromSelection();
    if (action === 'important') return markSelectionImportant();
    if (action === 'doubt') return createDoubtFromSelection();
  };

  const handleEditorCommand = (command) => {
    if (!selectedDocument() || !els.documentEditor) return showToast('Open a lecture first', true);
    const selected = selectedOrPlaceholder('study concept');
    if (command === 'heading-1') return execRichCommand('formatBlock', 'H1');
    if (command === 'heading-2') return execRichCommand('formatBlock', 'H2');
    if (command === 'heading-3') return execRichCommand('formatBlock', 'H3');
    if (command === 'paragraph') return execRichCommand('formatBlock', 'P');
    if (command === 'bold') return execRichCommand('bold');
    if (command === 'italic') return execRichCommand('italic');
    if (command === 'underline') return execRichCommand('underline');
    if (command === 'strike') return execRichCommand('strikeThrough');
    if (command === 'text-color') return execRichCommand('foreColor', els.editorTextColorInput?.value || '#4f46e5');
    if (command === 'highlight') return execRichCommand('hiliteColor', els.editorHighlightInput?.value || '#fef08a');
    if (command === 'bullet-list') return execRichCommand('insertUnorderedList');
    if (command === 'numbered-list') return execRichCommand('insertOrderedList');
    if (command === 'checklist') return insertRichHtml(`<ul class="checklist"><li><input type="checkbox" disabled> ${escapeHtml(selected)}</li></ul>`);
    if (command === 'quote') return execRichCommand('formatBlock', 'BLOCKQUOTE');
    if (command === 'code-block') return insertRichHtml(`<pre><code>${escapeHtml(selected)}</code></pre>`);
    if (command === 'divider') return insertRichHtml('<hr><p><br></p>');
    if (command === 'table') return insertRichHtml('<table><tbody><tr><th>Concept</th><th>Meaning</th><th>Revision</th></tr><tr><td>Topic</td><td>Notes</td><td>To revise</td></tr></tbody></table><p><br></p>');
    if (command === 'image') return els.editorImageInput?.click();
    if (command === 'attachment') return els.editorAttachmentInput?.click();
    if (command === 'link') {
      const url = window.prompt('Paste the link URL');
      if (!url) return;
      if (getSelectedEditorText()) return execRichCommand('createLink', url);
      return insertRichHtml(`<a href="${escapeHtml(url)}">${escapeHtml(selected)}</a>`);
    }
    if (command === 'equation') return insertRichHtml('<div class="equation-block">E = mc<sup>2</sup></div><p><br></p>');
    if (command === 'callout') return insertRichHtml(`<div class="lecture-callout"><strong>Important</strong><p>${escapeHtml(selected)}</p></div><p><br></p>`);
    if (command === 'undo') {
      els.documentEditor.focus();
      document.execCommand?.('undo');
      updateEditorStudyStats();
      scheduleAutosave();
      return;
    }
    if (command === 'redo') {
      els.documentEditor.focus();
      document.execCommand?.('redo');
      updateEditorStudyStats();
      scheduleAutosave();
      return;
    }
  };

  const bindEditorCommandHandlers = () => {
    document.querySelector('.editor-toolbar')?.addEventListener('click', (event) => {
      event.preventDefault();
      els.documentEditor.focus();
    });

    document.querySelector('.premium-editor-toolbar')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-editor-command], #focusModeToolbarBtn');
      if (!button) return;
      event.preventDefault();
      if (button.id === 'focusModeToolbarBtn') return toggleFocusMode();
      handleEditorCommand(button.dataset.editorCommand);
    });

    document.querySelector('.premium-editor-toolbar')?.addEventListener('mousedown', (event) => {
      saveEditorSelection();
      if (event.target.closest('button')) event.preventDefault();
    });

    els.editorHeadingSelect?.addEventListener('change', (event) => {
      const command = event.target.value;
      if (command) handleEditorCommand(command);
      event.target.value = 'paragraph';
    });

    els.editorTextColorInput?.addEventListener('input', () => {
      restoreEditorSelection();
      handleEditorCommand('text-color');
    });
    els.editorTextColorInput?.addEventListener('change', () => {
      restoreEditorSelection();
      handleEditorCommand('text-color');
    });
    els.editorHighlightInput?.addEventListener('input', () => handleEditorCommand('highlight'));
    els.editorHighlightInput?.addEventListener('change', () => handleEditorCommand('highlight'));

    els.editorFloatingToolbar?.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });

    els.editorFloatingToolbar?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-selection-action]');
      if (!button) return;
      event.preventDefault();
      handleSelectionToolbarAction(button.dataset.selectionAction);
    });

    els.editorImageInput?.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const name = markdownFileName(file);
      insertRichHtml(`<figure class="lecture-image-placeholder"><div>Image</div><figcaption>${escapeHtml(name)}</figcaption></figure><p><br></p>`);
      event.target.value = '';
      showToast('Image reference added to lecture');
    });

    els.editorAttachmentInput?.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const name = markdownFileName(file);
      insertRichHtml(`<a class="lecture-attachment" href="attachment:${escapeHtml(name)}">${escapeHtml(name)}</a><p><br></p>`);
      event.target.value = '';
      showToast('Attachment reference added to lecture');
    });
  };

  return {
    bindEditorCommandHandlers,
    handleEditorCommand,
    handleSelectionToolbarAction,
    insertRichHtml
  };
};
