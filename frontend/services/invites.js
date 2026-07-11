import { selectedWorkspace, state } from '../state/store.js';
import { navigate } from './router.js';
import { escapeHtml } from '../utils/text.js';

let inviteRuntime = null;

export const configureInviteRuntime = (runtime) => {
  inviteRuntime = runtime;
};

const appRuntime = () => {
  if (!inviteRuntime) {
    throw new Error('Invite runtime has not been configured.');
  }

  return inviteRuntime;
};

export const inviteState = {
  latestCreatedInvite: null,
  activeJoinInvite: null,
  inviteRequestInFlight: false
};

export const formatInviteRole = (role = 'member') => ({
  admin: 'Admin',
  member: 'Editor',
  viewer: 'Viewer'
}[role] || String(role || 'Member'));

export const formatInviteExpiry = (expiresAt) => {
  if (!expiresAt) return 'Not available';
  return new Date(expiresAt).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
};

export const parseInviteInput = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return {};
  try {
    const parsedUrl = new URL(raw, location.origin);
    const token = parsedUrl.searchParams.get('token');
    const code = parsedUrl.searchParams.get('code');
    if (token) return { token };
    if (code) return { code: code.trim().toUpperCase() };
  } catch {
    // Plain token/code input falls through.
  }
  if (/^STUDY-[A-Z0-9]+$/i.test(raw)) return { code: raw.toUpperCase() };
  return { token: raw };
};

export const inviteCredentialQuery = (credential = {}) => {
  const params = new URLSearchParams();
  if (credential.code) params.set('code', credential.code);
  else if (credential.token) params.set('token', credential.token);
  return params.toString();
};

export const inviteCredentialStorageValue = (credential = {}) => JSON.stringify({
  token: credential.token || '',
  code: credential.code || ''
});

export const readPendingInviteCredential = () => {
  const value = localStorage.getItem('pendingInviteToken');
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed?.token || parsed?.code) return parsed;
  } catch {
    return { token: value };
  }
  return {};
};

export const storePendingInviteCredential = (credential = {}) => {
  localStorage.setItem('pendingInviteToken', inviteCredentialStorageValue(credential));
};

export const clearPendingInviteCredential = () => {
  localStorage.removeItem('pendingInviteToken');
};

export const inviteLinkForToken = (token = '') => `${location.origin}/join?token=${encodeURIComponent(token)}`;

export const pendingInviteRoute = () => {
  const credential = readPendingInviteCredential();
  const query = inviteCredentialQuery(credential);
  return query ? `invite?${query}` : '';
};

export const hydrateJoinRouteFromPath = () => {
  const isJoinPath = location.pathname.replace(/\/+$/, '') === '/join';
  if (!isJoinPath) return false;
  const params = new URLSearchParams(location.search);
  const token = params.get('token');
  const code = params.get('code');
  if (!token && !code) return false;
  const query = new URLSearchParams();
  if (token) query.set('token', token);
  if (code) query.set('code', code);
  location.hash = `#/invite?${query.toString()}`;
  return true;
};

