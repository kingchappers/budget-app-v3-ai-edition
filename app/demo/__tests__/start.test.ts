import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = window.fetch;

afterEach(() => {
  window.fetch = originalFetch;
  document.documentElement.removeAttribute('data-demo-build');
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.doUnmock('../../../src/demo');
  vi.resetModules();
});

describe('startDemoOrShowError', () => {
  it('shows a message, leaves fetch alone and resolves false when the backend cannot start', async () => {
    vi.doMock('../../../src/demo', () => ({
      DEMO_MARKER: 'marker',
      createSeededDemoApi: vi.fn().mockRejectedValue(new TypeError('secret detail')),
      installDemoFetch: vi.fn(),
    }));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { startDemoOrShowError } = await import('../start');

    expect(await startDemoOrShowError()).toBe(false);

    const alert = document.body.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('The demo could not start. Reload the page to try again.');
    expect(logged).toHaveBeenCalledWith('Could not start the demo:', 'TypeError');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('secret detail');
    expect(window.fetch).toBe(originalFetch);
  });

  it('takes over fetch, marks the page and resolves true on success', async () => {
    const takeover = vi.fn((): void => {
      window.fetch = vi.fn() as unknown as typeof window.fetch;
    });
    vi.doMock('../../../src/demo', () => ({
      DEMO_MARKER: 'marker',
      createSeededDemoApi: vi.fn().mockResolvedValue({ reset: vi.fn() }),
      installDemoFetch: takeover,
    }));
    const { startDemoOrShowError } = await import('../start');

    expect(await startDemoOrShowError()).toBe(true);

    expect(window.fetch).not.toBe(originalFetch);
    expect(document.documentElement.getAttribute('data-demo-build')).toBe('marker');
  });
});
