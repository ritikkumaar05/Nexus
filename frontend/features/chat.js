import { collab, selectedWorkspace, state } from '../state/store.js';
import { currentRoute, navigate } from '../services/router.js';
import { escapeHtml, formatChatTime, getInitials } from '../utils/text.js';
import { chatFeatureRuntime } from './chat/featureRuntime.js';
import { membersRuntime } from './members/runtime.js';
import { searchState } from './chat/runtime.js';

export const renderChatPage = async ({ skipEnsure = false } = {}) => {
  const { shell, session, chat } = chatFeatureRuntime();
  const { setMainMode, setRouteChrome, els, loadingRows, emptyState, showToast } = shell;
  const { ensureChatReady } = session;
  const { activeChatChannel, chatOnlineCount, clearChatUnread } = chat;

  setMainMode('feature');
  setRouteChrome('chat');
  clearChatUnread();

  if (!skipEnsure) {
    if (!state.demoMode && !state.chatMessages.length) {
      state.loading.chat = true;
    }
    ensureChatReady()
      .then(() => {
        if (currentRoute() === 'chat') {
          renderChatPage({ skipEnsure: true });
        }
      })
      .catch((err) => {
        state.loading.chat = false;
        showToast(err.message, true);
        if (currentRoute() === 'chat') {
          renderChatPage({ skipEnsure: true });
        }
      });
  }

  const workspace = selectedWorkspace();

  if (state.loading.workspaces) {
    els.routePage.innerHTML = `
      <section class="workspace-chat-shell">
        <div class="workspace-chat-header" style="height: 60px;"></div>
        <div class="workspace-chat-messages" style="padding: 24px;">
          ${loadingRows(5)}
        </div>
      </section>
    `;
    return;
  }

  if (!workspace) {
    els.routePage.innerHTML = `
      <section class="workspace-chat-shell" style="justify-content: center; align-items: center; background: var(--bg);">
        <div class="chat-empty-container">
          ${emptyState({
            title: 'No workspace selected',
            body: 'Select or create a workspace to start chatting.',
            action: 'Choose Workspace',
            actionId: 'emptyOpenWorkspaceSwitcherBtn',
            icon: '▣'
          })}
        </div>
      </section>
    `;
    return;
  }

  // Check scroll state of existing message list before we destroy the DOM elements
  const oldMessageArea = document.getElementById('workspaceChatMessages');
  let wasNearBottom = true;
  if (oldMessageArea) {
    const threshold = 100;
    wasNearBottom = oldMessageArea.scrollHeight - oldMessageArea.clientHeight - oldMessageArea.scrollTop < threshold;
  }

  const channel = activeChatChannel();
  const onlineCount = chatOnlineCount();
  const typingNames = state.chatTypingUsers
    .filter((user) => user.userId !== state.user?.id)
    .map((user) => user.username || user.email?.split('@')[0] || 'Someone');

  const isMuted = localStorage.getItem(`chat_mute_${channel.slug}`) === 'true';

  els.routePage.innerHTML = `
    <section class="workspace-chat-shell">
      <header class="workspace-chat-header">
        <div class="chat-header-left">
          <span class="chat-channel-hash">#</span>
          <div class="chat-header-titles">
            <h2 class="chat-channel-name">${escapeHtml(channel.name || 'General')}</h2>
            <div class="chat-header-meta">
              <span class="chat-workspace-name">${escapeHtml(workspace?.name || 'Workspace')}</span>
              <span class="chat-meta-divider">·</span>
              <span class="chat-online-badge"></span>
              <span class="chat-online-count">${onlineCount} ${onlineCount === 1 ? 'member' : 'members'} online</span>
            </div>
          </div>
        </div>
        <div class="chat-header-right">
          <button class="chat-header-action" data-chat-action="search" type="button" title="Search messages">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </button>
          <button class="chat-header-action" data-chat-action="members" type="button" title="Channel members">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </button>
          <button class="chat-header-action sparkles-btn" data-chat-action="ai-summarize" type="button" title="AI summarize chat">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z"/></svg>
            <span>Summarize</span>
          </button>
          <button class="chat-header-action" data-chat-action="more" type="button" title="More options">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
          </button>
          <button class="ghost mobile-sidebar-open" type="button" data-mobile-menu-open title="Open Menu">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
        </div>

        <!-- Search Overlay Container (hidden by default) -->
        <div id="chatHeaderSearchContainer" class="chat-header-search-container hidden">
          <input type="text" id="chatSearchInput" placeholder="Search messages..." />
          <span id="chatSearchMatches" class="chat-search-matches">0 / 0</span>
          <button class="chat-search-nav-btn" id="chatSearchPrevBtn" type="button" title="Previous match">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
          </button>
          <button class="chat-search-nav-btn" id="chatSearchNextBtn" type="button" title="Next match">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <button class="chat-search-close-btn" id="chatSearchCloseBtn" type="button" title="Close search">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <!-- Members Popover (hidden by default) -->
        <div id="chatMembersPopover" class="chat-dropdown-menu chat-members-popover hidden">
          <div class="popover-header">
            <h4>Workspace Members</h4>
          </div>
          <div class="popover-body" id="chatMembersPopoverBody"></div>
        </div>

        <!-- Dropdown Options Menu (hidden by default) -->
        <div id="chatDropdownMenu" class="chat-dropdown-menu hidden">
          <button class="chat-dropdown-item" data-dropdown-action="info" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            Channel Info
          </button>
          <button class="chat-dropdown-item" data-dropdown-action="members" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            View Members
          </button>
          <button class="chat-dropdown-item" data-dropdown-action="copy" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy Channel Name
          </button>
          <button class="chat-dropdown-item" data-dropdown-action="mark-read" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><polyline points="20 6 9 17 4 12"/></svg>
            Mark all as Read
          </button>
          <button class="chat-dropdown-item" data-dropdown-action="mute" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M23 9l-6 6M17 9l6 6"/></svg>
            <span id="chatMuteDropdownLabel">${isMuted ? 'Unmute Notifications' : 'Mute Notifications'}</span>
          </button>
        </div>
      </header>

      <div id="workspaceChatMessages" class="workspace-chat-messages" aria-live="polite">
        ${state.loading.chat ? loadingRows(5) : renderChatMessages()}
      </div>

      <div id="chatNewMessagesBanner" class="chat-new-messages-banner hidden">
        <button type="button" id="chatNewMessagesBannerBtn">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 4px;"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
          <span>New messages</span>
        </button>
      </div>

      <div class="workspace-chat-typing" id="workspaceChatTyping">
        ${typingNames.length ? `<span class="typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span><span>${escapeHtml(typingNames.slice(0, 2).join(', '))} ${typingNames.length === 1 ? 'is' : 'are'} typing…</span>` : ''}
      </div>

      <form id="workspaceChatForm" class="workspace-chat-composer">
        <div class="composer-input-wrapper">
          <div id="chatAttachmentPreview" class="chat-attachment-preview hidden"></div>
          <textarea id="workspaceChatInput" rows="1" placeholder="Message #${escapeHtml(channel.name || 'general')}"></textarea>
          <input type="file" id="chatFileInput" class="hidden" style="display: none;" />
          <div class="composer-toolbar">
            <div class="composer-toolbar-left">
              <button class="composer-tool-btn" id="chatUploadFileBtn" type="button" title="Attach File">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              </button>
              <span class="composer-tool-divider"></span>
              <button class="composer-tool-btn" data-composer-format="bold" type="button" title="Bold">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>
              </button>
              <button class="composer-tool-btn" data-composer-format="italic" type="button" title="Italic">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
              </button>
              <button class="composer-tool-btn" data-composer-format="strike" type="button" title="Strikethrough">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/></svg>
              </button>
              <span class="composer-tool-divider"></span>
              <button class="composer-tool-btn" data-composer-format="code" type="button" title="Code Block">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              </button>
              <button class="composer-tool-btn" data-composer-format="list" type="button" title="Bullet List">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              </button>
            </div>
            <div class="composer-toolbar-right">
              <button class="send-btn" id="workspaceChatSendBtn" type="submit" disabled>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          </div>
        </div>
      </form>
    </section>
  `;

  const messageArea = document.getElementById('workspaceChatMessages');
  const banner = document.getElementById('chatNewMessagesBanner');
  const bannerBtn = document.getElementById('chatNewMessagesBannerBtn');

  if (messageArea) {
    if (wasNearBottom || window.chatForceScrollBottom) {
      messageArea.scrollTop = messageArea.scrollHeight;
      window.chatForceScrollBottom = false;
      if (banner) banner.classList.add('hidden');
    } else {
      if (banner) banner.classList.remove('hidden');
    }

    messageArea.addEventListener('scroll', () => {
      const isNearBottom = messageArea.scrollHeight - messageArea.clientHeight - messageArea.scrollTop < 20;
      if (isNearBottom && banner) {
        banner.classList.add('hidden');
      }
    });
  }

  if (bannerBtn) {
    bannerBtn.addEventListener('click', () => {
      if (messageArea) {
        messageArea.scrollTo({ top: messageArea.scrollHeight, behavior: 'smooth' });
      }
      if (banner) banner.classList.add('hidden');
    });
  }

  const input = document.getElementById('workspaceChatInput');
  const sendBtn = document.getElementById('workspaceChatSendBtn');
  if (input && sendBtn) {
    const handleInput = () => {
      const hasText = input.value.trim().length > 0 || !!state.attachedFile;
      sendBtn.disabled = !hasText;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 180) + 'px';
    };
    input.addEventListener('input', handleInput);
    handleInput();
  }

  // --- Attach File Listener ---
  const uploadBtn = document.getElementById('chatUploadFileBtn');
  const fileInput = document.getElementById('chatFileInput');
  if (uploadBtn && fileInput) {
    uploadBtn.onclick = () => fileInput.click();
    
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      if (file.size > 2 * 1024 * 1024) {
        showToast('Files must be under 2MB', true);
        fileInput.value = '';
        return;
      }
      
      const reader = new FileReader();
      reader.onload = () => {
        const base64Data = reader.result.split(',')[1];
        state.attachedFile = {
          name: file.name,
          type: file.type,
          size: file.size,
          base64: base64Data,
          dataUrl: reader.result
        };
        
        const formatBytes = (bytes) => {
          if (bytes === 0) return '0 Bytes';
          const k = 1024;
          const sizes = ['Bytes', 'KB', 'MB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        };

        const previewContainer = document.getElementById('chatAttachmentPreview');
        if (previewContainer) {
          previewContainer.innerHTML = `
            <div class="attachment-preview-card">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;color:var(--muted)"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              <div class="attachment-preview-info">
                <span class="attachment-preview-name">${escapeHtml(file.name)}</span>
                <span class="attachment-preview-size">${formatBytes(file.size)}</span>
              </div>
              <button id="cancelChatAttachmentBtn" class="attachment-cancel-btn" type="button" title="Remove attachment">&times;</button>
            </div>
          `;
          previewContainer.classList.remove('hidden');
        }
        if (sendBtn) sendBtn.disabled = false;
      };
      reader.readAsDataURL(file);
    };
  }

  // Cancel Attachment Action
  const previewContainer = document.getElementById('chatAttachmentPreview');
  if (previewContainer) {
    previewContainer.onclick = (e) => {
      const cancelBtn = e.target.closest('#cancelChatAttachmentBtn');
      if (cancelBtn) {
        state.attachedFile = null;
        if (fileInput) fileInput.value = '';
        previewContainer.innerHTML = '';
        previewContainer.classList.add('hidden');
        if (input && sendBtn) {
          sendBtn.disabled = input.value.trim().length === 0;
        }
      }
    };
  }
};




export const renderAttachmentInBubble = (content) => {
  if (!content) return '';
  // Find markdown links pointing to attachments
  const regex = /\[📎 (.*?)\((.*?),\s*(.*?)\)\]\((.*?)\)/g;
  return content.replace(regex, (match, filename, mimeType, size, url) => {
    const isImage = mimeType.trim().toLowerCase().startsWith('image/');
    
    if (isImage) {
      return `
        <div class="chat-attachment-block image-attachment" style="margin-top: 8px; border-radius: var(--radius); overflow: hidden; border: 1px solid var(--line); max-width: 320px;">
          <a href="${url}" target="_blank" rel="noopener noreferrer" style="display: block;">
            <img src="${url}" alt="${escapeHtml(filename)}" style="width: 100%; height: auto; max-height: 240px; object-fit: cover; display: block;" />
          </a>
          <div class="attachment-meta" style="padding: 8px 12px; background: var(--panel-soft); display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--line); font-size: 11px; color: var(--muted);">
            <span style="font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 180px;">${escapeHtml(filename)}</span>
            <span>${escapeHtml(size)}</span>
          </div>
        </div>
      `;
    }
    
    return `
      <div class="chat-attachment-block file-attachment" style="margin-top: 8px; border-radius: var(--radius); border: 1px solid var(--line); padding: 10px 14px; background: var(--panel-soft); display: flex; align-items: center; gap: 12px; max-width: 380px;">
        <span style="font-size: 20px;">📎</span>
        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;">
          <span style="font-size: 13px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(filename)}</span>
          <span style="font-size: 11px; color: var(--muted);">${escapeHtml(size)}</span>
        </div>
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="soft-button" style="padding: 6px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; height: 32px; width: 32px; flex-shrink: 0;" title="Download File">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </a>
      </div>
    `;
  });
};

export const renderReactions = (reactions) => {
  if (!reactions || !reactions.length) return '';
  const currentUserId = String(state.user?.id || state.user?._id || 'me');
  return `
    <div class="chat-message-reactions">
      ${reactions.map(r => {
        const hasReacted = r.users && r.users.some(uid => String(uid) === currentUserId);
        return `
          <button class="chat-reaction-chip ${hasReacted ? 'active' : ''}" data-emoji="${escapeHtml(r.emoji)}" type="button">
            <span>${escapeHtml(r.emoji)}</span>
            <span>${r.users ? r.users.length : 0}</span>
          </button>
        `;
      }).join('')}
      <button class="chat-reaction-chip add-reaction-chip-btn" data-msg-action="react" type="button" title="Add reaction">
        <span>+</span>
      </button>
    </div>
  `;
};


export const renderChatMessages = () => {
  const { chat, markdown } = chatFeatureRuntime();
  const { activeChatChannel, chatSenderName, isMine } = chat;
  const { parseMarkdownToHtml } = markdown;

  const messages = state.chatMessages.filter((message) => message.channelId === activeChatChannel().slug);
  if (!messages.length) {
    return `
      <div class="chat-empty-container">
        <div class="chat-empty-icon">#</div>
        <h3 class="chat-empty-title">Start the conversation</h3>
        <p class="chat-empty-desc">Share notes, doubts, links, or quick updates with your workspace.</p>
        <div class="chat-empty-chips">
          <button class="chat-chip" data-empty-action="start-discussion" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span>Send first message</span>
          </button>
          <button class="chat-chip" data-empty-action="ai-summarize" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z"/></svg>
            <span>Summarize later with AI</span>
          </button>
        </div>
      </div>
    `;
  }

  let lastDayStr = '';
  let prevMsg = null;
  const htmlParts = [];

  messages.forEach((message) => {
    if (message.isSystem) {
      htmlParts.push(`
        <div class="chat-system-message" data-message-id="${escapeHtml(message._id || '')}">
          <span>${escapeHtml(message.content || '')}</span>
        </div>
      `);
      prevMsg = null;
      return;
    }

    // Day divider
    const msgDate = new Date(message.createdAt || Date.now());
    const dayStr = msgDate.toDateString();
    if (dayStr !== lastDayStr) {
      lastDayStr = dayStr;
      const todayStr = new Date().toDateString();
      const yesterdayStr = new Date(Date.now() - 86400000).toDateString();
      let displayDay = msgDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
      if (dayStr === todayStr) displayDay = 'Today';
      else if (dayStr === yesterdayStr) displayDay = 'Yesterday';

      htmlParts.push(`
        <div class="chat-day-divider">
          <span>${escapeHtml(displayDay)}</span>
        </div>
      `);
      prevMsg = null; // reset grouping on day change
    }

    const mine = isMine(message);
    const name = mine ? 'You' : chatSenderName(message);
    const initials = getInitials(name);
    
    // Grouping checks: consecutive if same sender, and within 2 minutes (120000ms)
    const isSameSender = prevMsg && !prevMsg.isSystem && String(prevMsg.sender?._id || prevMsg.sender) === String(message.sender?._id || message.sender);
    const prevTime = prevMsg ? new Date(prevMsg.createdAt || Date.now()).getTime() : 0;
    const currTime = new Date(message.createdAt || Date.now()).getTime();
    const isWithinTime = prevMsg && (currTime - prevTime < 120000);

    if (isSameSender && isWithinTime) {
      // Consecutive message in same group
      htmlParts.push(`
        <article class="workspace-chat-message consecutive ${mine ? 'mine' : ''}" data-message-id="${escapeHtml(message._id || '')}">
          <div class="chat-avatar-placeholder"></div>
          <div class="chat-message-content">
            <div class="chat-bubble">
              <p>${renderAttachmentInBubble(parseMarkdownToHtml(message.content || ''))}</p>
              ${renderReactions(message.reactions || [])}
            </div>
          </div>
          <div class="chat-message-actions">
            <button class="chat-action-btn" data-msg-action="copy" type="button" title="Copy text">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="chat-action-btn chat-action-react-trigger" data-msg-action="react" type="button" title="Add reaction">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
            </button>
            <button class="chat-action-btn" data-msg-action="reply" type="button" title="Reply">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
            </button>
          </div>
        </article>
      `);
    } else {
      // Normal message starting a group
      htmlParts.push(`
        <article class="workspace-chat-message ${mine ? 'mine' : ''}" data-message-id="${escapeHtml(message._id || '')}">
          <span class="chat-avatar">${escapeHtml(initials)}</span>
          <div class="chat-message-content">
            <div class="chat-message-meta">
              <strong class="chat-sender-name">${escapeHtml(name)}</strong>
              <time class="chat-timestamp">${escapeHtml(formatChatTime(message.createdAt))}</time>
            </div>
            <div class="chat-bubble">
              <p>${renderAttachmentInBubble(parseMarkdownToHtml(message.content || ''))}</p>
              ${renderReactions(message.reactions || [])}
            </div>
          </div>
          <div class="chat-message-actions">
            <button class="chat-action-btn" data-msg-action="copy" type="button" title="Copy text">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="chat-action-btn chat-action-react-trigger" data-msg-action="react" type="button" title="Add reaction">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
            </button>
            <button class="chat-action-btn" data-msg-action="reply" type="button" title="Reply">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
            </button>
          </div>
        </article>
      `);
    }

    prevMsg = message;
  });

  return htmlParts.join('');
};


export const applyComposerFormat = (formatType) => {
  const input = document.getElementById('workspaceChatInput');
  if (!input) return;

  const start = input.selectionStart;
  const end = input.selectionEnd;
  const value = input.value;
  const selectedText = value.substring(start, end);

  let replacement = '';
  let newStart = start;
  let newEnd = end;

  switch (formatType) {
    case 'bold':
      replacement = `**${selectedText || 'bold text'}**`;
      newStart = start + 2;
      newEnd = start + 2 + (selectedText ? selectedText.length : 9);
      break;
    case 'italic':
      replacement = `*${selectedText || 'italic text'}*`;
      newStart = start + 1;
      newEnd = start + 1 + (selectedText ? selectedText.length : 11);
      break;
    case 'strike':
      replacement = `~~${selectedText || 'strikethrough text'}~~`;
      newStart = start + 2;
      newEnd = start + 2 + (selectedText ? selectedText.length : 18);
      break;
    case 'code':
      if (selectedText.includes('\n')) {
        replacement = `\`\`\`\n${selectedText}\n\`\`\``;
        newStart = start + 4;
        newEnd = newStart + selectedText.length;
      } else {
        replacement = `\`${selectedText || 'code'}\``;
        newStart = start + 1;
        newEnd = start + 1 + (selectedText ? selectedText.length : 4);
      }
      break;
    case 'list':
      if (selectedText) {
        const lines = selectedText.split('\n');
        replacement = lines.map(line => line.startsWith('- ') ? line : `- ${line}`).join('\n');
        newStart = start;
        newEnd = start + replacement.length;
      } else {
        replacement = '- ';
        newStart = start + 2;
        newEnd = start + 2;
      }
      break;
    default:
      return;
  }

  input.value = value.substring(0, start) + replacement + value.substring(end);
  input.focus();
  input.setSelectionRange(newStart, newEnd);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

