// Client des fonctions /api (Vercel + Neon).
// VITE_DEMO=1 active un mode démonstration sans serveur (données locales),
// utile pour présenter le site avant le branchement de la base.
import { PRESTATIONS as SEED_PRESTATIONS, POLES as SEED_POLES, COURSES as SEED_COURSES, CONTENT as SEED_CONTENT } from '../content/seed.js';

export const DEMO = import.meta.env.VITE_DEMO === '1';

// Libellés des statuts (les valeurs sont celles de la base, voir api/_lib/schemas.js).
export const QUOTE_LABELS = {
  nouveau: 'Nouvelle demande', en_etude: 'En étude', envoye: 'Devis envoyé', accepte: 'Accepté',
  refuse: 'Refusé', expire: 'Expiré', annule: 'Annulé',
};
export const ORDER_LABELS = {
  confirmee: 'Confirmée', en_production: 'En production', terminee: 'Terminée (prête)', livree: 'Livrée', annulee: 'Annulée',
};
export const PAYMENT_LABELS = { non_paye: 'Non payé', acompte: 'Acompte payé', paye: 'Payé' };
export const TRAINING_STATUSES = ['Nouvelle demande', 'Contacté', 'Inscrit', 'Terminé', 'Annulé'];

async function call(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Connexion impossible. Vérifiez votre réseau, ou écrivez-nous sur WhatsApp.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Le serveur ne répond pas. Réessayez dans un instant.');
    err.status = res.status;
    throw err;
  }
  return data;
}

// ----- Mode démonstration ---------------------------------------------------
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const item = (label, quantity, unit_price_fcfa, unit = 'pièce') => ({
  id: label, label, quantity, unit, unit_price_fcfa, line_total_fcfa: unit_price_fcfa === null ? null : quantity * unit_price_fcfa,
});
const total = (items, discount = 0) => Math.max(items.reduce((s, i) => s + (i.line_total_fcfa || 0), 0) - discount, 0);
const demo = {
  user: { id: 'demo', email: 'demo@emanprod.com', full_name: 'Démonstration', role: 'admin', email_verified: true },
  quotes: [
    { id: 'q1', number: 'DV-2026-00012', customer_name: 'Association Espoir', customer_phone: '+22890000002', customer_email: '', message: 'Flyers A5 recto verso pour une journée portes ouvertes.', status: 'nouveau', items: [item('Flyers A5 recto verso', 500, null)], discount_fcfa: 0, created_at: daysAgo(1) },
    { id: 'q2', number: 'DV-2026-00011', customer_name: 'Kossi A.', customer_phone: '+22890000001', customer_email: '', message: 'Bâche pour la devanture, œillets aux quatre coins.', status: 'accepte', items: [item('Bâche 3 × 2 m', 1, 85000)], discount_fcfa: 0, created_at: daysAgo(4), order_number: 'CMD-2026-00007' },
  ],
  orders: [
    { id: 'o1', number: 'CMD-2026-00007', quote_number: 'DV-2026-00011', customer_name: 'Kossi A.', customer_phone: '+22890000001', status: 'en_production', payment_status: 'acompte', amount_paid_fcfa: 40000, items: [item('Bâche 3 × 2 m', 1, 85000)], discount_fcfa: 0, due_on: null, created_at: daysAgo(3) },
  ],
  messages: {},
  registrations: [
    { id: 't1', full_name: 'Yao K.', phone: '+22890000004', email: '', course: 'Infographie et design graphique', message: 'Disponible le soir après 17 h.', status: 'Nouvelle demande', created_at: daysAgo(1) },
  ],
};
for (const x of [...demo.quotes, ...demo.orders]) Object.assign(x, { subtotal_fcfa: total(x.items), total_fcfa: total(x.items, x.discount_fcfa), summary: x.items.map((i) => i.label).join(', '), history: [{ action: 'quote.created', created_at: x.created_at, data: {} }], files: [] });
const wait = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const demoRef = () => 'DV-2026-' + String(Math.floor(Math.random() * 90000) + 10000);

