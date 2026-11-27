// Modèles d'e-mails transactionnels E-MAN PROD (HTML + texte brut).
// L'administration peut remplacer l'objet et le paragraphe d'introduction de chaque modèle
// (réglage « email_templates »), avec des variables entre accolades : {prenom}, {numero}…
import { one } from './db.js';
import { deliverEmail, escapeHtml, DEFAULT_REPLY_TO } from './mail.js';

/** Modèles : objet, titre, introduction (modifiables), détails et bouton (fixes). */
export const TEMPLATES = {
  account_verify: {
    label: 'Confirmation d’inscription', category: 'account',
    vars: ['prenom', 'lien'],
    subject: 'Confirmez votre adresse e-mail',
    title: 'Bienvenue chez E-MAN PROD',
    intro: 'Bonjour {prenom}, votre espace client est créé. Confirmez votre adresse e-mail pour suivre vos devis, commandes et formations.',
    cta: 'Confirmer mon adresse',
    outro: 'Ce lien est valable 48 heures. Si vous n’avez pas créé de compte, ignorez ce message.',
  },
  account_exists: {
    label: 'Inscription avec une adresse déjà inscrite', category: 'account',
    vars: ['prenom', 'lien'],
    subject: 'Vous avez déjà un compte E-MAN PROD',
    title: 'Votre compte existe déjà',
    intro: 'Bonjour {prenom}, une inscription vient d’être faite avec une adresse qui a déjà un compte E-MAN PROD (peut-être votre première tentative). Cliquez sur le bouton et choisissez votre mot de passe : votre adresse est confirmée et vous êtes connecté directement.',
    cta: 'Choisir mon mot de passe et me connecter',
    outro: 'Ce lien est valable 24 heures. Si vous n’êtes pas à l’origine de cette inscription, ignorez ce message : rien ne change sur votre compte.',
  },
  password_reset: {
    label: 'Réinitialisation du mot de passe', category: 'account',
    vars: ['prenom', 'lien'],
    subject: 'Réinitialisez votre mot de passe',
    title: 'Nouveau mot de passe',
    intro: 'Bonjour {prenom}, une demande de nouveau mot de passe a été faite pour votre espace E-MAN PROD.',
    cta: 'Choisir un nouveau mot de passe',
    outro: 'Ce lien est valable 1 heure et ne sert qu’une fois. Si vous n’êtes pas à l’origine de la demande, ignorez ce message : votre mot de passe actuel reste valable.',
  },
  staff_invite: {
    label: 'Invitation d’un collaborateur', category: 'account',
    vars: ['prenom', 'invite_par', 'lien'],
    subject: 'Votre accès à l’espace E-MAN PROD',
    title: 'Votre accès à l’espace de gestion',
    intro: 'Bonjour {prenom}, {invite_par} vous a ouvert un accès à l’espace de gestion E-MAN PROD.',
    cta: 'Choisir mon mot de passe',
    outro: 'Ce lien est valable 72 heures et ne sert qu’une fois.',
  },
  quote_received: {
    label: 'Confirmation de demande de devis', category: 'quotes',
    vars: ['prenom', 'numero', 'prestations', 'lien'],
    subject: 'Demande de devis {numero} reçue',
    title: 'Nous avons bien reçu votre demande',
    intro: 'Bonjour {prenom}, merci pour votre demande. L’atelier l’étudie et vous envoie un devis chiffré dans votre espace.',
    cta: 'Suivre ma demande',
  },
  quote_sent: {
    label: 'Envoi de devis', category: 'quotes',
    vars: ['prenom', 'numero', 'total', 'validite', 'lien'],
    subject: 'Votre devis {numero} est disponible',
    title: 'Votre devis est prêt',
    intro: 'Bonjour {prenom}, votre devis est disponible dans votre espace. Vous pouvez le télécharger en PDF, l’accepter ou le refuser en ligne.',
    cta: 'Voir mon devis',
  },
  quote_decision: {
    label: 'Devis accepté ou refusé', category: 'quotes',
    vars: ['prenom', 'numero', 'decision', 'lien'],
    subject: 'Devis {numero} : {decision}',
    title: 'Votre réponse est enregistrée',
    intro: 'Bonjour {prenom}, le devis {numero} est désormais {decision}.',
    cta: 'Voir le devis',
  },
  order_received: {
    label: 'Commande envoyée par le client', category: 'orders',
    vars: ['prenom', 'numero', 'lien'],
    subject: 'Commande {numero} bien reçue',
    title: 'Nous avons reçu votre commande',
    intro: 'Bonjour {prenom}, votre commande {numero} est bien arrivée à l’atelier. Nous la vérifions et vous confirmons le prix et la date dans votre espace.',
    cta: 'Suivre ma commande',
  },
  order_confirmed: {
    label: 'Confirmation de commande', category: 'orders',
    vars: ['prenom', 'numero', 'total', 'date_prevue', 'lien'],
    subject: 'Commande {numero} confirmée',
    title: 'Votre commande est enregistrée',
    intro: 'Bonjour {prenom}, votre commande est confirmée. Vous suivez son avancement dans votre espace.',
    cta: 'Suivre ma commande',
  },
  order_update: {
    label: 'Mise à jour de commande', category: 'orders',
    vars: ['prenom', 'numero', 'statut', 'lien'],
    subject: 'Commande {numero} : {statut}',
    title: 'Votre commande avance',
    intro: 'Bonjour {prenom}, votre commande {numero} est passée au statut « {statut} ».',
    cta: 'Voir ma commande',
  },
  order_ready: {
    label: 'Commande prête', category: 'orders',
    vars: ['prenom', 'numero', 'lien'],
    subject: 'Commande {numero} prête',
    title: 'Votre commande est prête',
    intro: 'Bonjour {prenom}, bonne nouvelle : votre commande {numero} est prête. Contactez-nous pour convenir du retrait ou de la livraison.',
    cta: 'Voir ma commande',
  },
  enrollment_confirmed: {
    label: 'Confirmation d’inscription à une formation', category: 'trainings',
    vars: ['prenom', 'formation', 'session', 'lieu', 'lien'],
    subject: 'Inscription confirmée : {formation}',
    title: 'Votre place est confirmée',
    intro: 'Bonjour {prenom}, votre inscription à la formation « {formation} » est confirmée.',
    cta: 'Voir mon inscription',
  },
  certificate_issued: {
    label: 'Attestation disponible', category: 'trainings',
    vars: ['prenom', 'formation', 'numero', 'lien'],
    subject: 'Votre {document} est disponible',
    title: 'Félicitations',
    intro: 'Bonjour {prenom}, votre {document} pour la formation « {formation} » est disponible dans votre espace.',
    cta: 'Télécharger mon document',
  },
  message_new: {
    label: 'Nouveau message de l’équipe', category: 'messages',
    vars: ['prenom', 'sujet', 'lien'],
    subject: '{sujet}',
    title: 'Vous avez un nouveau message',
    intro: 'Bonjour {prenom}, l’équipe E-MAN PROD vous a répondu.',
    cta: 'Lire le message',
  },
  announcement: {
    label: 'Information importante', category: 'announcements',
    vars: ['prenom', 'titre'],
    subject: '{titre}',
    title: '{titre}',
    intro: 'Bonjour {prenom},',
    cta: 'En savoir plus',
  },
  invoice_issued: {
    label: 'Facture émise', category: 'orders',
    vars: ['prenom', 'numero', 'total', 'lien'],
    subject: 'Facture {numero}',
    title: 'Votre facture est disponible',
    intro: 'Bonjour {prenom}, la facture {numero} est disponible dans votre espace, rubrique Mes documents.',
    cta: 'Voir mes documents',
  },
  security_alert: {
    label: 'Alerte de sécurité (nouvelle connexion)', category: 'account',
    vars: ['prenom', 'appareil'],
    subject: 'Nouvelle connexion à votre compte E-MAN PROD',
    title: 'Nouvelle connexion à votre compte',
    intro: 'Bonjour {prenom}, une connexion à votre compte vient d’avoir lieu depuis {appareil}. Si c’était vous, il n’y a rien à faire. Sinon, révoquez cet appareil et changez votre mot de passe tout de suite.',
    cta: 'Vérifier mes appareils',
  },
  team_alert: {
    label: 'Alerte pour l’équipe', category: 'team',
    vars: ['titre'],
    subject: '[E-MAN PROD] {titre}',
    title: '{titre}',
    intro: 'Nouvelle activité dans l’espace de gestion.',
    cta: 'Ouvrir l’espace de gestion',
  },
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATES);

