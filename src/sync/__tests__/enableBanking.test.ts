import { describe, it, expect, vi } from 'vitest';
import { createEnableBankingProvider, isAllowedAuthUrl, MAX_TRANSACTION_PAGES } from '../providers/enableBanking';
import type { EbClient } from '../providers/enableBankingClient';
import type { ConnectedAccount, EnableBankingConnection } from '../types';

const psu = { ipAddress: '203.0.113.5', userAgent: 'Firefox' };

function fakeClient(overrides: Partial<EbClient> = {}): EbClient {
  return { get: vi.fn(), post: vi.fn(), delete: vi.fn(), ...overrides };
}

const account: ConnectedAccount = {
  accountUid: 'acc/1', dedupeId: 'acc/1', displayName: 'Current', last4: '1234', currency: 'GBP', startDate: '2026-09-01',
};
const connection: EnableBankingConnection = {
  connectionId: 'c1', provider: 'enable-banking', displayName: 'Lloyds', status: 'ACTIVE', consecutiveFailures: 0,
  accounts: [account], auth: { sessionId: 's1', consentValidUntil: '2027-01-01T00:00:00.000Z' },
  createdAt: 't', updatedAt: 't',
};

const booked = (ref: string) => ({
  entry_reference: ref, transaction_amount: { amount: '1.00', currency: 'GBP' },
  credit_debit_indicator: 'DBIT', booking_date: '2026-09-10', remittance_information: ['SHOP'],
});

describe('isAllowedAuthUrl', () => {
  it.each([
    ['https://tilisy.enablebanking.com/welcome?x=1', true],
    ['https://enablebanking.com/auth', true],
    ['http://tilisy.enablebanking.com/', false],
    ['https://enablebanking.com.evil.example/', false],
    ['https://evilenablebanking.com/', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isAllowedAuthUrl(url)).toBe(expected);
  });
});

describe('listBanks', () => {
  it('maps ASPSPs and defaults a missing consent validity to 90 days', async () => {
    const client = fakeClient({
      get: vi.fn(async () => ({
        aspsps: [
          { name: 'Lloyds Bank', country: 'GB', logo: 'https://x/logo.png', maximum_consent_validity: 15552000 },
          { name: 'Other', country: 'GB' },
        ],
      })),
    });
    const banks = await createEnableBankingProvider(client).listBanks('GB');
    expect(client.get).toHaveBeenCalledWith('/aspsps', { country: 'GB' });
    expect(banks).toEqual([
      { name: 'Lloyds Bank', country: 'GB', logo: 'https://x/logo.png', maximumConsentValiditySeconds: 15552000 },
      { name: 'Other', country: 'GB', logo: '', maximumConsentValiditySeconds: 7776000 },
    ]);
  });
});

describe('startAuth', () => {
  it('posts the authorisation request and returns the url', async () => {
    const client = fakeClient({ post: vi.fn(async () => ({ url: 'https://tilisy.enablebanking.com/a' })) });
    const url = await createEnableBankingProvider(client).startAuth({
      aspspName: 'Lloyds Bank', country: 'GB', state: 'state-1', redirectUrl: 'https://app.example/banks/callback',
      validUntil: '2027-03-01T00:00:00.000Z', psu,
    });
    expect(url).toBe('https://tilisy.enablebanking.com/a');
    expect(client.post).toHaveBeenCalledWith('/auth', {
      access: { valid_until: '2027-03-01T00:00:00.000Z' },
      aspsp: { name: 'Lloyds Bank', country: 'GB' },
      state: 'state-1',
      redirect_url: 'https://app.example/banks/callback',
      psu_type: 'personal',
    }, psu);
  });
});

describe('completeAuth', () => {
  it('maps the session and derives display names and last4', async () => {
    const client = fakeClient({
      post: vi.fn(async () => ({
        session_id: 'sess-1',
        access: { valid_until: '2027-03-01T00:00:00.000Z' },
        accounts: [
          { uid: 'u1', currency: 'GBP', name: 'Classic', account_id: { iban: 'GB33 BUKB 2020 1555 5555 55' } },
          { uid: 'u2', currency: 'GBP', product: 'Saver', account_id: { other: { identification: '30963212345678' } } },
          { uid: 'u3', currency: 'EUR' },
        ],
      })),
    });
    const session = await createEnableBankingProvider(client).completeAuth('code-1', psu);
    expect(client.post).toHaveBeenCalledWith('/sessions', { code: 'code-1' }, psu);
    expect(session).toEqual({
      sessionId: 'sess-1',
      consentValidUntil: '2027-03-01T00:00:00.000Z',
      accounts: [
        { accountUid: 'u1', displayName: 'Classic', last4: '5555', currency: 'GBP' },
        { accountUid: 'u2', displayName: 'Saver', last4: '5678', currency: 'GBP' },
        { accountUid: 'u3', displayName: 'Account', last4: '', currency: 'EUR' },
      ],
    });
  });

  it('rejects a malformed session', async () => {
    const client = fakeClient({ post: vi.fn(async () => ({ accounts: [] })) });
    await expect(createEnableBankingProvider(client).completeAuth('code', psu)).rejects.toMatchObject({ type: 'INVALID_RESPONSE' });
  });
});

describe('fetchTransactions', () => {
  it('follows continuation keys and normalises every page', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ transactions: [booked('a')], continuation_key: 'next' })
      .mockResolvedValueOnce({ transactions: [booked('b')] });
    const provider = createEnableBankingProvider(fakeClient({ get }));
    const result = await provider.fetchTransactions(connection, account, { from: '2026-09-01', to: '2026-09-13' }, { psu, deadline: 0 });
    expect(result.map(t => t.entryReference)).toEqual(['a', 'b']);
    expect(get).toHaveBeenNthCalledWith(1, '/accounts/acc%2F1/transactions',
      { date_from: '2026-09-01', date_to: '2026-09-13', transaction_status: 'BOOK' }, psu);
    expect(get.mock.calls[1][1]).toMatchObject({ continuation_key: 'next' });
  });

  it('fails rather than silently truncating after the page cap', async () => {
    const get = vi.fn(async () => ({ transactions: [], continuation_key: 'again' }));
    const provider = createEnableBankingProvider(fakeClient({ get }));
    await expect(provider.fetchTransactions(connection, account, { from: '2026-09-01', to: '2026-09-13' }, { deadline: 0 }))
      .rejects.toMatchObject({ type: 'INVALID_RESPONSE' });
    expect(get).toHaveBeenCalledTimes(MAX_TRANSACTION_PAGES);
  });

  it('rejects a response without a transactions array', async () => {
    const provider = createEnableBankingProvider(fakeClient({ get: vi.fn(async () => ({})) }));
    await expect(provider.fetchTransactions(connection, account, { from: 'a', to: 'b' }, { deadline: 0 }))
      .rejects.toMatchObject({ type: 'INVALID_RESPONSE' });
  });
});

describe('endSession', () => {
  it('deletes the session with an encoded id', async () => {
    const client = fakeClient();
    await createEnableBankingProvider(client).endSession('s/1');
    expect(client.delete).toHaveBeenCalledWith('/sessions/s%2F1');
  });
});
