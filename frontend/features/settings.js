import { selectedWorkspace, state } from '../state/store.js';
import { escapeHtml, getInitials } from '../utils/text.js';
import { membersRuntime } from './members/runtime.js';
import { settingsRuntime } from './settings/runtime.js';
import { settingsState } from './settings/state.js';
import { workspaceUiState } from './workspaces/state.js';

// Lazily loaded route module. Shared shell bindings are exposed by app.js.

export const renderSettingsContent = (tab, workspace) => {
  const memberRuntime = membersRuntime();
  const canManage = workspace ? memberRuntime.isCurrentUserWorkspaceAdmin(workspace) : false;
  const canOwnerManage = workspace ? memberRuntime.isWorkspaceOwner(workspace) : false;
  const isDirty = settingsRuntime().isSettingsDirty();
  const security = state.accountSecurity?.data || {};
  const password = security.password || {
    hasPassword: Boolean(state.user?.hasPassword),
    passwordChangedAt: state.user?.passwordChangedAt || null
  };
  const google = security.google || {
    connected: Boolean(state.user?.googleConnected || state.user?.authProvider === 'google')
  };
  const email = security.email || {
    address: state.user?.email || '',
    verified: Boolean(state.user?.emailVerified),
    verifiedAt: state.user?.emailVerifiedAt || null
  };
  const account = security.account || {
    createdAt: state.user?.createdAt || null
  };
  const metadataLoading = Boolean(state.accountSecurity?.loading && !state.accountSecurity?.loaded);
  const securityDate = (value) => value ? new Date(value).toLocaleString() : 'Not available';
  const metadataValue = (value) => value
    ? escapeHtml(securityDate(value))
    : metadataLoading
      ? '<span class="security-skeleton" aria-label="Loading"></span>'
      : 'Not available';

  const panels = {
    general: `
      <section class="settings-content-card" data-settings-panel="general">
        <div class="settings-panel-header">
          <h3>General Settings</h3>
          <p>Manage workspace identity, account profile, and workspace administration.</p>
        </div>

        <!-- Workspace Profile -->
        <div class="settings-section-card">
          <div class="settings-section-title">
            <div>
              <h4>Workspace Profile</h4>
              <p>Identity details visible to all workspace members.</p>
            </div>
          </div>
          <div class="settings-profile-row">
            <span class="workspace-avatar big">${escapeHtml(getInitials(settingsState.workspaceName || 'S'))}</span>
            <div class="settings-field" style="flex:1;">
              <label class="settings-field-label">Workspace Name</label>
              <input id="settingsWorkspaceNameInput" value="${escapeHtml(settingsState.workspaceName)}" ${canManage ? '' : 'readonly'} placeholder="Workspace Name" />
            </div>
          </div>
          <div class="settings-field">
            <label class="settings-field-label">Workspace Description</label>
            <textarea id="settingsWorkspaceDescriptionInput" ${canManage ? '' : 'readonly'} placeholder="Describe this workspace...">${escapeHtml(settingsState.workspaceDescription)}</textarea>
          </div>
          <div class="settings-meta-grid">
            <div class="settings-meta-item">
              <span class="settings-meta-label">Created</span>
              <span class="settings-meta-value">${workspace?.createdAt ? new Date(workspace.createdAt).toLocaleDateString() : 'N/A'}</span>
            </div>
            <div class="settings-meta-item">
              <span class="settings-meta-label">Members</span>
              <span class="settings-meta-value">${workspace?.members?.length || 1}</span>
            </div>
            <div class="settings-meta-item">
              <span class="settings-meta-label">Workspace ID</span>
              <div class="settings-meta-copy-row">
                <code>${workspace?._id || ''}</code>
                <button class="settings-meta-copy-btn" id="settingsCopyWorkspaceIdBtn" type="button">Copy</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Account Profile -->
        <div class="settings-section-card">
          <div class="settings-section-title">
            <div>
              <h4>Account Profile</h4>
              <p>Your personal account details and session.</p>
            </div>
          </div>
          <div class="settings-account-info-card">
            <div>
              <div class="account-name">${escapeHtml(state.user?.username || 'User')}</div>
              <div class="account-email">${escapeHtml(state.user?.email || '')}</div>
            </div>
            <button class="ghost" id="settingsSignOutBtn" style="color: #ef4444; border-color: color-mix(in srgb, #ef4444 30%, var(--line));" type="button">Sign Out</button>
          </div>
        </div>

        <!-- Workspace Administration -->
        <div class="settings-section-card">
          <div class="settings-section-title">
            <div>
              <h4>Workspace Administration</h4>
              <p>Manage members, invitations, roles, and advanced workspace tools.</p>
            </div>
          </div>
          <div>
            <button class="soft-button" data-route-go="workspace-settings" type="button">Manage Workspace Settings</button>
          </div>
        </div>

        <div class="settings-save-footer">
          <button class="ghost" id="settingsCancelBtn" type="button">Cancel</button>
          <button class="primary" id="settingsSaveBtn" type="button" ${settingsState.saveInProgress || !isDirty ? 'disabled' : ''}>
            ${settingsState.saveInProgress ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </section>
    `,
    appearance: `
      <section class="settings-content-card" data-settings-panel="appearance">
        <div class="settings-panel-header">
          <h3>Appearance</h3>
          <p>Control how Nexus feels while you read, write, and collaborate.</p>
        </div>

        <!-- Theme -->
        <div class="settings-section-card">
          <div class="settings-section-title">
            <div>
              <h4>Theme Preference</h4>
              <p>Select your interface theme or sync with system preferences.</p>
            </div>
          </div>
          <div class="theme-selector-grid">
            <div class="theme-select-card ${settingsState.theme === 'light' ? 'active' : ''}" data-theme-val="light">
              <span class="theme-card-icon">☀️</span>
              <strong>Light</strong>
              <span class="theme-card-desc">Sleek, bright palette</span>
            </div>
            <div class="theme-select-card ${settingsState.theme === 'dark' ? 'active' : ''}" data-theme-val="dark">
              <span class="theme-card-icon">🌙</span>
              <strong>Dark</strong>
              <span class="theme-card-desc">Deep, contrast palette</span>
            </div>
            <div class="theme-select-card ${settingsState.theme === 'system' ? 'active' : ''}" data-theme-val="system">
              <span class="theme-card-icon">🖥️</span>
              <strong>System</strong>
              <span class="theme-card-desc">Match device settings</span>
            </div>
          </div>
        </div>

        <!-- Density -->
        <div class="settings-section-card">
          <div class="settings-section-title">
            <div>
              <h4>Interface Density</h4>
              <p>Control the height and padding scale of workspace views.</p>
            </div>
          </div>
          <div class="settings-field">
            <label class="settings-field-label">Density Level</label>
            <select id="settingsDensitySelect">
              <option value="comfortable" ${settingsState.density === 'comfortable' ? 'selected' : ''}>Comfortable (default)</option>
              <option value="compact" ${settingsState.density === 'compact' ? 'selected' : ''}>Compact (high density)</option>
            </select>
          </div>
        </div>

        <!-- Reduce Motion -->
        <div class="settings-toggle-row">
          <div class="settings-toggle-left">
            <div class="settings-toggle-icon">✨</div>
            <div class="settings-toggle-info">
              <strong>Reduce Motion</strong>
              <p>Minimize hover lifts and animated transitions.</p>
            </div>
          </div>
          <label class="toggle-switch-wrapper">
            <input type="checkbox" id="settingsReduceMotionInput" ${settingsState.reduceMotion ? 'checked' : ''} />
            <span class="toggle-switch-slider"></span>
          </label>
        </div>

        <div class="settings-save-footer">
          <button class="ghost" id="settingsCancelBtn" type="button">Cancel</button>
          <button class="primary" id="settingsSaveBtn" type="button" ${settingsState.saveInProgress || !isDirty ? 'disabled' : ''}>
            ${settingsState.saveInProgress ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </section>
    `,
    notifications: `
      <section class="settings-content-card" data-settings-panel="notifications">
        <div class="settings-panel-header">
          <h3>Notifications</h3>
          <p>Choose which workspace events should ask for your attention.</p>
        </div>

        <div class="settings-section-card">
          <div class="settings-section-title">
            <div>
              <h4>Email &amp; In-App Alerts</h4>
              <p>Each notification can be individually toggled on or off.</p>
            </div>
          </div>

          <div class="settings-toggle-row">
            <div class="settings-toggle-left">
              <div class="settings-toggle-icon">📧</div>
              <div class="settings-toggle-info">
                <strong>Email Summaries</strong>
                <p>Receive weekly updates and digest summaries by email.</p>
              </div>
            </div>
            <label class="toggle-switch-wrapper">
              <input type="checkbox" id="settingsEmailNotificationsInput" ${settingsState.emailNotifications ? 'checked' : ''} />
              <span class="toggle-switch-slider"></span>
            </label>
          </div>

          <div class="settings-toggle-row">
            <div class="settings-toggle-left">
              <div class="settings-toggle-icon">📋</div>
              <div class="settings-toggle-info">
                <strong>Task Updates</strong>
                <p>Notify me when tasks are created, assigned, or completed.</p>
              </div>
            </div>
            <label class="toggle-switch-wrapper">
              <input type="checkbox" id="settingsTaskNotificationsInput" ${settingsState.taskNotifications ? 'checked' : ''} />
              <span class="toggle-switch-slider"></span>
            </label>
          </div>

          <div class="settings-toggle-row">
            <div class="settings-toggle-left">
              <div class="settings-toggle-icon">💬</div>
              <div class="settings-toggle-info">
                <strong>Discussion Replies</strong>
                <p>Notify me when teammates reply in document discussions.</p>
              </div>
            </div>
            <label class="toggle-switch-wrapper">
              <input type="checkbox" id="settingsDiscussionNotificationsInput" ${settingsState.discussionNotifications ? 'checked' : ''} />
              <span class="toggle-switch-slider"></span>
            </label>
          </div>

          <div class="settings-toggle-row">
            <div class="settings-toggle-left">
              <div class="settings-toggle-icon">🏷️</div>
              <div class="settings-toggle-info">
                <strong>Mentions &amp; Activity</strong>
                <p>Notify me when I am mentioned or tagged in discussions.</p>
              </div>
            </div>
            <label class="toggle-switch-wrapper">
              <input type="checkbox" id="settingsMentionNotificationsInput" ${settingsState.mentionNotifications ? 'checked' : ''} />
              <span class="toggle-switch-slider"></span>
            </label>
          </div>

          <div class="settings-toggle-row">
            <div class="settings-toggle-left">
              <div class="settings-toggle-icon">👋</div>
              <div class="settings-toggle-info">
                <strong>Workspace Invites</strong>
                <p>Notify me when a new member joins or accepts an invite.</p>
              </div>
            </div>
            <label class="toggle-switch-wrapper">
              <input type="checkbox" id="settingsInviteNotificationsInput" ${settingsState.inviteNotifications ? 'checked' : ''} />
              <span class="toggle-switch-slider"></span>
            </label>
          </div>
        </div>

        <div class="settings-save-footer">
          <button class="ghost" id="settingsCancelBtn" type="button">Cancel</button>
          <button class="primary" id="settingsSaveBtn" type="button" ${settingsState.saveInProgress || !isDirty ? 'disabled' : ''}>
            ${settingsState.saveInProgress ? 'Saving…' : 'Save Changes'}
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
        <div class="settings-panel-header">
          <h3>Security</h3>
          <p>Manage sign-in methods, account credentials, and permanent account actions.</p>
        </div>
        ${state.accountSecurity?.loading && !state.accountSecurity?.loaded ? '<p class="security-inline-state">Checking sign-in methods…</p>' : ''}
        ${state.accountSecurity?.error ? `<p class="security-inline-state error">${escapeHtml(state.accountSecurity.error)}</p>` : ''}

        <div class="security-cards-stack">

          <!-- Password -->
          <div class="security-card">
            <div class="security-card-header">
              <div class="security-card-title-group">
                <div class="security-card-icon-wrap">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                </div>
                <div>
                  <h4>Password</h4>
                  <p class="security-card-subtitle">Email &amp; password sign-in credentials</p>
                </div>
              </div>
              <span class="security-status-pill ${password.hasPassword ? 'ok' : 'warn'}">${password.hasPassword ? '\u2713 Enabled' : 'Not set'}</span>
            </div>
            <div class="security-card-body">
              ${password.hasPassword ? `
                <div class="security-field-row">
                  <span>Last changed</span>
                  <strong>${metadataValue(password.passwordChangedAt)}</strong>
                </div>
                <div class="security-password-mask">••••••••••••</div>
                <div class="security-card-actions">
                  <button class="primary" data-account-password-action="change" type="button">Change Password</button>
                </div>
              ` : `
                <p class="security-card-empty">No password set. Add one to enable email/password sign-in while keeping Google Sign-In active.</p>
                <div class="security-card-actions">
                  <button class="primary" data-account-password-action="set" type="button">Set Password</button>
                </div>
              `}
            </div>
          </div>

          <!-- Sign-In Methods -->
          <div class="security-card">
            <div class="security-card-header">
              <div class="security-card-title-group">
                <div class="security-card-icon-wrap">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                </div>
                <div>
                  <h4>Sign-In Methods</h4>
                  <p class="security-card-subtitle">Active authentication providers on your account</p>
                </div>
              </div>
            </div>
            <div class="security-card-body">
              <div class="security-method-grid">
                <div class="security-method-row">
                  <div class="security-method-info">
                    <span class="security-method-label">Google Account</span>
                    <small class="security-method-desc">Sign in with your Google profile</small>
                  </div>
                  <span class="security-status-pill ${google.connected ? 'ok' : ''}">${google.connected ? '\u2713 Connected' : 'Not connected'}</span>
                </div>
                <div class="security-method-row">
                  <div class="security-method-info">
                    <span class="security-method-label">Email Verified</span>
                    <small class="security-method-desc">${escapeHtml(email.address || 'No email on record')}</small>
                  </div>
                  <span class="security-status-pill ${email.verified ? 'ok' : 'warn'}">${email.verified ? '\u2713 Verified' : 'Unverified'}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Metadata -->
          <div class="security-card">
            <div class="security-card-header">
              <div class="security-card-title-group">
                <div class="security-card-icon-wrap">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                </div>
                <div>
                  <h4>Account Details</h4>
                  <p class="security-card-subtitle">Server-backed security metadata</p>
                </div>
              </div>
            </div>
            <div class="security-card-body">
              <div class="security-method-grid">
                <div class="security-method-row">
                  <div class="security-method-info">
                    <span class="security-method-label">Account Created</span>
                    <small class="security-method-desc">${metadataValue(account.createdAt)}</small>
                  </div>
                </div>
                <div class="security-method-row">
                  <div class="security-method-info">
                    <span class="security-method-label">Password Changed</span>
                    <small class="security-method-desc">${metadataValue(password.passwordChangedAt)}</small>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- Danger Zone -->
        <div class="danger-zone-card account-danger-zone">
          <div class="danger-zone-header">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <h4>Danger Zone</h4>
          </div>
          <p>Deleting your account is permanent. All owned workspaces, documents, tasks, threads, messages, AI history, sessions, and tokens will be removed.</p>
          <div class="danger-zone-row">
            <div>
              <strong>Delete Account</strong>
              <p>This cannot be undone. You will be signed out everywhere.</p>
            </div>
            <button class="danger-button" data-account-delete-start type="button">Delete Account</button>
          </div>
        </div>

      </section>
    `
  };

  return panels[tab] || panels.general;
};

