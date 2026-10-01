import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Runs the real public/sw.js against a stand-in for the worker's global scope.
const source = readFileSync(resolve(__dirname, '../../../public/sw.js'), 'utf8');
const ORIGIN = 'https://budget.example';

type Listener = (event: Record<string, unknown>) => void;

interface Scope {
  listeners: Map<string, Listener>;
  showNotification: ReturnType<typeof vi.fn>;
  openWindow: ReturnType<typeof vi.fn>;
  matchAll: ReturnType<typeof vi.fn>;
  claim: ReturnType<typeof vi.fn>;
  skipWaiting: ReturnType<typeof vi.fn>;
}

function load(): Scope {
  const listeners = new Map<string, Listener>();
  const scope: Scope = {
    listeners,
    showNotification: vi.fn(async () => undefined),
    openWindow: vi.fn(async () => undefined),
    matchAll: vi.fn(async () => []),
    claim: vi.fn(async () => undefined),
    skipWaiting: vi.fn(),
  };
  const fakeSelf = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: scope.skipWaiting,
    registration: { showNotification: scope.showNotification },
    clients: { matchAll: scope.matchAll, openWindow: scope.openWindow, claim: scope.claim },
  };
  new Function('self', source)(fakeSelf);
  return scope;
}

function pushEvent(payload: unknown, scope: Scope): Promise<void> {
  const waits: Promise<unknown>[] = [];
  scope.listeners.get('push')?.({
    data: payload === undefined ? null : { json: () => (payload instanceof Error ? (() => { throw payload; })() : payload) },
    waitUntil: (promise: Promise<unknown>) => waits.push(promise),
  });
  return Promise.all(waits).then(() => undefined);
}

function clickEvent(scope: Scope, data: unknown, action = ''): Promise<void> {
  const waits: Promise<unknown>[] = [];
  const close = vi.fn();
  scope.listeners.get('notificationclick')?.({
    notification: { data, close },
    action,
    waitUntil: (promise: Promise<unknown>) => waits.push(promise),
  });
  return Promise.all(waits).then(() => undefined);
}

const REMINDER = { title: 'Add rent £850.00?', body: 'Due today.', url: '/?due=rent-1&period=2026-10', recurringId: 'rent-1', period: '2026-10' };

let scope: Scope;
beforeEach(() => { scope = load(); });

