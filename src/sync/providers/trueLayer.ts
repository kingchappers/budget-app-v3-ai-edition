import { isRecord } from '../../api/body';
import type { SessionAccount } from '../accounts';
import { ProviderError } from '../errors';
import type { BankProvider, PsuContext, ProviderTransaction } from '../types';
import type { TlClient, TlEnvironment } from './trueLayerClient';

export const MAX_TRANSACTION_PAGES = 50;
export const MAX_STATUS_POLLS = 10;
export const STATUS_POLL_INTERVAL_MS = 2000;
// Unconfirmed item 9: the sandbox hosted-page host is inferred from the
// confirmed api/auth sandbox host naming pattern, not directly verified —
// confirm during the Phase 0.3 sandbox walkthrough.
const HOSTED_PAGE_HOSTS: Record<TlEnvironment, string> = {
  live: 'truelayer.com',
  sandbox: 'truelayer-sandbox.com',
};
// Unconfirmed item 4: placeholder terminal status name — confirm during
// Task 26 Step 1 against the sandbox and adjust the check below.
const CONNECTION_PENDING_STATUSES = new Set(['authorization_required', 'authorizing']);

export interface TlUserInfo {
  name: string;
}

export type TlAccount = SessionAccount;

export interface CreateConnectionInput {
  returnUri: string;
  state: string;
  psu: PsuContext;
}

export interface TrueLayerApi extends BankProvider {
  createConnection(input: CreateConnectionInput): Promise<{ providerConnectionId: string; hostedPageUrl: string }>;
  pollConnectionStatus(providerConnectionId: string): Promise<'PENDING' | 'READY' | 'FAILED'>;
  getUserInfo(providerConnectionId: string): Promise<TlUserInfo>;
  getAccounts(providerConnectionId: string): Promise<TlAccount[]>;
}

export interface TrueLayerProviderOptions {
  /** Selects the hosted-page host allowlist. Defaults to 'live'. */
  environment?: TlEnvironment;
  /** Injectable poll delay, mirroring TlClientOptions.sleep — defaults to a real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock used for the fetchTransactions deadline check — defaults to Date.now. */
  now?: () => number;
}

export function isAllowedHostedPageUrl(value: string, host: string = HOSTED_PAGE_HOSTS.live): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function invalid(what: string): ProviderError {
  return new ProviderError('INVALID_RESPONSE', `TrueLayer ${what} has an unexpected shape`);
}

function connectionIdHeader(providerConnectionId: string): Record<string, string> {
  return { 'Connection-Id': providerConnectionId };
}

// Unconfirmed item: `X-Device-User-Agent` is not sent — only `Tl-User-IP` is
// confirmed supported (see spec's Sync Algorithm section). Confirm the exact
// user-agent header name during the Phase 0.3 sandbox walkthrough before adding it.
function psuHeaders(psu: PsuContext | undefined): Record<string, string> {
  return psu ? { 'Tl-User-IP': psu.ipAddress } : {};
}

function lastFour(identifiers: unknown): string {
  if (!Array.isArray(identifiers)) return '';
  for (const raw of identifiers) {
    if (!isRecord(raw)) continue;
    const identifier = typeof raw.account_number === 'string' ? raw.account_number : typeof raw.iban === 'string' ? raw.iban : undefined;
    if (identifier) return identifier.replace(/\s/g, '').slice(-4);
  }
  return '';
}

function accountDisplayName(accountType: unknown): string {
  if (accountType === 'savings') return 'Savings Account';
  return 'Current Account';
}