export const renderInviteResultTool = (result = inviteState.latestCreatedInvite) => {
  inviteState.latestCreatedInvite = result;
  const invite = result?.invite || result?.invitation || {};
  const token = result?.token || invite.token || '';
  const code = result?.code || invite.code || '';
  const inviteLink = token ? inviteLinkForToken(token) : result?.inviteLink || '';
  const formattedRole = formatInviteRole(invite.role);
  const formattedExpiry = formatInviteExpiry(invite.expiresAt);

  appRuntime().shell.renderToolPanel(`
    <div class="tool-card invite-result-card">
      <div class="invite-success-box">
        <strong>Teammate invite ready!</strong>
        <p>Your workspace invitation is generated. Share the details below with your teammate.</p>
      </div>

      <div class="form-field-v2 invite-form-field">
        <label>Role</label>
        <div class="invite-meta-badge">${escapeHtml(formattedRole)}</div>
      </div>

      <div class="form-field-v2 invite-form-field">
        <label>Expires</label>
        <div class="invite-meta-badge secondary">${escapeHtml(formattedExpiry)}</div>
      </div>

      <div class="form-field-v2 invite-form-field">
        <label>Invite Link</label>
        <div class="invite-copy-row">
          <input readonly value="${escapeHtml(inviteLink)}" id="inviteResultLinkInput" />
          <button class="primary invite-copy-btn" data-copy-invite-link type="button">Copy Link</button>
        </div>
      </div>

      <div class="form-field-v2 invite-form-field">
        <label>Invite Code</label>
        <div class="invite-copy-row">
          <input class="invite-code-input" readonly value="${escapeHtml(code)}" id="inviteResultCodeInput" />
          <button class="ghost invite-copy-btn" data-copy-invite-code type="button">Copy Code</button>
        </div>
      </div>

      <div class="invite-modal-actions">
        <button class="ghost" id="inviteCloseBtn" type="button">Done</button>
      </div>
    </div>
  `, 'Teammate Invite', 'Send this link or code to your classmates to bring them into the workspace.');
};

export const renderJoinWorkspaceTool = ({ inputValue = '', preview = null, credential = null, error = '' } = {}) => {
  inviteState.activeJoinInvite = preview && credential ? { preview, credential } : null;
  const workspace = preview?.workspace || preview;
  const token = credential?.token || '';
  const code = credential?.code || '';

  appRuntime().shell.renderToolPanel(`
    <div class="tool-card join-workspace-card">
      ${error ? `
        <div class="invite-error-box">
          <strong>Could not load invite</strong>
          <p>${escapeHtml(error)}</p>
        </div>
      ` : ''}

      ${preview ? `
        <div class="invite-preview-box">
          <p class="invite-kicker">You've been invited to join</p>
          <h3>${escapeHtml(workspace?.name || 'Workspace')}</h3>
          ${workspace?.description ? `<p class="invite-desc">${escapeHtml(workspace.description)}</p>` : ''}
          <div class="invite-preview-meta">
            <div><dt>Role</dt><dd>${escapeHtml(formatInviteRole(preview.role))}</dd></div>
            <div><dt>Expires</dt><dd>${escapeHtml(formatInviteExpiry(preview.expiresAt))}</dd></div>
          </div>
        </div>
      ` : `
        <strong>Join Workspace</strong>
        <p>Enter an invite link or study code to gain access to a workspace.</p>
      `}

      <section class="join-workspace-form">
        ${inviteState.activeJoinInvite ? '' : `<input id="inviteTokenInput" value="${escapeHtml(token || code || inputValue)}" placeholder="Invite link, token, or STUDY code" />`}
        <button id="${inviteState.activeJoinInvite ? 'confirmJoinWorkspaceBtn' : 'previewInviteBtn'}" class="primary" type="button">${inviteState.activeJoinInvite ? 'Join Workspace' : 'Preview invite'}</button>
      </section>
    </div>
  `, preview ? 'Join workspace?' : 'Join Workspace', 'Accept a teammate invite');
  if (!preview) window.setTimeout(() => document.getElementById('joinWorkspaceInviteInput')?.focus(), 0);
};

