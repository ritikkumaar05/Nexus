import { state } from '../state/store.js';

export const modalState = {
  overlayScrollLocked: false,
  overlayScrollY: 0
};

export const showToast = (message, isError = false) => {
  if (!globalThis.els?.toast) return;
  globalThis.els.toast.textContent = message;
  globalThis.els.toast.classList.toggle('error', isError);
  globalThis.els.toast.classList.remove('hidden');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => globalThis.els.toast.classList.add('hidden'), 3600);
};

export const syncOverlayScrollLock = () => {
  const overlayOpen = !globalThis.els.commandPalette.classList.contains('hidden') || globalThis.els.toolPanel.classList.contains('open');

  if (overlayOpen && !modalState.overlayScrollLocked) {
    modalState.overlayScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.top = `-${modalState.overlayScrollY}px`;
    document.body.classList.add('overlay-scroll-locked');
    modalState.overlayScrollLocked = true;
    return;
  }

  if (!overlayOpen && modalState.overlayScrollLocked) {
    document.body.classList.remove('overlay-scroll-locked');
    document.body.style.top = '';
    window.scrollTo(0, modalState.overlayScrollY);
    modalState.overlayScrollLocked = false;
  }
};

export const showMemberDetailsModal = (member) => {
  const existing = document.getElementById('membersDetailsModal');
  if (existing) existing.remove();
  const workspace = globalThis.selectedWorkspace();
  const displayName = globalThis.getMemberDisplayName(member);
  const email = member.user?.email || member.email || 'No email';
  const role = globalThis.displayWorkspaceRole(workspace, member);
  const isOnline = globalThis.isMemberOnline(member);
  const activity = globalThis.getMemberActivityText(member);
  const modal = document.createElement('div');
  modal.id = 'membersDetailsModal';
  modal.className = 'members-modal-backdrop';
  modal.innerHTML = `
    <div class="members-modal-card" role="dialog" aria-modal="true" aria-label="Member profile">
      <div class="members-modal-header">
        <div class="members-profile-title">
          <span class="avatar-dot large">${globalThis.escapeHtml(globalThis.getInitials(displayName))}</span>
          <div>
            <h3>${globalThis.escapeHtml(displayName)}</h3>
            <p>${globalThis.escapeHtml(email)}</p>
          </div>
        </div>
        <button class="members-modal-close" type="button" data-close-members-modal aria-label="Close member profile">×</button>
      </div>
      <div class="members-profile-grid">
        <div><span>Role</span><strong>${globalThis.escapeHtml(role)}</strong></div>
        <div><span>Status</span><strong>${isOnline ? 'Online' : 'Offline'}</strong></div>
        <div><span>Current activity</span><strong>${globalThis.escapeHtml(activity)}</strong></div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
};

export const showRemoveMemberModal = (memberId) => {
  const existing = document.getElementById('membersRemoveModal');
  if (existing) existing.remove();
  const workspace = globalThis.selectedWorkspace();
  const member = workspace?.members?.find((item) => globalThis.memberUserId(item) === memberId);
  if (!member) return;
  const displayName = globalThis.getMemberDisplayName(member);
  globalThis.membersRemoveCandidateId = memberId;
  const modal = document.createElement('div');
  modal.id = 'membersRemoveModal';
  modal.className = 'members-modal-backdrop';
  modal.innerHTML = `
    <div class="members-modal-card members-remove-card" role="dialog" aria-modal="true" aria-label="Remove workspace member">
      <div class="members-modal-header">
        <div>
          <p class="auth-kicker">Remove Member</p>
          <h3>Remove "${globalThis.escapeHtml(displayName)}"?</h3>
        </div>
        <button class="members-modal-close" type="button" data-close-members-modal aria-label="Close remove member confirmation">×</button>
      </div>
      <p class="members-remove-copy">They will lose access to documents, chat, tasks, and workspace activity.</p>
      <div class="members-modal-actions">
        <button type="button" class="ghost" data-close-members-modal>Cancel</button>
        <button type="button" class="danger-button" id="confirmRemoveMemberBtn" data-confirm-remove-member="${globalThis.escapeHtml(memberId)}">Remove Member</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
};