// ----- Formulaires publics --------------------------------------------------
export async function submitOrder(f) {
  if (DEMO) {
    await wait();
    const reference = demoRef();
    const items = [item(f.service, 1, null)];
    if (f.quantity) items[0].description = `Quantité / format : ${f.quantity}`;
    demo.quotes.unshift({ id: reference, number: reference, customer_name: f.name, customer_phone: f.phone, customer_email: f.email, message: f.details, status: 'nouveau', items, discount_fcfa: 0, subtotal_fcfa: 0, total_fcfa: 0, summary: f.service, history: [{ action: 'quote.created', created_at: new Date().toISOString(), data: {} }], files: [], created_at: new Date().toISOString() });
    return reference;
  }
  const { reference } = await call('/api/quotes', { method: 'POST', body: f });
  return reference;
}

export async function submitTraining(f) {
  if (DEMO) {
    await wait();
    demo.registrations.unshift({ id: 't' + Date.now(), full_name: f.name, phone: f.phone, email: f.email, course: f.course, message: f.message, status: 'Nouvelle demande', created_at: new Date().toISOString() });
    return;
  }
  await call('/api/trainings', { method: 'POST', body: f });
}

// ----- Comptes --------------------------------------------------------------
export const auth = {
  async me() {
    if (DEMO) return { user: null, mail: false };
    return call('/api/auth/me');
  },
  signup: (body) => call('/api/auth/signup', { method: 'POST', body }),
  login: (body) => call('/api/auth/login', { method: 'POST', body }),
  logout: () => (DEMO ? Promise.resolve() : call('/api/auth/logout', { method: 'POST', body: {} })),
  forgot: (body) => call('/api/auth/forgot', { method: 'POST', body }),
  reset: (body) => call('/api/auth/reset', { method: 'POST', body }),
  verify: (body) => call('/api/auth/verify', { method: 'POST', body }),
  resend: () => call('/api/auth/resend', { method: 'POST', body: {} }),
  demoUser: () => demo.user,
};

// ----- Espace client / administration ---------------------------------------
const DEMO_QUOTE_NEXT = {
  nouveau: ['en_etude', 'envoye', 'annule'], en_etude: ['envoye', 'annule'], envoye: ['en_etude', 'accepte', 'refuse', 'expire', 'annule'],
  accepte: ['annule'], refuse: ['en_etude'], expire: ['en_etude'], annule: [],
};
const DEMO_ORDER_NEXT = { confirmee: ['en_production', 'annulee'], en_production: ['terminee', 'annulee'], terminee: ['livree', 'en_production'], livree: [], annulee: [] };
const demoFind = (list, id) => {
  const x = list.find((q) => q.id === id);
  if (!x) throw new Error('Introuvable.');
  return x;
};
const clone = (x) => JSON.parse(JSON.stringify(x));

// Devis
export async function fetchQuotes(params = {}) {
  if (DEMO) return (await wait(150), demo.quotes.map(clone));
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return (await call('/api/quotes' + (qs ? '?' + qs : ''))).quotes;
}
export async function getQuote(id) {
  if (DEMO) {
    await wait(120);
    const q = clone(demoFind(demo.quotes, id));
    return { ...q, allowed: DEMO_QUOTE_NEXT[q.status], order: q.order_number ? { number: q.order_number } : null };
  }
  return (await call('/api/quotes?id=' + encodeURIComponent(id))).quote;
}
export async function updateQuote(id, patch) {
  if (DEMO) {
    await wait(200);
    const q = demoFind(demo.quotes, id);
    if (patch.items) q.items = patch.items.map((i) => item(i.label, Number(i.quantity) || 1, i.unit_price_fcfa === '' || i.unit_price_fcfa === null ? null : Number(i.unit_price_fcfa), i.unit));
    if ('discount_fcfa' in patch) q.discount_fcfa = Number(patch.discount_fcfa) || 0;
    Object.assign(q, { subtotal_fcfa: total(q.items), total_fcfa: total(q.items, q.discount_fcfa), summary: q.items.map((i) => i.label).join(', ') });
    q.history.push({ action: 'quote.updated', created_at: new Date().toISOString(), data: {} });
    return getQuote(id);
  }
  return (await call('/api/quotes', { method: 'PATCH', body: { id, ...patch } })).quote;
}
export async function quoteStatus(id, to) {
  if (DEMO) {
    await wait(200);
    const q = demoFind(demo.quotes, id);
    if (to === 'envoye' && q.items.some((i) => i.unit_price_fcfa === null)) throw new Error('Fixez le prix de toutes les lignes avant d’envoyer le devis.');
    q.history.push({ action: 'quote.status_changed', created_at: new Date().toISOString(), data: { from: q.status, to } });
    q.status = to;
    return getQuote(id);
  }
  return (await call('/api/quotes', { method: 'POST', body: { action: 'status', id, to } })).quote;
}
export async function convertQuote(id, due_on = null) {
  if (DEMO) {
    await wait(200);
    const q = demoFind(demo.quotes, id);
    const number = 'CMD-2026-' + String(demo.orders.length + 8).padStart(5, '0');
    q.order_number = number;
    demo.orders.unshift({ ...clone(q), id: 'o' + Date.now(), number, quote_number: q.number, status: 'confirmee', payment_status: 'non_paye', amount_paid_fcfa: 0, due_on, created_at: new Date().toISOString(), history: [{ action: 'order.created', created_at: new Date().toISOString(), data: {} }] });
    return { number };
  }
  return (await call('/api/quotes', { method: 'POST', body: { action: 'convert', id, due_on } })).order;
}

