let activeMembersRuntime = null;

export const setMembersRuntime = (runtime) => {
  activeMembersRuntime = runtime;
  return activeMembersRuntime;
};

export const membersRuntime = () => {
  if (!activeMembersRuntime) {
    throw new Error('Members runtime has not been initialized.');
  }
  return activeMembersRuntime;
};

export const createMembersRuntime = ({
  state,
  membersUi,
  selectedWorkspace,
  selectedDocumentTitle,
  escapeHtml,
  copyText,
  request,
  loadWorkspaces,
  renderMembersPage,
  showMemberDetailsModal,
  showRemoveMemberModal,
  showToast
}) => {
  const getWorkspaceMembers = () => selectedWorkspace()?.members || [];

  const getUserDisplayName = (user) => {
    if (!user) return 'Unknown user';
    if (typeof user === 'string') return user;
    return user.username || user.name || user.firstName || user.email?.split('@')[0] || user.email || 'Unknown user';
  };

  const getMemberDisplayName = (member = {}) => {
    return getUserDisplayName(member.user || member);
  };

  const getMemberName = (member = {}) => getMemberDisplayName(member);

  const memberUserId = (member = {}) => String(
    member.user?._id ||
    member.user?.id ||
    member.userId ||
    member._id ||
    member.id ||
    member.user ||
    ''
  );

  const isWorkspaceOwner = (workspace = selectedWorkspace(), userId = state.user?.id) => (
    Boolean(workspace?.owner && userId && String(workspace.owner?._id || workspace.owner) === String(userId))
  );

  const isCurrentUserWorkspaceAdmin = (workspace = selectedWorkspace()) => {
    if (isWorkspaceOwner(workspace)) return true;
    const member = workspace?.members?.find((item) => memberUserId(item) === String(state.user?.id));
    return member?.role === 'admin';
  };

  const displayWorkspaceRole = (workspace, member) => (
    isWorkspaceOwner(workspace, memberUserId(member)) ? 'OWNER' : String(member.role || 'member').toUpperCase()
  );

  const collaborationPeople = () => {
    const workspaceMembers = getWorkspaceMembers();
    if (state.demoMode) {
      return workspaceMembers.slice(0, 3).map((member, index) => ({
        id: member.user?._id || `demo-member-${index}`,
        name: getMemberName(member),
        email: member.user?.email || member.email || '',
        status: index === 0 ? 'Editing Deadlocks notes' : index === 1 ? 'Reviewing Process Scheduling' : 'In Tasks',
        online: true
      }));
    }

    const presenceEmails = new Set(state.presence.map((user) => user.email).filter(Boolean));
    return workspaceMembers.map((member) => {
      const name = getMemberName(member);
      const email = member.user?.email || member.email || '';
      const id = memberUserId(member);
      const online = presenceEmails.has(email) || state.presence.some((user) => String(user.userId) === id);
      return {
        id: id || email || name,
        name,
        email,
        status: online ? `Editing ${selectedDocumentTitle()}` : `Role · ${member.role || 'member'}`,
        online
      };
    });
  };

  const memberActionPolicy = (workspace = selectedWorkspace(), member = {}) => {
    const currentUserId = String(state.user?.id || state.user?._id || '');
    const targetUserId = memberUserId(member);
    const currentMember = workspace?.members?.find((item) => memberUserId(item) === currentUserId);
    const isSelf = Boolean(currentUserId && targetUserId && currentUserId === targetUserId);
    const currentIsOwner = isWorkspaceOwner(workspace, currentUserId);
    const currentIsAdmin = currentIsOwner || currentMember?.role === 'admin';
    const targetIsOwner = isWorkspaceOwner(workspace, targetUserId);
    const targetRole = member.role || 'member';
    const targetIsAdmin = targetRole === 'admin';
    const adminCount = (workspace?.members || []).filter((item) => (
      item.role === 'admin' || isWorkspaceOwner(workspace, memberUserId(item))
    )).length;
    let removeAllowed = true;
    let removeReason = '';

    if (state.demoMode) {
      removeAllowed = false;
      removeReason = 'Demo members cannot be removed.';
    } else if (isSelf) {
      removeAllowed = false;
      removeReason = 'You cannot remove yourself here.';
    } else if (!currentIsAdmin) {
      removeAllowed = false;
      removeReason = 'Only admins can remove members.';
    } else if (targetIsOwner) {
      removeAllowed = false;
      removeReason = 'Workspace owner cannot be removed.';
    } else if (targetIsAdmin && !currentIsOwner) {
      removeAllowed = false;
      removeReason = 'Only the owner can remove admins.';
    } else if (targetIsAdmin && adminCount <= 1) {
      removeAllowed = false;
      removeReason = 'At least one admin must remain.';
    }

    return {
      isSelf,
      currentIsAdmin,
      currentIsOwner,
      targetIsOwner,
      targetIsAdmin,
      canChangeRole: !state.demoMode && currentIsOwner && !targetIsOwner && !isSelf,
      canRemove: removeAllowed,
      removeReason
    };
  };

  const removeMembersActionMenu = () => {
    document.getElementById('membersActionPortal')?.remove();
  };

  const closeMembersActionMenu = () => {
    membersUi.activeMenuMemberId = '';
    membersUi.actionMenuRect = null;
    removeMembersActionMenu();
    document.querySelectorAll('.members-menu-trigger-btn[aria-expanded="true"]').forEach((button) => {
      button.setAttribute('aria-expanded', 'false');
    });
  };

  const renderMembersActionMenu = () => {
    removeMembersActionMenu();
    if (!membersUi.activeMenuMemberId) return;
    const workspace = selectedWorkspace();
    const member = workspace?.members?.find((item) => memberUserId(item) === membersUi.activeMenuMemberId);
    if (!workspace || !member || !membersUi.actionMenuRect) return;

    const displayName = getMemberDisplayName(member);
    const email = member.user?.email || member.email || '';
    const role = member.role || 'member';
    const policy = memberActionPolicy(workspace, member);
    const menuWidth = 220;
    const estimatedHeight = policy.canChangeRole && policy.canRemove ? 238 : policy.canRemove || policy.canChangeRole ? 196 : 154;
    const viewportPadding = 12;
    const left = Math.min(
      Math.max(viewportPadding, membersUi.actionMenuRect.right - menuWidth),
      window.innerWidth - menuWidth - viewportPadding
    );
    const openUpward = membersUi.actionMenuRect.bottom + estimatedHeight + viewportPadding > window.innerHeight;
    const top = openUpward
      ? Math.max(viewportPadding, membersUi.actionMenuRect.top - estimatedHeight - 8)
      : Math.min(window.innerHeight - viewportPadding, membersUi.actionMenuRect.bottom + 8);

    const portal = document.createElement('div');
    portal.id = 'membersActionPortal';
    portal.className = 'member-action-dropdown member-action-portal';
    portal.setAttribute('role', 'menu');
    portal.style.left = `${Math.round(left)}px`;
    portal.style.top = `${Math.round(top)}px`;
    portal.innerHTML = `
      <button type="button" class="members-menu-action-btn" data-menu-action="view-profile" data-member-id="${escapeHtml(membersUi.activeMenuMemberId)}" role="menuitem">
        <span class="menu-action-icon">◷</span><span>View profile</span>
      </button>
      <button type="button" class="members-menu-action-btn" data-menu-action="copy-email" data-member-email="${escapeHtml(email)}" role="menuitem">
        <span class="menu-action-icon">□</span><span>Copy email</span>
      </button>
      ${policy.canChangeRole ? `
        <button type="button" class="members-menu-action-btn" data-menu-action="change-role" data-role-to="${role === 'admin' ? 'member' : 'admin'}" data-member-id="${escapeHtml(membersUi.activeMenuMemberId)}" role="menuitem">
          <span class="menu-action-icon">◇</span><span>Make ${role === 'admin' ? 'member' : 'admin'}</span>
        </button>
      ` : ''}
      <button type="button" class="members-menu-action-btn" data-menu-action="message" data-member-id="${escapeHtml(membersUi.activeMenuMemberId)}" role="menuitem">
        <span class="menu-action-icon">↗</span><span>Message member</span>
      </button>
      ${policy.canRemove ? `
        <button type="button" class="members-menu-action-btn danger" data-menu-action="remove" data-member-id="${escapeHtml(membersUi.activeMenuMemberId)}" role="menuitem">
          <span class="menu-action-icon">−</span><span>Remove from workspace</span>
        </button>
      ` : ''}
    `;
    document.body.appendChild(portal);
    document.querySelectorAll('.members-menu-trigger-btn').forEach((button) => {
      button.setAttribute('aria-expanded', button.dataset.triggerMenuFor === membersUi.activeMenuMemberId ? 'true' : 'false');
    });
  };

  const openMembersActionMenu = (memberId, triggerButton) => {
    if (membersUi.activeMenuMemberId === memberId) {
      closeMembersActionMenu();
      return;
    }
    membersUi.activeMenuMemberId = memberId;
    membersUi.actionMenuRect = triggerButton.getBoundingClientRect();
    renderMembersActionMenu();
  };

  const handleMembersMenuAction = async (menuAction) => {
    const action = menuAction.dataset.menuAction;
    const memberId = menuAction.dataset.memberId;
    const workspace = selectedWorkspace();
    if (!workspace) return;

    if (action === 'view-profile') {
      const member = workspace.members.find((m) => memberUserId(m) === memberId);
      if (member) showMemberDetailsModal(member);
      closeMembersActionMenu();
    } else if (action === 'copy-email') {
      const email = menuAction.dataset.memberEmail;
      await copyText(email, 'Email copied');
      closeMembersActionMenu();
    } else if (action === 'message') {
      showToast('Direct messages are not available yet.');
      closeMembersActionMenu();
    } else if (action === 'change-role') {
      if (state.demoMode) {
        showToast('Demo roles cannot be updated');
        closeMembersActionMenu();
        return;
      }
      const roleTo = menuAction.dataset.roleTo;
      if (confirm(`Change member's role to ${roleTo.toUpperCase()}?`)) {
        try {
          await request(`/api/workspaces/${state.selectedWorkspaceId}/members/${memberId}`, {
            method: 'PATCH',
            body: JSON.stringify({ role: roleTo })
          });
          await loadWorkspaces();
          showToast('Member role updated');
          closeMembersActionMenu();
          renderMembersPage();
        } catch (err) {
          showToast(err.message, true);
        }
      }
    } else if (action === 'remove') {
      const member = workspace.members.find((m) => memberUserId(m) === memberId);
      const policy = member ? memberActionPolicy(workspace, member) : { canRemove: false, removeReason: 'Member not found.' };
      closeMembersActionMenu();
      if (!policy.canRemove) {
        showToast(policy.removeReason || 'You cannot remove this member.', true);
        return;
      }
      showRemoveMemberModal(memberId);
    }
  };

  const isMemberOnline = (member) => {
    const userId = memberUserId(member);
    if (state.demoMode) {
      return userId !== 'demo-user-alex';
    }
    const chatOnlineIds = new Set(state.chatOnlineUsers.map((user) => String(user.userId)).filter(Boolean));
    const presenceUserIds = new Set(state.presence.map((user) => String(user.userId)).filter(Boolean));
    return chatOnlineIds.has(userId) || presenceUserIds.has(userId) || userId === String(state.user?.id);
  };

  const getMemberActivityText = (member) => {
    const userId = memberUserId(member);
    if (state.demoMode) {
      if (userId === 'demo-user-priya') return 'Editing Deadlocks notes';
      if (userId === 'demo-user-sam') return 'In Tasks';
      if (userId === 'demo-user-rohan') return 'Reviewing Process Scheduling';
    }
    const pres = state.presence.find(u => String(u.userId) === userId);
    if (pres) {
      return `Editing ${selectedDocumentTitle()}`;
    }
    const isOnline = isMemberOnline(member);
    if (isOnline) {
      return 'Active in workspace';
    }
    return 'No recent activity';
  };

  return {
    getWorkspaceMembers,
    getUserDisplayName,
    getMemberDisplayName,
    getMemberName,
    collaborationPeople,
    memberUserId,
    isWorkspaceOwner,
    isCurrentUserWorkspaceAdmin,
    displayWorkspaceRole,
    memberActionPolicy,
    closeMembersActionMenu,
    renderMembersActionMenu,
    openMembersActionMenu,
    handleMembersMenuAction,
    isMemberOnline,
    getMemberActivityText
  };
};
