/*
 * Push handling, imported into the generated service worker.
 *
 * Kept as a plain file next to the app rather than folded into the Workbox build:
 * the generated worker is regenerated on every deploy, and this needs to survive
 * that untouched.
 */

self.addEventListener('push', (event) => {
  // A push with no readable payload still has to show something: the browsers
  // that require userVisibleOnly will otherwise post their own "site updated in
  // the background" notice.
  let message = { title: 'pnkt', body: '', url: '/' };
  try {
    if (event.data) message = { ...message, ...event.data.json() };
  } catch {
    // Malformed payload; the generic title is better than nothing.
  }

  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      // Replaces rather than stacks: a second reminder for the same month should
      // not leave two entries on the lock screen.
      tag: 'pnkt',
      renotify: true,
      data: { url: message.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Reuse the open app if there is one; a second window loses its state.
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
