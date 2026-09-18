import { createHash } from 'node:crypto';
import type { ProviderTransaction } from './types';

const KEY_LENGTH = 32;

function hashParts(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, KEY_LENGTH);
}

export function deriveTxnKeys(provider: string, dedupeId: string, transactions: ProviderTransaction[]): string[] {
  const occurrences = new Map<string, number>();
  return transactions.map(t => {
    if (t.entryReference) return hashParts([provider, dedupeId, 'ref', t.entryReference]);
    const n = occurrences.get(t.fallbackBasis) ?? 0;
    occurrences.set(t.fallbackBasis, n + 1);
    return hashParts([provider, dedupeId, 'fallback', t.fallbackBasis, String(n)]);
  });
}