export const showInviteMemberModal = () => {
  const workspace = selectedWorkspace();
  if (!workspace) return;
  
  const result = inviteState.latestCreatedInvite;
  let successHtml = '';
  
  if (result) {
    successHtml = `
      <div class="invite-success-box">
        <strong>Invite successfully created!</strong>
        <p>Copy the invite details below to share with your teammate.</p>
      </div>
      <div class="form-field-v2 invite-form-field">
        <label>Invite Link</label>
        <div class="invite-copy-row">
          <input readonly value="${escapeHtml(result.inviteLink)}" id="generatedInviteLinkInput" />
          <button class="primary invite-copy-btn" id="copyGeneratedInviteLinkBtn" type="button">Copy Link</button>
        </div>
      </div>
      <div class="form-field-v2 invite-form-field">
        <label>Invite Code</label>
        <div class="invite-copy-row">
          <input class="invite-code-input" readonly value="${escapeHtml(result.code)}" id="generatedInviteCodeInput" />
          <button class="ghost invite-copy-btn" id="copyGeneratedInviteCodeBtn" type="button">Copy Code</button>
        </div>
      </div>
    `;
  }
  
  appRuntime().shell.renderToolPanel(`
    <div class="tool-card invite-member-card">
      ${successHtml}
      
      <div class="form-field-v2 invite-form-field">
        <label for="inviteEmailInput">Teammate Email (Optional)</label>
        <input id="inviteEmailInput" placeholder="teammate@email.com" />
      </div>
      
      <div class="form-field-v2 invite-form-field">
        <label for="inviteRoleInput">Workspace Role</label>
        <select id="inviteRoleInput">
          <option value="viewer">Viewer</option>
          <option value="member" selected>Editor / Member</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      
      <div class="invite-modal-expiry">
        <span aria-hidden="true">⌁</span> Expiry: Invites automatically expire in 7 days.
      </div>
      
      <div class="invite-modal-actions">
        <button class="primary" id="inviteCreateSubmitBtn" type="button">Generate Invite</button>
        <button class="ghost" id="inviteCloseBtn" type="button">${result ? 'Done' : 'Cancel'}</button>
      </div>
      
      ${state.demoMode ? '<p class="muted-copy invite-demo-note">Demo members are sample collaborators. Sign up to invite your own team.</p>' : ''}
    </div>
  `, 'Invite Teammate', 'Invite classmates and collaborators to this study workspace.');
};

export const previewInviteCredential = async (credential) => {
  const query = inviteCredentialQuery(credential);
  if (!query) throw new Error('Paste an invite link or code first.');
  return appRuntime().data.request(`/api/invites/preview?${query}`, {}, false);
};

export const openJoinWorkspaceFlow = async (inputValue = '') => {
  const credential = parseInviteInput(inputValue);
  if (!credential.token && !credential.code) {
    renderJoinWorkspaceTool({ inputValue });
    return;
  }
  try {
    const preview = await previewInviteCredential(credential);
    if (!state.token) {
      storePendingInviteCredential(credential);
      const { closeToolPanel, showToast } = appRuntime().shell;
      closeToolPanel();
      showToast('Log in or create an account to join this workspace.');
      navigate('login');
      return;
    }
    renderJoinWorkspaceTool({ inputValue, preview, credential });
  } catch (err) {
    renderJoinWorkspaceTool({ inputValue, error: err.message || 'This invite link is invalid.' });
  }
};

export const acceptActiveInvite = async () => {
  const credential = inviteState.activeJoinInvite?.credential || readPendingInviteCredential();
  const { shell, data } = appRuntime();
  if (!credential.token && !credential.code) return shell.showToast('Paste an invite link or code first.', true);
  if (!state.token) {
    storePendingInviteCredential(credential);
    navigate('login');
    return shell.showToast('Log in or create an account to join this workspace.');
  }
  if (inviteState.inviteRequestInFlight) return;
  inviteState.inviteRequestInFlight = true;
  try {
    const result = await data.request('/api/invites/accept', {
      method: 'POST',
      body: JSON.stringify(credential)
    });
    clearPendingInviteCredential();
    const workspace = result.workspace || result;
    if (workspace?._id && !state.workspaces.some((item) => item._id === workspace._id)) {
      state.workspaces.push(workspace);
    }
    if (workspace?._id) {
      state.selectedWorkspaceId = workspace._id;
      localStorage.setItem('workspaceId', workspace._id);
    }
    shell.closeToolPanel();
    await data.loadWorkspaces();
    await data.bootstrapWorkspace();
    navigate('home');
    shell.showToast(`Joined ${workspace?.name || 'workspace'}`);
  } catch (err) {
    shell.showToast(err.message || 'Could not join workspace. Try again.', true);
  } finally {
    inviteState.inviteRequestInFlight = false;
  }
};
