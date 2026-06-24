// Lazily loaded route module. Shared shell bindings are exposed by app.js.

export const renderSettingsContent = (tab, workspace) => {
  const canManage = workspace ? isCurrentUserWorkspaceAdmin(workspace) : false;
  const canOwnerManage = workspace ? isWorkspaceOwner(workspace) : false;
  const isDirty = isSettingsDirty();

  const panels = {
    general: `
      <section class="settings-content-card" data-settings-panel="general">
        <h3>General Settings</h3>
        <p>Manage workspace profile, account settings, and workspace identity.</p>

        <div class="security-card">
          <div class="security-card-header">
            <h4>Workspace Profile</h4>
          </div>
          <p>Identity details for the workspace.</p>
          
          <div style="display: flex; gap: 16px; align-items: center; margin-bottom: 20px;">
            <span class="workspace-avatar big" style="width: 56px; height: 56px; font-size: 20px; display: flex; align-items: center; justify-content: center; background: var(--primary-soft); color: var(--primary); border-radius: 12px; font-weight: 700;">
              ${escapeHtml(getInitials(settingsWorkspaceName || 'S'))}
            </span>
            <div style="flex: 1;">
              <label style="margin: 0;">Workspace Name
                <input id="settingsWorkspaceNameInput" value="${escapeHtml(settingsWorkspaceName)}" ${canManage ? '' : 'readonly'} placeholder="Workspace Name" />
              </label>
            </div>
          </div>

          <label style="margin-bottom: 16px;">Workspace Description
            <textarea id="settingsWorkspaceDescriptionInput" ${canManage ? '' : 'readonly'} placeholder="Describe this workspace...">${escapeHtml(settingsWorkspaceDescription)}</textarea>
          </label>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; padding: 12px; background: var(--panel-soft); border-radius: var(--radius-md); font-size: 13px; margin-bottom: 16px;">
            <div><span style="color: var(--muted); display: block; font-size: 11px; margin-bottom: 2px;">CREATED</span><strong>${workspace?.createdAt ? new Date(workspace.createdAt).toLocaleDateString() : 'Not available'}</strong></div>
            <div><span style="color: var(--muted); display: block; font-size: 11px; margin-bottom: 2px;">MEMBERS</span><strong>${workspace?.members?.length || 1} members</strong></div>
            <div>
              <span style="color: var(--muted); display: block; font-size: 11px; margin-bottom: 2px;">WORKSPACE ID</span>
              <div style="display: flex; gap: 6px; align-items: center;">
                <code style="background: transparent; padding: 0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px;">${workspace?._id || ''}</code>
                <button class="ghost" id="settingsCopyWorkspaceIdBtn" style="padding: 2px 6px; font-size: 11px; height: auto;" type="button">Copy</button>
              </div>
            </div>
          </div>
        </div>

        <div class="security-card">
          <div class="security-card-header">
            <h4>Account Profile</h4>
          </div>
          <p>Manage your account settings and credentials.</p>
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--panel-soft); border-radius: var(--radius-md);">
            <div>
              <strong>${escapeHtml(state.user?.username || 'User')}</strong>
              <span style="display: block; font-size: 12px; color: var(--muted); margin-top: 2px;">${escapeHtml(state.user?.email || '')}</span>
            </div>
            <button class="soft-button" id="settingsSignOutBtn" style="color: #ef4444;" type="button">Sign Out</button>
          </div>
        </div>

        <div class="security-card">
          <div class="security-card-header">
            <h4>Workspace Administration</h4>
          </div>
          <p>Access members directory, invite management, and database tools.</p>
          <button class="soft-button" data-route-go="workspace-settings" type="button">Manage Workspace Settings</button>
        </div>

        <div class="settings-save-footer">
          <button class="ghost" id="settingsCancelBtn" type="button">Cancel</button>
          <button class="primary" id="settingsSaveBtn" type="button" ${settingsSaveInProgress || !isDirty ? 'disabled' : ''}>
            ${settingsSaveInProgress ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </section>
    `,
    appearance: `
      <section class="settings-content-card" data-settings-panel="appearance">
        <h3>Appearance Settings</h3>
        <p>Control how Nexus feels while you read, write, and collaborate.</p>

        <div class="security-card">
          <div class="security-card-header">
            <h4>Theme Preference</h4>
          </div>
          <p>Select your interface theme or sync with system preferences.</p>
          <div class="theme-selector-grid">
            <div class="theme-select-card ${settingsTheme === 'light' ? 'active' : ''}" data-theme-val="light">
              <span class="theme-card-icon">☀️</span>
              <strong>Light Mode</strong>
              <span class="theme-card-desc">Sleek, bright palette</span>
            </div>
            <div class="theme-select-card ${settingsTheme === 'dark' ? 'active' : ''}" data-theme-val="dark">
              <span class="theme-card-icon">🌙</span>
              <strong>Dark Mode</strong>
              <span class="theme-card-desc">Deep, contrast palette</span>
            </div>
            <div class="theme-select-card ${settingsTheme === 'system' ? 'active' : ''}" data-theme-val="system">
              <span class="theme-card-icon">🖥️</span>
              <strong>System Sync</strong>
              <span class="theme-card-desc">Match device settings</span>
            </div>
          </div>
        </div>

        <div class="security-card">
          <div class="security-card-header">
            <h4>Interface Density</h4>
          </div>
          <p>Control the height and padding scale of workspace views.</p>
          <label style="margin: 0;">Density Level
            <select id="settingsDensitySelect">
              <option value="comfortable" ${settingsDensity === 'comfortable' ? 'selected' : ''}>Comfortable (default)</option>
              <option value="compact" ${settingsDensity === 'compact' ? 'selected' : ''}>Compact (high density)</option>
            </select>
          </label>
        </div>

        <div class="notification-option-row">
          <div class="notification-option-details">
            <span class="notification-option-icon">✨</span>
            <div>
              <strong>Reduce motion</strong>
              <p>Minimize hover lifts and animated transitions.</p>
            </div>
          </div>
          <label class="toggle-switch-wrapper">
            <input type="checkbox" id="settingsReduceMotionInput" ${settingsReduceMotion ? 'checked' : ''} />
            <span class="toggle-switch-slider"></span>
          </label>
        </div>

        <div class="settings-save-footer">
          <button class="ghost" id="settingsCancelBtn" type="button">Cancel</button>
          <button class="primary" id="settingsSaveBtn" type="button" ${settingsSaveInProgress || !isDirty ? 'disabled' : ''}>
            ${settingsSaveInProgress ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </section>
    `,
    notifications: `
      <section class="settings-content-card" data-settings-panel="notifications">
        <h3>Notifications</h3>
        <p>Choose which workspace events should ask for your attention.</p>

        <div class="notification-option-row">
          <div class="notification-option-details">
            <span class="notification-option-icon">📧</span>
            <div>
              <strong>Email summaries</strong>
              <p>Receive weekly updates and digest summaries by email.</p>
            </div>
          </div>
          <label class="toggle-switch-wrapper">
            <input type="checkbox" id="settingsEmailNotificationsInput" ${settingsEmailNotifications ? 'checked' : ''} />
            <span class="toggle-switch-slider"></span>
          </label>
        </div>

        <div class="notification-option-row">
          <div class="notification-option-details">
            <span class="notification-option-icon">📋</span>
            <div>
              <strong>Task updates</strong>
              <p>Notify me when document tasks are created, assigned, or completed.</p>
            </div>
          </div>
          <label class="toggle-switch-wrapper">
            <input type="checkbox" id="settingsTaskNotificationsInput" ${settingsTaskNotifications ? 'checked' : ''} />
            <span class="toggle-switch-slider"></span>
          </label>
        </div>

        <div class="notification-option-row">
          <div class="notification-option-details">
            <span class="notification-option-icon">💬</span>
            <div>
              <strong>Discussion replies</strong>
              <p>Notify me when teammates reply in document discussions.</p>
            </div>
          </div>
          <label class="toggle-switch-wrapper">
            <input type="checkbox" id="settingsDiscussionNotificationsInput" ${settingsDiscussionNotifications ? 'checked' : ''} />
            <span class="toggle-switch-slider"></span>
          </label>
        </div>

        <div class="notification-option-row">
          <div class="notification-option-details">
            <span class="notification-option-icon">🏷️</span>
            <div>
              <strong>Mentions & Activity</strong>
              <p>Notify me when I am mentioned or tagged in discussions.</p>
            </div>
          </div>
          <label class="toggle-switch-wrapper">
            <input type="checkbox" id="settingsMentionNotificationsInput" ${settingsMentionNotifications ? 'checked' : ''} />
            <span class="toggle-switch-slider"></span>
          </label>
        </div>

        <div class="notification-option-row">
          <div class="notification-option-details">
            <span class="notification-option-icon">👋</span>
            <div>
              <strong>Workspace Invites</strong>
              <p>Notify me when a new member joins or accepts an invite.</p>
            </div>
          </div>
          <label class="toggle-switch-wrapper">
            <input type="checkbox" id="settingsInviteNotificationsInput" ${settingsInviteNotifications ? 'checked' : ''} />
            <span class="toggle-switch-slider"></span>
          </label>
        </div>

        <div class="settings-save-footer">
          <button class="ghost" id="settingsCancelBtn" type="button">Cancel</button>
          <button class="primary" id="settingsSaveBtn" type="button" ${settingsSaveInProgress || !isDirty ? 'disabled' : ''}>
            ${settingsSaveInProgress ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </section>
    `,
    integrations: `
      <section class="settings-content-card" data-settings-panel="integrations">
        <h3>Integrations Marketplace</h3>
        <p>Connect Nexus with external collaboration, storage, and developer utilities.</p>
        
        <div class="integrations-grid">
          <article class="integration-card" data-integration-id="google-drive">
            <div class="integration-card-header">
              <div class="integration-icon-wrapper">📁</div>
              <span class="integration-status-badge coming-soon">Coming Soon</span>
            </div>
            <h4 class="integration-card-title">Google Drive</h4>
            <p class="integration-card-desc">Link documents, spreadsheets, and slides directly to workspace notes and files.</p>
            <div class="integration-card-footer">
              <button class="soft-button" style="padding: 4px 10px; font-size: 12px; height: auto;" type="button">Learn More</button>
            </div>
          </article>

          <article class="integration-card" data-integration-id="github">
            <div class="integration-card-header">
              <div class="integration-icon-wrapper">🐙</div>
              <span class="integration-status-badge coming-soon">Coming Soon</span>
            </div>
            <h4 class="integration-card-title">GitHub</h4>
            <p class="integration-card-desc">Connect pull requests, issues, and commit triggers to document tasks and milestones.</p>
            <div class="integration-card-footer">
              <button class="soft-button" style="padding: 4px 10px; font-size: 12px; height: auto;" type="button">Learn More</button>
            </div>
          </article>

          <article class="integration-card" data-integration-id="google-calendar">
            <div class="integration-card-header">
              <div class="integration-icon-wrapper">📅</div>
              <span class="integration-status-badge coming-soon">Coming Soon</span>
            </div>
            <h4 class="integration-card-title">Google Calendar</h4>
            <p class="integration-card-desc">Sync workspace tasks and event due dates directly to your Google Calendar.</p>
            <div class="integration-card-footer">
              <button class="soft-button" style="padding: 4px 10px; font-size: 12px; height: auto;" type="button">Learn More</button>
            </div>
          </article>

          <article class="integration-card" data-integration-id="notion">
            <div class="integration-card-header">
              <div class="integration-icon-wrapper">📓</div>
              <span class="integration-status-badge coming-soon">Coming Soon</span>
            </div>
            <h4 class="integration-card-title">Notion</h4>
            <p class="integration-card-desc">Import existing wiki pages and databases into Nexus document spaces.</p>
            <div class="integration-card-footer">
              <button class="soft-button" style="padding: 4px 10px; font-size: 12px; height: auto;" type="button">Learn More</button>
            </div>
          </article>

          <article class="integration-card" data-integration-id="slack">
            <div class="integration-card-header">
              <div class="integration-icon-wrapper">💬</div>
              <span class="integration-status-badge coming-soon">Coming Soon</span>
            </div>
            <h4 class="integration-card-title">Slack</h4>
            <p class="integration-card-desc">Publish real-time task updates and document replies to specific Slack channels.</p>
            <div class="integration-card-footer">
              <button class="soft-button" style="padding: 4px 10px; font-size: 12px; height: auto;" type="button">Learn More</button>
            </div>
          </article>

          <article class="integration-card" data-integration-id="lms-classroom">
            <div class="integration-card-header">
              <div class="integration-icon-wrapper">🎓</div>
              <span class="integration-status-badge coming-soon">Coming Soon</span>
            </div>
            <h4 class="integration-card-title">LMS Classroom</h4>
            <p class="integration-card-desc">Sync school classes, assignments, and files from Google Classroom or Canvas LMS.</p>
            <div class="integration-card-footer">
              <button class="soft-button" style="padding: 4px 10px; font-size: 12px; height: auto;" type="button">Learn More</button>
            </div>
          </article>
        </div>
      </section>
    `,
    security: `
      <section class="settings-content-card" data-settings-panel="security">
        <h3>Security Settings</h3>
        <p>Manage password updates, email verification, active sessions, and workspace lifecycle.</p>

        <div class="security-card">
          <div class="security-card-header">
            <h4>Account Credentials</h4>
          </div>
          <p>Change your password regularly to keep your account secure.</p>
          <button class="primary" data-tool="profile" type="button">Update Password & Profile</button>
        </div>

        <div class="security-card">
          <div class="security-card-header">
            <h4>Account Verification</h4>
          </div>
          <p>Ensure your recovery and communication channels are verified.</p>
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: var(--panel-soft); border-radius: var(--radius-md);">
            <div>
              <strong>Email Status</strong>
              <span style="display: block; font-size: 12px; color: var(--muted); margin-top: 2px;">${escapeHtml(state.user?.email || '')}</span>
            </div>
            <span style="font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 4px; background: rgba(16, 185, 129, 0.1); color: #10b981;">Verified</span>
          </div>
        </div>

        <div class="security-card">
          <div class="security-card-header">
            <h4>Active Devices & Sessions</h4>
          </div>
          <p>You are currently logged in to Nexus from these browser sessions.</p>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius-md);">
              <div>
                <strong style="font-size: 13px;">Chrome on Linux (Current session)</strong>
                <span style="display: block; font-size: 11px; color: var(--muted); margin-top: 2px;">IP: 192.168.1.45 · Active now</span>
              </div>
              <span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981;"></span>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius-md); opacity: 0.7;">
              <div>
                <strong style="font-size: 13px;">Safari on iPhone</strong>
                <span style="display: block; font-size: 11px; color: var(--muted); margin-top: 2px;">IP: 172.56.21.99 · Last active 2 hours ago</span>
              </div>
              <button class="ghost" style="padding: 2px 6px; font-size: 11px; height: auto;" type="button" onclick="showToast('Session revoked')">Revoke</button>
            </div>
          </div>
        </div>

        <div class="danger-zone-card">
          <h4>Danger Zone</h4>
          <p style="margin: 0 0 16px 0; font-size: 12px; color: var(--muted);">Irreversible actions concerning this workspace. Please proceed with caution.</p>
          
          <div class="danger-zone-row">
            <div>
              <strong style="font-size: 14px; font-weight: 600; color: var(--text);">Leave Workspace</strong>
              <p style="margin: 4px 0 0 0; font-size: 12px; color: var(--muted);">You will lose access to all notes, channels, tasks and conversations in this workspace.</p>
            </div>
            <button class="danger-button" id="settingsLeaveWorkspaceBtn" type="button" ${state.workspaces.length > 1 && !canOwnerManage ? '' : 'disabled'}>
              Leave Workspace
            </button>
          </div>

          <div class="danger-zone-row">
            <div>
              <strong style="font-size: 14px; font-weight: 600; color: var(--text);">Delete Workspace</strong>
              <p style="margin: 4px 0 0 0; font-size: 12px; color: var(--muted);">Permanently delete this workspace and all its data. This action is irreversible.</p>
            </div>
            <button class="danger-button" id="settingsDeleteWorkspaceBtn" type="button" ${state.workspaces.length > 1 && canOwnerManage ? '' : 'disabled'}>
              Delete Workspace
            </button>
          </div>
          ${canOwnerManage && state.workspaces.length <= 1 ? '<small style="color: #ef4444; font-size: 11px; margin-top: 8px; display: block;">You must have at least one other workspace to delete this one.</small>' : ''}
          ${!canOwnerManage ? '<small style="color: var(--muted); font-size: 11px; margin-top: 8px; display: block;">Only the workspace owner can delete this workspace.</small>' : ''}
          ${canOwnerManage && state.workspaces.length > 1 ? '' : !canOwnerManage && state.workspaces.length <= 1 ? '<small style="color: #ef4444; font-size: 11px; margin-top: 8px; display: block;">You must have at least one other workspace to leave this one.</small>' : ''}
        </div>
      </section>
    `
  };

  return panels[tab] || panels.general;
};


