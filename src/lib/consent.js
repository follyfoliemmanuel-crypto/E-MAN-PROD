// Choix de l'utilisateur sur les cookies et le stockage du navigateur.
// - Cookies techniques (session, sécurité) : toujours actifs, sans eux la connexion est impossible.
// - « Affichage rapide » : copie des photos et du catalogue sur l'appareil (localStorage). Facultatif.
// Aucune publicité, aucune mesure d'audience : rien d'autre n'est déposé.
const KEY = 'eman-cookies-v1';
const COMFORT_KEYS = ['eman-media-v1', 'emp_catalog_v1'];
export const CONSENT_EVENT = 'eman:cookies';
export const OPEN_EVENT = 'eman:cookies-open';

export function readConsent() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    return c && c.v === 1 ? c : null;
  } catch {
    return null;
  }
}

/** Mémorisation facultative autorisée ? Tant qu'aucun choix n'est fait, oui (aucun suivi, données du site seulement). */
export function comfortAllowed() {
  return readConsent()?.comfort !== false;
}

export function saveConsent(comfort) {
  const value = { v: 1, comfort: Boolean(comfort), at: new Date().toISOString() };
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
    if (!comfort) for (const k of COMFORT_KEYS) localStorage.removeItem(k);
  } catch { /* stockage indisponible : le choix vaut pour cette visite */ }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }));
  return value;
}

export const openCookieSettings = () => window.dispatchEvent(new Event(OPEN_EVENT));