describe('the service worker', () => {
  it('takes over straight away when it is installed or updated', async () => {
    scope.listeners.get('install')?.({});
    expect(scope.skipWaiting).toHaveBeenCalled();
    const waits: Promise<unknown>[] = [];
    scope.listeners.get('activate')?.({ waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
    await Promise.all(waits);
    expect(scope.claim).toHaveBeenCalled();
  });
});

describe('showing a reminder', () => {
  it('shows the question with Add and Skip, and nothing else', async () => {
    await pushEvent(REMINDER, scope);

    const [title, options] = scope.showNotification.mock.calls[0];
    expect(title).toBe('Add rent £850.00?');
    expect(options.body).toBe('Due today.');
    expect(options.actions).toEqual([{ action: 'add', title: 'Add' }, { action: 'skip', title: 'Skip' }]);
  });

  it('gives each bill and period one notification that a later one replaces', async () => {
    await pushEvent(REMINDER, scope);
    await pushEvent(REMINDER, scope);
    const tags = scope.showNotification.mock.calls.map(call => call[1].tag);
    expect(tags).toEqual(['rent-1:2026-10', 'rent-1:2026-10']);
  });

  it('still shows something plain when the message cannot be read, since it must show something', async () => {
    await pushEvent(new Error('bad json'), scope);
    expect(scope.showNotification).toHaveBeenCalledWith('Bill reminder', expect.objectContaining({ body: 'Open Budget to see what is due.', actions: [] }));
  });

  it('does the same for a push with no content', async () => {
    await pushEvent(undefined, scope);
    expect(scope.showNotification).toHaveBeenCalledWith('Bill reminder', expect.objectContaining({ actions: [] }));
  });

  it('does the same for content with no title', async () => {
    await pushEvent({ body: 'something' }, scope);
    expect(scope.showNotification).toHaveBeenCalledWith('Bill reminder', expect.anything());
  });

  it('has no counts, overdue wording or bad news of its own', async () => {
    await pushEvent(undefined, scope);
    const [title, options] = scope.showNotification.mock.calls[0];
    expect(`${title} ${options.body}`).not.toMatch(/overdue|late|missed|behind|!|\d/i);
  });
});

describe('tapping a reminder', () => {
  it('closes the notification', async () => {
    const closes: unknown[] = [];
    const waits: Promise<unknown>[] = [];
    scope.listeners.get('notificationclick')?.({
      notification: { data: { url: REMINDER.url }, close: () => closes.push(true) },
      action: '',
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    });
    await Promise.all(waits);
    expect(closes).toHaveLength(1);
  });

  it('opens Add for that bill when Add was tapped', async () => {
    await clickEvent(scope, { url: REMINDER.url }, 'add');
    expect(scope.openWindow).toHaveBeenCalledWith('/?due=rent-1&period=2026-10&action=add');
  });

  it('opens Skip for that bill when Skip was tapped', async () => {
    await clickEvent(scope, { url: REMINDER.url }, 'skip');
    expect(scope.openWindow).toHaveBeenCalledWith('/?due=rent-1&period=2026-10&action=skip');
  });

  it('just opens the bill when the notification itself was tapped', async () => {
    await clickEvent(scope, { url: REMINDER.url }, '');
    expect(scope.openWindow).toHaveBeenCalledWith('/?due=rent-1&period=2026-10');
  });

  it('ignores an action it does not know', async () => {
    await clickEvent(scope, { url: REMINDER.url }, 'delete');
    expect(scope.openWindow).toHaveBeenCalledWith('/?due=rent-1&period=2026-10');
  });

  it('never leads off this site, whatever the notification carries', async () => {
    await clickEvent(scope, { url: 'https://evil.example/?due=rent-1&action=add' }, 'add');
    expect(scope.openWindow).toHaveBeenCalledWith('/');
  });

  it('keeps only the bill, the period and the action from the address', async () => {
    await clickEvent(scope, { url: '/transactions?due=rent-1&period=2026-10&next=https://evil.example&x=1' }, 'add');
    expect(scope.openWindow).toHaveBeenCalledWith('/?due=rent-1&period=2026-10&action=add');
  });

  it('opens Home when the notification has no address', async () => {
    await clickEvent(scope, undefined, 'add');
    expect(scope.openWindow).toHaveBeenCalledWith('/');
  });

  it('opens Home when the address cannot be read', async () => {
    await clickEvent(scope, { url: 'http://[' }, 'add');
    expect(scope.openWindow).toHaveBeenCalledWith('/');
  });

  it('uses a window that is already open instead of opening another', async () => {
    const navigate = vi.fn(async () => undefined);
    const focus = vi.fn(async () => undefined);
    scope.matchAll.mockResolvedValue([{ url: `${ORIGIN}/transactions`, focus, navigate }]);

    await clickEvent(scope, { url: REMINDER.url }, 'add');

    expect(focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/?due=rent-1&period=2026-10&action=add');
    expect(scope.openWindow).not.toHaveBeenCalled();
  });

  it('opens a new window if an open one cannot be navigated', async () => {
    const navigate = vi.fn(async () => { throw new Error('not allowed'); });
    scope.matchAll.mockResolvedValue([{ url: `${ORIGIN}/`, focus: vi.fn(async () => undefined), navigate }]);

    await clickEvent(scope, { url: REMINDER.url }, 'skip');

    expect(scope.openWindow).toHaveBeenCalledWith('/?due=rent-1&period=2026-10&action=skip');
  });

  it('does not borrow a window from another site', async () => {
    const focus = vi.fn();
    scope.matchAll.mockResolvedValue([{ url: 'https://other.example/', focus, navigate: vi.fn() }]);

    await clickEvent(scope, { url: REMINDER.url }, 'add');

    expect(focus).not.toHaveBeenCalled();
    expect(scope.openWindow).toHaveBeenCalled();
  });
});