function parseTlAccount(raw: unknown): TlAccount {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.currency !== 'string') throw invalid('connected account');
  return {
    accountUid: raw.id,
    displayName: accountDisplayName(raw.account_type),
    last4: lastFour(raw.account_identifiers),
    currency: raw.currency,
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normaliseTlTransaction(raw: unknown, startDate: string): ProviderTransaction | null {
  if (
    !isRecord(raw)
    || typeof raw.id !== 'string'
    || typeof raw.timestamp !== 'string'
    || typeof raw.currency !== 'string'
    || typeof raw.amount_in_minor !== 'number'
    || typeof raw.status !== 'string'
  ) {
    throw invalid('transaction');
  }

  if (raw.status !== 'settled') return null;
  if (raw.currency !== 'GBP') return null;

  const bookingDate = raw.timestamp.slice(0, 10);
  if (bookingDate < startDate) return null;

  const amountPence = Math.abs(raw.amount_in_minor);
  if (amountPence === 0) return null;

  const direction = raw.amount_in_minor < 0 ? 'OUT' : 'IN';
  const description = typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim().slice(0, 200) : 'Bank transaction';

  return {
    entryReference: raw.id,
    amountPence,
    direction,
    bookingDate,
    description,
    currency: raw.currency,
    fallbackBasis: [bookingDate, amountPence, direction, description].join('|'),
  };
}

export function createTrueLayerProvider(client: TlClient, options: TrueLayerProviderOptions = {}): TrueLayerApi {
  const hostedPageHost = HOSTED_PAGE_HOSTS[options.environment ?? 'live'];
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;

  return {
    id: 'truelayer',

    async createConnection(input) {
      const response = await client.post('/v3/data-connections', {
        scopes: ['info', 'accounts', 'balance', 'transactions'],
        data_access_type: 'recurring',
        authorization_flow: { redirect: { return_uri: input.returnUri } },
        user_consent: { state: input.state },
      }, psuHeaders(input.psu));

      if (!isRecord(response) || typeof response.id !== 'string' || !isRecord(response.hosted_page) || typeof response.hosted_page.uri !== 'string') {
        throw invalid('connection response');
      }
      if (!isAllowedHostedPageUrl(response.hosted_page.uri, hostedPageHost)) throw invalid('hosted page url');

      return { providerConnectionId: response.id, hostedPageUrl: response.hosted_page.uri };
    },

    async pollConnectionStatus(providerConnectionId) {
      const response = await client.get(`/v3/data-connections/${encodeURIComponent(providerConnectionId)}`, undefined, connectionIdHeader(providerConnectionId));
      if (!isRecord(response) || typeof response.status !== 'string') throw invalid('connection status response');
      if (response.status === 'failed') return 'FAILED';
      if (CONNECTION_PENDING_STATUSES.has(response.status)) return 'PENDING';
      // Unconfirmed item 2 (see spec): this is the one item that fails *open*, not
      // closed — any status we don't recognise as pending is treated as READY. Log
      // the raw value (not sensitive) so an unexpected terminal status surfaces
      // immediately during the sandbox walkthrough instead of silently 502ing.
      console.log('TrueLayer connection status not recognised as pending; treating as READY', { status: response.status });
      return 'READY';
    },

    async getUserInfo(providerConnectionId) {
      const response = await client.get(`/v3/data-connections/${encodeURIComponent(providerConnectionId)}/user-info`, undefined, connectionIdHeader(providerConnectionId));
      if (!isRecord(response) || typeof response.name !== 'string') throw invalid('user-info response');
      return { name: response.name };
    },

    async getAccounts(providerConnectionId) {
      const response = await client.get('/v3/connected-accounts', undefined, connectionIdHeader(providerConnectionId));
      if (!isRecord(response) || !Array.isArray(response.items)) throw invalid('connected accounts response');
      // Matches the transactions path's throw-don't-truncate convention: a second
      // page of connected accounts would otherwise be silently dropped, and a
      // dropped account means silently missing transactions forever.
      if (isRecord(response.pagination) && typeof response.pagination.next_cursor === 'string') {
        throw new ProviderError('INVALID_RESPONSE', 'TrueLayer connected accounts response is paginated, which is not supported');
      }
      return response.items.map(parseTlAccount);
    },

    async fetchTransactions(connection, account, window, ctx) {
      if (connection.provider !== 'truelayer') throw invalid('connection (not a TrueLayer connection)');
      const headers = { ...connectionIdHeader(connection.auth.providerConnectionId), ...psuHeaders(ctx.psu) };

      const createResponse = await client.post(`/v3/connected-accounts/${encodeURIComponent(account.accountUid)}/transactions/requests`, {
        from: window.from,
        to: window.to,
      }, headers);
      if (!isRecord(createResponse) || typeof createResponse.id !== 'string') throw invalid('transactions request response');
      const requestId = createResponse.id;

      const results: ProviderTransaction[] = [];
      let cursor: string | undefined;
      let pollCount = 0;

      for (let page = 0; page < MAX_TRANSACTION_PAGES; page++) {
        let statusResponse: unknown;
        for (;;) {
          const query = cursor ? { cursor } : undefined;
          statusResponse = await client.get(`/v3/connected-accounts/${encodeURIComponent(account.accountUid)}/transactions/requests/${encodeURIComponent(requestId)}`, query, headers);
          if (!isRecord(statusResponse) || typeof statusResponse.status !== 'string') throw invalid('transactions-request status response');
          if (statusResponse.status === 'completed') break;
          if (statusResponse.status === 'failed') throw invalid('transactions-request (failed)');
          pollCount += 1;
          if (pollCount >= MAX_STATUS_POLLS) throw new ProviderError('TRANSIENT', 'TrueLayer transactions request did not complete in time');
          if (ctx.deadline - now() < STATUS_POLL_INTERVAL_MS) {
            throw new ProviderError('TRANSIENT', 'TrueLayer transactions request would exceed the sync deadline');
          }
          await sleep(STATUS_POLL_INTERVAL_MS);
        }

        const page_ = statusResponse as Record<string, unknown>;
        if (!Array.isArray(page_.results)) throw invalid('transactions-request results');
        for (const raw of page_.results) {
          const transaction = normaliseTlTransaction(raw, account.startDate);
          if (transaction) results.push(transaction);
        }

        const pagination = page_.pagination;
        cursor = isRecord(pagination) && typeof pagination.next_cursor === 'string' ? pagination.next_cursor : undefined;
        if (!cursor) return results;
      }

      throw new ProviderError('INVALID_RESPONSE', `TrueLayer returned more than ${MAX_TRANSACTION_PAGES} pages`);
    },
  };
}
