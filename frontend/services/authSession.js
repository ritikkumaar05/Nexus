import { state, setDocuments } from '../state/store.js';
import { connectSocket, disconnectSocket, teardownYDoc } from './socket.js';
import { pendingInviteRoute } from './invites.js';
import { escapeHtml, friendlyUiMessage, isValidSignupUsername } from '../utils/text.js';

let authSessionRuntime = null;
let emailVerificationResendTimer = null;

export const configureAuthSessionRuntime = (runtime) => {
  authSessionRuntime = runtime;
};

const appRuntime = () => {
  if (!authSessionRuntime) {
    throw new Error('Auth session runtime has not been configured.');
  }

  return authSessionRuntime;
};

export const saveSession = ({ token, user, csrfToken }) => {
  state.token = token;
  state.user = user;
  state.csrfToken = csrfToken || state.csrfToken || '';
  localStorage.setItem('user', JSON.stringify(user));
  if (state.csrfToken) localStorage.setItem('csrfToken', state.csrfToken);
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
};

export const clearSession = () => {
  disconnectSocket();
  teardownYDoc();
  sessionStorage.removeItem('demoMode');
  state.demoMode = false;
  state.token = '';
  state.csrfToken = '';
  state.user = null;
  state.workspaces = [];
  state.channels = [];
  setDocuments([]);
  state.messages = [];
  state.documentMessages = [];
  state.workspaceThreads = [];
  appRuntime().tasks.resetTaskStore();
  state.studyMaterials = [];
  state.demoStudyMaterials = [];
  state.activityItems = [];
  state.typingUsers = [];
  state.lastAiAction = '';
  state.lastAiOutput = '';
  state.aiStructuredOutput = null;
  state.aiStudySession = null;
  state.pendingDoubtLinkedText = '';
  state.presence = [];
  state.selectedWorkspaceId = '';
  state.selectedChannelId = '';
  state.selectedDocumentId = '';
  localStorage.removeItem('token');
  localStorage.removeItem('csrfToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  localStorage.removeItem('workspaceId');
  localStorage.removeItem('channelId');
  localStorage.removeItem('documentId');
};

export const bootstrapAuthenticatedSession = async () => {
  try {
    await connectSocket();
  } catch (err) {
    console.warn('Realtime connection failed after sign in:', err.message);
  }

  try {
    await appRuntime().workspace.loadWorkspaces();
    if (state.token && !state.demoMode) await appRuntime().routes.renderRoute();
  } catch (err) {
    appRuntime().shell.render();
    appRuntime().shell.showToast(`Signed in, but workspace loading failed: ${err.message}`, true);
  }
};

export const completeAuthenticatedSession = (result) => {
  saveSession(result);
  appRuntime().shell.showToast('Signed in');
  appRuntime().routes.navigate(pendingInviteRoute() || 'home');
  void bootstrapAuthenticatedSession();
};

export const restoreSessionFromRefresh = async () => {
  if (state.token || !state.csrfToken) return false;

  try {
    const result = await appRuntime().data.request('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({})
    }, false);
    saveSession(result);
    return true;
  } catch (err) {
    state.csrfToken = '';
    localStorage.removeItem('csrfToken');
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    return false;
  }
};

export const completeOAuthCallback = async () => {
  const handoffToken = appRuntime().routes.routeQuery().get('token') || '';
  const error = appRuntime().routes.routeQuery().get('error') || '';

  if (error) {
    appRuntime().shell.showToast(error, true);
    appRuntime().routes.navigate('login');
    return false;
  }

  if (!handoffToken) {
    appRuntime().shell.showToast('Google sign-in could not be completed.', true);
    appRuntime().routes.navigate('login');
    return false;
  }

  try {
    const result = await appRuntime().data.request('/api/auth/google/complete', {
      method: 'POST',
      body: JSON.stringify({ token: handoffToken })
    }, false);
    completeAuthenticatedSession(result);
    return true;
  } catch (err) {
    appRuntime().shell.showToast(friendlyUiMessage(err.message, { isError: true }), true);
    appRuntime().routes.navigate('login');
    return false;
  }
};

export const handleLogout = async () => {
  if (state.demoMode) {
    clearSession();
    appRuntime().routes.navigate('login');
    await appRuntime().routes.renderRoute();
    appRuntime().shell.showToast('Exited demo workspace');
    return;
  }

  const logoutRequest = state.token
    ? appRuntime().data.request('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) })
    : Promise.resolve();

  clearSession();
  appRuntime().routes.navigate('login');
  await appRuntime().routes.renderRoute();
  appRuntime().shell.showToast('Logged out');
  logoutRequest.catch((err) => console.warn('Logout request failed:', err.message));
};

export const setPendingVerificationEmail = (email = '') => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (normalizedEmail) sessionStorage.setItem('nexusPendingVerificationEmail', normalizedEmail);
  else sessionStorage.removeItem('nexusPendingVerificationEmail');
};

