// Notifications push côté navigateur : service worker, autorisation, abonnement de cet appareil.
import { DEMO, call } from './api.js';

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
/** Sur iPhone et iPad, le push n'existe que pour le site ajouté à l'écran d'accueil. */
export const needsHomeScreen = () => isIos() && !isStandalone();

/** Enregistre le service worker (il ne gère que les notifications : aucun cache, aucune requête interceptée). */
export function registerServiceWorker() {
  if (DEMO || typeof window === 'undefined' || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}); });
}

async function registration() {
  const reg = (await navigator.serviceWorker.getRegistration('/')) || (await navigator.serviceWorker.register('/sw.js', { scope: '/' }));
  return navigator.serviceWorker.ready.then(() => reg);
}

function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export const pushApi = {
  status: () => call('/api/account?push=1'),
  remove: (id) => call('/api/account', { method: 'POST', body: { action: 'push_unsubscribe', id } }),
  test: () => call('/api/account', { method: 'POST', body: { action: 'push_test' } }),
};

/** Abonnement de cet appareil, s'il existe. */
export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Demande l'autorisation, abonne cet appareil et le rattache au compte connecté. */
export async function enablePush(publicKey) {
  if (!pushSupported()) throw new Error('Ce navigateur ne permet pas les notifications push.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    throw new Error(perm === 'denied'
      ? 'Les notifications sont bloquées pour ce site. Autorisez-les dans les réglages du navigateur (icône à gauche de l’adresse), puis réessayez.'
      : 'Autorisation non accordée.');
  }
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // Abonnement fait avec une autre clé (clés changées côté serveur) : on le renouvelle.
  const key = keyBytes(publicKey);
  const same = sub?.options?.applicationServerKey && new Uint8Array(sub.options.applicationServerKey).every((b, i) => b === key[i]);
  if (sub && !same) { await sub.unsubscribe().catch(() => {}); sub = null; }
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    } catch (err) {
      throw new Error('Ce navigateur n’a pas pu joindre son service de notifications (connexion, mode navigation privée ou navigateur sans service push). Réessayez, ou utilisez Chrome, Edge, Firefox ou Safari à jour.');
    }
  }
  await call('/api/account', { method: 'POST', body: { action: 'push_subscribe', subscription: sub.toJSON() } });
  try { localStorage.setItem(OPT_IN, '1'); } catch { /* stockage indisponible */ }
  return sub;
}

const OPT_IN = 'eman-push-optin';
/** Après connexion : si cet appareil avait déjà choisi les notifications, on le réabonne sans rien demander. */
export async function restorePush() {
  try {
    if (DEMO || !pushSupported() || Notification.permission !== 'granted' || localStorage.getItem(OPT_IN) !== '1') return;
    const { public_key: key } = await pushApi.status();
    if (key) await enablePush(key);
  } catch { /* l'utilisateur pourra réactiver depuis son profil */ }
}

/** Désactive les notifications sur cet appareil (navigateur + serveur). */
export async function disablePush({ forget = true } = {}) {
  if (forget) { try { localStorage.removeItem(OPT_IN); } catch { /* stockage indisponible */ } }
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await call('/api/account', { method: 'POST', body: { action: 'push_unsubscribe', endpoint } }).catch(() => {});
}
