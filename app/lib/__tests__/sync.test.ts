import { describe, it, expect } from 'vitest';
import { isSyncFinished, shouldPollSync, syncErrorMessage, SYNC_MAX_WAIT_MS } from '../sync';
import { ApiError } from '../apiError';

const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const pending = { baselineFinishedAt: '2026-09-13T06:00:00.000Z', requestedAt: NOW };

describe('isSyncFinished', () => {
  it('is false while the previous result is still showing', () => {
    expect(isSyncFinished({ state: 'IDLE', finishedAt: '2026-09-13T06:00:00.000Z' }, pending)).toBe(false);
  });

  it('is true once a new result is recorded', () => {
    expect(isSyncFinished({ state: 'IDLE', finishedAt: '2026-09-13T12:00:05.000Z' }, pending)).toBe(true);
  });

  it('is false while running', () => {
    expect(isSyncFinished({ state: 'RUNNING', finishedAt: '2026-09-13T12:00:05.000Z' }, pending)).toBe(false);
  });
});

describe('shouldPollSync', () => {
  it('polls while RUNNING even without a pending request', () => {
    expect(shouldPollSync({ state: 'RUNNING' }, null, NOW)).toBe(true);
  });

  it('polls after a request until the worker records a result', () => {
    expect(shouldPollSync({ state: 'IDLE', finishedAt: pending.baselineFinishedAt }, pending, NOW + 5000)).toBe(true);
    expect(shouldPollSync({ state: 'IDLE', finishedAt: '2026-09-13T12:01:00.000Z' }, pending, NOW + 5000)).toBe(false);
  });

  it('gives up after the maximum wait', () => {
    expect(shouldPollSync({ state: 'IDLE', finishedAt: pending.baselineFinishedAt }, pending, NOW + SYNC_MAX_WAIT_MS + 1)).toBe(false);
  });

  it('does not poll when idle with nothing pending', () => {
    expect(shouldPollSync({ state: 'IDLE' }, null, NOW)).toBe(false);
  });
});

describe('syncErrorMessage', () => {
  it.each([
    [new ApiError(409, 'Conflict'), 'A sync is already running'],
    [new ApiError(429, 'Too Many Requests'), 'Synced recently — try again in a few minutes'],
    [new Error('network'), 'Sync could not start. Please try again.'],
  ])('%s → %s', (error, expected) => {
    expect(syncErrorMessage(error)).toBe(expected);
  });
});
