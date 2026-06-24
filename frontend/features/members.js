// Lazily loaded route module. Shared shell bindings are exposed by app.js.

const app = () => globalThis;
let loadedInvitesWorkspaceId = '';
let loadingInvitesWorkspaceId = '';

export const renderMembersPage = async () => {
  app().setMainMode('feature');
  app().setRouteChrome('members');
  const workspace = app().selectedWorkspace();
  if (!workspace) {
    app().els.routePage.innerHTML = app().emptyState({
      title: 'No workspace selected',
      body: 'Create or switch to a workspace before opening workspace settings.',
      icon: '▣'
    });
    return;
  }

  const canManage = app().isCurrentUserWorkspaceAdmin(workspace);
  const canOwnerManage = app().isWorkspaceOwner(workspace);
  const workspaceId = String(app().state.selectedWorkspaceId || workspace._id || '');
  let invites = loadedInvitesWorkspaceId === workspaceId ? app().pendingWorkspaceInvites : [];
  if (!app().state.demoMode && canManage) {
    if (loadedInvitesWorkspaceId !== workspaceId && loadingInvitesWorkspaceId !== workspaceId) {
      loadingInvitesWorkspaceId = workspaceId;
      app().request(`/api/invites/workspace/${workspaceId}`)
        .then((result) => {
          app().pendingWorkspaceInvites = Array.isArray(result) ? result : [];
          loadedInvitesWorkspaceId = workspaceId;
          if (app().currentRoute() === 'members' && String(app().state.selectedWorkspaceId || '') === workspaceId) {
            renderMembersPage();
          }
        })
        .catch(() => {
          if (loadedInvitesWorkspaceId !== workspaceId) app().pendingWorkspaceInvites = [];
        })
        .finally(() => {
          if (loadingInvitesWorkspaceId === workspaceId) loadingInvitesWorkspaceId = '';
        });
    }
  } else {
    invites = [];
  }

  // Calculations
  const totalCount = workspace.members?.length || 0;
  const onlineCount = (workspace.members || []).filter(app().isMemberOnline).length;
  const pendingCount = invites.length;
  const adminsCount = (workspace.members || []).filter(member => member.role === 'admin' || app().isWorkspaceOwner(workspace, app().memberUserId(member))).length;

  // Filter members
  const filteredMembers = (workspace.members || []).filter(member => {
    const displayName = app().getMemberDisplayName(member);
    const email = member.user?.email || member.email || '';
    const role = member.role || 'member';
    const isOnline = app().isMemberOnline(member);
    const statusText = isOnline ? 'online' : 'offline';
    
    const q = (app().membersSearchQuery || '').trim().toLowerCase();
    const matchesSearch = !q || displayName.toLowerCase().includes(q) 
      || email.toLowerCase().includes(q) 
      || role.toLowerCase().includes(q)
      || statusText.includes(q);
      
    const roleFilter = app().membersRoleFilter || 'all';
    const statusFilter = app().membersStatusFilter || 'all';
    const matchesRole = roleFilter === 'all' 
      || (roleFilter === 'admin' && role === 'admin')
      || (roleFilter === 'member' && role === 'member')
      || (roleFilter === 'viewer' && role === 'viewer');
      
    const matchesStatus = statusFilter === 'all' 
      || (statusFilter === 'online' && isOnline)
      || (statusFilter === 'offline' && !isOnline);
      
    return matchesSearch && matchesRole && matchesStatus;
  });

  // Render Layout
  let tabContentHtml = '';

  const activeMembersTab = app().membersActiveTab || 'members';
  const searchQuery = app().membersSearchQuery || '';
  const roleFilter = app().membersRoleFilter || 'all';
  const statusFilter = app().membersStatusFilter || 'all';

  if (activeMembersTab === 'members') {
    tabContentHtml = `
      <div class="members-toolbar">
        <div class="members-search-wrapper">
          <span class="members-search-icon" aria-hidden="true"></span>
          <input class="members-search-input" id="membersSearchInput" placeholder="Search members by name, email, or role..." value="${app().escapeHtml(searchQuery)}" />
        </div>
        <select class="members-filter-select" id="membersRoleFilterSelect">
          <option value="all" ${roleFilter === 'all' ? 'selected' : ''}>All Roles</option>
          <option value="admin" ${roleFilter === 'admin' ? 'selected' : ''}>Admin</option>
          <option value="member" ${roleFilter === 'member' ? 'selected' : ''}>Member</option>
          <option value="viewer" ${roleFilter === 'viewer' ? 'selected' : ''}>Viewer</option>
        </select>
        <select class="members-filter-select" id="membersStatusFilterSelect">
          <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>All Status</option>
          <option value="online" ${statusFilter === 'online' ? 'selected' : ''}>Online</option>
          <option value="offline" ${statusFilter === 'offline' ? 'selected' : ''}>Offline</option>
        </select>
      </div>

      <div class="members-table-wrapper">
        <div class="members-table">
          <div class="members-table-head">
            <span>Member</span>
            <span>Email</span>
            <span>Role</span>
            <span>Status</span>
            <span>Current Activity</span>
            <span>Actions</span>
          </div>
          ${filteredMembers.map((member) => {
            const displayName = app().getMemberDisplayName(member);
            const email = member.user?.email || member.email || 'No email';
            const role = member.role || 'member';
            const userId = app().memberUserId(member);
            const isOnline = app().isMemberOnline(member);
            const activityText = app().getMemberActivityText(member);
            const isSelf = userId === String(app().state.user?.id);
            const isOwner = app().isWorkspaceOwner(workspace, userId);
            const actionPolicy = app().memberActionPolicy(workspace, member);

            // Generate initials
            const initials = app().getInitials(displayName);

            // Display role text
            const roleText = isOwner ? 'OWNER' : role.toUpperCase();
            const roleClass = isOwner ? 'owner' : role;

            return `
              <div class="members-table-row ${app().membersActiveMenuMemberId === userId ? 'is-menu-open' : ''}">
                <div data-label="Member" class="members-member-cell">
                  <span class="avatar-dot">${app().escapeHtml(initials)}</span>
                  <span class="members-member-copy">
                    <strong>${app().escapeHtml(displayName)} ${isSelf ? '<small class="member-you-badge">You</small>' : ''}</strong>
                    <small>${isOwner ? 'Workspace owner' : actionPolicy.targetIsAdmin ? 'Workspace admin' : 'Workspace member'}</small>
                  </span>
                </div>
                <span data-label="Email" class="members-email-cell">${app().escapeHtml(email)}</span>
                <span data-label="Role">
                  <span class="role-badge ${roleClass}">${app().escapeHtml(roleText)}</span>
                </span>
                <span data-label="Status">
                  <span class="status-dot-wrapper">
                    <span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>
                    ${isOnline ? 'Online' : 'Offline'}
                  </span>
                </span>
                <span data-label="Current Activity" class="members-activity-cell muted-copy">${app().escapeHtml(activityText)}</span>
                <div data-label="Actions" class="member-action-menu-container">
                  <button class="members-menu-trigger-btn" data-trigger-menu-for="${userId}" aria-haspopup="menu" aria-expanded="${app().membersActiveMenuMemberId === userId ? 'true' : 'false'}" aria-label="Member actions for ${app().escapeHtml(displayName)}" type="button">
                    <span aria-hidden="true">•••</span>
                  </button>
                </div>
              </div>
            `;
          }).join('') || `<div class="tasks-compact-empty members-empty-state"><span class="empty-icon">◇</span><h4>No members found</h4><p>Try a different search or filter.</p></div>`}
        </div>
      </div>
    `;
  } else if (activeMembersTab === 'invites') {
    tabContentHtml = `
      <div class="invites-list">
        ${invites.map((invite) => {
          const code = invite.code || 'SHAREABLE LINK';
          const email = invite.email || 'Any teammate with link';
          const inviteId = invite._id || invite.id;
          const createdDate = invite.createdAt ? new Date(invite.createdAt).toLocaleDateString() : 'recent';
          const expiresDate = invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : 'never';
          const inviteLink = invite.token ? `${location.origin}${location.pathname}#/invite?token=${encodeURIComponent(invite.token)}` : `${location.origin}${location.pathname}#/invite?code=${encodeURIComponent(invite.code)}`;
          
          return `
            <div class="invite-item-card">
              <div class="invite-item-details">
                <span class="invite-item-code">${app().escapeHtml(code)}</span>
                <span class="invite-item-meta">Role: <strong>${app().escapeHtml(String(invite.role || 'member').toUpperCase())}</strong> · Sent to: <strong>${app().escapeHtml(email)}</strong></span>
                <span class="invite-item-meta">Created ${app().escapeHtml(createdDate)} · Expires ${app().escapeHtml(expiresDate)}</span>
              </div>
              <div class="invite-item-actions">
                <button class="ghost copy-invite-btn" data-copy-invite-url="${app().escapeHtml(inviteLink)}" type="button">📋 Copy Link</button>
                <button class="ghost copy-invite-btn" data-copy-invite-code="${app().escapeHtml(code)}" type="button">🔑 Copy Code</button>
                ${canManage ? `
                  <button class="danger-button revoke-invite-btn" data-revoke-invite-id="${inviteId}" type="button">Revoke</button>
                ` : ''}
              </div>
            </div>
          `;
        }).join('') || `
          ${app().emptyState({
            title: 'No pending invites',
            body: 'Create an invite link to bring classmates into this workspace.',
            action: 'Invite Member',
            actionId: 'emptyMembersInviteBtn',
            icon: '✉️'
          })}
        `}
      </div>
    `;
  } else if (activeMembersTab === 'roles') {
    tabContentHtml = `
      <div class="roles-grid">
        <div class="role-explain-card">
          <h4>👑 Owner / Admin</h4>
          <ul>
            <li>Full read/write access across documents and chats</li>
            <li>Rename or delete workspaces</li>
            <li>Generate invite codes and links</li>
            <li>Change member roles (Owner only)</li>
            <li>Remove members safely</li>
          </ul>
        </div>
        <div class="role-explain-card">
          <h4>👤 Member (Editor)</h4>
          <ul>
            <li>Read and edit workspace documents</li>
            <li>Send messages in chat channels</li>
            <li>Create tasks and ask doubt threads</li>
            <li>Collaborate in real time</li>
          </ul>
        </div>
        <div class="role-explain-card">
          <h4>👁️ Viewer</h4>
          <ul>
            <li>Read-only access to documents</li>
            <li>View chat logs and discussion threads</li>
            <li>Cannot modify files, create tasks, or edit notes</li>
          </ul>
        </div>
      </div>
      <div class="roles-safety-warning">
        <span>⚠️</span>
        <div>
          <strong>Workspace Safety Rule</strong>
          <p style="margin: 4px 0 0 0; font-size: 12px; color: #78350f;">Keep at least one admin/owner active in the workspace at all times to maintain configuration controls.</p>
        </div>
      </div>
    `;
  }

  // Active Sessions / Live Activity
  const activeSessions = (workspace.members || []).map(member => {
    const userId = app().memberUserId(member);
    const isOnline = app().isMemberOnline(member);
    if (!isOnline) return null;
    
    // Find active doc
    let documentId = '';
    let documentTitle = '';
    
    if (app().state.demoMode) {
      if (userId === 'demo-user-priya') {
        documentId = 'demo-doc-ml-guide';
        documentTitle = 'ML Study Guide';
      } else if (userId === 'demo-user-rohan') {
        documentId = 'demo-doc-ds-lecture';
        documentTitle = 'Lecture Notes';
      }
    } else {
      const pres = app().state.presence.find(u => String(u.userId) === userId);
      if (pres && app().state.selectedDocumentId) {
        documentId = app().state.selectedDocumentId;
        documentTitle = app().selectedDocumentTitle();
      }
    }
    
    return {
      userId,
      displayName: app().getMemberDisplayName(member),
      email: member.user?.email || member.email || '',
      activity: app().getMemberActivityText(member),
      documentId,
      documentTitle
    };
  }).filter(Boolean);

  app().els.routePage.innerHTML = `
    <div class="members-page page-shell-v2">
      <header class="page-heading-v2">
        <div>
          <p class="auth-kicker">Workspace Access Settings</p>
          <h2>Workspace Members</h2>
          <p>Manage access, roles, invites, and live presence for this workspace.</p>
        </div>
        <div class="workspace-settings-actions">
          <button class="members-header-btn secondary" id="membersJoinWorkspaceBtn" type="button"><span aria-hidden="true">⌘</span> Join with Code</button>
          <button class="members-header-btn secondary" id="membersCopyWorkspaceInviteLinkBtn" type="button"><span aria-hidden="true">□</span> Copy Invite Link</button>
          <button class="members-header-btn primary" id="membersInviteMemberBtn" type="button"><span aria-hidden="true">+</span> Invite Member</button>
        </div>
      </header>

      <div class="members-stats-row">
        <div class="members-stat-card">
          <div class="members-stat-header">
            <span>Total Members</span>
            <span class="members-stat-icon">●</span>
          </div>
          <div class="members-stat-value">${totalCount}</div>
        </div>
        <div class="members-stat-card">
          <div class="members-stat-header">
            <span>Online Now</span>
            <span class="members-stat-icon success">●</span>
          </div>
          <div class="members-stat-value">${onlineCount}</div>
        </div>
        <div class="members-stat-card">
          <div class="members-stat-header">
            <span>Pending Invites</span>
            <span class="members-stat-icon">◇</span>
          </div>
          <div class="members-stat-value">${pendingCount}</div>
        </div>
        <div class="members-stat-card">
          <div class="members-stat-header">
            <span>Admins</span>
            <span class="members-stat-icon">◆</span>
          </div>
          <div class="members-stat-value">${adminsCount}</div>
        </div>
      </div>

      <div class="members-tabs">
        <button class="members-tab-btn ${activeMembersTab === 'members' ? 'active' : ''}" data-members-tab="members" type="button">Members <span>${totalCount}</span></button>
        <button class="members-tab-btn ${activeMembersTab === 'invites' ? 'active' : ''}" data-members-tab="invites" type="button">Invites <span>${pendingCount}</span></button>
        <button class="members-tab-btn ${activeMembersTab === 'roles' ? 'active' : ''}" data-members-tab="roles" type="button">Roles</button>
      </div>

      <div class="members-tab-content">
        ${tabContentHtml}
      </div>

      <div class="live-activity-container">
        <h3>Live Activity</h3>
        <p class="muted-copy" style="margin-top: 4px; margin-bottom: 12px;">See what members are doing right now.</p>
        <div class="live-activity-grid">
          ${activeSessions.map(session => {
            const initials = app().getInitials(session.displayName);
            const isClickable = session.documentId ? 'clickable' : '';
            return `
              <div class="live-activity-card ${isClickable}" ${session.documentId ? `data-active-doc-link="${session.documentId}"` : ''}>
                <span class="avatar-dot">${app().escapeHtml(initials)}</span>
                <div class="live-activity-info">
                  <div class="live-activity-user">
                    ${app().escapeHtml(session.displayName)}
                    <span class="status-dot online"></span>
                  </div>
                  <div class="live-activity-desc">
                    ${session.documentTitle ? `Editing <em>${app().escapeHtml(session.documentTitle)}</em>` : app().escapeHtml(session.activity)}
                  </div>
                </div>
                <span class="live-activity-time">Live</span>
              </div>
            `;
          }).join('') || `
            <div style="grid-column: 1 / -1; padding: 24px; text-align: center; border: 1px dashed var(--line); border-radius: var(--radius-lg); color: var(--muted); font-size: 13px;">
              No live activity right now.
            </div>
          `}
        </div>
      </div>
    </div>
  `;

  // Focus preservation for search input
  const searchInput = document.getElementById('membersSearchInput');
  if (searchInput && document.activeElement?.id === 'membersSearchInput') {
    searchInput.focus();
    const len = searchInput.value.length;
    searchInput.setSelectionRange(len, len);
  }
};