// Commandes
export async function fetchOrders(params = {}) {
  if (DEMO) return (await wait(150), demo.orders.map(clone));
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return (await call('/api/orders' + (qs ? '?' + qs : ''))).orders;
}
export async function getOrder(id) {
  if (DEMO) {
    await wait(120);
    const o = clone(demoFind(demo.orders, id));
    return { ...o, allowed: DEMO_ORDER_NEXT[o.status] };
  }
  return (await call('/api/orders?id=' + encodeURIComponent(id))).order;
}
export async function updateOrder(id, patch) {
  if (DEMO) {
    await wait(200);
    const o = demoFind(demo.orders, id);
    if (patch.status && patch.status !== o.status) {
      o.history.push({ action: 'order.status_changed', created_at: new Date().toISOString(), data: { from: o.status, to: patch.status } });
      o.status = patch.status;
    }
    if ('amount_paid_fcfa' in patch) {
      o.amount_paid_fcfa = Number(patch.amount_paid_fcfa) || 0;
      o.payment_status = !o.amount_paid_fcfa ? 'non_paye' : o.amount_paid_fcfa >= o.total_fcfa ? 'paye' : 'acompte';
    }
    if ('due_on' in patch) o.due_on = patch.due_on || null;
    return getOrder(id);
  }
  return (await call('/api/orders', { method: 'PATCH', body: { id, ...patch } })).order;
}

// Messages, notifications
export async function fetchMessages(target) {
  if (DEMO) return (await wait(100), [...(demo.messages[target.quote_id || target.order_id] || [])]);
  const qs = target.quote_id ? 'quote=' + target.quote_id : 'order=' + target.order_id;
  return (await call('/api/inbox?' + qs)).messages;
}
export async function sendMessage(target, body) {
  if (DEMO) {
    await wait(150);
    const k = target.quote_id || target.order_id;
    (demo.messages[k] ||= []).push({ id: String(Date.now()), author_role: 'admin', author_name: 'Démonstration', body, created_at: new Date().toISOString(), files: [] });
    return;
  }
  await call('/api/inbox', { method: 'POST', body: { ...target, body } });
}
export async function fetchNotifications() {
  if (DEMO) return { notifications: [], unread: 0 };
  return call('/api/inbox?notifications=1');
}
export async function markNotificationsRead(ids) {
  if (DEMO) return;
  await call('/api/inbox', { method: 'POST', body: { action: 'read', ...(ids ? { ids } : {}) } });
}

// Fichiers : préparation, envoi direct au stockage, vérification.
export async function uploadFile(purpose, targetId, file) {
  if (DEMO) throw new Error('L’envoi de fichiers n’est pas disponible en démonstration.');
  const { file_id: id, upload } = await call('/api/files', { method: 'POST', body: { purpose, target_id: targetId, filename: file.name, mime_type: file.type, size: file.size } });
  let res;
  try {
    res = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file });
  } catch {
    throw new Error('Envoi interrompu. Vérifiez votre connexion et réessayez.');
  }
  if (!res.ok) throw new Error('Le stockage a refusé le fichier. Réessayez.');
  return (await call('/api/files', { method: 'POST', body: { action: 'confirm', id } })).file;
}
export const fileUrl = (id) => `/api/files?id=${encodeURIComponent(id)}`;

