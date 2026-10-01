import { useCallback, useSyncExternalStore } from 'react';

export const MAX_PINNED_CHIPS = 6;

// After saving in the Add sheet: 'ask' the first time, then remember the answer.
export type KeepSheetOpen = 'ask' | 'yes' | 'no';
// How the Add sheet opens: the form, or the one-line "type it" box.
export type EntryMode = 'form' | 'quick';

// Root font size, so every rem-based size follows: 100%, 112.5% and 125%.
export type TextSize = 'standard' | 'large' | 'largest';
// How long a message with an Undo button stays on screen.
export type UndoDuration = 'until-closed' | '30s' | '10s';

export interface Preferences {
  textSize: TextSize;
  undoDuration: UndoDuration;
  shortcutN: boolean;
  openAddOnLaunch: boolean;
  // Category chips the user chose to keep first, in the order they chose them.
  pinnedCategoryIds: string[];
  keepSheetOpen: KeepSheetOpen;
  entryMode: EntryMode;
  quickAddTipDismissed: boolean;
  // Days the user said they had nothing to log, by Auth0 user id. Kept on this device for now.
  nothingToLog: Record<string, string[]>;
  // The welcome-back card stays hidden until this date (YYYY-MM-DD). Empty means not hidden.
  welcomeBackHiddenUntil: string;
  // "What's changed" notes the user has dismissed, by release key.
  seenReleases: string[];
}

export const DEFAULT_PREFERENCES: Preferences = {
  textSize: 'standard',
  undoDuration: 'until-closed',
  shortcutN: true,
  openAddOnLaunch: false,
  pinnedCategoryIds: [],
  keepSheetOpen: 'ask',
  entryMode: 'form',
  quickAddTipDismissed: false,
  nothingToLog: {},
  welcomeBackHiddenUntil: '',
  seenReleases: [],
};

const BOOLEAN_KEYS = ['shortcutN', 'openAddOnLaunch', 'quickAddTipDismissed'] as const;
const KEEP_SHEET_OPEN_VALUES: readonly KeepSheetOpen[] = ['ask', 'yes', 'no'];
const ENTRY_MODES: readonly EntryMode[] = ['form', 'quick'];
const TEXT_SIZES: readonly TextSize[] = ['standard', 'large', 'largest'];
const UNDO_DURATIONS: readonly UndoDuration[] = ['until-closed', '30s', '10s'];
const MAX_CATEGORY_ID_LENGTH = 64;
const MAX_USER_KEY_LENGTH = 128;
const MAX_NOTHING_TO_LOG_USERS = 20;
const MAX_RELEASE_KEYS = 50;
const MAX_RELEASE_KEY_LENGTH = 64;
const MAX_NOTHING_TO_LOG_DAYS = 400;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const PREFERENCES_KEY = 'budget.preferences';
export const LEGACY_OPEN_ON_LAUNCH_KEY = 'budget.openAddOnLaunch';

type PreferenceKey = keyof Preferences;
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

function pinnedFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= MAX_CATEGORY_ID_LENGTH);
  return [...new Set(ids)].slice(0, MAX_PINNED_CHIPS);
}

function nothingToLogFrom(value: unknown): Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<string, string[]> = {};
  for (const [user, days] of Object.entries(value).slice(0, MAX_NOTHING_TO_LOG_USERS)) {
    if (user === '' || user.length > MAX_USER_KEY_LENGTH || !Array.isArray(days)) continue;
    const valid = days.filter((day): day is string => typeof day === 'string' && ISO_DATE.test(day));
    result[user] = [...new Set(valid)].sort().slice(-MAX_NOTHING_TO_LOG_DAYS);
  }
  return result;
}

function releasesFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys = value.filter((key): key is string => typeof key === 'string' && key !== '' && key.length <= MAX_RELEASE_KEY_LENGTH);
  return [...new Set(keys)].slice(-MAX_RELEASE_KEYS);
}

function fromStored(stored: Record<string, unknown>, legacyOpenOnLaunch: string | null): Preferences {
  const result: Preferences = { ...DEFAULT_PREFERENCES };
  for (const key of BOOLEAN_KEYS) {
    const value = stored[key];
    if (typeof value === 'boolean') result[key] = value;
  }
  result.pinnedCategoryIds = pinnedFrom(stored.pinnedCategoryIds);
  if (KEEP_SHEET_OPEN_VALUES.includes(stored.keepSheetOpen as KeepSheetOpen)) result.keepSheetOpen = stored.keepSheetOpen as KeepSheetOpen;
  if (TEXT_SIZES.includes(stored.textSize as TextSize)) result.textSize = stored.textSize as TextSize;
  if (UNDO_DURATIONS.includes(stored.undoDuration as UndoDuration)) result.undoDuration = stored.undoDuration as UndoDuration;
  if (ENTRY_MODES.includes(stored.entryMode as EntryMode)) result.entryMode = stored.entryMode as EntryMode;
  result.nothingToLog = nothingToLogFrom(stored.nothingToLog);
  result.seenReleases = releasesFrom(stored.seenReleases);
  if (typeof stored.welcomeBackHiddenUntil === 'string' && (stored.welcomeBackHiddenUntil === '' || ISO_DATE.test(stored.welcomeBackHiddenUntil))) {
    result.welcomeBackHiddenUntil = stored.welcomeBackHiddenUntil;
  }
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
