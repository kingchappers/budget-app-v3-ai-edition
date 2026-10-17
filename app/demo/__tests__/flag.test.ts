import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('isDemo', () => {
  it('is false unless the demo build flag is exactly "true"', async () => {
    vi.stubEnv('VITE_DEMO', '');
    vi.resetModules();
    expect((await import('../flag')).isDemo).toBe(false);
    vi.stubEnv('VITE_DEMO', 'yes');
    vi.resetModules();
    expect((await import('../flag')).isDemo).toBe(false);
  });

  it('is true for the demo build', async () => {
    vi.stubEnv('VITE_DEMO', 'true');
    vi.resetModules();
    expect((await import('../flag')).isDemo).toBe(true);
  });
});
