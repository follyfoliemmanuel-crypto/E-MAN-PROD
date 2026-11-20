// Abonnements push d'un compte : chaque appareil est rattaché au compte connecté (jamais à un
// identifiant envoyé par le navigateur). Un compte peut avoir plusieurs appareils.
import { query, one } from '../db.js';
import { HttpError } from '../http.js';
import { vapidKeys, allowedEndpoint, deviceLabel, pushToUsers } from '../push.js';
import { logActivity } from '../activity.js';

const MAX_DEVICES = 10;

export async function pushStatus(userId) {
  let publicKey = null; let error = null;
  try { publicKey = (await vapidKeys()).publicKey; } catch (err) {
    // Le détail (noms de variables) reste dans le journal du serveur, jamais dans la réponse.
    console.error(JSON.stringify({ level: 'error', event: 'push.keys', message: err.message }));
    error = 'Notifications push indisponibles pour le moment : l’administrateur doit vérifier la configuration.';
  }
  const devices = await query(
    `select id, device_label, created_at, last_seen_at, last_success_at, failures, endpoint
       from push_subscriptions where user_id = $1 order by last_seen_at desc`, [userId]);
  return {
    configured: Boolean(publicKey), public_key: publicKey, error,
    // L'adresse complète d'un appareil n'est pas renvoyée : seulement de quoi reconnaître celui-ci.
    devices: devices.map(({ endpoint, ...d }) => ({ ...d, endpoint_hint: endpoint.slice(-16) })),
  };
}

export async function subscribe(actor, sub, userAgent) {
  if (!allowedEndpoint(sub.endpoint)) throw new HttpError(400, 'Ce navigateur utilise un service de notifications non reconnu.');
  const count = await one('select count(*)::int as n from push_subscriptions where user_id = $1 and endpoint <> $2', [actor.id, sub.endpoint]);
  if (count.n >= MAX_DEVICES) {
    // On garde les plus récents : le plus ancien appareil laisse sa place.
    await query(`delete from push_subscriptions where id = (select id from push_subscriptions where user_id = $1 order by last_seen_at asc limit 1) returning id`, [actor.id]);
  }
  const row = await one(
    `insert into push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
     values ($1, $2, $3, $4, $5)
     on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
       device_label = excluded.device_label, last_seen_at = now(), failures = 0, last_error = null
     returning id, (xmax = 0) as created`,
    [actor.id, sub.endpoint, sub.keys.p256dh, sub.keys.auth, deviceLabel(userAgent)],
  );
  if (row.created) await logActivity(actor, 'push.subscribed', 'user', actor.id, { device: deviceLabel(userAgent) });
  return { id: row.id };
}

/** Retire un appareil du compte (par son identifiant, ou par son adresse pour l'appareil courant). */
export async function unsubscribe(actor, { id, endpoint }) {
  const rows = id
    ? await query('delete from push_subscriptions where id = $1 and user_id = $2 returning id', [id, actor.id])
    : await query('delete from push_subscriptions where endpoint = $1 and user_id = $2 returning id', [endpoint, actor.id]);
  if (rows.length) await logActivity(actor, 'push.unsubscribed', 'user', actor.id, {});
  return { removed: rows.length };
}

/** Notification d'essai envoyée à mes propres appareils seulement. */
export async function testPush(actor) {
  const r = await pushToUsers([actor.id], { kind: 'test', link: '/espace?section=profil', ttl: 300, urgency: 'high' });
  if (!r.devices) throw new HttpError(409, 'Aucun appareil abonné : activez d’abord les notifications sur cet appareil.');
  return r;
}
