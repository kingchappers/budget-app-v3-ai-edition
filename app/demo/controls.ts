// What the banner can ask the running demo to do. startDemo() fills it in.
export const demoControls: { reset(): Promise<void> } = {
  reset: async () => {
    throw new Error('The demo has not started');
  },
};
