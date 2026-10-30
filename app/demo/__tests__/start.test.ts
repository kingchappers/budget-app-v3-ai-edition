import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = window.fetch;

afterEach(() => {
  if (originalSecure) Object.defineProperty(window, 'isSecureContext', originalSecure);
  else Reflect.deleteProperty(window, 'isSecureContext');
  window.fetch = originalFetch;
  document.documentElement.removeAttribute('data-demo-build');
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.doUnmock('../../../src/demo');
  vi.resetModules();
});

const originalSecure = Object.getOwnPropertyDescriptor(window, 'isSecureContext');

function setSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', { value, configurable: true });
}

function mockFailingBackend(): void {
  vi.doMock('../../../src/demo', () => ({
    DEMO_MARKER: 'marker',
    createSeededDemoApi: vi.fn().mockRejectedValue(new TypeError('crypto.randomUUID is not a function')),
    installDemoFetch: vi.fn(),
  }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

describe('startDemoOrShowError', () => {
  it('shows a message, leaves fetch alone and resolves false when the backend cannot start', async () => {
    setSecureContext(true);
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
      createSeededDemoApi: vi.fn().mockResolvedValue({}),
      installDemoFetch: takeover,
    }));
    const { startDemoOrShowError } = await import('../start');

    expect(await startDemoOrShowError()).toBe(true);

    expect(window.fetch).not.toBe(originalFetch);
    expect(document.documentElement.getAttribute('data-demo-build')).toBe('marker');
  });

  it('asks for HTTPS when the page is not a secure context', async () => {
    setSecureContext(false);
    mockFailingBackend();
    const { startDemoOrShowError } = await import('../start');

    expect(await startDemoOrShowError()).toBe(false);

    expect(document.body.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      'The demo needs a secure connection (HTTPS). Open this page over HTTPS.',
    );
  });

  it('shows the generic message when the page is a secure context', async () => {
    setSecureContext(true);
    mockFailingBackend();
    const { startDemoOrShowError } = await import('../start');

    expect(await startDemoOrShowError()).toBe(false);

    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('The demo could not start. Reload the page to try again.');
  });
});
