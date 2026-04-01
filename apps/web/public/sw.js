/* eslint-disable no-restricted-globals */
// Service worker for Web Push notifications

self.addEventListener('push', (event) => {
  if (!event.data) return

  try {
    const payload = event.data.json()
    const title = payload.title || 'Area Code'
    const options = {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      data: payload.data || {},
      tag: payload.data?.rewardId || 'default',
      renotify: true,
    }

    event.waitUntil(self.registration.showNotification(title, options))
  } catch {
    // Malformed push payload — ignore
  }
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
