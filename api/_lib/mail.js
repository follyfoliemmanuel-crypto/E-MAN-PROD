// Envoi d'e-mails transactionnels. Fournisseur choisi par variables d'environnement :
//   MAIL_PROVIDER = resend | brevo        (par défaut : resend si une clé Resend est présente)
//   MAIL_API_KEY  = clé du fournisseur    (RESEND_API_KEY ou BREVO_API_KEY acceptées aussi)
//   MAIL_FROM     = "E-MAN PROD <contact@votre-domaine>"  (adresse vérifiée chez le fournisseur)
//   MAIL_REPLY_TO = adresse de réponse    (par défaut emanprod3@gmail.com)
// Sans fournisseur, le site fonctionne : les e-mails ne partent pas et le journal l'indique.
// Un e-mail n'est noté « envoyé » que si le fournisseur l'a accepté et a renvoyé un identifiant.
import { query } from './db.js';

export const DEFAULT_REPLY_TO = 'emanprod3@gmail.com';

const PROVIDERS = {
  resend: {
    label: 'Resend',
    url: 'https://api.resend.com/emails',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    body: ({ from, to, subject, html, text, replyTo }) => ({ from, to: [to], subject, html, text, reply_to: replyTo }),
    id: (data) => data?.id,
  },
  brevo: {
    label: 'Brevo',
    url: 'https://api.brevo.com/v3/smtp/email',
    headers: (key) => ({ 'api-key': key, accept: 'application/json' }),
    body: ({ from, to, subject, html, text, replyTo }) => {
      const m = String(from).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
      return {
        sender: m ? { name: m[1].replace(/^"|"$/g, '') || 'E-MAN PROD', email: m[2] } : { name: 'E-MAN PROD', email: from },
        to: [{ email: to }], subject, htmlContent: html, textContent: text, replyTo: { email: replyTo },
      };
    },
    id: (data) => data?.messageId,
  },
};

function config() {
  const env = process.env;
  const name = (env.MAIL_PROVIDER || (env.BREVO_API_KEY && !env.RESEND_API_KEY ? 'brevo' : 'resend')).toLowerCase();
  const provider = PROVIDERS[name] ? name : null;
  const key = env.MAIL_API_KEY || (provider === 'brevo' ? env.BREVO_API_KEY : env.RESEND_API_KEY);
  return { provider, key, from: env.MAIL_FROM, replyTo: env.MAIL_REPLY_TO || DEFAULT_REPLY_TO };
}

export const mailConfigured = () => {
  const c = config();
  return Boolean(c.provider && c.key && c.from);
};

/** État de la configuration, sans jamais renvoyer la clé. */
export function mailStatus() {
  const c = config();
  return {
    configured: mailConfigured(),
    provider: c.provider ? PROVIDERS[c.provider].label : null,
    provider_valid: Boolean(c.provider),
    key: Boolean(c.key),
    from: c.from || null,
    reply_to: c.replyTo,
    team_alerts_to: process.env.NOTIFY_TO || null,
  };
}

// Tests automatiques uniquement : un faux fournisseur local (jamais en production).
const endpointFor = (p) => (process.env.MAIL_TEST_ENDPOINT && !process.env.VERCEL ? `${process.env.MAIL_TEST_ENDPOINT}/${p}` : PROVIDERS[p].url);

async function log(entry) {
  try {
    await query(
      `insert into email_log (user_id, to_email, template, subject, status, provider, provider_id, error)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [entry.userId || null, entry.to, entry.template, entry.subject.slice(0, 300), entry.status, entry.provider || null, entry.providerId || null, entry.error ? String(entry.error).slice(0, 500) : null],
    );
  } catch (err) {
    console.error('email_log', err.message);
  }
}

/**
 * Envoie un e-mail et l'inscrit au journal.
 * @returns {Promise<{status: 'envoye'|'echec'|'non_configure'|'desactive', id?: string, error?: string}>}
 */
export async function deliverEmail({ to, subject, html, text, template = 'libre', userId = null, disabled = false }) {
  if (!to) return { status: 'echec', error: 'Adresse manquante.' };
  if (disabled) {
    await log({ to, subject, template, userId, status: 'desactive' });
    return { status: 'desactive' };
  }
  const c = config();
  if (!mailConfigured()) {
    await log({ to, subject, template, userId, status: 'non_configure' });
    return { status: 'non_configure' };
  }
  const p = PROVIDERS[c.provider];
  try {
    const res = await fetch(endpointFor(c.provider), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...p.headers(c.key) },
      body: JSON.stringify(p.body({ from: c.from, to, subject, html, text, replyTo: c.replyTo })),
      signal: AbortSignal.timeout(10000),
    });
    const raw = await res.text();
    let data = null;
    try { data = JSON.parse(raw); } catch { /* réponse non JSON */ }
    const id = res.ok ? p.id(data) : null;
    if (!id) {
      const error = res.ok ? 'Le fournisseur n’a pas confirmé l’envoi (aucun identifiant).' : `${p.label} ${res.status} : ${data?.message || data?.error?.message || raw.slice(0, 200)}`;
      console.error('E-mail non envoyé —', error);
      await log({ to, subject, template, userId, status: 'echec', provider: c.provider, error });
      return { status: 'echec', error };
    }
    await log({ to, subject, template, userId, status: 'envoye', provider: c.provider, providerId: String(id) });
    return { status: 'envoye', id: String(id) };
  } catch (err) {
    const error = err.name === 'TimeoutError' ? 'Le fournisseur n’a pas répondu à temps.' : err.message;
    await log({ to, subject, template, userId, status: 'echec', provider: c.provider, error });
    return { status: 'echec', error };
  }
}

/** Compatibilité : vrai seulement si le fournisseur a accepté le message. */
export async function sendMail({ to, subject, text, html, template, userId }) {
  return (await deliverEmail({ to, subject, text, html: html || `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(text || '')}</pre>`, template, userId })).status === 'envoye';
}

export const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
