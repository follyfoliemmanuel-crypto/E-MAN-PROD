// Validation des données reçues par l'API, avec Zod.
// Chaque champ a un message d'erreur en français, renvoyé tel quel au visiteur.
import { z } from 'zod';
import { HttpError } from './http.js';

/** Valide `data` ; en cas d'erreur, renvoie 400 avec le premier message. */
export function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  throw new HttpError(400, r.error.issues[0]?.message || 'Données invalides.');
}

/**
 * Pour les mises à jour partielles : seuls les champs présents dans `body` sont
 * validés et renvoyés. Un champ envoyé vide (« » ou null) efface la valeur.
 */
export function parsePatch(schema, body) {
  const keys = Object.keys(schema.shape).filter((k) => Object.prototype.hasOwnProperty.call(body || {}, k));
  if (!keys.length) throw new HttpError(400, 'Aucune modification envoyée.');
  return parse(schema.pick(Object.fromEntries(keys.map((k) => [k, true]))), body);
}

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const trimmed = (v) => (typeof v === 'string' ? v.trim() : v);

/** Champ facultatif : vide → null. */
function optional(schema) {
  return z.preprocess((v) => (blank(v) ? undefined : trimmed(v)), schema.optional()).transform((v) => v ?? null);
}
function required(schema) {
  return z.preprocess((v) => (blank(v) ? undefined : trimmed(v)), schema);
}

export function text(label, { min = 1, max = 200, req = false } = {}) {
  const s = z
    .string({ required_error: `${label} : champ obligatoire.`, invalid_type_error: `${label} : texte attendu.` })
    .min(min, `${label} : ${min} caractères minimum.`)
    .max(max, `${label} : ${max} caractères maximum.`);
  return req ? required(s) : optional(s);
}

export const phone = (label = 'Téléphone', { req = true } = {}) => {
  const s = z
    .string({ required_error: `${label} : champ obligatoire.`, invalid_type_error: `${label} invalide.` })
    .transform((v) => {
      const cleaned = v.replace(/[^\d+]/g, '');
      const digits = cleaned.replace(/\D/g, '');
      // Numéro togolais saisi sans indicatif : on ajoute +228.
      if (!cleaned.startsWith('+') && digits.length === 8) return '+228' + digits;
      return '+' + digits;
    })
    .refine((v) => /^\+\d{8,15}$/.test(v), `${label} invalide (8 chiffres minimum).`);
  return req ? required(s) : optional(s);
};

export const email = ({ req = false } = {}) => {
  const s = z
    .string({ required_error: 'Adresse e-mail obligatoire.', invalid_type_error: 'Adresse e-mail invalide.' })
    .transform((v) => v.toLowerCase())
    .refine((v) => v.length <= 200 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Adresse e-mail invalide.');
  return req ? required(s) : optional(s);
};

export const uuid = (label = 'Identifiant') =>
  z.string({ required_error: `${label} manquant.`, invalid_type_error: `${label} invalide.` }).regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, `${label} invalide.`);

export const optionalUuid = (label) => optional(uuid(label));

export const slug = (label = 'Identifiant') =>
  z.string({ required_error: `${label} manquant.`, invalid_type_error: `${label} invalide.` }).regex(/^[a-z0-9-]{2,60}$/, `${label} invalide (minuscules, chiffres et tirets).`);

export const optionalSlug = (label) => optional(slug(label));

export function date(label, { req = false } = {}) {
  const s = z
    .string({ required_error: `${label} : champ obligatoire.`, invalid_type_error: `${label} invalide.` })
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().startsWith(v), `${label} invalide (format AAAA-MM-JJ).`);
  return req ? required(s) : optional(s);
}

const toNumber = (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/\s/g, '')) : v);

/** Montant en FCFA (entier, 0 à 100 milliards). */
export function fcfa(label, { req = false } = {}) {
  const s = z
    .number({ required_error: `${label} : champ obligatoire.`, invalid_type_error: `${label} : nombre attendu.` })
    .int(`${label} : nombre entier attendu (FCFA).`)
    .min(0, `${label} : le montant ne peut pas être négatif.`)
    .max(1e11, `${label} : montant trop élevé.`);
  return z.preprocess((v) => (blank(v) ? undefined : toNumber(v)), req ? s : s.optional()).transform((v) => v ?? null);
}

