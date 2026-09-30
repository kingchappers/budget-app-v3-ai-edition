import { addDaysIso } from './months';

const SNOOZE_PREFIX = 'budget.billSnoozes.';
const DISMISSED_PREFIX = 'budget.billDismissedMatches.';
const MAX_DISMISSED = 200;

type SnoozeMap = Record<string, string>;

function readJson<T>(key: string, isValid: (value: unknown) => value is T, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch (error) {
    console.error('billPrefs: could not read', key, error);
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error('billPrefs: could not write', key, error);
  }
}

function isSnoozeMap(value: unknown): value is SnoozeMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(until => typeof until === 'string');
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

function snoozeKey(recurringId: string, period: string): string {
  return `${recurringId}:${period}`;
}

export function snoozeUntilTomorrow(userSub: string, recurringId: string, period: string, today: string): void {
  const key = SNOOZE_PREFIX + userSub;
  const current = readJson(key, isSnoozeMap, {});
  const active = Object.fromEntries(Object.entries(current).filter(([, until]) => until > today));
  writeJson(key, { ...active, [snoozeKey(recurringId, period)]: addDaysIso(today, 1) });
}

export function isSnoozed(userSub: string, recurringId: string, period: string, today: string): boolean {
  const until = readJson(SNOOZE_PREFIX + userSub, isSnoozeMap, {})[snoozeKey(recurringId, period)];
  return until !== undefined && today < until;
}

function matchKey(recurringId: string, transactionId: string): string {
  return `${recurringId}:${transactionId}`;
}

export function dismissMatch(userSub: string, recurringId: string, transactionId: string): void {
  const key = DISMISSED_PREFIX + userSub;
  const entry = matchKey(recurringId, transactionId);
  const current = readJson(key, isStringList, []).filter(existing => existing !== entry);
  writeJson(key, [...current, entry].slice(-MAX_DISMISSED));
}

export function isMatchDismissed(userSub: string, recurringId: string, transactionId: string): boolean {
  return readJson(DISMISSED_PREFIX + userSub, isStringList, []).includes(matchKey(recurringId, transactionId));
}