export const startVerificationResendCountdown = (seconds = 60) => {
  window.clearInterval(emailVerificationResendTimer);
  const resendButtons = [
    document.getElementById('pageResendOtpInlineBtn'),
    document.getElementById('pageResendVerificationSubmit')
  ].filter(Boolean);
  const countdown = document.getElementById('verificationResendCountdown');
  let remaining = seconds;

  const renderCountdown = () => {
    resendButtons.forEach((button) => {
      button.disabled = remaining > 0;
      button.setAttribute('aria-disabled', remaining > 0 ? 'true' : 'false');
    });
    if (countdown) {
      countdown.classList.toggle('hidden', remaining <= 0);
      countdown.textContent = remaining > 0
        ? `You can resend OTP in ${remaining}s.`
        : 'You can resend OTP now.';
    }
  };

  renderCountdown();
  emailVerificationResendTimer = window.setInterval(() => {
    remaining -= 1;
    renderCountdown();
    if (remaining <= 0) {
      window.clearInterval(emailVerificationResendTimer);
      emailVerificationResendTimer = null;
    }
  }, 1000);
};

export const requestVerificationOtp = async (email, { startCountdown = true } = {}) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    appRuntime().shell.showToast('Enter the email address for your Nexus account.', true);
    return false;
  }
  await appRuntime().data.request('/api/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email: normalizedEmail })
  }, false);
  setPendingVerificationEmail(normalizedEmail);
  if (startCountdown) startVerificationResendCountdown(60);
  appRuntime().shell.showToast('If the account is unverified, a new OTP has been sent.');
  return true;
};

