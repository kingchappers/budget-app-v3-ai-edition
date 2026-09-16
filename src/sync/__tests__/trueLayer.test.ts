import { describe, it, expect, vi } from 'vitest';
import { createTrueLayerProvider, isAllowedHostedPageUrl, MAX_TRANSACTION_PAGES } from '../providers/trueLayer';
import type { TlClient } from '../providers/trueLayerClient';
import type { ConnectedAccount, Connection } from '../types';

const psu = { ipAddress: '203.0.113.5', userAgent: 'Firefox' };

function fakeClient(overrides: Partial<TlClient> = {}): TlClient {
  return { get: vi.fn(), post: vi.fn(), ...overrides };
}

const account: ConnectedAccount = {
  accountUid: 'acc-1', dedupeId: 'acc-1', displayName: 'Current', last4: '1234', currency: 'GBP', startDate: '2026-09-01',
};
const connection: Connection = {
  connectionId: 'c1', provider: 'truelayer', displayName: 'My Bank', status: 'ACTIVE', consecutiveFailures: 0,
  accounts: [account], auth: { providerConnectionId: 'tl-conn-1' },
  createdAt: 't', updatedAt: 't',
};

const settled = (id: string) => ({
  id, timestamp: '2026-09-10T00:00:00Z', description: 'TESCO STORES', currency: 'GBP',
  amount_in_minor: -350, status: 'settled',
});

describe('isAllowedHostedPageUrl', () => {
  it.each([
    ['https://payment.truelayer.com/pay', true],
    ['https://auth.truelayer.com/authorize', true],
    ['http://payment.truelayer.com/', false],
    ['https://truelayer.com.evil.example/', false],
    ['https://eviltruelayer.com/', false],
    ['not a url', false],
  ])('%s -> %s', (url, expected) => {
    expect(isAllowedHostedPageUrl(url)).toBe(expected);
  });
});

describe('createConnection', () => {
  it('posts the connection request and returns the provider connection id and hosted page url', async () => {
    const client = fakeClient({ post: vi.fn(async () => ({ id: 'tl-conn-1', status: 'authorization_required', hosted_page: { uri: 'https://payment.truelayer.com/x' } })) });
    const result = await createTrueLayerProvider(client).createConnection({ returnUri: 'https://app.example/banks/callback', state: 'state-1', psu });
    expect(result).toEqual({ providerConnectionId: 'tl-conn-1', hostedPageUrl: 'https://payment.truelayer.com/x' });
    expect(client.post).toHaveBeenCalledWith('/v3/data-connections', expect.objectContaining({
      scopes: ['info', 'accounts', 'balance', 'transactions'],
      data_access_type: 'recurring',
    }), undefined);
  });

  it('rejects a malformed response', async () => {
    const client = fakeClient({ post: vi.fn(async () => ({ status: 'authorization_required' })) });
    await expect(createTrueLayerProvider(client).createConnection({ returnUri: 'x', state: 's', psu })).rejects.toMatchObject({ type: 'INVALID_RESPONSE' });
  });

  it('rejects a hosted page url on a disallowed host', async () => {
    const client = fakeClient({ post: vi.fn(async () => ({ id: 'c1', status: 'authorization_required', hosted_page: { uri: 'https://evil.example/x' } })) });
    await expect(createTrueLayerProvider(client).createConnection({ returnUri: 'x', state: 's', psu })).rejects.toMatchObject({ type: 'INVALID_RESPONSE' });
  });
});

describe('pollConnectionStatus', () => {
  it('reports PENDING for authorization_required and authorizing', async () => {
    const client = fakeClient({ get: vi.fn(async () => ({ status: 'authorization_required' })) });
    await expect(createTrueLayerProvider(client).pollConnectionStatus('tl-conn-1')).resolves.toBe('PENDING');
  });

  it('reports READY once the connection leaves the pending states', async () => {
    const client = fakeClient({ get: vi.fn(async () => ({ status: 'authorized' })) });
    await expect(createTrueLayerProvider(client).pollConnectionStatus('tl-conn-1')).resolves.toBe('READY');
  });
});

describe('getUserInfo', () => {
  it('returns the account holder name', async () => {
    const client = fakeClient({ get: vi.fn(async () => ({ name: 'A. Person' })) });
    await expect(createTrueLayerProvider(client).getUserInfo('tl-conn-1')).resolves.toEqual({ name: 'A. Person' });
    expect(client.get).toHaveBeenCalledWith('/v3/data-connections/tl-conn-1/user-info', undefined, { 'Connection-Id': 'tl-conn-1' });
  });
});