export function int(label, { min = 0, max = 1e9, req = false } = {}) {
  const s = z
    .number({ required_error: `${label} : champ obligatoire.`, invalid_type_error: `${label} : nombre attendu.` })
    .int(`${label} : nombre entier attendu.`)
    .min(min, `${label} : ${min} minimum.`)
    .max(max, `${label} : ${max} maximum.`);
  return z.preprocess((v) => (blank(v) ? undefined : toNumber(v)), req ? s : s.optional()).transform((v) => v ?? null);
}

export const quantity = z.preprocess(
  (v) => (blank(v) ? 1 : toNumber(v)),
  z.number({ invalid_type_error: 'Quantité : nombre attendu.' })
    .gt(0, 'Quantité : doit être supérieure à 0.')
    .max(1e6, 'Quantité trop élevée.')
    .refine((n) => Math.round(n * 100) === n * 100, 'Quantité : 2 décimales maximum.'),
);

export const bool = z.preprocess((v) => v === true || v === 'true' || v === 1, z.boolean());

export const oneOf = (values, label) =>
  z.enum(values, { errorMap: () => ({ message: `${label} invalide.` }) });

export const list = (item, label, { max = 30 } = {}) =>
  z.preprocess((v) => (v === undefined || v === null ? [] : v), z.array(item, { invalid_type_error: `${label} : liste attendue.` }).max(max, `${label} : ${max} éléments maximum.`));

/** Adresse d'image : https://… ou un chemin du site (/media/photo.jpg). */
export const imageUrl = required(
  z.string({ required_error: 'Adresse de l’image obligatoire.', invalid_type_error: 'Adresse de l’image invalide.' })
    .max(1000, 'Adresse trop longue.')
    .refine((u) => {
      // Image envoyée dans le stockage du site (voir /api/files).
      if (/^\/api\/files\?id=[0-9a-f-]{36}&inline=1$/.test(u)) return true;
      if (u.startsWith('/') && !u.startsWith('//')) return /^\/[A-Za-z0-9._~\-/%]+$/.test(u) && !u.includes('..');
      try {
        return new URL(u).protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Adresse d’image invalide : https://… ou /media/…'),
);

// ---------------------------------------------------------------------------
// Statuts : une seule définition, utilisée par les règles métier et la base.
// ---------------------------------------------------------------------------
export const QUOTE_STATUSES = ['nouveau', 'en_etude', 'envoye', 'accepte', 'refuse', 'expire', 'annule'];
export const ORDER_STATUSES = ['confirmee', 'en_production', 'terminee', 'livree', 'annulee'];
export const PAYMENT_STATUSES = ['non_paye', 'acompte', 'paye'];
export const ENROLLMENT_STATUSES = ['Nouvelle demande', 'Contacté', 'Inscrit', 'Terminé', 'Annulé'];
export const PORTFOLIO_STATUSES = ['brouillon', 'publie', 'masque'];
export const TESTIMONIAL_STATUSES = ['en_attente', 'publie', 'refuse'];
export const CLIENT_TYPES = ['particulier', 'entreprise', 'association', 'etablissement'];

// ---------------------------------------------------------------------------
// Schémas partagés
// ---------------------------------------------------------------------------
export const customer = {
  name: text('Nom', { min: 2, max: 120, req: true }),
  phone: phone(),
  email: email(),
  company: text('Entreprise', { max: 160 }),
};

/** Ligne de devis ou de commande. */
export const lineItem = z.object({
  service_slug: optionalSlug('Prestation'),
  label: text('Intitulé de la ligne', { min: 2, max: 160 }),
  description: text('Détail de la ligne', { max: 2000 }),
  quantity,
  unit: text('Unité', { max: 30 }),
  unit_price_fcfa: fcfa('Prix unitaire'),
});

/** Choix facultatif : vide → null. */
export const optionalOneOf = (values, label) => optional(oneOf(values, label));
