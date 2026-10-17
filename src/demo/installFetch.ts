import type { DemoApi } from './api';

// The Fetch spec forbids any body, even an empty string, on these statuses.
const NULL_BODY_STATUSES: readonly number[] = [101, 103, 204, 205, 304];

export interface FetchHost {
  fetch: typeof fetch;
  location: { origin: string; href: string };
}

// Replaces fetch on the page: same-origin /config.json and /api/* calls are answered by the in-browser API, and everything else
// (the demo's own static files) goes to the original fetch. A request to another origin is never answered locally.
export function installDemoFetch(api: Pick<DemoApi, 'handles' | 'handle'>, host: FetchHost): void {
  const original = host.fetch.bind(host);
  host.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const target = new URL(raw, host.location.href);
    if (target.origin !== host.location.origin || !api.handles(target.pathname)) return original(input, init);

    const request = input instanceof Request ? new Request(input, init) : new Request(target.href, init);
    const requestBody = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
    const response = await api.handle({
      method: request.method,
      url: `${target.pathname}${target.search}`,
      headers: Object.fromEntries(request.headers.entries()),
      body: requestBody,
    });
    const body = NULL_BODY_STATUSES.includes(response.status) ? null : response.body;
    return new Response(body, { status: response.status, headers: response.headers });
  };
}