async function setting(key) {
  return (await one('select value from site_settings where key = $1', [key]))?.value || {};
}

const fill = (tpl, vars) => String(tpl).replace(/\{([a-z_]+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));

/** Adresse publique du site pour les liens des e-mails : SITE_URL, sinon l'adresse de production Vercel. */
export const siteUrl = () => (process.env.SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
  || 'https://www.emanprod.com').replace(/\/$/, '');

/**
 * Construit l'e-mail : { subject, html, text }.
 * @param {string} key  modèle
 * @param {object} vars variables (déjà en texte)
 * @param {{ details?: [string,string][], body?: string, link?: string }} extra
 */
export async function renderEmail(key, vars = {}, extra = {}, overrides = null) {
  const t = TEMPLATES[key];
  if (!t) throw new Error(`Modèle d’e-mail inconnu : ${key}`);
  const [custom, biz] = await Promise.all([overrides ? Promise.resolve(overrides) : setting('email_templates'), setting('business')]);
  const o = (overrides ? overrides : custom[key]) || {};
  const v = { ...vars, document: vars.document || 'attestation' };
  const subject = fill(o.subject || t.subject, v).replace(/\s+/g, ' ').trim();
  const title = fill(t.title, v);
  const intro = fill(o.intro || t.intro, v);
  const site = siteUrl();
  const link = extra.link ? (extra.link.startsWith('http') ? extra.link : `${site}${extra.link}`) : null;
  const details = (extra.details || []).filter(([, val]) => val !== null && val !== undefined && val !== '');
  const d = String(biz.phone || '').replace(/\D/g, '');
  const tel = d.length === 11 && d.startsWith('228') ? `+228 ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)} ${d.slice(9)}` : biz.phone;
  const contact = [tel && `Tél. / WhatsApp ${tel}`, biz.email || DEFAULT_REPLY_TO].filter(Boolean).join(' · ');
  const address = (biz.sites || []).map((s) => `${s.label} : ${s.address}`).join(' · ') || 'Lomé, Togo';
  const slogan = biz.slogan || 'E-man Prod, la référence !';
  const logo = site ? `<img src="${escapeHtml(site)}/logo-eman-prod.png" width="150" alt="E-MAN PROD" style="display:block;border:0;max-width:150px;height:auto;background:#fff;border-radius:6px;padding:6px 10px">` : '<span style="font:700 22px Arial,sans-serif;color:#fff;letter-spacing:.5px">E-MAN PROD</span>';

  const para = (s) => `<p style="margin:0 0 14px;font:15px/1.6 Arial,Helvetica,sans-serif;color:#1f2433">${escapeHtml(s).replace(/\n/g, '<br>')}</p>`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef1f6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#0f1b3d;padding:22px 28px">${logo}<div style="font:13px Arial,sans-serif;color:#c9d2ee;margin-top:8px">${escapeHtml(slogan)}</div></td></tr>
<tr><td style="height:4px;line-height:4px;font-size:0;background:linear-gradient(90deg,#1e26c4 50%,#d3121c 50%)">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 8px">
<h1 style="margin:0 0 16px;font:700 22px/1.3 Arial,Helvetica,sans-serif;color:#0f1b3d">${escapeHtml(title)}</h1>
${para(intro)}
${extra.body ? para(extra.body) : ''}
${details.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border:1px solid #e3e7ef;border-radius:8px">${details.map(([k, val], i) => `<tr><td style="padding:10px 14px;font:13px Arial,sans-serif;color:#5b6478;${i ? 'border-top:1px solid #e3e7ef;' : ''}width:40%">${escapeHtml(k)}</td><td style="padding:10px 14px;font:600 14px Arial,sans-serif;color:#1f2433;${i ? 'border-top:1px solid #e3e7ef;' : ''}">${escapeHtml(val)}</td></tr>`).join('')}</table>` : ''}
${link && t.cta ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 22px"><tr><td style="background:#d3121c;border-radius:6px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:13px 22px;font:700 15px Arial,sans-serif;color:#ffffff;text-decoration:none">${escapeHtml(t.cta)}</a></td></tr></table>
<p style="margin:0 0 14px;font:12px/1.5 Arial,sans-serif;color:#5b6478">Si le bouton ne fonctionne pas, copiez ce lien : <br><a href="${escapeHtml(link)}" style="color:#1e26c4;word-break:break-all">${escapeHtml(link)}</a></p>` : ''}
${t.outro ? `<p style="margin:0 0 14px;font:13px/1.5 Arial,sans-serif;color:#5b6478">${escapeHtml(fill(t.outro, v))}</p>` : ''}
</td></tr>
<tr><td style="padding:18px 28px 24px;border-top:1px solid #e3e7ef;font:12px/1.6 Arial,sans-serif;color:#5b6478">
<strong style="color:#0f1b3d">E-MAN PROD</strong> — ${escapeHtml(address)}<br>${escapeHtml(contact)}<br>
${t.category === 'account' || t.category === 'team' ? '' : `Vous recevez ce message à propos de votre espace client. Vous pouvez choisir les e-mails reçus dans votre espace, rubrique Mon profil.`}
</td></tr></table></td></tr></table></body></html>`;

  const text = [
    title, '', intro, extra.body || '', '',
    ...details.map(([k, val]) => `${k} : ${val}`),
    details.length ? '' : null,
    link ? `${t.cta || 'Lien'} : ${link}` : null,
    t.outro ? `\n${fill(t.outro, v)}` : null,
    '', '—', `E-MAN PROD — ${address}`, contact,
  ].filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
  return { subject: `${subject} — E-MAN PROD`, html, text };
}

/** Rend puis envoie un modèle. Renvoie le résultat honnête de l'envoi. */
export async function sendTemplate(key, { to, userId = null, vars = {}, details, body, link, disabled = false }) {
  const mail = await renderEmail(key, vars, { details, body, link });
  return deliverEmail({ to, userId, template: key, disabled, ...mail });
}