export const renderSettingsPage = () => {
  setMainMode('feature');
  setRouteChrome('settings');
  const workspace = selectedWorkspace();
  const tabs = [
    ['general', 'General'],
    ['appearance', 'Appearance'],
    ['notifications', 'Notifications'],
    ['integrations', 'Integrations'],
    ['security', 'Security']
  ];
  const tabIcons = {
    general: '⚙️',
    appearance: '🎨',
    notifications: '🔔',
    integrations: '🔌',
    security: '🔒'
  };
  els.routePage.innerHTML = `
    <div class="settings-page page-shell-v2">
      <header class="page-heading-v2">
        <div><h2>Settings</h2><p>Configure workspace preferences, account security, and collaboration tools.</p></div>
      </header>
      <div class="settings-layout">
        <nav class="settings-tabs">
          ${tabs.map(([id, label]) => `
            <button class="settings-nav-btn ${state.activeSettingsTab === id ? 'active' : ''}" data-settings-tab="${id}" type="button">
              <span class="settings-nav-btn-icon">${tabIcons[id] || '⚙️'}</span>
              <span>${label}</span>
            </button>
          `).join('')}
        </nav>
        <div class="settings-content-wrapper">
          ${renderSettingsContent(state.activeSettingsTab, workspace)}
        </div>
      </div>
    </div>
  `;
};


