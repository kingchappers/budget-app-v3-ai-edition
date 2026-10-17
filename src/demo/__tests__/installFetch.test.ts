import { describe, expect, it, vi } from 'vitest';
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

describe('installDemoFetch', () => {
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
    expect(api.handle).not.toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('other.example.net') }));
  });

  it('sends no body for GET requests', async () => {
    const { host } = makeHost();
    installDemoFetch(api, host);
    await host.fetch('/config.json');
    expect(api.handle).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'GET', body: undefined }));
  });
});