describe('getAccounts', () => {
  it('maps connected accounts and derives last4 from sort-code-account-number or iban', async () => {
    const client = fakeClient({
      get: vi.fn(async () => ({
        items: [
          { id: 'a1', currency: 'GBP', account_type: 'current', account_identifiers: [{ type: 'sort_code_account_number', account_number: '12345678' }] },
          { id: 'a2', currency: 'GBP', account_type: 'savings', account_identifiers: [{ type: 'iban', iban: 'GB33 BUKB 2020 1555 5555 55' }] },
          { id: 'a3', currency: 'EUR', account_type: 'current', account_identifiers: [] },
        ],
        pagination: { next_cursor: null },
      })),
    });
    const accounts = await createTrueLayerProvider(client).getAccounts('tl-conn-1');
    expect(accounts).toEqual([
      { accountUid: 'a1', displayName: 'Current Account', last4: '5678', currency: 'GBP' },
      { accountUid: 'a2', displayName: 'Savings Account', last4: '5555', currency: 'GBP' },
      { accountUid: 'a3', displayName: 'Current Account', last4: '', currency: 'EUR' },
    ]);
  });
});

describe('fetchTransactions', () => {
  it('submits a request, polls until completed, and normalises settled transactions', async () => {
    const post = vi.fn(async () => ({ id: 'req-1', status: 'pending' }));
    const get = vi.fn()
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'completed', results: [settled('t1')], pagination: { next_cursor: 'p2' } })
      .mockResolvedValueOnce({ status: 'completed', results: [settled('t2')], pagination: { next_cursor: null } });
    const provider = createTrueLayerProvider(fakeClient({ post, get }));
    const result = await provider.fetchTransactions(connection, account, { from: '2026-09-01', to: '2026-09-13' }, { psu, deadline: Date.now() + 60_000 });
    expect(result.map(t => t.entryReference)).toEqual(['t1', 't2']);
    expect(post).toHaveBeenCalledWith('/v3/connected-accounts/acc-1/transactions/requests', { from: '2026-09-01', to: '2026-09-13' }, { 'Connection-Id': 'tl-conn-1' });
  });

  it('skips pending (unsettled) transactions', async () => {
    const post = vi.fn(async () => ({ id: 'req-1', status: 'pending' }));
    const get = vi.fn(async () => ({
      status: 'completed',
      results: [{ ...settled('t1'), status: 'pending' }, settled('t2')],
      pagination: { next_cursor: null },
    }));
    const provider = createTrueLayerProvider(fakeClient({ post, get }));
    const result = await provider.fetchTransactions(connection, account, { from: 'a', to: 'b' }, { deadline: Date.now() + 60_000 });
    expect(result.map(t => t.entryReference)).toEqual(['t2']);
  });

  it('derives direction and amount from the signed minor-unit amount', async () => {
    const post = vi.fn(async () => ({ id: 'req-1', status: 'pending' }));
    const get = vi.fn(async () => ({
      status: 'completed',
      results: [settled('debit'), { ...settled('credit'), amount_in_minor: 500 }],
      pagination: { next_cursor: null },
    }));
    const provider = createTrueLayerProvider(fakeClient({ post, get }));
    const [debit, credit] = await provider.fetchTransactions(connection, account, { from: 'a', to: 'b' }, { deadline: Date.now() + 60_000 });
    expect(debit).toMatchObject({ amountPence: 350, direction: 'OUT' });
    expect(credit).toMatchObject({ amountPence: 500, direction: 'IN' });
  });

  it('throws INVALID_RESPONSE when the transactions request itself fails', async () => {
    const post = vi.fn(async () => ({ id: 'req-1', status: 'pending' }));
    const get = vi.fn(async () => ({ status: 'failed' }));
    const provider = createTrueLayerProvider(fakeClient({ post, get }));
    await expect(provider.fetchTransactions(connection, account, { from: 'a', to: 'b' }, { deadline: Date.now() + 60_000 }))
      .rejects.toMatchObject({ type: 'INVALID_RESPONSE' });
  });

  it('throws TRANSIENT if the request never completes within the poll budget', async () => {
    const post = vi.fn(async () => ({ id: 'req-1', status: 'pending' }));
    const get = vi.fn(async () => ({ status: 'pending' }));
    const provider = createTrueLayerProvider(fakeClient({ post, get }));
    await expect(provider.fetchTransactions(connection, account, { from: 'a', to: 'b' }, { deadline: Date.now() + 60_000 }))
      .rejects.toMatchObject({ type: 'TRANSIENT' });
    expect(get).toHaveBeenCalledTimes(10); // MAX_STATUS_POLLS
  }, 20_000); // real STATUS_POLL_INTERVAL_MS delays between polls exceed the default test timeout

  it('fails rather than silently truncating after the page cap', async () => {
    const post = vi.fn(async () => ({ id: 'req-1', status: 'pending' }));
    const get = vi.fn(async () => ({ status: 'completed', results: [], pagination: { next_cursor: 'again' } }));
    const provider = createTrueLayerProvider(fakeClient({ post, get }));
    await expect(provider.fetchTransactions(connection, account, { from: 'a', to: 'b' }, { deadline: Date.now() + 60_000 }))
      .rejects.toMatchObject({ type: 'INVALID_RESPONSE' });
  });
});