const renderSecurityContentFromState = (workspace) => {
  if (state.activeSettingsTab !== 'security') return;
  const wrapper = document.querySelector('.settings-content-wrapper');
  if (!wrapper) return;
  wrapper.innerHTML = renderSettingsContent('security', workspace);
};

const loadSecurityOverviewInBackground = (workspace) => {
  if (state.activeSettingsTab !== 'security' || !state.token || state.demoMode) return;
  if (state.accountSecurity.loading) return;

  state.accountSecurity.loading = true;
  state.accountSecurity.error = '';
  renderSecurityContentFromState(workspace);

  request('/api/account/security')
    .then((data) => {
      state.accountSecurity.data = data;
      state.accountSecurity.loaded = true;
    })
    .catch((err) => {
      state.accountSecurity.error = err.message || 'Security details could not be loaded.';
    })
    .finally(() => {
      state.accountSecurity.loading = false;
      renderSecurityContentFromState(workspace);
    });
};

export const renderSettingsPage = async () => {
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
    general: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>`,
    appearance: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 10 10 0 1 1 0-20"/></svg>`,
    notifications: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    integrations: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect x="2" y="7" width="6" height="10" rx="1"/><rect x="16" y="7" width="6" height="10" rx="1"/><path d="M8 12h8"/></svg>`,
    security: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`
  };
  els.routePage.innerHTML = `
    <div class="settings-page">
      <header class="page-heading-v2">
        <div>
          <h2>Settings</h2>
          <p>Configure workspace preferences, account security, and collaboration tools.</p>
        </div>
      </header>
      <div class="settings-layout">
        <nav class="settings-sidebar">
          <span class="settings-nav-section-label">Account</span>
          ${tabs.slice(0,2).map(([id, label]) => `
            <button class="settings-nav-btn ${state.activeSettingsTab === id ? 'active' : ''}" data-settings-tab="${id}" type="button">
              <span class="settings-nav-btn-icon">${tabIcons[id]}</span>
              <span>${label}</span>
            </button>
          `).join('')}
          <span class="settings-nav-section-label">Workspace</span>
          ${tabs.slice(2).map(([id, label]) => `
            <button class="settings-nav-btn ${state.activeSettingsTab === id ? 'active' : ''}" data-settings-tab="${id}" type="button">
              <span class="settings-nav-btn-icon">${tabIcons[id]}</span>
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
  loadSecurityOverviewInBackground(workspace);
};


