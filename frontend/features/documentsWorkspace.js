// Lazily loaded route module. Shared shell bindings are exposed by app.js.
import '../styles/workspace.css';

export const renderWorkspacePage = () => {
  setMainMode('workspace', { documentWorkspace: true });
  setRouteChrome('workspace');
  els.routePage.innerHTML = '';
  activateContextTab('ai');
  // The route shell renders before workspace mode is activated. Render once
  // more after activation so an already-loaded document collection populates
  // the tree immediately instead of waiting for the next document mutation.
  render();
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

