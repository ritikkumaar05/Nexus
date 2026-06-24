// Lazily loaded route module. Shared shell bindings are exposed by app.js.
import '../styles/auth.css';
import logoUrl from '../logo.jpg';

const renderAuthBelowFoldSections = () => `
      <!-- Product Preview Area below hero -->
      <section class="preview-section" id="preview-section" aria-label="Nexus Dashboard Preview">
        <div class="section-header">
          <span class="eyebrow">Interactive Preview</span>
          <h2>Experience the calm study workspace.</h2>
          <p>A unified space for your documents, discussions, tasks, and real-time collaborative editing.</p>
        </div>

        <div class="product-preview-card">
          <div class="preview-window-bar">
            <div class="preview-dots">
              <span></span><span></span><span></span>
            </div>
            <div class="preview-search-bar">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <span>workspace-cs-final / home</span>
            </div>
          </div>
          <div class="preview-app-container">
            <!-- Sidebar Mock -->
            <div class="preview-sidebar">
              <div class="preview-sidebar-header">
                <div class="preview-logo-mark"><img src="${logoUrl}" alt="" /></div>
                <div>
                  <strong>CS Final Year</strong>
                  <small>3 online</small>
                </div>
              </div>
              <div class="preview-sidebar-nav">
                <div class="preview-nav-item active"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>Home</div>
                <div class="preview-nav-item"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>Documents</div>
                <div class="preview-nav-item"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Chat <span class="preview-badge">4</span></div>
                <div class="preview-nav-item"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>Tasks</div>
              </div>
              <div class="preview-sidebar-footer">
                <div class="preview-avatar">AK</div>
                <div>
                  <strong>Alex Kumar</strong>
                  <small>Demo user</small>
                </div>
              </div>
            </div>

            <!-- Document List mock -->
            <div class="preview-doc-list">
              <div class="preview-doc-list-header">
                <strong>DOCUMENTS</strong>
                <button>+</button>
              </div>
              <div class="preview-doc-item active">Lecture 04 Summary</div>
              <div class="preview-doc-item">Quiz Prep: Algorithms</div>
              <div class="preview-doc-item">Project Brainstorming</div>
              <div class="preview-doc-item">Study Guide: Networks</div>
            </div>

            <!-- Editor Mock -->
            <div class="preview-editor">
              <div class="preview-editor-header">
                <h3>Lecture 04 Summary</h3>
                <div class="preview-users-list">
                  <span style="background: #ef4444;">AK</span>
                  <span style="background: #10b981;">RD</span>
                  <span style="background: #3b82f6;">CS</span>
                </div>
              </div>
              <div class="preview-editor-body">
                <p><strong>Topic: Deep Neural Networks (Backpropagation)</strong></p>
                <p>Today we discussed the math behind backpropagation and how weight gradients are calculated relative to loss.</p>
                <div class="preview-collab-cursor">
                  <span class="cursor-bar" style="background: #10b981;"></span>
                  <span class="cursor-badge" style="background: #10b981;">Ronnie 👋</span>
                  <span class="cursor-text">Wait, can we summarize this with the AI helper?</span>
                </div>
                <div class="preview-task-chips">
                  <span class="task-chip completed"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Read paper</span>
                  <span class="task-chip"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/></svg> Generate quiz</span>
                </div>
              </div>
            </div>

            <!-- AI Assistant mock -->
            <div class="preview-ai-panel">
              <div class="preview-ai-header">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                <strong>Nexus AI Helper</strong>
              </div>
              <div class="preview-ai-chat">
                <div class="preview-bubble user">Summarize the backpropagation steps.</div>
                <div class="preview-bubble ai">
                  Here are the steps:
                  <ol>
                    <li>Forward pass to calculate loss.</li>
                    <li>Calculate local gradients.</li>
                    <li>Propagate errors backwards.</li>
                  </ol>
                  <button class="preview-ai-btn" type="button">Create 5 Flashcards</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Features Grid Section -->
      <section class="features-grid-section" id="features-section" aria-label="Nexus Features">
        <div class="section-header">
          <span class="eyebrow">Powerful Features</span>
          <h2>Everything you need to ace your courses.</h2>
          <p>Ditch the fragmented tools. Bring your study group, lecture notes, and AI assistance into one workspace.</p>
        </div>
        <div class="features-grid">
          <div class="feature-card">
            <div class="feature-icon-wrapper">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
            </div>
            <h3>Shared Notes</h3>
            <p>Organize all lecture, book, and project notes inside hierarchical workspaces accessible to your whole study team.</p>
          </div>

          <div class="feature-card">
            <div class="feature-icon-wrapper">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            </div>
            <h3>AI Summaries</h3>
            <p>Get instant summaries and study guides generated from your notes to help review complex concepts faster.</p>
          </div>

          <div class="feature-card">
            <div class="feature-icon-wrapper">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>
            </div>
            <h3>Quiz Generator</h3>
            <p>Turn raw notes into quizzes and flashcards to test your knowledge before exams, complete with progress tracking.</p>
          </div>

          <div class="feature-card">
            <div class="feature-icon-wrapper">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            </div>
            <h3>Team Workspaces</h3>
            <p>Create separate workspaces for different subjects, group projects, or research topics with custom member roles.</p>
          </div>

          <div class="feature-card">
            <div class="feature-icon-wrapper">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
            </div>
            <h3>Task Tracker</h3>
            <p>Manage project tasks, quiz deadlines, and study goals with inline checklists and assignee roles on shared cards.</p>
          </div>

          <div class="feature-card">
            <div class="feature-icon-wrapper">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <h3>Real-time Collaboration</h3>
            <p>Collaborate in real time with operational transformation-based editing, workspace presence lists, and live chat rooms.</p>
          </div>
        </div>
      </section>

      <!-- Final CTA Section -->
      <section class="final-cta-section" aria-label="Get Started CTA">
        <div class="final-cta-card">
          <h2>Build your study workspace in minutes.</h2>
          <p>Join thousands of students and teams using Nexus to study smarter, collaborate faster, and learn deeper.</p>
          <a class="hero-btn-primary" href="#/signup">Create your workspace</a>
        </div>
      </section>
`;

