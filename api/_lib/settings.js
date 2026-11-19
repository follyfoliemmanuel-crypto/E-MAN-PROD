// Paramètres de l'entreprise enregistrés dans site_settings, avec leurs valeurs par défaut.
// Rien n'est inventé : un champ légal ou une condition non renseignés restent vides.
import { one } from './db.js';

export const DOCUMENT_DEFAULTS = {
  quote_validity_days: 30,
  // Conditions imprimées sur les devis et factures, rédigées par l'administration.
  quote_conditions: '',
  invoice_conditions: '',
  // Moyens de paiement acceptés et coordonnées (Mobile Money, banque) : texte libre.
  payment_instructions: '',
  signature_label: 'Bon pour accord',
};

export async function getSetting(key) {
  return (await one('select value from site_settings where key = $1', [key]))?.value || {};
}

export async function documentSettings() {
  const [documents, business, legal] = await Promise.all([getSetting('documents'), getSetting('business'), getSetting('legal')]);
  return { documents: { ...DOCUMENT_DEFAULTS, ...documents }, business, legal };
}

export async function quoteValidityDays() {
  const d = Number((await getSetting('documents')).quote_validity_days);
  return Number.isInteger(d) && d >= 1 && d <= 365 ? d : DOCUMENT_DEFAULTS.quote_validity_days;
}

/** Boutons WhatsApp configurables (numéro vide = numéro principal de l'entreprise). */
export const WHATSAPP_PURPOSES = {
  contact: 'Contact direct',
  info: 'Demande de renseignements',
  quote: 'Demande de devis',
  support: 'Assistance',
  training: 'Orientation formation',
};

/** Réseaux sociaux acceptés et leurs domaines. */
export const SOCIALS = {
  facebook: ['facebook.com', 'fb.com'],
  instagram: ['instagram.com'],
  tiktok: ['tiktok.com'],
  linkedin: ['linkedin.com'],
  youtube: ['youtube.com', 'youtu.be'],
  x: ['x.com', 'twitter.com'],
};
