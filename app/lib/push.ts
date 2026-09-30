import type { Api, PushSubscriptionInput } from './api';

// The public half of the reminder key pair. It is safe in the browser; the private half never is.
export const VAPID_PUBLIC_KEY: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '';

export const SERVICE_WORKER_PATH = '/sw.js';

export type PushSupport =
  // Not turned on for the app by whoever runs it yet.
  | 'not-configured'
  // iPhone and iPad only allow reminders from an app added to the Home Screen.
  | 'needs-install'
  | 'unsupported'
  | 'ready';

export interface PushEnvironment {
  publicKey: string;
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
}

export function currentEnvironment(): PushEnvironment {
  return {
    publicKey: VAPID_PUBLIC_KEY,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: (navigator as Navigator & { standalone?: boolean }).standalone === true
      || window.matchMedia?.('(display-mode: standalone)').matches === true,
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    hasNotification: 'Notification' in window,
  };
}

// iPadOS reports itself as a Mac, so a Mac with a touch screen is an iPad.
function isAppleTouchDevice({ userAgent, maxTouchPoints }: PushEnvironment): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

export function pushSupport(environment: PushEnvironment = currentEnvironment()): PushSupport {
  if (environment.publicKey === '') return 'not-configured';
  if (isAppleTouchDevice(environment) && !environment.standalone) return 'needs-install';
  if (!environment.hasServiceWorker || !environment.hasPushManager || !environment.hasNotification) return 'unsupported';
  return 'ready';
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

export interface ReminderSettings {
  hour: number;
  quietHours: boolean;
  quietStart: number;
  quietEnd: number;
}

export function subscriptionInput(subscription: PushSubscriptionJSON, settings: ReminderSettings): PushSubscriptionInput {
  return {
    subscription: {
      endpoint: subscription.endpoint ?? '',
      expirationTime: subscription.expirationTime ?? null,
      keys: { p256dh: subscription.keys?.p256dh ?? '', auth: subscription.keys?.auth ?? '' },
    },
    settings: {
      hour: settings.hour,
      quietStart: settings.quietHours ? settings.quietStart : null,
      quietEnd: settings.quietHours ? settings.quietEnd : null,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };
}

export type EnableResult = { ok: true } | { ok: false; reason: 'denied' | 'failed' };

// Asks for notification permission only here, at the moment someone turns reminders on.
export async function enableReminders(api: Pick<Api, 'savePushSubscription'>, settings: ReminderSettings): Promise<EnableResult> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: 'denied' };

    await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
    const registration = await navigator.serviceWorker.ready;
    const subscription = (await registration.pushManager.getSubscription())
      ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }));

    await api.savePushSubscription(subscriptionInput(subscription.toJSON(), settings));
    return { ok: true };
  } catch (error) {
    console.error('Could not turn on bill reminders', error);
    return { ok: false, reason: 'failed' };
  }
}

// Saves new times for a device that is already subscribed.
export async function updateReminderSettings(api: Pick<Api, 'savePushSubscription'>, settings: ReminderSettings): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return false;
    await api.savePushSubscription(subscriptionInput(subscription.toJSON(), settings));
    return true;
  } catch (error) {
    console.error('Could not save the new reminder times', error);
    return false;
  }
}

// The device stops receiving reminders even if the server cannot be reached, which then drops the stale
// subscription itself the next time the push service reports it gone.
export async function disableReminders(api: Pick<Api, 'deletePushSubscription'>): Promise<boolean> {
  let savedOnServer = true;
  try {
    const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      try {
        await api.deletePushSubscription(subscription.endpoint);
      } catch (error) {
        console.error('Could not remove this device from the server', error);
        savedOnServer = false;
      }
      await subscription.unsubscribe();
    }
  } catch (error) {
    console.error('Could not turn off bill reminders', error);
    return false;
  }
  return savedOnServer;
}
