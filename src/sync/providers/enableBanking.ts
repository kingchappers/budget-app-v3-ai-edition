import { isRecord } from '../../api/body';
import type { SessionAccount } from '../accounts';
import { ProviderError } from '../errors';
import type { BankProvider, PsuContext, ProviderTransaction } from '../types';
import type { EbClient } from './enableBankingClient';
import { normaliseEbTransaction } from './enableBankingNormalise';

export const MAX_TRANSACTION_PAGES = 50;
export const DEFAULT_CONSENT_SECONDS = 90 * 24 * 60 * 60;
const AUTH_HOST = 'enablebanking.com';

export interface EbBank {
  name: string;
  country: string;
  logo: string;
  maximumConsentValiditySeconds: number;
}

export interface EbSession {
  sessionId: string;
  consentValidUntil: string;
  accounts: SessionAccount[];
}

export interface StartAuthInput {
  aspspName: string;
  country: string;
  state: string;
  redirectUrl: string;
  validUntil: string;
  psu: PsuContext;
}

export interface EnableBankingApi extends BankProvider {
  listBanks(country: string): Promise<EbBank[]>;
  startAuth(input: StartAuthInput): Promise<string>;
  completeAuth(code: string, psu: PsuContext): Promise<EbSession>;
  endSession(sessionId: string): Promise<void>;
}

export function isAllowedAuthUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === AUTH_HOST || url.hostname.endsWith(`.${AUTH_HOST}`));
  } catch {
    return false;
  }
}

function invalid(what: string): ProviderError {
  return new ProviderError('INVALID_RESPONSE', `Enable Banking ${what} has an unexpected shape`);
}

function lastFour(accountId: unknown): string {
  if (!isRecord(accountId)) return '';
  const other = isRecord(accountId.other) ? accountId.other.identification : undefined;
  const identifier = typeof accountId.iban === 'string' ? accountId.iban : other;
  return typeof identifier === 'string' ? identifier.replace(/\s/g, '').slice(-4) : '';
}

function parseSessionAccount(raw: unknown): SessionAccount {
  if (!isRecord(raw) || typeof raw.uid !== 'string' || typeof raw.currency !== 'string') throw invalid('session account');
  const name = typeof raw.name === 'string' && raw.name ? raw.name : undefined;
  const product = typeof raw.product === 'string' && raw.product ? raw.product : undefined;
  return { accountUid: raw.uid, displayName: name ?? product ?? 'Account', last4: lastFour(raw.account_id), currency: raw.currency };
}

export function createEnableBankingProvider(client: EbClient): EnableBankingApi {
  return {
    id: 'enable-banking',

    async listBanks(country) {
      const response = await client.get('/aspsps', { country });
      if (!isRecord(response) || !Array.isArray(response.aspsps)) throw invalid('ASPSP list');
      return response.aspsps.filter(isRecord).flatMap(bank => {
        if (typeof bank.name !== 'string' || typeof bank.country !== 'string') return [];
        return [{
          name: bank.name,
          country: bank.country,
          logo: typeof bank.logo === 'string' ? bank.logo : '',
          maximumConsentValiditySeconds: typeof bank.maximum_consent_validity === 'number'
            ? bank.maximum_consent_validity
            : DEFAULT_CONSENT_SECONDS,
        }];
      });
    },

    async startAuth(input) {
      const response = await client.post('/auth', {
        access: { valid_until: input.validUntil },
        aspsp: { name: input.aspspName, country: input.country },
        state: input.state,
        redirect_url: input.redirectUrl,
        psu_type: 'personal',
      }, input.psu);
      if (!isRecord(response) || typeof response.url !== 'string') throw invalid('authorisation response');
      return response.url;
    },

    async completeAuth(code, psu) {
      const response = await client.post('/sessions', { code }, psu);
      if (
        !isRecord(response)
        || typeof response.session_id !== 'string'
        || !isRecord(response.access)
        || typeof response.access.valid_until !== 'string'
        || !Array.isArray(response.accounts)
      ) {
        throw invalid('session');
      }
      return {
        sessionId: response.session_id,
        consentValidUntil: response.access.valid_until,
        accounts: response.accounts.map(parseSessionAccount),
      };
    },

    async endSession(sessionId) {
      await client.delete(`/sessions/${encodeURIComponent(sessionId)}`);
    },

    async fetchTransactions(_connection, account, window, ctx) {
      const results: ProviderTransaction[] = [];
      let continuationKey: string | undefined;
      for (let page = 0; page < MAX_TRANSACTION_PAGES; page++) {
        const query: Record<string, string> = { date_from: window.from, date_to: window.to, transaction_status: 'BOOK' };
        if (continuationKey) query.continuation_key = continuationKey;
        const response = await client.get(`/accounts/${encodeURIComponent(account.accountUid)}/transactions`, query, ctx.psu);
        if (!isRecord(response) || !Array.isArray(response.transactions)) throw invalid('transactions response');
        for (const raw of response.transactions) {
          const transaction = normaliseEbTransaction(raw, account.startDate);
          if (transaction) results.push(transaction);
        }
        continuationKey = typeof response.continuation_key === 'string' && response.continuation_key
          ? response.continuation_key
          : undefined;
        if (!continuationKey) return results;
      }
      throw new ProviderError('INVALID_RESPONSE', `Enable Banking returned more than ${MAX_TRANSACTION_PAGES} pages`);
    },
  };
}
