import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category, Recurring } from '../../../app/lib/types';
import { runScheduler, type SchedulerDeps } from '../scheduler';
import type { Reminder } from '../select';
import type { ReminderData, StoredSubscription } from '../store';

function bill(over: Partial<Recurring> = {}): Recurring {
  return {
    recurringId: 'rent-1', type: 'EXPENSE', categoryId: 'cat-housing', amount: 85000, description: 'Rent', dayOfMonth: 14,
    frequency: 'MONTHLY', anchorDate: null, leadDays: 3, handledPeriod: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '', ...over,
  };
}

function device(sk: string, over: Partial<StoredSubscription['settings']> = {}): StoredSubscription {
  return {
    sk, endpoint: `https://fcm.googleapis.com/fcm/send/${sk}`, p256dh: 'p', auth: 'a',
    settings: { hour: 8, quietStart: null, quietEnd: null, timeZone: 'Europe/London', ...over },
  };
}

const data = (recurring: Recurring[] = [bill()]): ReminderData => ({
  recurring, categories: [{ categoryId: 'cat-housing', name: 'Housing' }] as Category[], transactions: [],
});

// 08:05 in London, on the day the rent is due (BST is UTC+1).
const DUE_MORNING = new Date('2026-10-14T07:05:00Z');

function fakeDeps(over: Partial<SchedulerDeps> = {}): SchedulerDeps & { sends: { sk: string; reminder: Reminder }[] } {
  const sends: { sk: string; reminder: Reminder }[] = [];
  return {
    sends,
    listUsers: vi.fn(async () => ['user-1']),
    loadSubscriptions: vi.fn(async () => [device('d1')]),
    loadReminderData: vi.fn(async () => data()),
    send: vi.fn(async (subscription, reminder) => { sends.push({ sk: subscription.sk, reminder }); }),
    remove: vi.fn(async () => undefined),
    ...over,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('runScheduler', () => {
  it('sends one notification per bill due, in the chosen hour', async () => {
    const deps = fakeDeps();
    const summary = await runScheduler(deps, DUE_MORNING);

    expect(deps.sends).toHaveLength(1);
    expect(deps.sends[0].reminder.title).toBe('Add rent £850.00?');
    expect(summary).toEqual({ users: 1, due: 1, sent: 1, removed: 0, failed: 0 });
  });

  it('sends nothing, and loads nothing, outside the chosen hour', async () => {
    const deps = fakeDeps();
    const summary = await runScheduler(deps, new Date('2026-10-14T09:05:00Z'));

    expect(deps.sends).toHaveLength(0);
    expect(deps.loadReminderData).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ users: 1, sent: 0 });
  });

  it('sends one notification for each bill due', async () => {
    const deps = fakeDeps({
      loadReminderData: vi.fn(async () => data([bill(), bill({ recurringId: 'gym-1', description: 'Gym', amount: 3000 })])),
    });
    await runScheduler(deps, DUE_MORNING);
    expect(deps.sends.map(send => send.reminder.title).sort()).toEqual(['Add gym £30.00?', 'Add rent £850.00?']);
  });

  it('sends nothing on a day with nothing due', async () => {
    const deps = fakeDeps();
    await runScheduler(deps, new Date('2026-10-20T07:05:00Z'));
    expect(deps.sends).toHaveLength(0);
  });

  it('respects quiet hours by waiting until they end', async () => {
    const quiet = device('d1', { hour: 6, quietStart: 22, quietEnd: 9 });
    const deps = fakeDeps({ loadSubscriptions: vi.fn(async () => [quiet]) });

    await runScheduler(deps, new Date('2026-10-14T05:05:00Z'));
    expect(deps.sends).toHaveLength(0);

    await runScheduler(deps, new Date('2026-10-14T08:05:00Z'));
    expect(deps.sends).toHaveLength(1);
  });

  it('sends to each device in its own time zone and hour', async () => {
    const deps = fakeDeps({
      loadSubscriptions: vi.fn(async () => [
        device('london', { hour: 8, timeZone: 'Europe/London' }),
        device('new-york', { hour: 8, timeZone: 'America/New_York' }),
      ]),
    });

    await runScheduler(deps, DUE_MORNING);
    expect(deps.sends.map(send => send.sk)).toEqual(['london']);

    await runScheduler(deps, new Date('2026-10-14T12:05:00Z'));
    expect(deps.sends.map(send => send.sk)).toEqual(['london', 'new-york']);
  });

  it('works out "today" on the device\'s own calendar', async () => {
    // 23:30 UTC on the 13th is already the 14th, 08:30, in Tokyo.
    const deps = fakeDeps({ loadSubscriptions: vi.fn(async () => [device('tokyo', { timeZone: 'Asia/Tokyo' })]) });
    await runScheduler(deps, new Date('2026-10-13T23:30:00Z'));
    expect(deps.loadReminderData).toHaveBeenCalledWith('user-1', '2026-10-14');
    expect(deps.sends).toHaveLength(1);
  });

  it('loads a user\'s data once however many of their devices are ready', async () => {
    const deps = fakeDeps({ loadSubscriptions: vi.fn(async () => [device('a'), device('b')]) });
    await runScheduler(deps, DUE_MORNING);
    expect(deps.loadReminderData).toHaveBeenCalledTimes(1);
    expect(deps.sends.map(send => send.sk)).toEqual(['a', 'b']);
  });

  it('removes a subscription the push service says is gone, and stops sending to it', async () => {
    const gone = Object.assign(new Error('gone'), { statusCode: 410 });
    const deps = fakeDeps({
      loadReminderData: vi.fn(async () => data([bill(), bill({ recurringId: 'gym-1', description: 'Gym' })])),
      send: vi.fn(async () => { throw gone; }),
    });

    const summary = await runScheduler(deps, DUE_MORNING);

    expect(deps.remove).toHaveBeenCalledWith('user-1', 'd1');
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ removed: 1, failed: 0 });
  });

  it('removes one that returns 404 as well', async () => {
    const deps = fakeDeps({ send: vi.fn(async () => { throw Object.assign(new Error('nope'), { statusCode: 404 }); }) });
    await runScheduler(deps, DUE_MORNING);
    expect(deps.remove).toHaveBeenCalledWith('user-1', 'd1');
  });

  it('keeps a subscription after an error that may pass, and carries on with the next bill', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { statusCode: 503 }))
      .mockResolvedValue(undefined);
    const deps = fakeDeps({
      loadReminderData: vi.fn(async () => data([bill(), bill({ recurringId: 'gym-1', description: 'Gym' })])),
      send,
    });

    const summary = await runScheduler(deps, DUE_MORNING);

    expect(deps.remove).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ sent: 1, failed: 1 });
  });

  it('carries on with the next user when one fails', async () => {
    const deps = fakeDeps({
      listUsers: vi.fn(async () => ['broken', 'fine']),
      loadSubscriptions: vi.fn(async (userId: string) => {
        if (userId === 'broken') throw new Error('table unavailable');
        return [device('d1')];
      }),
    });

    const summary = await runScheduler(deps, DUE_MORNING);

    expect(deps.sends).toHaveLength(1);
    expect(summary).toMatchObject({ users: 2, sent: 1, failed: 1 });
  });

  it('does nothing when nobody has turned reminders on', async () => {
    const deps = fakeDeps({ listUsers: vi.fn(async () => []) });
    expect(await runScheduler(deps, DUE_MORNING)).toEqual({ users: 0, due: 0, sent: 0, removed: 0, failed: 0 });
  });

  it('logs no addresses, ids or amounts when something goes wrong', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const deps = fakeDeps({
      send: vi.fn(async () => { throw Object.assign(new Error('POST https://fcm.googleapis.com/fcm/send/d1 failed for user-1'), { statusCode: 500 }); }),
    });

    await runScheduler(deps, DUE_MORNING);

    const text = JSON.stringify(logged.mock.calls);
    expect(text).not.toContain('googleapis');
    expect(text).not.toContain('user-1');
    expect(text).not.toContain('850');
  });

  it('never sends a notification that mentions overdue, counts or bad news', async () => {
    const deps = fakeDeps();
    await runScheduler(deps, DUE_MORNING);
    for (const { reminder } of deps.sends) {
      expect(`${reminder.title} ${reminder.body}`).not.toMatch(/overdue|late|missed|behind|!|\b\d+ (bills?|items?)\b/i);
    }
  });
});