// Compte client
export async function fetchAccount() {
  if (DEMO) return { user: demo.user, profile: { client_type: 'entreprise', company_name: 'E-MAN PROD', city: 'Lomé', whatsapp: '', address: '', preferred_contact: 'whatsapp' } };
  return call('/api/account');
}
export async function saveAccount(patch) {
  if (DEMO) return (await wait(200), fetchAccount());
  return call('/api/account', { method: 'PATCH', body: patch });
}

export async function fetchRegistrations() {
  if (DEMO) return (await wait(150), demo.registrations.map((r) => ({ ...r })));
  return (await call('/api/trainings')).registrations;
}

export async function updateRegistration(id, patch) {
  if (DEMO) {
    await wait(200);
    Object.assign(demo.registrations.find((r) => r.id === id), patch);
    return;
  }
  await call('/api/trainings', { method: 'PATCH', body: { id, ...patch } });
}

// ----- Images du site --------------------------------------------------------
const demoMedia = {};
export async function fetchMedia() {
  if (DEMO) return { ...demoMedia };
  return (await call('/api/media')).media;
}
export async function saveMedia(item) {
  if (DEMO) {
    await wait(200);
    demoMedia[item.slot] = { url: item.url, alt: item.alt };
    return;
  }
  await call('/api/media', { method: 'PUT', body: item });
}
export async function resetMedia(slot) {
  if (DEMO) {
    delete demoMedia[slot];
    return;
  }
  await call('/api/media', { method: 'DELETE', body: { slot } });
}

// ----- Catalogue : prestations, formations, réalisations, textes -------------
const demoCatalog = {
  prestations: SEED_PRESTATIONS.map((p) => ({ ...p, published: true })),
  poles: SEED_POLES,
  courses: SEED_COURSES.map((c) => ({ ...c, published: true, sessions: [] })),
  gallery: [],
  content: SEED_CONTENT,
  testimonials: [],
};

export async function fetchCatalog({ all = false } = {}) {
  if (DEMO) {
    const c = clone(demoCatalog);
    if (!all) {
      c.prestations = c.prestations.filter((p) => p.published);
      c.courses = c.courses.filter((x) => x.published);
      c.gallery = c.gallery.filter((g) => g.published);
    }
    return c;
  }
  return call(all ? '/api/catalog?all=1' : '/api/catalog');
}

/** Actions d'administration du contenu (voir api/manage.js). */
export async function manage(action, payload) {
  if (DEMO) {
    await wait(200);
    const c = demoCatalog;
    const course = (slug) => c.courses.find((x) => x.slug === slug);
    switch (action) {
      case 'course.update': Object.assign(course(payload.slug), payload, { price_fcfa: payload.price_fcfa === '' ? null : Number(payload.price_fcfa) }); break;
      case 'session.create': course(payload.course_slug).sessions.push({ ...payload, id: 's' + Date.now(), seats: payload.seats ? Number(payload.seats) : null, seats_left: payload.seats ? Number(payload.seats) : null, status: payload.status || 'ouverte' }); break;
      case 'session.update': for (const x of c.courses) { const s = x.sessions.find((y) => y.id === payload.id); if (s) Object.assign(s, payload); } break;
      case 'session.delete': for (const x of c.courses) x.sessions = x.sessions.filter((y) => y.id !== payload.id); break;
      case 'gallery.create': c.gallery.unshift({ ...payload, id: 'g' + Date.now(), published: true }); break;
      case 'gallery.update': Object.assign(c.gallery.find((g) => g.id === payload.id), payload); break;
      case 'gallery.delete': c.gallery = c.gallery.filter((g) => g.id !== payload.id); break;
      case 'prestation.update': Object.assign(c.prestations.find((p) => p.slug === payload.slug), payload); break;
      default: throw new Error('Action inconnue.');
    }
    return {};
  }
  return (await call('/api/manage', { method: 'POST', body: { action, ...payload } })).result;
}

export const formatPrice = (fcfa, note) =>
  fcfa === null || fcfa === undefined ? 'Nous consulter' : `${Number(fcfa).toLocaleString('fr-FR')} FCFA${note ? ` (${note})` : ''}`;
export const formatDay = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) : '');

