import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStore } from '../../store';
import { createSeededDemoApi, installDemoFetch } from '../index';
import type { FetchHost } from '../installFetch';

afterEach(() => setStore(undefined));

async function seededHost(): Promise<FetchHost> {
  const api = await createSeededDemoApi();
  const unreachable = vi.fn(async () => {
    throw new Error('the network must not be used');
  });
  const host: FetchHost = {
    fetch: unreachable as unknown as typeof fetch,
    location: { origin: 'https://demo.example.com', href: 'https://demo.example.com/' },
  };
  installDemoFetch(api, host);
  return host;
}

async function listThisMonth(host: FetchHost): Promise<{ transactionId: string }[]> {
  const now = new Date();
  const res = await host.fetch(`/api/transactions?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`);
  return ((await res.json()) as { transactions: { transactionId: string }[] }).transactions;
}

describe('deleting through the installed fetch', () => {
  it('deletes a transaction and answers 204', async () => {
    const host = await seededHost();
    const [first] = await listThisMonth(host);
    const yearMonth = new Date().toISOString().slice(0, 7);

    const res = await host.fetch(`/api/transactions/${yearMonth}/${first.transactionId}`, { method: 'DELETE' });

    expect(res.status).toBe(204);
    expect(res.ok).toBe(true);
    const ids = (await listThisMonth(host)).map(item => item.transactionId);
    expect(ids).not.toContain(first.transactionId);
  });

  it('deletes a target and answers 204', async () => {
    const host = await seededHost();
    const list = async (): Promise<{ categoryId: string }[]> =>
      ((await (await host.fetch('/api/targets')).json()) as { targets: { categoryId: string }[] }).targets;
    const [first] = await list();

    const res = await host.fetch(`/api/targets/${first.categoryId}`, { method: 'DELETE' });

    expect(res.status).toBe(204);
    expect(res.ok).toBe(true);
    expect((await list()).map(item => item.categoryId)).not.toContain(first.categoryId);
  });
});