export const renderWorkspaceSettingsPage = async () => {
  setMainMode('feature');
  setRouteChrome('settings');
  const workspace = selectedWorkspace();
  if (!workspace) {
    els.routePage.innerHTML = emptyState({
      title: 'No workspace selected',
      body: 'Create or switch to a workspace before opening workspace settings.',
      action: 'Switch Workspace',
      actionId: 'emptyOpenWorkspaceSwitcherBtn',
      icon: '▣'
    });
    return;
  }

  const canManage = isCurrentUserWorkspaceAdmin(workspace);
  const canOwnerManage = isWorkspaceOwner(workspace);
  if (!state.demoMode && canManage) {
    pendingWorkspaceInvites = await request(`/api/invites/workspace/${state.selectedWorkspaceId}`).catch(() => []);
  } else {
    pendingWorkspaceInvites = [];
  }

  const members = workspace.members || [];
  const createdDate = workspace.createdAt ? new Date(workspace.createdAt).toLocaleDateString() : 'Not available';
  const inviteLink = `${location.origin}${location.pathname}#/invite`;
  const canDeleteWorkspace = state.workspaces.length > 1 && canOwnerManage;
  const deleteTarget = pendingWorkspaceDeleteId === workspace._id ? workspace : null;

  els.routePage.innerHTML = `
    <div class="workspace-settings-page page-shell-v2">
      <header class="page-heading-v2 workspace-settings-heading">
        <div>
          <p class="auth-kicker">Workspace Settings</p>
          <h2>${escapeHtml(workspace.name || 'Workspace')}</h2>
          <p>Manage workspace identity, access, invites, roles, and irreversible actions.</p>
        </div>
        <button class="soft-button" data-tool="workspaces" type="button">Switch Workspace</button>
      </header>

      <section class="workspace-settings-grid">
        <article class="workspace-settings-card workspace-general-card">
          <div class="settings-section-head">
            <div>
              <h3>General</h3>
              <p>Workspace identity and quick actions.</p>
            </div>
            <span class="role-pill">${canOwnerManage ? 'OWNER' : canManage ? 'ADMIN' : 'MEMBER'}</span>
          </div>
          <label>Workspace Name
            <input id="workspaceSettingsNameInput" value="${escapeHtml(workspace.name || '')}" ${canOwnerManage ? '' : 'readonly'} />
          </label>
          <label>Workspace Description
            <textarea id="workspaceSettingsDescriptionInput" readonly>Shared workspace for notes, projects, tasks, and discussions.</textarea>
          </label>
          <dl class="workspace-meta-grid">
            <div><dt>Created</dt><dd>${escapeHtml(createdDate)}</dd></div>
            <div><dt>Members</dt><dd>${members.length}</dd></div>
            <div><dt>Workspace ID</dt><dd>${escapeHtml(workspace._id || '')}</dd></div>
          </dl>
          <div class="workspace-settings-actions">
            <button class="primary" id="workspaceSettingsRenameBtn" type="button" ${canOwnerManage ? '' : 'disabled'}>Rename Workspace</button>
            <button class="ghost" id="copyWorkspaceIdBtn" type="button">Copy Workspace ID</button>
            <button class="ghost" id="copyInviteLinkBtn" type="button">Copy Invite Link</button>
          </div>
        </article>

        <article class="workspace-settings-card">
          <div class="settings-section-head">
            <div>
              <h3>Members</h3>
              <p>Change roles and remove people from this workspace.</p>
            </div>
          </div>
          <div class="workspace-members-table">
            <div class="workspace-members-head"><span>Member</span><span>Email</span><span>Role</span><span>Actions</span></div>
            ${members.map((member) => {
              const name = member.user?.username || member.user?.email || String(member.user || 'Member');
              const email = member.user?.email || '';
              const userId = memberUserId(member);
              const isOwner = isWorkspaceOwner(workspace, userId);
              const isSelf = userId === String(state.user?.id);
              return `
                <article class="workspace-member-row">
                  <div><span class="avatar-dot">${escapeHtml(getInitials(name))}</span><strong>${escapeHtml(name)}</strong></div>
                  <span>${escapeHtml(email)}</span>
                  <span>
                    ${isOwner ? '<span class="role-pill">OWNER</span>' : `
                      <select data-workspace-role-member="${userId}" ${canOwnerManage ? '' : 'disabled'}>
                        <option value="admin" ${member.role === 'admin' ? 'selected' : ''}>ADMIN</option>
                        <option value="member" ${member.role !== 'admin' ? 'selected' : ''}>MEMBER</option>
                      </select>
                    `}
                  </span>
                  <span>
                    <button class="ghost" data-remove-workspace-member="${userId}" type="button" ${canManage && !isOwner && !isSelf ? '' : 'disabled'}>Remove</button>
                  </span>
                </article>
              `;
            }).join('') || emptyState({ title: 'No members yet', body: 'Invite teammates to collaborate in this workspace.', icon: '◌' })}
          </div>
        </article>

        <article class="workspace-settings-card">
          <div class="settings-section-head">
            <div>
              <h3>Invite Member</h3>
              <p>Create invite links and review pending invitations.</p>
            </div>
          </div>
          <div class="workspace-invite-form">
            <input id="workspaceInviteEmailInput" placeholder="optional teammate email" />
            <select id="workspaceInviteRoleInput">
              <option value="viewer">VIEWER</option>
              <option value="member" selected>EDITOR</option>
              <option value="admin">ADMIN</option>
            </select>
            <button class="primary" id="workspaceInviteCreateBtn" type="button" ${canManage ? '' : 'disabled'}>Create Invite</button>
          </div>
          <div class="pending-invite-list">
            ${pendingWorkspaceInvites.length ? pendingWorkspaceInvites.map((invite) => `
              <article>
                <span><strong>${escapeHtml(invite.email)}</strong><small>${escapeHtml(String(invite.role || 'member').toUpperCase())} · Pending · ${invite.createdAt ? new Date(invite.createdAt).toLocaleDateString() : 'recent'}</small></span>
                <button class="ghost" data-revoke-invite-id="${invite._id || invite.id}" type="button" ${canManage ? '' : 'disabled'}>Revoke</button>
              </article>
            `).join('') : emptyState({ title: 'No pending invites', body: canManage ? 'Generated invites will appear here until accepted or revoked.' : 'Only admins can view and create invites.', icon: '◌' })}
          </div>
        </article>

        <article class="workspace-settings-card workspace-danger-zone">
          <div class="settings-section-head">
            <div>
              <h3>Danger Zone</h3>
              <p>This action cannot be undone.</p>
            </div>
          </div>
          <p>Deleting this workspace may remove all documents, tasks, threads, study materials, and workspace data.</p>
          <button class="danger-button" data-delete-workspace-id="${workspace._id}" type="button" ${canDeleteWorkspace ? '' : 'disabled'}>Delete Workspace</button>
          ${canOwnerManage && state.workspaces.length <= 1 ? '<small>You must have at least one workspace.</small>' : ''}
          ${!canOwnerManage ? '<small>Only the workspace owner can delete this workspace.</small>' : ''}
          ${deleteTarget ? `
            <div class="workspace-delete-confirm" role="alertdialog" aria-modal="true" aria-label="Delete workspace confirmation">
              <strong>Delete Workspace?</strong>
              <p>This action cannot be undone. All documents, tasks, threads and workspace data may be removed.</p>
              <p class="workspace-delete-target">${escapeHtml(deleteTarget.name)}</p>
              <div>
                <button class="ghost" data-cancel-workspace-delete type="button">Cancel</button>
                <button class="danger-button" data-confirm-workspace-delete="${deleteTarget._id}" type="button">Delete Workspace</button>
              </div>
            </div>
          ` : ''}
        </article>
      </section>
    </div>
  `;
};


