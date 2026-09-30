import { useCallback, useSyncExternalStore } from 'react';

// The Insights sections that can be opened and closed, in page order.
export const INSIGHTS_SECTIONS = ['tracking', 'groups', 'trend', 'movers', 'targets', 'pots', 'netWorth', 'milestones'] as const;
export type InsightsSection = typeof INSIGHTS_SECTIONS[number];

const MAX_NOT_TRACKED_MONTHS = 120;
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface Preferences {
  shortcutN: boolean;
  openAddOnLaunch: boolean;
  // Outcome-only acknowledgements on Insights. Off unless asked for.
  showMilestones: boolean;
  // Months (YYYY-MM) the user said they did not track, left out of comparisons.
  notTrackedMonths: string[];
  // Insights sections the user left open. All start closed.
  insightsOpenSections: InsightsSection[];
}

export const DEFAULT_PREFERENCES: Preferences = {
  shortcutN: true,
  openAddOnLaunch: false,
  showMilestones: false,
  notTrackedMonths: [],
  insightsOpenSections: [],
};

const BOOLEAN_KEYS = ['shortcutN', 'openAddOnLaunch', 'showMilestones'] as const;

export const PREFERENCES_KEY = 'budget.preferences';
export const LEGACY_OPEN_ON_LAUNCH_KEY = 'budget.openAddOnLaunch';

type Listener = () => void;

const listeners = new Set<Listener>();
let cachedRaw: string | null | undefined;
let cachedPreferences: Preferences = DEFAULT_PREFERENCES;
let unsavedPreferences: Preferences | null = null;

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch (error) {
    console.error('preferences: localStorage is unavailable', error);
    return null;
  }
}

function readItem(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch (error) {
    console.error('preferences: could not read', key, error);
    return null;
  }
}

function parseStored(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch (error) {
    console.error('preferences: saved preferences are not valid JSON', error);
    return {};
  }
}

function monthsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const months = value.filter((item): item is string => typeof item === 'string' && YEAR_MONTH.test(item));
  return [...new Set(months)].sort().slice(-MAX_NOT_TRACKED_MONTHS);
}

function sectionsFrom(value: unknown): InsightsSection[] {
  if (!Array.isArray(value)) return [];
  return INSIGHTS_SECTIONS.filter(section => value.includes(section));
}

function fromStored(stored: Record<string, unknown>, legacyOpenOnLaunch: string | null): Preferences {
  const result: Preferences = { ...DEFAULT_PREFERENCES };
  for (const key of BOOLEAN_KEYS) {
    const value = stored[key];
    if (typeof value === 'boolean') result[key] = value;
  }
  result.notTrackedMonths = monthsFrom(stored.notTrackedMonths);
  result.insightsOpenSections = sectionsFrom(stored.insightsOpenSections);
  if (typeof stored.openAddOnLaunch !== 'boolean' && legacyOpenOnLaunch === '1') result.openAddOnLaunch = true;
  return result;
}

export function readPreferences(store: Storage | null): Preferences {
  if (store === null) return { ...DEFAULT_PREFERENCES };
  return fromStored(parseStored(readItem(store, PREFERENCES_KEY)), readItem(store, LEGACY_OPEN_ON_LAUNCH_KEY));
}

export function writePreferences(store: Storage | null, next: Preferences): boolean {
  if (store === null) return false;
  try {
    store.setItem(PREFERENCES_KEY, JSON.stringify(next));
    store.removeItem(LEGACY_OPEN_ON_LAUNCH_KEY);
    return true;
  } catch (error) {
    console.error('preferences: could not save', PREFERENCES_KEY, error);
    return false;
  }
}

function notify(): void {
  listeners.forEach(listener => listener());
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== PREFERENCES_KEY && event.key !== LEGACY_OPEN_ON_LAUNCH_KEY) return;
  notify();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot(): Preferences {
  if (unsavedPreferences !== null) return unsavedPreferences;
  const store = localStore();
  const raw = store === null
    ? null
    : `${readItem(store, PREFERENCES_KEY)}\u0000${readItem(store, LEGACY_OPEN_ON_LAUNCH_KEY)}`;
  if (raw === cachedRaw) return cachedPreferences;
  cachedRaw = raw;
  cachedPreferences = readPreferences(store);
  return cachedPreferences;
}

function getServerSnapshot(): Preferences {
  return DEFAULT_PREFERENCES;
}

function updatePreferences(patch: Partial<Preferences>): void {
  const next = { ...getSnapshot(), ...patch };
  unsavedPreferences = writePreferences(localStore(), next) ? null : next;
  notify();
}

export function usePreferences(): [Preferences, (patch: Partial<Preferences>) => void] {
  const preferences = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setPreferences = useCallback((patch: Partial<Preferences>) => updatePreferences(patch), []);
  return [preferences, setPreferences];
}