export const handleAuthRouteSubmit = async (event) => {
  const {
    clearInlineErrors,
    focusFirstInvalid,
    showInlineError,
    showToast
  } = appRuntime().shell;
  const { currentRoute, navigate } = appRuntime().routes;
  const { request } = appRuntime().data;

  if (event.target.id === 'pageForgotPasswordForm') {
    event.preventDefault();
    const submitButton = document.getElementById('pageForgotPasswordSubmit');
    const resultBox = document.getElementById('passwordRecoveryResult');

    try {
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.querySelector('span').textContent = 'Sending...';

      const result = await request('/api/auth/password/forgot', {
        method: 'POST',
        body: JSON.stringify({ email: document.getElementById('pageForgotEmailInput').value.trim() })
      }, false);

      resultBox.classList.remove('hidden');
      resultBox.innerHTML = `
        <strong>${escapeHtml(result.message || 'Password reset requested')}</strong>
        <p>Check your email for reset instructions.</p>
      `;
      showToast('Password reset email sent');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.querySelector('span').textContent = 'Send reset email';
      }
    }
    return true;
  }

  if (event.target.id === 'pageResetPasswordForm') {
    event.preventDefault();
    const submitButton = document.getElementById('pageResetPasswordSubmit');
    const resultBox = document.getElementById('passwordRecoveryResult');

    try {
      const resetToken = document.getElementById('pageResetTokenInput').value.trim();
      const newPassword = document.getElementById('pageNewPasswordInput').value;
      const confirmPassword = document.getElementById('pageConfirmNewPasswordInput').value;
      if (!resetToken) {
        throw new Error('Use the latest password reset link from your email.');
      }
      if (newPassword !== confirmPassword) {
        throw new Error('Passwords do not match.');
      }

      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.querySelector('span').textContent = 'Resetting...';

      await request('/api/auth/password/reset', {
        method: 'POST',
        body: JSON.stringify({
          token: resetToken,
          password: newPassword
        })
      }, false);

      document.getElementById('pageResetTokenInput').value = '';
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/reset-password`);
      resultBox.classList.remove('hidden');
      resultBox.innerHTML = `
        <strong>Password reset successful</strong>
        <p>You can now sign in with your new password.</p>
        <a class="primary" href="#/login">Back to login</a>
      `;
      showToast('Password reset successful');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.querySelector('span').textContent = 'Reset password';
      }
    }
    return true;
  }

  if (event.target.id === 'pageVerifyEmailForm') {
    event.preventDefault();
    const submitButton = document.getElementById('pageVerifyEmailSubmit');
    const resultBox = document.getElementById('emailVerificationResult');
    const emailInput = document.getElementById('pageVerifyEmailInput');
    const otpInput = document.getElementById('pageVerifyOtpInput');
    clearInlineErrors(event.target);

    const email = emailInput?.value.trim().toLowerCase() || '';
    const otp = otpInput?.value.trim() || '';
    let hasError = false;
    if (!email) {
      showInlineError(emailInput, 'Enter the email address you used to create your account.');
      hasError = true;
    } else if (!emailInput.validity.valid) {
      showInlineError(emailInput, 'Enter a valid email address.');
      hasError = true;
    }
    if (!/^\d{6}$/.test(otp)) {
      showInlineError(otpInput, 'Enter the 6-digit OTP from your email.');
      hasError = true;
    }
    if (hasError) {
      focusFirstInvalid(event.target);
      return true;
    }

    try {
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.querySelector('span').textContent = 'Verifying...';
      await request('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ email, otp })
      }, false);

      setPendingVerificationEmail('');
      window.clearInterval(emailVerificationResendTimer);
      resultBox.classList.remove('hidden');
      resultBox.innerHTML = `
        <strong>Email verified successfully</strong>
        <p>You can now sign in to Nexus.</p>
        <a class="primary" href="#/login">Back to login</a>
      `;
      showToast('Email verified successfully');
    } catch (err) {
      showToast(friendlyUiMessage(err.message, { isError: true }), true);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.querySelector('span').textContent = 'Verify OTP';
      }
    }
    return true;
  }

  if (event.target.id === 'pageResendVerificationForm') {
    event.preventDefault();
    const submitButton = document.getElementById('pageResendVerificationSubmit');
    const resultBox = document.getElementById('emailVerificationResult');
    const emailInput = document.getElementById('pageResendEmailInput');
    clearInlineErrors(event.target);

    const email = emailInput?.value.trim().toLowerCase() || '';
    if (!email) {
      showInlineError(emailInput, 'Enter the email address you used to create your account.');
      focusFirstInvalid(event.target);
      return true;
    }
    if (!emailInput.validity.valid) {
      showInlineError(emailInput, 'Enter a valid email address.');
      focusFirstInvalid(event.target);
      return true;
    }

    try {
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.querySelector('span').textContent = 'Sending...';
      const result = await request('/api/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email })
      }, false);
      setPendingVerificationEmail(email);
      startVerificationResendCountdown(60);

      resultBox.classList.remove('hidden');
      resultBox.innerHTML = `
        <strong>${escapeHtml(result.message || 'If the account is unverified, a new OTP has been sent.')}</strong>
        <p>Check your email for the latest 6-digit OTP.</p>
        <a class="primary" href="#/verify-email">Enter OTP</a>
      `;
      showToast('Verification OTP sent');
    } catch (err) {
      showToast(friendlyUiMessage(err.message, { isError: true }), true);
    } finally {
      if (submitButton) {
        if (!emailVerificationResendTimer) submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.querySelector('span').textContent = 'Resend verification OTP';
      }
    }
    return true;
  }

  if (event.target.id !== 'pageAuthForm') return false;
  event.preventDefault();
  if (state.demoMode) appRuntime().demo.exitDemoMode();

  const submitButton = document.getElementById('pageAuthSubmit');
  const form = event.target;
  clearInlineErrors(form);

  try {
    const mode = currentRoute() === 'signup' ? 'register' : 'login';
    const emailInput = document.getElementById('pageEmailInput');
    const passwordInput = document.getElementById('pagePasswordInput');
    const payload = {
      email: emailInput.value.trim(),
      password: passwordInput.value
    };
    let hasError = false;
    if (!payload.email) {
      showInlineError(emailInput, 'Enter the email address for your Nexus account.');
      hasError = true;
    } else if (!emailInput.validity.valid) {
      showInlineError(emailInput, 'Enter a valid email address.');
      hasError = true;
    }
    if (!payload.password) {
      showInlineError(passwordInput, 'Enter your password.');
      hasError = true;
    } else if (mode === 'register' && payload.password.length < 8) {
      showInlineError(passwordInput, 'Use at least 8 characters.');
      hasError = true;
    }
    if (mode === 'register') {
      const usernameInput = document.getElementById('pageUsernameInput');
      const confirmPasswordInput = document.getElementById('pageConfirmPasswordInput');
      const confirmPassword = confirmPasswordInput.value;
      payload.username = usernameInput.value.trim();
      if (!payload.username) {
        showInlineError(usernameInput, 'Choose a username for your profile.');
        hasError = true;
      } else if (!isValidSignupUsername(payload.username)) {
        showInlineError(usernameInput, 'Use 3-50 letters, numbers, underscores, or hyphens.');
        hasError = true;
      }
      if (payload.password !== confirmPassword) {
        showInlineError(confirmPasswordInput, 'Passwords do not match.');
        hasError = true;
      }
    }
    if (hasError) {
      focusFirstInvalid(form);
      showToast('Please fix the highlighted fields.', true);
      return true;
    }

    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
    submitButton.querySelector('span').textContent = mode === 'register' ? 'Creating account...' : 'Signing in...';

    const result = await request(`/api/auth/${mode}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (mode === 'register') {
      setPendingVerificationEmail(payload.email);
      showToast('Account created. Enter the OTP sent to your email.');
      navigate('verify-email');
      window.setTimeout(() => startVerificationResendCountdown(60), 0);
      return true;
    }
    completeAuthenticatedSession(result);
  } catch (err) {
    const message = friendlyUiMessage(err.message, { isError: true });
    showToast(message, true);
    const emailInput = document.getElementById('pageEmailInput');
    const passwordInput = document.getElementById('pagePasswordInput');
    const usernameInput = document.getElementById('pageUsernameInput');
    if (/username/i.test(message) && usernameInput) {
      showInlineError(usernameInput, message);
    } else if (/email|registered|credentials|password|sign in/i.test(message)) {
      showInlineError(/password/i.test(message) ? passwordInput : emailInput, message);
    }
    if (/verify your email/i.test(message) && emailInput?.value) {
      setPendingVerificationEmail(emailInput.value);
      let verifyAction = document.getElementById('authVerifyEmailAction');
      if (!verifyAction) {
        verifyAction = document.createElement('div');
        verifyAction.id = 'authVerifyEmailAction';
        verifyAction.className = 'password-recovery-result';
        submitButton?.insertAdjacentElement('afterend', verifyAction);
      }
      verifyAction.innerHTML = `
        <strong>Email verification required</strong>
        <p>Enter the OTP sent to ${escapeHtml(emailInput.value.trim())} to finish setup.</p>
        <a class="primary" href="#/verify-email">Verify Email</a>
      `;
    }
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.removeAttribute('aria-busy');
      submitButton.querySelector('span').textContent = currentRoute() === 'signup' ? 'Create account' : 'Continue';
    }
  }
  return true;
};

