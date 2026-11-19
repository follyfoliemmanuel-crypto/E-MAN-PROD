import { HttpError } from './http.js';

export const ORDER_STATUSES = ['En attente', 'Devis envoyé', 'Validée', 'En production', 'Terminée', 'Annulée'];
export const PAYMENT_STATUSES = ['Non payé', 'Acompte payé', 'Payé'];
export const TRAINING_STATUSES = ['Nouvelle demande', 'Contacté', 'Inscrit', 'Terminé'];

export function text(value, label, { min = 0, max = 200, required = false } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) {
    if (required) throw new HttpError(400, `${label} : champ obligatoire.`);
    return null;
  }
  if (v.length < min) throw new HttpError(400, `${label} : ${min} caractères minimum.`);
  if (v.length > max) throw new HttpError(400, `${label} : ${max} caractères maximum.`);
  return v;
}

export function phone(value) {
  const v = String(value || '').replace(/[^\d+]/g, '');
  const digits = v.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) throw new HttpError(400, 'Numéro de téléphone invalide (8 chiffres minimum).');
  // Numéro togolais saisi sans indicatif : on ajoute +228.
  if (!v.startsWith('+') && digits.length === 8) return '+228' + digits;
  return v.startsWith('+') ? v : '+' + digits;
}

export function email(value, { required = false } = {}) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!v) {
    if (required) throw new HttpError(400, 'Adresse e-mail obligatoire.');
    return null;
  }
  if (v.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new HttpError(400, 'Adresse e-mail invalide.');
  return v;
}

export function password(value) {
  const v = typeof value === 'string' ? value : '';
  if (v.length < 8) throw new HttpError(400, 'Mot de passe : 8 caractères minimum.');
  if (v.length > 200) throw new HttpError(400, 'Mot de passe trop long.');
  return v;
}

export function oneOf(value, list, label) {
  if (!list.includes(value)) throw new HttpError(400, `${label} invalide.`);
  return value;
}

export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) throw new HttpError(400, 'Identifiant invalide.');
  return value;
}

/** Adresse d'image acceptée : https://… ou un chemin du site (/media/photo.jpg). */
export function imageUrl(value) {
  const u = typeof value === 'string' ? value.trim() : '';
  if (!u) throw new HttpError(400, 'Adresse de l’image obligatoire.');
  if (u.length > 1000) throw new HttpError(400, 'Adresse trop longue.');
  if (u.startsWith('/') && !u.startsWith('//')) {
    if (!/^\/[A-Za-z0-9._~\-/%]+$/.test(u) || u.includes('..')) throw new HttpError(400, 'Chemin d’image invalide.');
    return u;
  }
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    throw new HttpError(400, 'Adresse d’image invalide.');
  }
  if (parsed.protocol !== 'https:') throw new HttpError(400, 'L’adresse doit commencer par https://');
  return parsed.href;
}

export function slug(value, label = 'Identifiant') {
  if (typeof value !== 'string' || !/^[a-z0-9-]{2,60}$/.test(value)) throw new HttpError(400, `${label} invalide.`);
  return value;
}

/** Date au format AAAA-MM-JJ. */
export function date(value, label, { required = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new HttpError(400, `${label} : champ obligatoire.`);
    return null;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${label} invalide (format AAAA-MM-JJ).`);
  }
  return value;
}

/** Entier positif facultatif. */
export function intOrNull(value, label, { min = 0, max = 1e9 } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} invalide.`);
  return n;
}

export function bool(value) {
  return value === true || value === 'true';
}
