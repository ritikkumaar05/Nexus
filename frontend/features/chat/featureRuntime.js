let activeChatFeatureRuntime = null;

export const configureChatFeatureRuntime = (runtime) => {
  activeChatFeatureRuntime = runtime;
};

export const chatFeatureRuntime = () => {
  if (!activeChatFeatureRuntime) {
    throw new Error('Chat feature runtime has not been configured.');
  }

  return activeChatFeatureRuntime;
};