export const showAskDoubtModal = () => {
  const docs = state.documents || [];
  if (!docs.length) {
    return showToast('Create a document first before asking a doubt.', true);
  }
  
  const currentDocId = state.selectedDocumentId || docs[0]?._id;
  const initialContext = globalThis.getSelectedEditorText() || state.pendingDoubtLinkedText || '';

  const modalHtml = `
    <form id="askDoubtModalForm" style="display: flex; flex-direction: column; gap: 16px;">
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 12px; font-weight: 600; color: var(--text-secondary);">Doubt Question *</label>
        <input type="text" id="askDoubtModalQuestion" placeholder="e.g. How does Paxos consensus work?" required style="background: var(--input-bg, var(--panel-soft)); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; color: var(--text); font-size: 14px; width: 100%; box-sizing: border-box;" />
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 12px; font-weight: 600; color: var(--text-secondary);">Description / Details (Optional)</label>
        <textarea id="askDoubtModalDesc" rows="4" placeholder="Provide extra context, details, or code snippets..." style="background: var(--input-bg, var(--panel-soft)); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; color: var(--text); font-size: 14px; width: 100%; box-sizing: border-box; resize: vertical; font-family: inherit;"></textarea>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 12px; font-weight: 600; color: var(--text-secondary);">Link to Document</label>
        <select id="askDoubtModalDoc" style="background: var(--input-bg, var(--panel-soft)); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; color: var(--text); font-size: 14px; width: 100%; box-sizing: border-box; cursor: pointer;">
          ${docs.map(doc => `
            <option value="${doc._id}" ${doc._id === currentDocId ? 'selected' : ''}>${globalThis.escapeHtml(doc.title || 'Untitled Document')}</option>
          `).join('')}
        </select>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 12px; font-weight: 600; color: var(--text-secondary);">Linked Text Context (Optional)</label>
        <textarea id="askDoubtModalContext" rows="2" placeholder="Reference text from notes..." style="background: var(--input-bg, var(--panel-soft)); border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; color: var(--text); font-size: 13px; width: 100%; box-sizing: border-box; resize: vertical; font-family: inherit;">${globalThis.escapeHtml(initialContext)}</textarea>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;">
        <button type="button" class="btn-cancel-modal" id="cancelAskDoubtModalBtn" style="background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 8px 16px; color: var(--text); font-size: 14px; font-weight: 500; cursor: pointer; transition: var(--transition);">Cancel</button>
        <button type="submit" style="background: var(--primary); border: none; border-radius: 6px; padding: 8px 16px; color: white; font-size: 14px; font-weight: 500; cursor: pointer; transition: var(--transition);">Create Doubt</button>
      </div>
    </form>
  `;

  globalThis.showChatModal('Ask a Doubt', modalHtml);

  const form = document.getElementById('askDoubtModalForm');
  const cancelBtn = document.getElementById('cancelAskDoubtModalBtn');
  
  cancelBtn?.addEventListener('click', () => {
    const modal = document.getElementById('chatOverlayModal');
    if (modal) modal.remove();
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    
    const question = document.getElementById('askDoubtModalQuestion').value.trim();
    const desc = document.getElementById('askDoubtModalDesc').value.trim();
    const docId = document.getElementById('askDoubtModalDoc').value;
    const linkedContextText = document.getElementById('askDoubtModalContext').value.trim();

    if (!question) return;
    const fullBody = desc ? `${question}\n\n${desc}` : question;

    const modal = document.getElementById('chatOverlayModal');
    if (modal) modal.remove();

    if (state.demoMode) {
      const selectedDoc = docs.find(d => d._id === docId);
      const thread = {
        _id: `demo-doc-msg-${Date.now()}`,
        sender: { _id: state.user.id, username: state.user.username, email: state.user.email },
        body: fullBody,
        linkedText: linkedContextText,
        status: 'open',
        replies: [],
        createdAt: new Date().toISOString()
      };
      state.documentMessages.unshift(thread);
      state.workspaceThreads.unshift({
        ...thread,
        documentTitle: selectedDoc?.title || 'Document',
        documentId: docId
      });
      state.selectedThreadId = thread._id;
      globalThis.addActivity({ action: 'asked a doubt on', target: selectedDoc?.title || 'Document' });
      showToast('Demo doubt created locally');
      globalThis.renderThreadsPage();
      return;
    }

    try {
      const message = await globalThis.request(`/api/workspaces/${state.selectedWorkspaceId}/documents/${docId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: fullBody, parentMessageId: null, linkedText: linkedContextText })
      });
      
      const selectedDoc = docs.find(d => d._id === docId);
      state.documentMessages.unshift(message);
      state.workspaceThreads.unshift({
        ...message,
        documentTitle: selectedDoc?.title || 'Document',
        documentId: docId
      });
      state.selectedThreadId = message._id;
      globalThis.addActivity({ action: 'asked a doubt on', target: selectedDoc?.title || 'Document' });
      showToast('Doubt created successfully!');
      globalThis.renderThreadsPage();
    } catch (err) {
      showToast(err.message, true);
    }
  });
};
