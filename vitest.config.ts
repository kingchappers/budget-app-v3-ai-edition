import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    passWithNoTests: true,
    // The suite runs several times slower on CI than on a laptop.
    testTimeout: 15000,
    projects: [
      {
        extends: true,
        test: {
          name: 'api',
          environment: 'node',
          include: ['src/**/__tests__/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'app',
          environment: 'jsdom',
          include: ['app/**/__tests__/**/*.test.{ts,tsx}'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
});