export const renderAuthPage = (mode) => {
  setMainMode('auth');
  state.authMode = mode;
  setRouteChrome(mode);
  const isSignup = mode === 'signup';
  const alternateAuthHref = isSignup ? '#/login' : '#/signup';
  const alternateAuthLabel = isSignup ? 'Login' : 'Create account';
  const primaryAuthHref = isSignup ? '#/signup' : '#/login';
  const primaryAuthLabel = isSignup ? 'Start free' : 'Sign in';
  els.routePage.innerHTML = `
    <div class="nexus-landing auth-page">
      <!-- Glow blobs -->
      <div class="landing-glow-blob blob-1"></div>
      <div class="landing-glow-blob blob-2"></div>

      <!-- Top Navbar -->
      <header class="landing-navbar">
        <div class="navbar-container">
          <a class="nexus-logo" href="#/workspace" aria-label="Nexus home">
            <span class="nexus-logo-mark">
              <img src="${logoUrl}" alt="" />
            </span>
            <span>Nexus</span>
          </a>
          <nav class="navbar-links">
            <a href="#features-section">Features</a>
            <a href="#preview-section">Dashboard</a>
            <button class="navbar-link-btn" data-try-demo type="button">Try Demo</button>
            <a href="${alternateAuthHref}" class="navbar-link-btn">${alternateAuthLabel}</a>
          </nav>
          <div class="navbar-actions">
            <a class="primary-nav-cta" href="${primaryAuthHref}">${primaryAuthLabel}</a>
          </div>
        </div>
      </header>

      <!-- Hero Section -->
      <div class="landing-hero-container">
        <div class="hero-content">
          <div class="hero-left">
            <div class="hero-badge">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
              <span>Built for modern student teams</span>
            </div>
            <h2 class="hero-headline">Your AI-powered workspace for collaborative learning.</h2>
            <p class="hero-subtext">
              Create shared notes, organize study rooms, track tasks, and turn lectures into summaries, quizzes, and flashcards.
            </p>
            <div class="hero-actions">
              <a class="hero-btn-primary" href="#/signup">Start free</a>
              <button class="hero-btn-secondary" data-try-demo type="button">Try demo workspace</button>
            </div>
            <div class="hero-trust">
              <div class="trust-item">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span>Real-time notes</span>
              </div>
              <div class="trust-item">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                <span>AI summaries</span>
              </div>
              <div class="trust-item">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                <span>Team workspaces</span>
              </div>
              <div class="trust-item">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>
                <span>Smart tasks</span>
              </div>
            </div>
            <div class="hero-proof-row" aria-label="Nexus highlights">
              <div>
                <strong>One workspace</strong>
                <span>Notes, tasks, threads, and AI</span>
              </div>
              <div>
                <strong>Zero setup</strong>
                <span>Try the demo before signing up</span>
              </div>
              <div>
                <strong>Team ready</strong>
                <span>Invite classmates into shared rooms</span>
              </div>
            </div>
          </div>

          <div class="hero-right">
            <!-- Auth Card Wrap -->
            <section class="auth-card-wrap" aria-label="${mode === 'signup' ? 'Create account' : 'Sign in'}">
              <form id="pageAuthForm" class="auth-card">
                <div class="auth-card-header">
                  <p class="auth-kicker">${mode === 'signup' ? 'Start free' : 'Welcome back'}</p>
                  <h2>${mode === 'signup' ? 'Create your account' : 'Sign in to Nexus'}</h2>
                  <p>${mode === 'signup' ? 'Set up your workspace and start collaborating in minutes.' : 'Continue to your notes, teams, and AI workspace.'}</p>
                </div>
                <div class="auth-value-strip" aria-label="Account benefits">
                  <span>Private workspace</span>
                  <span>No credit card</span>
                  <span>Demo available</span>
                </div>

                <div class="auth-fields">
                  ${mode === 'signup' ? `
                    <label class="auth-field" for="pageUsernameInput">
                      <span>Username</span>
                      <input id="pageUsernameInput" autocomplete="username" placeholder="Alex Kumar" />
                    </label>
                  ` : ''}
                  <label class="auth-field" for="pageEmailInput">
                    <span>Email address</span>
                    <input id="pageEmailInput" type="email" autocomplete="email" placeholder="you@university.edu" />
                  </label>
                  <label class="auth-field" for="pagePasswordInput">
                    <span>Password</span>
                    <input id="pagePasswordInput" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" placeholder="${mode === 'signup' ? 'Create a secure password' : 'Enter your password'}" />
                  </label>
                  ${mode === 'signup' ? `
                    <label class="auth-field" for="pageConfirmPasswordInput">
                      <span>Confirm password</span>
                      <input id="pageConfirmPasswordInput" type="password" autocomplete="new-password" placeholder="Repeat your password" />
                    </label>
                  ` : ''}
                </div>

                ${mode === 'signup' ? `
                  <div class="auth-password-hints" aria-label="Signup guidance">
                    <span>Use a password you do not reuse elsewhere.</span>
                    <span>Your first workspace is created after sign up.</span>
                  </div>
                ` : `
                  <div class="auth-return-hint">
                    Pick up where you left off with recent documents, tasks, and study threads.
                  </div>
                `}

                <div class="auth-row">
                  ${mode === 'signup' ? '' : '<a href="#/forgot-password" class="auth-link">Forgot password?</a>'}
                </div>

                <button id="pageAuthSubmit" type="submit" class="auth-submit">
                  <span>${mode === 'signup' ? 'Create account' : 'Continue'}</span>
                </button>

                <div class="auth-divider"><span>or continue with</span></div>

                <div class="auth-socials">
                  <button class="auth-social" type="button" disabled title="OAuth provider not connected yet">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" class="social-icon"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                    <span>Google</span>
                  </button>
                  <button class="auth-social" type="button" disabled title="OAuth provider not connected yet">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" class="social-icon"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
                    <span>GitHub</span>
                  </button>
                </div>

                <p class="auth-switch">
                  ${mode === 'signup' ? 'Already have an account?' : 'New to Nexus?'}
                  <a href="#/${mode === 'signup' ? 'login' : 'signup'}">${mode === 'signup' ? 'Sign in' : 'Create account'}</a>
                </p>
                <button class="demo-auth-link" data-try-demo type="button">Try the demo workspace instead</button>
              </form>
            </section>
          </div>
        </div>
      </div>
      ${renderAuthBelowFoldSections()}
    </div>
  `;
};

