export const searchState = {
  matches: [],
  currentIndex: -1,
  query: ''
};

export const createChatRuntime = ({
  state,
  els,
  searchState,
  GENERAL_CHAT_CHANNEL,
  collaborationPeople,
  selectedWorkspace,
  showToast,
  highlightSearchInDom
}) => {
  const activeChatChannel = () => state.channels.find((channel) => channel.slug === state.selectedChannelId)
    || state.channels.find((channel) => channel.slug === GENERAL_CHAT_CHANNEL)
    || state.channels[0]
    || { slug: GENERAL_CHAT_CHANNEL, name: 'General' };

  const chatSenderName = (message = {}) => message.sender?.username
    || message.sender?.email?.split('@')[0]
    || 'Member';

  const syncUnreadBadge = () => {
    if (!els.chatUnreadBadge) return;
    const count = Number(state.unreadChatCount || 0);
    els.chatUnreadBadge.textContent = count > 99 ? '99+' : String(count);
    els.chatUnreadBadge.classList.toggle('hidden', count <= 0);
    localStorage.setItem('chatUnreadCount', String(count));
  };

  const clearChatUnread = () => {
    state.unreadChatCount = 0;
    syncUnreadBadge();
  };

  const currentChatPreview = () => {
    const message = [...state.chatMessages].reverse().find((item) => item.channelId === activeChatChannel().slug)
      || [...state.messages].reverse().find((item) => item.channelId === GENERAL_CHAT_CHANNEL)
      || null;
    if (!message) return null;
    return {
      sender: chatSenderName(message),
      content: message.content || '',
      time: message.createdAt || message.updatedAt
    };
  };

  const chatOnlineCount = () => {
    if (state.demoMode) return Math.max(4, collaborationPeople().filter((person) => person.online).length);
    return state.chatOnlineUsers.length || collaborationPeople().filter((person) => person.online).length || (selectedWorkspace() ? 1 : 0);
  };

  const highlightActiveMatch = () => {
    searchState.matches.forEach((el) => el.classList.remove('active-highlight'));

    if (searchState.currentIndex >= 0 && searchState.currentIndex < searchState.matches.length) {
      const activeEl = searchState.matches[searchState.currentIndex];
      activeEl.classList.add('active-highlight');
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    updateSearchMatchesCounter();
  };

  const updateSearchMatchesCounter = () => {
    const counter = document.getElementById('chatSearchMatches');
    if (counter) {
      const current = searchState.matches.length > 0 ? searchState.currentIndex + 1 : 0;
      counter.textContent = `${current} / ${searchState.matches.length}`;
    }
  };

  const navigateSearchMatch = (direction) => {
    if (searchState.matches.length === 0) return;
    if (direction === 'next') {
      searchState.currentIndex = (searchState.currentIndex + 1) % searchState.matches.length;
    } else if (direction === 'prev') {
      searchState.currentIndex = (searchState.currentIndex - 1 + searchState.matches.length) % searchState.matches.length;
    }
    highlightActiveMatch();
  };

  const closeChatSearch = () => {
    const container = document.getElementById('chatHeaderSearchContainer');
    if (container) {
      container.classList.add('hidden');
    }
    const input = document.getElementById('chatSearchInput');
    if (input) {
      input.value = '';
    }
    highlightSearchInDom('');
  };

  const handleChatMessageAction = (action, msgId, msgArticle, targetEl) => {
    if (action === 'copy') {
      const textEl = msgArticle?.querySelector('.chat-bubble p');
      const content = textEl?.textContent || '';
      if (content) {
        navigator.clipboard.writeText(content)
          .then(() => showToast('Message copied to clipboard'))
          .catch(() => showToast('Failed to copy message', true));
      }
    } else if (action === 'reply') {
      const nameEl = msgArticle?.querySelector('.chat-sender-name');
      const senderName = nameEl?.textContent || 'teammate';
      const input = document.getElementById('workspaceChatInput');
      if (input) {
        input.value = `Replying to @${senderName}: "${input.value}"`;
        input.focus();
        const event = new Event('input', { bubbles: true });
        input.dispatchEvent(event);
      }
    } else if (action === 'react') {
      const btn = targetEl?.closest('[data-msg-action="react"]');
      if (btn && msgId) {
        globalThis.showEmojiPicker(btn, msgId);
      }
    }
  };

  const renderChatTypingIndicator = () => {
    const typingEl = document.getElementById('workspaceChatTyping');
    if (!typingEl) return;
    const typingNames = state.chatTypingUsers
      .filter((user) => user.userId !== state.user?.id)
      .map((user) => user.username || user.email?.split('@')[0] || 'Someone');
    typingEl.textContent = typingNames.length
      ? `${typingNames.slice(0, 2).join(', ')} ${typingNames.length === 1 ? 'is' : 'are'} typing...`
      : '';
  };

  return {
    activeChatChannel,
    chatSenderName,
    syncUnreadBadge,
    clearChatUnread,
    currentChatPreview,
    chatOnlineCount,
    highlightActiveMatch,
    updateSearchMatchesCounter,
    navigateSearchMatch,
    closeChatSearch,
    handleChatMessageAction,
    renderChatTypingIndicator
  };
};