export const handleLegacyAuthFormSubmit = async (event) => {
  event.preventDefault();
  if (state.demoMode) appRuntime().demo.exitDemoMode();
  const {
    clearInlineErrors,
    els,
    focusFirstInvalid,
    showInlineError,
    showToast
  } = appRuntime().shell;
  const { navigate } = appRuntime().routes;
  const { request } = appRuntime().data;

  clearInlineErrors(event.target);
  try {
    const payload = {
      email: els.emailInput.value.trim(),
      password: els.passwordInput.value
    };
    let hasError = false;
    if (!payload.email) {
      showInlineError(els.emailInput, 'Enter your email address.');
      hasError = true;
    } else if (!els.emailInput.validity.valid) {
      showInlineError(els.emailInput, 'Enter a valid email address.');
      hasError = true;
    }
    if (!payload.password) {
      showInlineError(els.passwordInput, 'Enter your password.');
      hasError = true;
    } else if (state.authMode === 'register' && payload.password.length < 8) {
      showInlineError(els.passwordInput, 'Use at least 8 characters.');
      hasError = true;
    }
    if (state.authMode === 'register') {
      payload.username = els.usernameInput.value.trim();
      if (!payload.username) {
        showInlineError(els.usernameInput, 'Choose a username.');
        hasError = true;
      } else if (!isValidSignupUsername(payload.username)) {
        showInlineError(els.usernameInput, 'Use 3-50 letters, numbers, underscores, or hyphens.');
        hasError = true;
      }
    }
    if (hasError) {
      focusFirstInvalid(event.target);
      return showToast('Please fix the highlighted fields.', true);
    }

    const authButton = event.target.querySelector('button[type="submit"]');
    authButton.disabled = true;
    authButton.setAttribute('aria-busy', 'true');

    const mode = state.authMode === 'register' ? 'register' : 'login';
    const result = await request(`/api/auth/${mode}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (mode === 'register') {
      setPendingVerificationEmail(payload.email);
      showToast('Account created. Enter the OTP sent to your email.');
      navigate('verify-email');
      window.setTimeout(() => startVerificationResendCountdown(60), 0);
      return;
    }
    completeAuthenticatedSession(result);
  } catch (err) {
    const message = friendlyUiMessage(err.message, { isError: true });
    showToast(message, true);
    if (/username/i.test(message) && els.usernameInput) {
      showInlineError(els.usernameInput, message);
    } else if (/email|registered|credentials|password|sign in/i.test(message)) {
      showInlineError(/password/i.test(message) ? els.passwordInput : els.emailInput, message);
    }
    if (/verify your email/i.test(message) && els.emailInput?.value) {
      setPendingVerificationEmail(els.emailInput.value);
      navigate('verify-email');
    }
  } finally {
    const authButton = event.target.querySelector('button[type="submit"]');
    if (authButton) {
      authButton.disabled = false;
      authButton.removeAttribute('aria-busy');
    }
  }
};
