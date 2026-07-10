let activeSettingsRuntime = null;

export const setSettingsRuntime = (runtime) => {
  activeSettingsRuntime = runtime;
  return activeSettingsRuntime;
};

export const settingsRuntime = () => {
  if (!activeSettingsRuntime) {
    throw new Error('Settings runtime has not been initialized.');
  }
  return activeSettingsRuntime;
};

export const createSettingsRuntime = ({
  state,
  settingsForm,
  selectedWorkspace,
  applyPreferences,
  persistPreferences,
  request,
  loadWorkspaces,
  renderSettingsPage,
  showToast
}) => {
  const syncSettingsFormState = (workspace) => {
    const preferences = state.preferences;
    settingsForm.workspaceName = workspace?.name || '';
    settingsForm.workspaceDescription = workspace ? (localStorage.getItem(`nexusWorkspaceDescription_${workspace._id}`) || 'Shared workspace for notes, projects, tasks, and discussions.') : '';
    settingsForm.theme = localStorage.getItem('theme') || preferences.theme || 'light';
    settingsForm.density = preferences.density || 'comfortable';
    settingsForm.reduceMotion = Boolean(preferences.reduceMotion);
    settingsForm.emailNotifications = preferences.emailNotifications !== false;
    settingsForm.taskNotifications = preferences.taskNotifications !== false;
    settingsForm.discussionNotifications = preferences.discussionNotifications !== false;
    settingsForm.mentionNotifications = preferences.mentionNotifications !== false;
    settingsForm.inviteNotifications = preferences.inviteNotifications !== false;
    settingsForm.saveInProgress = false;
  };

  const isSettingsDirty = () => {
    const workspace = selectedWorkspace();
    const preferences = state.preferences;
    if (state.activeSettingsTab === 'general') {
      const currentDesc = workspace ? (localStorage.getItem(`nexusWorkspaceDescription_${workspace._id}`) || 'Shared workspace for notes, projects, tasks, and discussions.') : '';
      return settingsForm.workspaceName !== (workspace?.name || '') ||
             settingsForm.workspaceDescription !== currentDesc;
    }
    if (state.activeSettingsTab === 'appearance') {
      return settingsForm.theme !== (preferences.theme || 'light') ||
             settingsForm.density !== (preferences.density || 'comfortable') ||
             settingsForm.reduceMotion !== Boolean(preferences.reduceMotion);
    }
    if (state.activeSettingsTab === 'notifications') {
      return settingsForm.emailNotifications !== (preferences.emailNotifications !== false) ||
             settingsForm.taskNotifications !== (preferences.taskNotifications !== false) ||
             settingsForm.discussionNotifications !== (preferences.discussionNotifications !== false) ||
             settingsForm.mentionNotifications !== (preferences.mentionNotifications !== false) ||
             settingsForm.inviteNotifications !== (preferences.inviteNotifications !== false);
    }
    return false;
  };

  const updateSaveButtonState = () => {
    const saveBtn = document.getElementById('settingsSaveBtn');
    if (saveBtn) {
      saveBtn.disabled = settingsForm.saveInProgress || !isSettingsDirty();
    }
  };

  const saveSettings = async () => {
    settingsForm.saveInProgress = true;
    updateSaveButtonState();

    try {
      const workspace = selectedWorkspace();
      if (state.activeSettingsTab === 'general') {
        if (state.demoMode) {
          showToast('Demo workspace settings are temporary.');
        } else if (workspace?._id) {
          if (!settingsForm.workspaceName) {
            showToast('Workspace name is required', true);
            settingsForm.saveInProgress = false;
            updateSaveButtonState();
            return;
          }
          await request(`/api/workspaces/${workspace._id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: settingsForm.workspaceName })
          });
          if (settingsForm.workspaceDescription) {
            localStorage.setItem(`nexusWorkspaceDescription_${workspace._id}`, settingsForm.workspaceDescription);
          }
          await loadWorkspaces();
        }
        showToast('Workspace profile saved');
      } else if (state.activeSettingsTab === 'appearance') {
        state.preferences.theme = settingsForm.theme;
        state.preferences.density = settingsForm.density;
        state.preferences.reduceMotion = settingsForm.reduceMotion;
        localStorage.setItem('theme', settingsForm.theme);
        persistPreferences();
        applyPreferences();
        showToast('Appearance preferences saved');
      } else if (state.activeSettingsTab === 'notifications') {
        state.preferences.emailNotifications = settingsForm.emailNotifications;
        state.preferences.taskNotifications = settingsForm.taskNotifications;
        state.preferences.discussionNotifications = settingsForm.discussionNotifications;
        state.preferences.mentionNotifications = settingsForm.mentionNotifications;
        state.preferences.inviteNotifications = settingsForm.inviteNotifications;
        persistPreferences();
        showToast('Notification preferences saved');
      }
    } catch (err) {
      showToast(err.message, true);
    } finally {
      settingsForm.saveInProgress = false;
      syncSettingsFormState(selectedWorkspace());
      renderSettingsPage();
    }
  };

  return {
    syncSettingsFormState,
    isSettingsDirty,
    updateSaveButtonState,
    saveSettings
  };
};
