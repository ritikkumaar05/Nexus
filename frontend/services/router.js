import { state } from '../state/store.js';

export const currentRoute = () => (location.hash.replace(/^#\/?/, '') || ((state.token || state.demoMode) ? 'home' : 'login')).split('?')[0];

export const routeQuery = () => {
  const query = location.hash.split('?')[1] || '';
  return new URLSearchParams(query);
};

export const navigate = (route) => {
  location.hash = `/${route}`;
};

export const renderRoute = async () => {
  let routeAtStart = currentRoute();

  const runRouteUpdate = async () => {
    const route = currentRoute();
    routeAtStart = route;

    if (route === 'invite') {
      return globalThis.renderInvitePage();
    }

    if (state.demoMode && ['login', 'signup'].includes(route)) {
      globalThis.exitDemoMode();
    }

    if (!state.token && !state.demoMode && !['login', 'signup', 'forgot-password', 'reset-password'].includes(route)) {
      navigate('login');
      return false;
    }

    if (state.token && ['login', 'signup', 'forgot-password', 'reset-password'].includes(route)) {
      navigate('home');
      return false;
    }

    globalThis.render();

    if (route === 'login' || route === 'signup') {
      return globalThis.renderAuthPage(route);
    }

    if (route === 'forgot-password' || route === 'reset-password') {
      return globalThis.renderPasswordRecoveryPage(route);
    }

    if (route === 'home') {
      return globalThis.renderHomePage();
    }

    if (route === 'chat') {
      return globalThis.renderChatPage();
    }

    if (route === 'threads') {
      await globalThis.loadWorkspaceThreads({
        limit: state.documents.length || 8,
        clear: !state.workspaceThreads.length
      }).catch((err) => globalThis.showToast(err.message, true));
      return globalThis.renderThreadsPage();
    }

    if (route === 'tasks') {
      globalThis.loadDashboardTasks({ limit: state.documents.length }).then(() => {
        if (currentRoute() === 'tasks') globalThis.renderTasksPage();
      });
      return globalThis.renderTasksPage();
    }

    if (route === 'members') {
      if (!state.demoMode && state.token && !state.workspaces.length) {
        await globalThis.loadWorkspaces().catch((err) => globalThis.showToast(err.message, true));
      }
      return globalThis.renderMembersPage();
    }

    if (route === 'settings') {
      globalThis.syncSettingsFormState(globalThis.selectedWorkspace());
      return globalThis.renderSettingsPage();
    }

    if (route === 'workspace-settings') {
      return globalThis.renderWorkspaceSettingsPage();
    }

    if (route === 'workspace' || route === 'documents') {
      return globalThis.renderWorkspacePage();
    }

    navigate('home');
    return false;
  };

  const completeRouteUpdate = (result) => {
    globalThis.resolveStartupSurface({
      routeAtStart,
      routeCompleted: result !== false
    });
    return result;
  };

  if (document.startViewTransition) {
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
  renderRoute().catch((err) => globalThis.showToast(err.message, true));
});