export const formatAmount = (v) =>
  v === null || v === undefined || v === '' ? 'À chiffrer' : Number(v).toLocaleString('fr-FR') + ' FCFA';
export const formatDate = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

// ----- Sécurité du compte et équipe -------------------------------------------
export const security = {
  sessions: () => (DEMO ? Promise.resolve({ sessions: [{ id: 'd', current: true, method: 'password', user_agent: navigator.userAgent, created_at: new Date().toISOString(), last_seen_at: new Date().toISOString() }], google: null, has_password: true }) : call('/api/auth/sessions')),
  revoke: (body) => (DEMO ? Promise.resolve({ revoked: 0 }) : call('/api/auth/revoke', { method: 'POST', body })),
  password: (body) => (DEMO ? Promise.reject(new Error('Indisponible en démonstration.')) : call('/api/auth/password', { method: 'POST', body })),
  unlinkGoogle: () => call('/api/auth/google-unlink', { method: 'POST', body: {} }),
  team: () => (DEMO ? Promise.resolve({ team: [demo.user], permissions: {} }) : call('/api/account?team=1')),
  log: () => (DEMO ? Promise.resolve({ events: [] }) : call('/api/account?security=1')),
  clients: (q) => (DEMO ? Promise.resolve({ clients: [] }) : call('/api/account?clients=1&q=' + encodeURIComponent(q || ''))),
  setRole: (body) => call('/api/account', { method: 'POST', body: { action: 'role', ...body } }),
  disable: (user_id, disabled) => call('/api/account', { method: 'POST', body: { action: 'disable', user_id, disabled } }),
  revokeUser: (user_id) => call('/api/account', { method: 'POST', body: { action: 'revoke_sessions', user_id } }),
};

// ----- Espaces client et administrateur (v2.7) ----------------------------------
const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
export const quotePdfUrl = (id) => `/api/quotes?id=${encodeURIComponent(id)}&pdf=1`;
export const orderPdfUrl = (id) => `/api/orders?id=${encodeURIComponent(id)}&pdf=1`;
export const avatarUrl = (fileId) => (fileId ? `/api/files?id=${encodeURIComponent(fileId)}&inline=1` : null);

