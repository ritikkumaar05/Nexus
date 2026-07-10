export const createAccountSecurity = ({
  state,
  els,
  request
}) => {
  const refreshAccountSecurity = async () => {
    if (!state.token || state.demoMode) return null;
    state.accountSecurity.loading = true;
    state.accountSecurity.error = '';
    try {
      state.accountSecurity.data = await request('/api/account/security');
      state.accountSecurity.loaded = true;
      return state.accountSecurity.data;
    } catch (err) {
      state.accountSecurity.error = err.message || 'Security details could not be loaded.';
      throw err;
    } finally {
      state.accountSecurity.loading = false;
    }
  };

  const closeAccountSecurityModal = () => {
    document.getElementById('accountSecurityModal')?.remove();
  };

  const loadGoogleIdentityToken = async () => {
    const clientId = state.accountSecurity?.data?.google?.clientId || '';
    if (!clientId) {
      throw new Error('Google verification is not configured for account deletion.');
    }
    if (!globalThis.google?.accounts?.id) {
      await new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-google-identity]');
        if (existing) {
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', () => reject(new Error('Google verification could not be loaded.')), { once: true });
          return;
        }
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.dataset.googleIdentity = 'true';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Google verification could not be loaded.'));
        document.head.appendChild(script);
      });
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Google verification timed out. Please try again.'));
      }, 60000);
      globalThis.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          if (response?.credential) resolve(response.credential);
          else reject(new Error('Google verification did not return an identity token.'));
        }
      });
      globalThis.google.accounts.id.prompt((notification) => {
        if (settled) return;
        if (notification.isNotDisplayed?.() || notification.isSkippedMoment?.()) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error('Continue with Google to confirm your identity.'));
        }
      });
    });
  };

  const showAccountPasswordModal = (mode = 'set') => {
    const isChange = mode === 'change';
    closeAccountSecurityModal();
    els.routePage.insertAdjacentHTML('beforeend', `
      <div class="account-security-modal" id="accountSecurityModal" role="dialog" aria-modal="true" aria-label="${isChange ? 'Change password' : 'Set password'}">
        <form class="account-security-dialog" id="accountPasswordForm" data-password-mode="${isChange ? 'change' : 'set'}">
          <div class="account-security-dialog-head">
            <div>
              <strong>${isChange ? 'Change Password' : 'Set Password'}</strong>
              <small>${isChange ? 'Update your local password and revoke other sessions.' : 'Add email/password sign-in while keeping Google connected.'}</small>
            </div>
            <button class="ghost" data-account-security-close type="button">Close</button>
          </div>
          ${isChange ? `
            <label>Current Password
              <input id="accountCurrentPasswordInput" type="password" autocomplete="current-password" required />
            </label>
          ` : ''}
          <label>New Password
            <input id="accountNewPasswordInput" type="password" autocomplete="new-password" required minlength="8" />
          </label>
          <label>Confirm Password
            <input id="accountConfirmPasswordInput" type="password" autocomplete="new-password" required minlength="8" />
          </label>
          <p class="security-inline-state">Use at least 8 characters with uppercase, lowercase, and a number.</p>
          <div class="account-security-dialog-actions">
            <button class="ghost" data-account-security-close type="button">Cancel</button>
            <button class="primary" type="submit">${isChange ? 'Change Password' : 'Set Password'}</button>
          </div>
        </form>
      </div>
    `);
  };

  const showAccountDeleteModal = (step = 'primary') => {
    const security = state.accountSecurity?.data || {};
    const hasPassword = Boolean(security.password?.hasPassword ?? state.user?.hasPassword);
    closeAccountSecurityModal();
    const primaryMarkup = hasPassword ? `
      <label>Current Password
        <input id="accountDeletePasswordInput" type="password" autocomplete="current-password" required />
      </label>
    ` : `
      <p class="security-inline-state">Google-only accounts must verify their Google identity before receiving a deletion code.</p>
    `;
    const body = step === 'primary' ? `
      <form class="account-security-dialog" id="accountDeleteRequestForm">
        <div class="account-security-dialog-head">
          <div><strong>Delete Account</strong><small>Step 1 of 4: verify your identity.</small></div>
          <button class="ghost" data-account-security-close type="button">Close</button>
        </div>
        ${primaryMarkup}
        <div class="account-security-dialog-actions">
          <button class="ghost" data-account-security-close type="button">Cancel</button>
          <button class="danger-button" type="submit">${hasPassword ? 'Send OTP' : 'Continue with Google'}</button>
        </div>
      </form>
    ` : `
      <form class="account-security-dialog" id="accountDeleteConfirmForm">
        <div class="account-security-dialog-head">
          <div><strong>Final Account Deletion</strong><small>Steps 2-4: OTP, typed confirmation, final consent.</small></div>
          <button class="ghost" data-account-security-close type="button">Close</button>
        </div>
        <label>Email OTP
          <input id="accountDeleteOtpInput" inputmode="numeric" pattern="\\d{6}" maxlength="6" required />
        </label>
        <label>Type DELETE
          <input id="accountDeleteConfirmationInput" autocomplete="off" required />
        </label>
        <label class="settings-toggle-row account-final-confirm">
          <div>
            <span>This cannot be undone</span>
            <small>All sessions and account tokens will be invalidated.</small>
          </div>
          <input id="accountDeleteFinalInput" type="checkbox" required />
        </label>
        <div class="account-security-dialog-actions">
          <button class="ghost" data-account-security-close type="button">Cancel</button>
          <button class="danger-button" type="submit">Delete Account</button>
        </div>
      </form>
    `;
    els.routePage.insertAdjacentHTML('beforeend', `
      <div class="account-security-modal" id="accountSecurityModal" role="dialog" aria-modal="true" aria-label="Delete account">
        ${body}
      </div>
    `);
  };

  return {
    refreshAccountSecurity,
    closeAccountSecurityModal,
    loadGoogleIdentityToken,
    showAccountPasswordModal,
    showAccountDeleteModal
  };
};
