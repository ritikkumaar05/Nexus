export const demoRuntime = {
  workspacePromise: null,
  workspaceModule: null
};

export const loadDemoWorkspaceModule = async () => {
  if (!demoRuntime.workspacePromise) {
    demoRuntime.workspacePromise = import('../demoWorkspace.js');
  }
  demoRuntime.workspaceModule = demoRuntime.workspaceModule || await demoRuntime.workspacePromise;
  return demoRuntime.workspaceModule;
};

export const requireDemoWorkspaceModule = () => {
  if (!demoRuntime.workspaceModule) {
    throw new Error('Demo workspace is still loading. Try again in a moment.');
  }
  return demoRuntime.workspaceModule;
};

export const demoAiResponse = (action) => {
  const { DEMO_AI_OUTPUTS } = requireDemoWorkspaceModule();
  const mappedAction = {
    'extract-tasks': 'exam',
    expand: 'explain',
    quiz: 'quiz',
    flashcards: 'flashcards',
    'simple-explanation': 'simple-explanation',
    'important-questions': 'important-questions'
  }[action] || action;
  return DEMO_AI_OUTPUTS[mappedAction] || DEMO_AI_OUTPUTS.summarize;
};
