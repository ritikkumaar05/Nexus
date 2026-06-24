// Lazily loaded route module. Shared shell bindings are exposed by app.js.
import '../styles/workspace.css';

export const renderWorkspacePage = () => {
  setMainMode('workspace', { documentWorkspace: true });
  setRouteChrome('workspace');
  els.routePage.innerHTML = '';
  activateContextTab('ai');
};

const routeRuntime = {
  renderAuthPage,
  renderPasswordRecoveryPage,
  renderHomePage,
  renderChatPage,
  renderThreadsPage,
  renderTasksPage,
  renderMembersPage,
  renderSettingsPage,
  renderWorkspaceSettingsPage,
  renderWorkspacePage
};