export const space = {
  stats: () => (DEMO ? Promise.resolve({ demo: true, sections: [] }) : call('/api/account?stats=1')),
  documents: () => (DEMO ? Promise.resolve({ files: [], quotes: [], orders: [] }) : call('/api/account?documents=1')),
  setAvatar: (file_id) => call('/api/account', { method: 'POST', body: { action: 'avatar', file_id } }),
  removeAvatar: () => call('/api/account', { method: 'POST', body: { action: 'avatar_remove' } }),
  invite: (body) => call('/api/account', { method: 'POST', body: { action: 'invite', ...body } }),
  activity: (actor) => call('/api/account?activity=1&actor=' + encodeURIComponent(actor)),
  clients: (filters = {}) => (DEMO ? Promise.resolve({ clients: [] }) : call('/api/account?clients=1&' + qs(filters))),
  client: (id) => call('/api/account?user=' + encodeURIComponent(id)),
  note: (user_id, note) => call('/api/account', { method: 'POST', body: { action: 'note', user_id, note } }),
  supportThreads: () => (DEMO ? Promise.resolve({ threads: [] }) : call('/api/inbox?support=threads')),
  supportMessages: (who = 'me') => (DEMO ? Promise.resolve({ messages: [] }) : call('/api/inbox?support=' + encodeURIComponent(who))),
  supportSend: (body, userId) => call('/api/inbox', { method: 'POST', body: userId ? { support_user_id: userId, body } : { support: true, body } }),
  orderComment: (id, text) => call('/api/orders', { method: 'POST', body: { action: 'comment', id, text } }),
  members: () => call('/api/orders?members=1'),
  createOrder: (body) => call('/api/orders', { method: 'POST', body }),
  createQuote: (body) => call('/api/quotes', { method: 'POST', body }),
  enrollment: (id) => call('/api/trainings?id=' + encodeURIComponent(id)),
  enrollments: (filters = {}) => call('/api/trainings?' + qs(filters)).then((r) => r.registrations),
  notifications: (f = {}) => (DEMO ? Promise.resolve({ notifications: [], unread: 0, has_more: false }) : call('/api/inbox?notifications=1&' + qs(f))),
  readNotifications: (ids) => (DEMO ? Promise.resolve() : call('/api/inbox', { method: 'POST', body: { action: 'read', ...(ids ? { ids } : {}) } })),
  unreadNotifications: (ids) => call('/api/inbox', { method: 'POST', body: { action: 'unread', ids } }),
  announcements: () => (DEMO ? Promise.resolve({ announcements: [] }) : call('/api/inbox?announcements=1')),
  announce: (body) => call('/api/inbox', { method: 'POST', body: { action: 'announce', ...body } }),
  emailPrefs: () => (DEMO ? Promise.resolve({ categories: [] }) : call('/api/account?prefs=1')),
  setEmailPrefs: (email_prefs) => call('/api/account', { method: 'PATCH', body: { email_prefs } }),
  // Facturation
  payments: (orderId) => call('/api/documents?payments=' + encodeURIComponent(orderId)),
  recordPayment: (body) => call('/api/documents', { method: 'POST', body: { action: 'payment', ...body } }),
  invoices: (orderId) => call('/api/documents?invoices=1' + (orderId ? '&order=' + encodeURIComponent(orderId) : '')),
  issueInvoice: (order_id, due_date) => call('/api/documents', { method: 'POST', body: { action: 'invoice', order_id, ...(due_date ? { due_date } : {}) } }),
  cancelInvoice: (id, reason) => call('/api/documents', { method: 'POST', body: { action: 'invoice_cancel', id, reason } }),
  // Formations
  roster: (sessionId) => call('/api/documents?roster=' + encodeURIComponent(sessionId)),
  attendance: (session_id, day, marks) => call('/api/documents', { method: 'POST', body: { action: 'attendance', session_id, day, marks } }),
  result: (enrollment_id, result) => call('/api/documents', { method: 'POST', body: { action: 'result', enrollment_id, result } }),
  eligibility: (id) => call('/api/documents?eligibility=' + encodeURIComponent(id)),
  issueCertificate: (enrollment_id, note) => call('/api/documents', { method: 'POST', body: { action: 'certificate', enrollment_id, confirm: true, ...(note ? { note } : {}) } }),
  revokeCertificate: (id, reason) => call('/api/documents', { method: 'POST', body: { action: 'certificate_revoke', id, reason } }),
  learner: (id) => call('/api/documents?learner=' + encodeURIComponent(id)),
  verify: (code) => call('/api/documents?verify=' + encodeURIComponent(code)),
  // Paramètres et e-mails (admin)
  emailStatus: () => call('/api/manage', { method: 'POST', body: { action: 'email.status' } }).then((r) => r.result),
  authStatus: () => (DEMO ? Promise.resolve({ google: { configured: false, secret: false, client_id: null, origin: window.location.origin, redirect_uri: `${window.location.origin}/api/auth/google-callback`, linked_accounts: 0 } }) : call('/api/manage', { method: 'POST', body: { action: 'auth.status' } }).then((r) => r.result)),
  emailPreview: (template, subject, intro) => call('/api/manage', { method: 'POST', body: { action: 'email.preview', template, subject, intro } }).then((r) => r.result),
  emailTest: (template) => call('/api/manage', { method: 'POST', body: { action: 'email.test', template } }).then((r) => r.result),
  saveSetting: (key, value) => call('/api/manage', { method: 'POST', body: { action: 'setting.update', key, value } }),
};

export const invoicePdfUrl = (id) => `/api/documents?invoice=${encodeURIComponent(id)}&pdf=1`;
export const receiptPdfUrl = (id) => `/api/documents?receipt=${encodeURIComponent(id)}`;
export const rosterPdfUrl = (id) => `/api/documents?roster=${encodeURIComponent(id)}&pdf=1`;
export const certificatePdfUrl = (id) => `/api/documents?certificate=${encodeURIComponent(id)}&pdf=1`;
export const PAYMENT_METHOD_LABELS = { especes: 'Espèces', mobile_money: 'Mobile Money', virement: 'Virement', cheque: 'Chèque', carte: 'Carte', autre: 'Autre', historique: 'Saisie antérieure', correction: 'Correction' };
export const INVOICE_STATE = { a_payer: ['À payer', 'new'], partielle: ['Partiellement réglée', 'work'], acquittee: ['Acquittée', 'done'], annulee: ['Annulée', 'off'] };
