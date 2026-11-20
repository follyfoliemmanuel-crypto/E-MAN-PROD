/* Service worker d'E-MAN PROD : notifications push uniquement.
   Il ne met rien en cache et n'intercepte aucune requête : le site se comporte exactement comme avant. */
const VERSION = 'push-1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/** Lien interne seulement : une notification n'ouvre jamais un autre site. */
function internalPath(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\') ? url.slice(0, 300) : '/espace';
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 80) : 'E-MAN PROD';
  const body = typeof data.body === 'string' ? data.body.slice(0, 200) : 'Vous avez une nouvelle notification.';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    tag: typeof data.tag === 'string' ? data.tag.slice(0, 40) : 'eman-prod',
    renotify: true,
    data: { url: internalPath(data.url), v: VERSION },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(internalPath(event.notification.data?.url), self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Une fenêtre du site est déjà ouverte : on l'amène devant et on l'envoie sur la bonne page.
    const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (win) {
      try { await win.focus(); } catch { /* certains navigateurs refusent */ }
      try { await win.navigate(target); return; } catch { /* page non contrôlée : on ouvre un onglet */ }
    }
    await self.clients.openWindow(target);
  })());
});

// Le navigateur a renouvelé l'abonnement (clé changée, expiration) : on prévient le serveur.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const old = event.oldSubscription;
      const fresh = event.newSubscription || await self.registration.pushManager.subscribe(old?.options || { userVisibleOnly: true });
      await fetch('/api/account', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'push_subscribe', subscription: fresh.toJSON() }),
      });
      if (old) {
        await fetch('/api/account', {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'push_unsubscribe', endpoint: old.endpoint }),
        });
      }
    } catch { /* l'utilisateur pourra réactiver depuis son profil */ }
  })());
});
