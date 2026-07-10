import { selectedWorkspace, state } from '../state/store.js';
import { settingsRuntime } from '../features/settings/runtime.js';

let routerRuntime = null;

export const configureRouterRuntime = (runtime) => {
  routerRuntime = runtime;
};

const appRoute = () => {
  if (!routerRuntime) {
    throw new Error('Router runtime has not been configured.');
  }
  return routerRuntime;
};

export const currentRoute = () => (location.hash.replace(/^#\/?/, '') || ((state.token || state.demoMode) ? 'home' : 'login')).split('?')[0];

export const routeQuery = () => {
  const query = location.hash.split('?')[1] || '';
  return new URLSearchParams(query);
};

export const navigate = (route) => {
  location.hash = `/${route}`;
};

// Native View Transitions can keep a non-interactive snapshot over visible routes in Chrome.
// Keep app route transitions opt-in so newly visible pages are clickable immediately.
const ROUTE_VIEW_TRANSITION_OPT_IN = new Set();

const shouldUseRouteViewTransition = (route) => (
  Boolean(document.startViewTransition) &&
  ROUTE_VIEW_TRANSITION_OPT_IN.has(route) &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

export const renderRoute = async () => {
  let routeAtStart = currentRoute();

  const runRouteUpdate = async () => {
    const route = currentRoute();
    routeAtStart = route;
    const runtime = appRoute();

    if (route === 'invite') {
      return runtime.routes.renderInvitePage();
    }

    if (state.demoMode && ['login', 'signup'].includes(route)) {
      runtime.demo.exitDemoMode();
    }

    if (!state.token && !state.demoMode && !['login', 'signup', 'forgot-password', 'reset-password', 'verify-email', 'resend-verification', 'oauth-callback'].includes(route)) {
      navigate('login');
      return false;
    }

    if (state.token && ['login', 'signup', 'forgot-password', 'reset-password', 'verify-email', 'resend-verification', 'oauth-callback'].includes(route)) {
      navigate('home');
      return false;
    }

    runtime.shell.render();

    if (route === 'login' || route === 'signup') {
      return runtime.auth.renderAuthPage(route);
    }

    if (route === 'forgot-password' || route === 'reset-password') {
      return runtime.auth.renderPasswordRecoveryPage(route);
    }

    if (route === 'verify-email' || route === 'resend-verification') {
      return runtime.auth.renderEmailVerificationPage(route);
    }

    if (route === 'oauth-callback') {
      runtime.auth.renderOAuthCallbackPage();
      return runtime.auth.completeOAuthCallback();
    }

    if (route === 'home') {
      return runtime.routes.renderHomePage();
    }

    if (route === 'chat') {
      return runtime.routes.renderChatPage();
    }

    if (route === 'threads') {
      runtime.data.loadWorkspaceThreads({
        limit: state.documents.length || 8,
        clear: !state.workspaceThreads.length
      }).catch((err) => runtime.shell.showToast(err.message, true));
      return runtime.routes.renderThreadsPage();
    }

    if (route === 'tasks') {
      runtime.data.loadDashboardTasks({ limit: state.documents.length }).then(() => {
        if (currentRoute() === 'tasks') runtime.routes.renderTasksBoard();
      });
      return runtime.routes.renderTasksPage();
    }

    if (route === 'members') {
      if (!state.demoMode && state.token && !state.workspaces.length) {
        await runtime.data.loadWorkspaces().catch((err) => runtime.shell.showToast(err.message, true));
      }
      return runtime.routes.renderMembersPage();
    }

    if (route === 'settings') {
      settingsRuntime().syncSettingsFormState(selectedWorkspace());
      return runtime.routes.renderSettingsPage();
    }

    if (route === 'workspace-settings') {
      return runtime.routes.renderWorkspaceSettingsPage();
    }

    if (route === 'workspace' || route === 'documents') {
      return runtime.routes.renderWorkspacePage();
    }

    navigate('home');
    return false;
  };

  const completeRouteUpdate = (result) => {
    appRoute().shell.resolveStartupSurface({
      routeAtStart,
      routeCompleted: result !== false
    });
    return result;
  };

  if (shouldUseRouteViewTransition(routeAtStart)) {
    let result;
    const transition = document.startViewTransition(async () => {
      result = await runRouteUpdate();
    });

    transition.ready?.catch(() => {});
    transition.finished?.catch(() => {});
    await transition.updateCallbackDone;
    return completeRouteUpdate(result);
  }

  const result = await runRouteUpdate();
  return completeRouteUpdate(result);
};

window.addEventListener('hashchange', () => {
  renderRoute().catch((err) => appRoute().shell.showToast(err.message, true));
});