export const renderPasswordRecoveryPage = (mode = 'forgot-password') => {
  setMainMode('auth');
  setRouteChrome('');
  const token = routeQuery().get('token') || '';
  const isReset = mode === 'reset-password';

  els.routePage.innerHTML = `
    <div class="nexus-landing auth-page password-recovery-page">
      <!-- Glow blobs -->
      <div class="landing-glow-blob blob-1"></div>
      <div class="landing-glow-blob blob-2"></div>

      <!-- Top Navbar -->
      <header class="landing-navbar">
        <div class="navbar-container">
          <a class="nexus-logo" href="#/workspace" aria-label="Nexus home">
            <span class="nexus-logo-mark">
              <img src="${logoUrl}" alt="" />
            </span>
            <span>Nexus</span>
          </a>
          <nav class="navbar-links">
            <a href="#features-section">Features</a>
            <a href="#preview-section">Dashboard</a>
            <button class="navbar-link-btn" data-try-demo type="button">Try Demo</button>
            <a href="#/login" class="navbar-link-btn">Login</a>
          </nav>
          <div class="navbar-actions">
            <a class="primary-nav-cta" href="#/signup">Start Free</a>
          </div>
        </div>
      </header>

      <!-- Hero Section -->
      <div class="landing-hero-container">
        <div class="hero-content">
          <div class="hero-left">
            <div class="hero-badge">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
              <span>Built for modern student teams</span>
            </div>
            <h2 class="hero-headline">Your AI-powered workspace for collaborative learning.</h2>
            <p class="hero-subtext">
              Create shared notes, organize study rooms, track tasks, and turn lectures into summaries, quizzes, and flashcards.
            </p>
            <div class="hero-actions">
              <a class="hero-btn-primary" href="#/signup">Start free</a>
              <button class="hero-btn-secondary" data-try-demo type="button">Try demo workspace</button>
            </div>
            <div class="hero-trust">
              <div class="trust-item">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span>Real-time notes</span>
              </div>
              <div class="trust-item">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                <span>AI summaries</span>
              </div>
              <div class="trust-item">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                <span>Team workspaces</span>
              </div>
              <div class="trust-item">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>
                <span>Smart tasks</span>
              </div>
            </div>
          </div>

          <div class="hero-right">
            <!-- Auth Card Wrap -->
            <section class="auth-card-wrap" aria-label="${isReset ? 'Reset password' : 'Forgot password'}">
              <form id="${isReset ? 'pageResetPasswordForm' : 'pageForgotPasswordForm'}" class="auth-card">
                <div class="auth-card-header">
                  <p class="auth-kicker">${isReset ? 'Reset password' : 'Forgot password'}</p>
                  <h2>${isReset ? 'Create a new password' : 'Send reset instructions'}</h2>
                  <p>${isReset ? 'Paste your reset token and choose a stronger password.' : 'Enter your account email and Nexus will create a password reset token.'}</p>
                </div>

                <div class="auth-fields">
                  ${isReset ? `
                    <label class="auth-field" for="pageResetTokenInput">
                      <span>Reset token</span>
                      <input id="pageResetTokenInput" autocomplete="one-time-code" placeholder="Reset token" value="${escapeHtml(token)}" />
                    </label>
                    <label class="auth-field" for="pageNewPasswordInput">
                      <span>New password</span>
                      <input id="pageNewPasswordInput" type="password" autocomplete="new-password" placeholder="New password" />
                    </label>
                  ` : `
                    <label class="auth-field" for="pageForgotEmailInput">
                      <span>Email address</span>
                      <input id="pageForgotEmailInput" autocomplete="email" placeholder="Email address" />
                    </label>
                  `}
                </div>

                <button id="${isReset ? 'pageResetPasswordSubmit' : 'pageForgotPasswordSubmit'}" type="submit" class="auth-submit" style="margin-top: 24px;">
                  <span>${isReset ? 'Reset password' : 'Create reset token'}</span>
                </button>

                <div id="passwordRecoveryResult" class="password-recovery-result hidden"></div>

                <p class="auth-switch">
                  ${isReset ? 'Remembered your password?' : 'Already have a reset token?'}
                  <a href="#/${isReset ? 'login' : 'reset-password'}">${isReset ? 'Sign in' : 'Reset password'}</a>
                </p>
              </form>
            </section>
          </div>
        </div>
      </div>
    </div>
  `;
};
