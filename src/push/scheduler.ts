import webpush from 'web-push';
import { isTimeToSend, localMoment, selectReminders, type Reminder } from './select';
import {
  listSubscribedUsers, loadReminderData, loadSubscriptions, removeSubscription, type ReminderData, type StoredSubscription,
} from './store';
import { initStore } from '../store';
import { loadVapid, type VapidDetails } from './vapid';

// A reminder is about today, so it is worth nothing once the day is over.
const TTL_SECONDS = 12 * 60 * 60;
const GONE = new Set([404, 410]);

export interface Summary {
  users: number;
  due: number;
  sent: number;
  removed: number;
  failed: number;
}

export interface SchedulerDeps {
  listUsers: () => Promise<string[]>;
  loadSubscriptions: (userId: string) => Promise<StoredSubscription[]>;
  loadReminderData: (userId: string, today: string) => Promise<ReminderData>;
  send: (subscription: StoredSubscription, reminder: Reminder) => Promise<void>;
  remove: (userId: string, sk: string) => Promise<void>;
}

function statusOf(error: unknown): number | null {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' ? status : null;
}

// Runs once an hour. Only a device whose own clock has reached its chosen hour is looked at, so most runs do no more than read the index.
export async function runScheduler(deps: SchedulerDeps, now: Date = new Date()): Promise<Summary> {
  const summary: Summary = { users: 0, due: 0, sent: 0, removed: 0, failed: 0 };

  for (const userId of await deps.listUsers()) {
    summary.users += 1;
    try {
      const ready = (await deps.loadSubscriptions(userId)).filter(subscription => isTimeToSend(now, subscription.settings));
      const dataByDay = new Map<string, ReminderData>();

      for (const subscription of ready) {
        const today = localMoment(now, subscription.settings.timeZone).date;
        let data = dataByDay.get(today);
        if (!data) {
          data = await deps.loadReminderData(userId, today);
          dataByDay.set(today, data);
        }

        const reminders = selectReminders({ ...data, today });
        summary.due += reminders.length;
        for (const reminder of reminders) {
          try {
            await deps.send(subscription, reminder);
            summary.sent += 1;
          } catch (error) {
            const status = statusOf(error);
            if (status !== null && GONE.has(status)) {
              await deps.remove(userId, subscription.sk);
              summary.removed += 1;
              break;
            }
            // Status only: the message can include the endpoint address.
            console.error('Push reminders: a notification was not sent', { status });
            summary.failed += 1;
          }
        }
      }
    } catch (error) {
      console.error('Push reminders: one user was skipped', error instanceof Error ? error.name : 'UnknownError');
      summary.failed += 1;
    }
  }
  return summary;
}

function sender(vapid: VapidDetails): SchedulerDeps['send'] {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return async (subscription, reminder) => {
    const payload = JSON.stringify({
      title: reminder.title, body: reminder.body, url: reminder.url, recurringId: reminder.recurringId, period: reminder.period,
    });
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      payload,
      { TTL: TTL_SECONDS, urgency: 'normal', topic: reminder.topic },
    );
  };
}

export async function handler(): Promise<Summary | { skipped: string }> {
  const vapid = await loadVapid();
  if (!vapid) {
    console.log('Push reminders are not set up yet: nothing to do');
    return { skipped: 'not set up' };
  }

  await initStore();
  const summary = await runScheduler({
    listUsers: listSubscribedUsers,
    loadSubscriptions,
    loadReminderData,
    send: sender(vapid),
    remove: removeSubscription,
  });
  // Counts only: no user ids, addresses or bill details.
  console.log('Push reminders run finished', summary);
  return summary;
}
