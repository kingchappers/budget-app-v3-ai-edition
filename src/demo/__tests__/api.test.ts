import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStore } from '../../store';
import { MemoryStore } from '../../store/memory';
import { DEMO_EMAIL, DEMO_USER_ID, createDemoApi, type Send } from '../api';
import { DEMO_MARKER } from '../marker';

afterEach(() => {
  setStore(undefined);
  vi.restoreAllMocks();
});

const json = (body: string): unknown => JSON.parse(body);

describe('createDemoApi', () => {
  it('answers /config.json as the local-login configuration', async () => {
    const api = await createDemoApi();
    const res = await api.handle({ method: 'GET', url: '/config.json' });
    expect(res.status).toBe(200);
    expect(json(res.body)).toEqual({ auth: 'local' });
  });

  it('claims only /config.json and /api/ paths', async () => {
    const api = await createDemoApi();
    expect(api.handles('/config.json')).toBe(true);
    expect(api.handles('/api/categories')).toBe(true);
    expect(api.handles('/assets/app.js')).toBe(false);
    expect(api.handles('/')).toBe(false);
  });

  it('shows the visitor as signed in and never asks for setup or recovery', async () => {
    const api = await createDemoApi();
    expect(json((await api.handle({ method: 'GET', url: '/api/auth/me' })).body)).toEqual({ userId: DEMO_USER_ID, email: DEMO_EMAIL });
    expect(json((await api.handle({ method: 'GET', url: '/api/auth/status' })).body)).toEqual({ setupRequired: false, recoveryOpen: false });
    expect((await api.handle({ method: 'POST', url: '/api/auth/logout', body: '{}' })).status).toBe(200);
    expect((await api.handle({ method: 'GET', url: '/api/auth/nope' })).status).toBe(404);
  });

  it('serves the real handlers: default categories, then a created transaction', async () => {
    const api = await createDemoApi();
    const categories = json((await api.handle({ method: 'GET', url: '/api/categories' })).body) as { categories: { categoryId: string }[] };
    expect(categories.categories.map(c => c.categoryId)).toContain('cat-groceries');

    const today = new Date().toISOString().slice(0, 10);
    const created = await api.send('POST', '/api/transactions', {
      amount: 1234, type: 'EXPENSE', categoryId: 'cat-groceries', description: 'Test shop', date: today,
    });
    expect(created.status).toBe(201);

    const [year, month] = today.split('-');
    const listed = json((await api.handle({ method: 'GET', url: `/api/transactions?year=${year}&month=${Number(month)}` })).body) as { transactions: { description: string }[] };
    expect(listed.transactions.map(t => t.description)).toContain('Test shop');
  });

  it('answers an unknown API route with 404 JSON', async () => {
    const api = await createDemoApi();
    const res = await api.handle({ method: 'GET', url: '/api/nope' });
    expect(res.status).toBe(404);
    expect(json(res.body)).toEqual({ error: 'Endpoint not found' });
  });

  it('turns a handler failure into a generic 500 and logs only the error name', async () => {
    const api = await createDemoApi();
    vi.spyOn(MemoryStore.prototype, 'query').mockRejectedValueOnce(new Error('secret detail'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await api.handle({ method: 'GET', url: '/api/categories' });
    expect(res.status).toBe(500);
    expect(json(res.body)).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret detail');
  });

  it('marks every response as coming from the demo', async () => {
    const api = await createDemoApi();
    for (const url of ['/config.json', '/api/auth/me', '/api/categories', '/api/nope']) {
      expect((await api.handle({ method: 'GET', url })).headers['X-Demo']).toBe(DEMO_MARKER);
    }
  });

  it('seeds a fresh store through the same send function the app uses', async () => {
    const seed = vi.fn(async (send: Send) => {
      await send('PUT', '/api/targets/cat-groceries', { targetAmount: 30000, period: 'MONTHLY' });
    });
    const api = await createDemoApi({ seed });
    expect(seed).toHaveBeenCalledTimes(1);

    const seeded = json((await api.send('GET', '/api/targets')).body) as { targets: unknown[] };
    expect(seeded.targets).toHaveLength(1);
  });

  it('refuses to start when the seed fails, naming the request but not the data', async () => {
    const failing = async (send: Send): Promise<void> => {
      const res = await send('PUT', '/api/targets/cat-groceries', { targetAmount: -1, period: 'MONTHLY' });
      if (res.status >= 400) throw new Error(`Demo seed: PUT /api/targets/{categoryId} answered ${res.status}`);
    };
    await expect(createDemoApi({ seed: failing })).rejects.toThrow('Demo seed');
  });
});
