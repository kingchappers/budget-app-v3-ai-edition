export const ADD_PARAM = 'add';
export const PENDING_ADD_KEY = 'budget.pendingAdd';
export const LAUNCH_HANDLED_KEY = 'budget.launchHandled';
export const OPEN_ON_LAUNCH_KEY = 'budget.openAddOnLaunch';

export interface LocationParts {
  pathname: string;
  search: string;
  hash: string;
}

export interface StandaloneEnv {
  matchMedia: (query: string) => { matches: boolean };
  navigator: Navigator;
}

export interface LaunchContext {
  session: Storage | null;
  local: Storage | null;
  standalone: boolean;
}

export function safeStorage(kind: 'session' | 'local'): Storage | null {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch (error) {
    console.error(`launchIntent: ${kind}Storage is unavailable`, error);
    return null;
  }
}

function readItem(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch (error) {
    console.error('launchIntent: could not read', key, error);
    return null;
  }
}

function writeItem(store: Storage, key: string, value: string): boolean {
  try {
    store.setItem(key, value);
    return true;
  } catch (error) {
    console.error('launchIntent: could not write', key, error);
    return false;
  }
}

function removeItem(store: Storage, key: string): void {
  try {
    store.removeItem(key);
  } catch (error) {
    console.error('launchIntent: could not remove', key, error);
  }
}

export function captureAddParam(location: LocationParts, session: Storage | null): string | null {
  if (session === null) return null;
  const params = new URLSearchParams(location.search);
  if (params.get(ADD_PARAM) !== '1') return null;
  if (!writeItem(session, PENDING_ADD_KEY, '1')) return null;

  params.delete(ADD_PARAM);
  const rest = params.toString();
  const search = rest ? `?${rest}` : '';
  return `${location.pathname}${search}${location.hash}`;
}

export function isStandalone(env: StandaloneEnv): boolean {
  const iosStandalone = (env.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || env.matchMedia('(display-mode: standalone)').matches;
}

export function readOpenOnLaunch(local: Storage | null): boolean {
  if (local === null) return false;
  return readItem(local, OPEN_ON_LAUNCH_KEY) === '1';
}

export function writeOpenOnLaunch(local: Storage | null, enabled: boolean): void {
  if (local === null) return;
  if (enabled) {
    writeItem(local, OPEN_ON_LAUNCH_KEY, '1');
    return;
  }
  removeItem(local, OPEN_ON_LAUNCH_KEY);
}

export function consumeLaunchIntent({ session, local, standalone }: LaunchContext): boolean {
  let pending = false;
  let firstEvaluation = false;

  if (session !== null) {
    pending = readItem(session, PENDING_ADD_KEY) === '1';
    if (pending) removeItem(session, PENDING_ADD_KEY);
    firstEvaluation = readItem(session, LAUNCH_HANDLED_KEY) !== '1' && writeItem(session, LAUNCH_HANDLED_KEY, '1');
  }

  const launchOpen = firstEvaluation && standalone && readOpenOnLaunch(local);
  return pending || launchOpen;
}
