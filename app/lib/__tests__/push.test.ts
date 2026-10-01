import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  disableReminders, enableReminders, pushSupport, subscriptionInput, updateReminderSettings, urlBase64ToUint8Array,
  type PushEnvironment, type ReminderSettings,
} from '../push';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15';

function environment(over: Partial<PushEnvironment> = {}): PushEnvironment {
  return {
    publicKey: 'BKey', userAgent: CHROME, maxTouchPoints: 0, standalone: false,
    hasServiceWorker: true, hasPushManager: true, hasNotification: true, ...over,
  };
}

const settings: ReminderSettings = { hour: 8, quietHours: true, quietStart: 22, quietEnd: 7 };

describe('pushSupport', () => {
  it('is ready in a browser that can do it', () => {
    expect(pushSupport(environment())).toBe('ready');
  });

  it('is not configured until the app has a key, whatever the browser can do', () => {
    expect(pushSupport(environment({ publicKey: '' }))).toBe('not-configured');
    expect(pushSupport(environment({ publicKey: '', userAgent: IPHONE }))).toBe('not-configured');
  });

  it('asks an iPhone to install the app first', () => {
    expect(pushSupport(environment({ userAgent: IPHONE, hasPushManager: false }))).toBe('needs-install');
  });

  it('is ready on an iPhone once the app is on the Home Screen', () => {
    expect(pushSupport(environment({ userAgent: IPHONE, standalone: true }))).toBe('ready');
  });

  it('treats an iPad that calls itself a Mac as an iPad', () => {
    expect(pushSupport(environment({ userAgent: MAC, maxTouchPoints: 5, hasPushManager: false }))).toBe('needs-install');
    expect(pushSupport(environment({ userAgent: MAC, maxTouchPoints: 0 }))).toBe('ready');
  });

  it.each([
    ['a service worker', { hasServiceWorker: false }],
    ['push', { hasPushManager: false }],
    ['notifications', { hasNotification: false }],
  ])('is unsupported without %s', (_name, over) => {
    expect(pushSupport(environment(over))).toBe('unsupported');
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes base64url, restoring the padding and the - and _ characters', () => {
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([251, 255]);
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3]);
    expect([...urlBase64ToUint8Array('AQI')]).toEqual([1, 2]);
  });

  it('is empty for nothing', () => {
    expect(urlBase64ToUint8Array('').length).toBe(0);
  });
});

describe('subscriptionInput', () => {
  it('turns a browser subscription and the settings into what the server expects', () => {
    const input = subscriptionInput({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }, settings);
    expect(input.subscription).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', expirationTime: null, keys: { p256dh: 'p', auth: 'a' } });
    expect(input.settings).toMatchObject({ hour: 8, quietStart: 22, quietEnd: 7 });
    expect(input.settings.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('sends no quiet hours when they are off', () => {
    const input = subscriptionInput({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } }, { ...settings, quietHours: false });
    expect(input.settings).toMatchObject({ quietStart: null, quietEnd: null });
  });
});

describe('turning reminders on and off in the browser', () => {
  const subscribe = vi.fn();
  const getSubscription = vi.fn();
  const register = vi.fn();
  const getRegistration = vi.fn();
  const requestPermission = vi.fn();
  const save = vi.fn();
  const remove = vi.fn();
  const unsubscribe = vi.fn();

  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe,
  };

  beforeEach(() => {
    for (const mock of [subscribe, getSubscription, register, getRegistration, requestPermission, save, remove, unsubscribe]) mock.mockReset();
    requestPermission.mockResolvedValue('granted');
    register.mockResolvedValue(undefined);
    getSubscription.mockResolvedValue(null);
    subscribe.mockResolvedValue(subscription);
    save.mockResolvedValue(undefined);
    remove.mockResolvedValue(undefined);
    unsubscribe.mockResolvedValue(true);
    const registration = { pushManager: { subscribe, getSubscription } };
    getRegistration.mockResolvedValue(registration);
    vi.stubGlobal('Notification', { requestPermission });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register, ready: Promise.resolve(registration), getRegistration },
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('asks for permission, registers the worker, subscribes and tells the server', async () => {
    await expect(enableReminders({ savePushSubscription: save }, settings)).resolves.toEqual({ ok: true });

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('/sw.js');
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ hour: 8 }) }));
  });

  it('asks for permission before anything else, and does nothing more if it is refused', async () => {
    requestPermission.mockResolvedValue('denied');

    await expect(enableReminders({ savePushSubscription: save }, settings)).resolves.toEqual({ ok: false, reason: 'denied' });

    expect(register).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('treats dismissing the permission prompt as a no', async () => {
    requestPermission.mockResolvedValue('default');
    await expect(enableReminders({ savePushSubscription: save }, settings)).resolves.toEqual({ ok: false, reason: 'denied' });
  });

  it('reuses a subscription the browser already has', async () => {
    getSubscription.mockResolvedValue(subscription);
    await enableReminders({ savePushSubscription: save }, settings);
    expect(subscribe).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('reports a failure, without throwing, when the server cannot be reached', async () => {
    save.mockRejectedValue(new Error('offline'));
    await expect(enableReminders({ savePushSubscription: save }, settings)).resolves.toEqual({ ok: false, reason: 'failed' });
  });

  it('reports a failure when the browser will not subscribe', async () => {
    subscribe.mockRejectedValue(new Error('no push service'));
    await expect(enableReminders({ savePushSubscription: save }, settings)).resolves.toEqual({ ok: false, reason: 'failed' });
  });

  it('saves new times for a device that is already subscribed', async () => {
    getSubscription.mockResolvedValue(subscription);
    await expect(updateReminderSettings({ savePushSubscription: save }, { ...settings, hour: 18 })).resolves.toBe(true);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ hour: 18 }) }));
  });

  it('has nothing to update for a device that is not subscribed', async () => {
    await expect(updateReminderSettings({ savePushSubscription: save }, settings)).resolves.toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('says so when new times could not be saved', async () => {
    getSubscription.mockResolvedValue(subscription);
    save.mockRejectedValue(new Error('offline'));
    await expect(updateReminderSettings({ savePushSubscription: save }, settings)).resolves.toBe(false);
  });

  it('removes the device from the server and from the browser', async () => {
    getSubscription.mockResolvedValue(subscription);

    await expect(disableReminders({ deletePushSubscription: remove })).resolves.toBe(true);

    expect(remove).toHaveBeenCalledWith('https://fcm.googleapis.com/fcm/send/abc');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('still stops reminders on the device when the server cannot be reached', async () => {
    getSubscription.mockResolvedValue(subscription);
    remove.mockRejectedValue(new Error('offline'));

    await expect(disableReminders({ deletePushSubscription: remove })).resolves.toBe(false);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('has nothing to do when the device was never subscribed', async () => {
    await expect(disableReminders({ deletePushSubscription: remove })).resolves.toBe(true);
    expect(remove).not.toHaveBeenCalled();
  });
});