export const renderWorkspaceSettingsPage = async () => {
  const memberRuntime = membersRuntime();
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

  const canManage = memberRuntime.isCurrentUserWorkspaceAdmin(workspace);
  const canOwnerManage = memberRuntime.isWorkspaceOwner(workspace);
  if (!state.demoMode && canManage) {
    workspaceUiState.pendingWorkspaceInvites = await request(`/api/invites/workspace/${state.selectedWorkspaceId}`).catch(() => []);
  } else {
    workspaceUiState.pendingWorkspaceInvites = [];
  }

  const members = workspace.members || [];
  const createdDate = workspace.createdAt ? new Date(workspace.createdAt).toLocaleDateString() : 'Not available';
  const inviteLink = `${location.origin}${location.pathname}#/invite`;
  const canDeleteWorkspace = state.workspaces.length > 1 && canOwnerManage;
  const deleteTarget = workspaceUiState.pendingWorkspaceDeleteId === workspace._id ? workspace : null;

  els.routePage.innerHTML = `
    <div class="workspace-settings-page">
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
              const userId = memberRuntime.memberUserId(member);
              const isOwner = memberRuntime.isWorkspaceOwner(workspace, userId);
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
            ${workspaceUiState.pendingWorkspaceInvites.length ? workspaceUiState.pendingWorkspaceInvites.map((invite) => `
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
