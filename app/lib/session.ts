import { useSyncExternalStore } from 'react';

const SESSION_ENDED_CODES = new Set(['login_required', 'missing_refresh_token', 'invalid_grant']);

type Listener = () => void;

const listeners = new Set<Listener>();
let sessionEnded = false;

export function isSessionEndedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { error?: unknown }).error;
  return typeof code === 'string' && SESSION_ENDED_CODES.has(code);
}

function setSessionEnded(value: boolean): void {
  if (sessionEnded === value) return;
  sessionEnded = value;
  listeners.forEach(listener => listener());
}

export function markSessionEnded(): void {
  setSessionEnded(true);
}

export function clearSessionEnded(): void {
  setSessionEnded(false);
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return sessionEnded;
}

export function useSessionEnded(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
