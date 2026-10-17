// Replaced by a constant at build time: false in every build except `yarn build:demo`. Code guarded by it is removed from the others.
export const isDemo: boolean = import.meta.env.VITE_DEMO === 'true';