export const showChatModal = (title, contentHtml) => {
  let modal = document.getElementById('chatOverlayModal');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'chatOverlayModal';
  modal.className = 'chat-overlay-modal-backdrop';
  modal.innerHTML = `
    <div class="chat-overlay-modal-card">
      <div class="chat-overlay-modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="chat-overlay-modal-close" id="closeChatOverlayModalBtn" type="button" title="Close">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="chat-overlay-modal-body">
        ${contentHtml}
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeBtn = modal.querySelector('#closeChatOverlayModalBtn');
  const closeModal = () => modal.remove();
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
};


export const highlightSearchInDom = (query = '') => {
  const { chat, markdown } = chatFeatureRuntime();
  const { activeChatChannel, highlightActiveMatch, updateSearchMatchesCounter } = chat;
  const { parseMarkdownToHtml } = markdown;

  const messages = state.chatMessages.filter((message) => message.channelId === activeChatChannel().slug && !message.isSystem);
  const messageElements = document.querySelectorAll('.workspace-chat-message:not(.chat-system-message)');
  
  messageElements.forEach((el) => {
    const msgId = el.dataset.messageId;
    const msg = messages.find(m => String(m._id || '') === String(msgId));
    if (msg) {
      const bubbleP = el.querySelector('.chat-bubble p');
      if (bubbleP) {
        bubbleP.innerHTML = parseMarkdownToHtml(msg.content || '');
      }
    }
  });

  searchState.matches = [];
  searchState.currentIndex = -1;
  searchState.query = query.trim().toLowerCase();

  if (!searchState.query) {
    updateSearchMatchesCounter();
    return;
  }

  messageElements.forEach((el) => {
    const bubbleP = el.querySelector('.chat-bubble p');
    if (!bubbleP) return;

    const walkTextNodes = (node, callback) => {
      if (node.nodeType === Node.TEXT_NODE) {
        callback(node);
      } else {
        for (let i = 0; i < node.childNodes.length; i++) {
          walkTextNodes(node.childNodes[i], callback);
        }
      }
    };

    const textNodes = [];
    walkTextNodes(bubbleP, (node) => textNodes.push(node));

    textNodes.forEach((node) => {
      const text = node.nodeValue;
      const lowerText = text.toLowerCase();
      if (lowerText.includes(searchState.query)) {
        const parent = node.parentNode;
        const fragments = [];
        let lastIndex = 0;
        let index = lowerText.indexOf(searchState.query);

        while (index !== -1) {
          if (index > lastIndex) {
            fragments.push(document.createTextNode(text.substring(lastIndex, index)));
          }
          const mark = document.createElement('mark');
          mark.className = 'chat-search-highlight';
          mark.textContent = text.substring(index, index + searchState.query.length);
          fragments.push(mark);
          
          lastIndex = index + searchState.query.length;
          index = lowerText.indexOf(searchState.query, lastIndex);
        }

        if (lastIndex < text.length) {
          fragments.push(document.createTextNode(text.substring(lastIndex)));
        }

        const next = node.nextSibling;
        fragments.forEach(frag => {
          parent.insertBefore(frag, next);
        });
        parent.removeChild(node);
      }
    });
  });

  const highlights = document.querySelectorAll('.chat-search-highlight');
  searchState.matches = Array.from(highlights);
  
  if (searchState.matches.length > 0) {
    searchState.currentIndex = 0;
    highlightActiveMatch();
  } else {
    updateSearchMatchesCounter();
  }
};


export const handleChatDropdownAction = (action) => {
  const { shell, chat } = chatFeatureRuntime();
  const { showToast } = shell;
  const { activeChatChannel, chatOnlineCount, clearChatUnread, chatSenderName, isMine } = chat;

  const channel = activeChatChannel();
  const workspace = selectedWorkspace();

  if (action === 'info') {
    const onlineCount = chatOnlineCount();
    const totalCount = membersRuntime().collaborationPeople().length || state.chatOnlineUsers.length || 1;
    const infoHtml = `
      <div class="channel-info-modal-content">
        <div class="channel-info-row">
          <strong>Workspace</strong>
          <span>${escapeHtml(workspace?.name || 'Current Workspace')}</span>
        </div>
        <div class="channel-info-row">
          <strong>Channel Name</strong>
          <span>#${escapeHtml(channel.name || 'general')}</span>
        </div>
        <div class="channel-info-row">
          <strong>Topic</strong>
          <span>Study resources, collaboration, and class chat</span>
        </div>
        <div class="channel-info-row">
          <strong>Online Members</strong>
          <span>${onlineCount} active</span>
        </div>
        <div class="channel-info-row">
          <strong>Total Members</strong>
          <span>${totalCount} members</span>
        </div>
      </div>
    `;
    showChatModal('Channel Info', infoHtml);
  } else if (action === 'members') {
    const members = membersRuntime().collaborationPeople();
    const membersHtml = `
      <div class="members-view-modal-content">
        ${members.map(member => {
          const initials = getInitials(member.name);
          return `
            <div class="member-list-row">
              <span class="member-avatar">${escapeHtml(initials)}</span>
              <div class="member-details">
                <span class="member-name">${escapeHtml(member.name)}</span>
                <span class="member-status ${member.online ? 'online' : 'offline'}">
                  ${member.online ? '● Online' : '○ Offline'} ${member.status ? `· ${escapeHtml(member.status)}` : ''}
                </span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    showChatModal('Channel Members', membersHtml);
  } else if (action === 'copy') {
    const channelName = `#${channel.name || 'general'}`;
    navigator.clipboard.writeText(channelName).then(() => {
      showToast(`Copied ${channelName} to clipboard!`);
    }).catch(() => {
      showToast('Failed to copy channel name.');
    });
  } else if (action === 'mark-read') {
    clearChatUnread();
    showToast('Marked all messages as read.');
  } else if (action === 'clear-local') {
    state.chatMessages = state.chatMessages.filter(msg => msg.channelId !== channel.slug);
    renderChatPage();
    showToast('Cleared local message history.');
  } else if (action === 'export') {
    const messages = state.chatMessages.filter(msg => msg.channelId === channel.slug);
    if (!messages.length) {
      showToast('No chat history to export.');
      return;
    }
    const textLines = messages.map(msg => {
      const name = msg.isSystem ? 'System' : (isMine(msg) ? 'You' : chatSenderName(msg));
      const time = new Date(msg.createdAt).toLocaleString();
      return `[${time}] ${name}: ${msg.content || ''}`;
    }).join('\r\n');
    
    const blob = new Blob([textLines], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chat-export-${channel.slug}-${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Chat history exported successfully!');
  } else if (action === 'mute') {
    const key = `chat_mute_${channel.slug}`;
    const currentMute = localStorage.getItem(key) === 'true';
    const newMute = !currentMute;
    localStorage.setItem(key, String(newMute));
    showToast(newMute ? `Muted notifications for #${channel.name}` : `Unmuted notifications for #${channel.name}`);
    const label = document.getElementById('chatMuteDropdownLabel');
    if (label) {
      label.textContent = newMute ? 'Unmute Notifications' : 'Mute Notifications';
    }
  }
};


export const handleChatAction = async (action) => {
  const { shell, chat, data, markdown } = chatFeatureRuntime();
  const { showToast } = shell;
  const { activeChatChannel, chatSenderName, isMine } = chat;
  const { request } = data;
  const { parseMarkdownToHtml } = markdown;

  if (action === 'search') {
    const container = document.getElementById('chatHeaderSearchContainer');
    if (container) {
      container.classList.remove('hidden');
      const input = document.getElementById('chatSearchInput');
      if (input) {
        input.focus();
        input.select();
      }
    }
  } else if (action === 'members') {
    const popover = document.getElementById('chatMembersPopover');
    if (popover) {
      popover.classList.toggle('hidden');
      if (!popover.classList.contains('hidden')) {
        const body = document.getElementById('chatMembersPopoverBody');
        if (body) {
          const members = membersRuntime().collaborationPeople();
          body.innerHTML = members.map(member => {
            const initials = getInitials(member.name);
            return `
              <div class="member-list-row">
                <span class="member-avatar">${escapeHtml(initials)}</span>
                <div class="member-details">
                  <span class="member-name">${escapeHtml(member.name)}</span>
                  <span class="member-status ${member.online ? 'online' : 'offline'}">
                    ${member.online ? '● Online' : '○ Offline'}
                  </span>
                </div>
              </div>
            `;
          }).join('');
        }
      }
    }
  } else if (action === 'more') {
    const menu = document.getElementById('chatDropdownMenu');
    if (menu) {
      menu.classList.toggle('hidden');
    }
  } else if (action === 'ai-summarize') {
    const messages = state.chatMessages.filter((message) => message.channelId === activeChatChannel().slug && !message.isSystem);
    if (!messages.length) {
      showToast('No chat messages to summarize yet. Send some messages first!');
      return;
    }
    
    let overlay = document.getElementById('aiChatSummaryOverlay');
    if (overlay) overlay.remove();
    
    overlay = document.createElement('div');
    overlay.id = 'aiChatSummaryOverlay';
    overlay.className = 'ai-summary-overlay';
    overlay.innerHTML = `
      <div class="ai-summary-header">
        <span class="ai-summary-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z"/></svg>
          AI Chat Summarizer
        </span>
        <button class="ai-summary-close" type="button" id="closeAiChatSummaryOverlayBtn" title="Close">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="ai-summary-body" id="aiChatSummaryBody">
        <div class="ai-loading-card">
          <span>✦</span>
          <strong>Summarizing chat history...</strong>
          <small>Nexus is finding topics, decisions, and action items.</small>
        </div>
      </div>
    `;
    
    const shell = document.querySelector('.workspace-chat-shell');
    if (shell) {
      shell.appendChild(overlay);
      document.getElementById('closeAiChatSummaryOverlayBtn')?.addEventListener('click', () => {
        document.getElementById('aiChatSummaryOverlay')?.remove();
      });
    }

    if (state.demoMode) {
      window.setTimeout(() => {
        const topics = messages.map(m => m.content).filter(Boolean);
        const isOsTopic = topics.some(t => /deadlock|scheduling|process|banker|memory|os|study/i.test(t || ''));
        let summaryHtml = '';
        if (isOsTopic) {
          summaryHtml = `
            <p>✦ Here is the Nexus Mentor summary for <strong>#${escapeHtml(activeChatChannel().name || 'general')}</strong>:</p>
            <ul>
              <li><strong>Focus:</strong> Operating Systems revision, especially Deadlocks and Scheduling.</li>
              <li><strong>Discussion:</strong> Teammates are coordinating lecture review and unresolved doubts.</li>
              <li><strong>Next step:</strong> Review Banker algorithm, then answer the Deadlocks quiz.</li>
            </ul>
          `;
        } else {
          const recent = messages.slice(-4).map(m => `"${escapeHtml(m.content?.substring(0, 40))}${m.content?.length > 40 ? '...' : ''}"`).join(', ');
          summaryHtml = `
            <p>✦ Here is the Nexus Mentor summary for <strong>#${escapeHtml(activeChatChannel().name || 'general')}</strong>:</p>
            <ul>
              <li><strong>Discussion Point:</strong> General coordination in the workspace.</li>
              <li><strong>Recent topics:</strong> ${recent || 'No text content found.'}</li>
              <li><strong>Status:</strong> All workspace members are online and active.</li>
            </ul>
          `;
        }
        const bodyEl = document.getElementById('aiChatSummaryBody');
        if (bodyEl) bodyEl.innerHTML = summaryHtml;
        showToast('AI Summary generated successfully!');
      }, 500);
      return;
    }

    const chatText = messages.map(m => {
      const sender = m.isSystem ? 'System' : (isMine(m) ? 'You' : chatSenderName(m));
      return `${sender}: ${m.content}`;
    }).join('\n');

    try {
      const result = await request('/api/ai/document-action', {
        method: 'POST',
        body: JSON.stringify({
          action: 'summarize',
          text: chatText
        })
      });
      const bodyEl = document.getElementById('aiChatSummaryBody');
      if (bodyEl) {
        bodyEl.innerHTML = `
          <div class="ai-summary-content">
            ${parseMarkdownToHtml(result.response)}
          </div>
        `;
      }
      showToast('AI Summary generated successfully!');
    } catch (err) {
      document.getElementById('aiChatSummaryOverlay')?.remove();
      if (err.message.includes('GEMINI_API_KEY') || err.message.includes('503') || err.message.includes('not configured')) {
        showToast('AI summary needs the AI key in this environment.', true);
      } else {
        showToast(err.message, true);
      }
    }
  }
};


export const handleChatEmptyAction = (action) => {
  const { shell } = chatFeatureRuntime();
  const { showToast } = shell;

  if (action === 'ai-summarize') {
    handleChatAction('ai-summarize');
  } else if (action === 'share-note') {
    const newDocBtn = document.getElementById('newDocBtn');
    if (newDocBtn) {
      newDocBtn.click();
      navigate('workspace');
    } else {
      showToast('Navigating to workspace to share a note...');
      navigate('workspace');
    }
  } else if (action === 'start-discussion') {
    const input = document.getElementById('workspaceChatInput');
    if (input) {
      input.focus();
    }
  } else if (action === 'mention-members') {
    const input = document.getElementById('workspaceChatInput');
    if (input) {
      input.value = '@' + input.value;
      input.focus();
      const event = new Event('input', { bubbles: true });
      input.dispatchEvent(event);
    }
  }
};

export const showEmojiPicker = (buttonEl, messageId) => {
  const existing = document.getElementById('chatEmojiPicker');
  if (existing) existing.remove();

  const picker = document.createElement('div');
  picker.id = 'chatEmojiPicker';
  picker.className = 'chat-emoji-picker';
  picker.style.cssText = `
    position: absolute;
    z-index: 1000;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-elevated);
    padding: 6px;
    display: flex;
    gap: 4px;
  `;
  
  const emojis = ['👍', '❤️', '🔥', '😂', '😮', '😢', '🙌', '🎉'];
  picker.innerHTML = emojis.map(emoji => `
    <button class="emoji-picker-btn" data-emoji="${emoji}" type="button" style="border: none; background: transparent; font-size: 16px; padding: 4px 6px; cursor: pointer; border-radius: 4px; transition: var(--transition-fast);">${emoji}</button>
  `).join('');

  document.body.appendChild(picker);

  const rect = buttonEl.getBoundingClientRect();
  picker.style.top = `${rect.top + window.scrollY - 38}px`;
  picker.style.left = `${Math.max(8, rect.left + window.scrollX - 90)}px`;

  setTimeout(() => {
    const handleOutsideClick = (e) => {
      if (!picker.contains(e.target) && e.target !== buttonEl) {
        picker.remove();
        document.removeEventListener('click', handleOutsideClick);
      }
    };
    document.addEventListener('click', handleOutsideClick);
  }, 50);

  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('.emoji-picker-btn');
    if (btn) {
      const emoji = btn.dataset.emoji;
      toggleReaction(messageId, emoji);
      picker.remove();
    }
  });
};

export const toggleReaction = async (messageId, emoji) => {
  const { chat } = chatFeatureRuntime();
  const { activeChatChannel } = chat;

  const currentUserId = String(state.user?.id || state.user?._id || 'me');
  
  const toggleLocal = (msg) => {
    if (msg) {
      if (!msg.reactions) msg.reactions = [];
      let react = msg.reactions.find(r => r.emoji === emoji);
      if (react) {
        const userIndex = react.users.findIndex(uid => String(uid) === currentUserId);
        if (userIndex > -1) {
          react.users.splice(userIndex, 1);
        } else {
          react.users.push(currentUserId);
        }
      } else {
        msg.reactions.push({ emoji, users: [currentUserId] });
      }
      msg.reactions = msg.reactions.filter(r => r.users && r.users.length > 0);
    }
  };

  const message = state.messages.find(m => String(m._id) === String(messageId));
  const chatMessage = state.chatMessages.find(m => String(m._id) === String(messageId));
  toggleLocal(message);
  if (chatMessage && chatMessage !== message) {
    toggleLocal(chatMessage);
  }
  
  if (currentRoute() === 'chat') {
    renderChatPage({ skipEnsure: true });
  }

  if (!state.demoMode && collab.socket?.connected) {
    collab.socket.emit('react-chat-message', {
      workspaceId: state.selectedWorkspaceId,
      channelId: activeChatChannel().slug,
      messageId,
      emoji
    });
  }
};
