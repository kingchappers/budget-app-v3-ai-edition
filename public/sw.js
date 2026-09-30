// Bill reminders. This file is only registered once someone turns reminders on in Settings,
// and does nothing except show a notification and open the app when it is tapped.

const ACTIONS = ['add', 'skip'];
const FALLBACK_TITLE = 'Bill reminder';
const FALLBACK_BODY = 'Open Budget to see what is due.';

// Where a tap should lead: the app at Home, with the bill and the chosen action in the address.
// Anything that is not an address on this site, or an action we know, is ignored.
function notificationTarget(data, action) {
  const base = self.location.origin;
  let url;
  try {
    url = new URL(data && typeof data.url === 'string' ? data.url : '/', base);
  } catch (error) {
    return '/';
  }
  if (url.origin !== base) return '/';

  const target = new URL('/', base);
  const due = url.searchParams.get('due');
  const period = url.searchParams.get('period');
  if (due) target.searchParams.set('due', due);
  if (period) target.searchParams.set('period', period);
  if (due && ACTIONS.includes(action)) target.searchParams.set('action', action);
  return target.pathname + target.search;
}

function readPayload(event) {
  try {
    return event.data ? event.data.json() : null;
  } catch (error) {
    return null;
  }
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  const data = readPayload(event);
  const known = data && typeof data.title === 'string' && data.title !== '';

  // A push that shows nothing is not allowed, so an unreadable one still says something plain.
  event.waitUntil(
    self.registration.showNotification(known ? data.title : FALLBACK_TITLE, {
      body: known && typeof data.body === 'string' ? data.body : FALLBACK_BODY,
      icon: '/icons/icon-192.png',
      // One notification per bill and period: a later one replaces it instead of stacking.
      tag: known && data.recurringId ? `${data.recurringId}:${data.period || ''}` : 'bill-reminder',
      data: known ? { url: data.url } : { url: '/' },
      actions: known && data.recurringId
        ? [{ action: 'add', title: 'Add' }, { action: 'skip', title: 'Skip' }]
        : [],
    }),
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = notificationTarget(event.notification.data, event.action);

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      if ('navigate' in open) {
        try {
          await open.navigate(target);
          return;
        } catch (error) {
          // Fall through and open a new window instead.
        }
      }
    }
    await self.clients.openWindow(target);
  })());
});
