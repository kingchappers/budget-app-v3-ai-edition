import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installDemoFetch, type FetchHost } from '../installFetch';

function makeHost(): { host: FetchHost; original: ReturnType<typeof vi.fn> } {
  const original = vi.fn(async () => new Response('from the network', { status: 200 }));
  const host = { fetch: original as unknown as typeof fetch, location: { origin: 'https://demo.example.com', href: 'https://demo.example.com/' } };
  return { host, original };
}

const api = {
  handles: (pathname: string): boolean => pathname === '/config.json' || pathname.startsWith('/api/'),
  handle: vi.fn(async (request: { method: string; url: string; body?: string }) => ({
    status: 201, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seen: request }),
  })),
};

type Seen = { seen: { method: string; url: string; body?: string } };

describe('installDemoFetch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('answers same-origin API calls locally, with the method, path, query and body', async () => {
    const { host, original } = makeHost();
    installDemoFetch(api, host);
    const res = await host.fetch('/api/transactions?year=2026&month=10', { method: 'POST', body: JSON.stringify({ a: 1 }) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { seen: { method: string; url: string; body: string } };
    expect(body.seen).toMatchObject({ method: 'POST', url: '/api/transactions?year=2026&month=10', body: '{"a":1}' });
    expect(original).not.toHaveBeenCalled();
  });

  it('passes other same-origin requests (static files) through to the network', async () => {
    const { host, original } = makeHost();
    installDemoFetch(api, host);
    await host.fetch('/assets/app.js');
    expect(original).toHaveBeenCalledTimes(1);
  });

  it('never answers, or forwards on behalf of, a request to another origin', async () => {
    const { host, original } = makeHost();
    installDemoFetch(api, host);
    await host.fetch('https://other.example.net/api/categories');
    expect(original).toHaveBeenCalledTimes(1);
    expect(api.handle).not.toHaveBeenCalled();
  });

  it('sends no body for GET requests', async () => {
    const { host } = makeHost();
    installDemoFetch(api, host);
    await host.fetch('/config.json');
    expect(api.handle).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'GET', body: undefined }));
  });

  it('answers a Request input locally with its method and body', async () => {
    const { host } = makeHost();
    installDemoFetch(api, host);
    const res = await host.fetch(new Request('https://demo.example.com/api/targets', { method: 'POST', body: '{"b":2}' }));
    expect(((await res.json()) as Seen).seen).toMatchObject({ method: 'POST', url: '/api/targets', body: '{"b":2}' });
  });

  it('keeps the method and body of a Request input when init only sets headers', async () => {
    const { host } = makeHost();
    installDemoFetch(api, host);
    const request = new Request('https://demo.example.com/api/targets', { method: 'PUT', body: '{"c":3}' });
    await host.fetch(request, { headers: { 'X-Test': '1' } });
    expect(api.handle).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'PUT', body: '{"c":3}' }));
  });

  it('handles a URL object input', async () => {
    const { host, original } = makeHost();
    installDemoFetch(api, host);
    await host.fetch(new URL('https://demo.example.com/api/accounts?x=1'));
    expect(api.handle).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'GET', url: '/api/accounts?x=1' }));
    expect(original).not.toHaveBeenCalled();
  });

  it('rejects, rather than swallowing, a Request whose body was already used', async () => {
    const { host } = makeHost();
    installDemoFetch(api, host);
    const request = new Request('https://demo.example.com/api/targets', { method: 'POST', body: 'x' });
    await request.text();
    await expect(host.fetch(request)).rejects.toThrow();
  });
});
