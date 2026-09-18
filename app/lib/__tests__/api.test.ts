import { describe, it, expect, vi } from 'vitest';
import { createApi } from '../api';

function setup(response: unknown = {}) {
  const request = vi.fn(async () => response);
  return { request, api: createApi(request) };
}

describe('bank and inbox API client', () => {
  it('encodes path segments', async () => {
    const { request, api } = setup();
    await api.disconnectBank('a/b');
    expect(request).toHaveBeenCalledWith('/api/banks/connections/a%2Fb', { method: 'DELETE' });
  });

  it('posts the connect request and returns the url and state', async () => {
    const { request, api } = setup({ url: 'https://auth.truelayer.com/x', state: 'state-1' });
    const result = await api.connectBank({ startDate: '2026-09-01' });
    expect(result).toEqual({ url: 'https://auth.truelayer.com/x', state: 'state-1' });
    expect(request).toHaveBeenCalledWith('/api/banks/connect', {
      method: 'POST', body: JSON.stringify({ startDate: '2026-09-01' }),
    });
  });

  it('includes connectionId when reconnecting an existing connection', async () => {
    const { request, api } = setup({ url: 'https://auth.truelayer.com/x', state: 'state-1' });
    await api.connectBank({ startDate: '2026-09-01', connectionId: 'conn-1' });
    expect(request).toHaveBeenCalledWith('/api/banks/connect', {
      method: 'POST', body: JSON.stringify({ startDate: '2026-09-01', connectionId: 'conn-1' }),
    });
  });

  it('returns the ready connection when the callback completes', async () => {
    const connection = { connectionId: 'c1' };
    const { request, api } = setup({ connection });
    const result = await api.completeBankCallback('state-1');
    expect(result).toEqual({ status: 'READY', connection });
    expect(request).toHaveBeenCalledWith('/api/banks/callback', {
      method: 'POST', body: JSON.stringify({ state: 'state-1' }),
    });
  });

  it('returns a pending status when the callback is still processing', async () => {
    const { api } = setup({ status: 'PENDING' });
    const result = await api.completeBankCallback('state-1');
    expect(result).toEqual({ status: 'PENDING' });
  });

  it('passes the inbox cursor as an encoded query parameter', async () => {
    const { request, api } = setup({ items: [] });
    await api.getInbox('abc+/=');
    expect(request).toHaveBeenCalledWith('/api/inbox?cursor=abc%2B%2F%3D');
  });

  it('confirms an inbox item by booking date and key', async () => {
    const { request, api } = setup({ transaction: { transactionId: 'k' } });
    await api.confirmInboxItem({ bookingDate: '2026-09-10', txnKey: 'k' }, { type: 'EXPENSE', categoryId: 'c' });
    expect(request).toHaveBeenCalledWith('/api/inbox/2026-09-10/k/confirm', {
      method: 'POST', body: JSON.stringify({ type: 'EXPENSE', categoryId: 'c' }),
    });
  });
});
