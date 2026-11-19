// Documents PDF : devis, bons de commande, factures, reçus, feuilles d'émargement, attestations.
// pdf-lib (JavaScript pur : fonctionne sur Vercel). Les droits sont vérifiés par les services
// qui fournissent les données (getQuote, getOrder, getInvoice…), comme pour l'affichage.
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { HttpError } from './http.js';
import { isTeam } from './activity.js';
import { documentSettings } from './settings.js';
import { LOGO_PNG_BASE64 } from './logo.js';
import { getQuote } from './services/quotes.js';
import { getOrder } from './services/orders.js';

const NAVY = rgb(0.059, 0.106, 0.239);
const RED = rgb(0.827, 0.071, 0.11);
const BLUE = rgb(0.118, 0.149, 0.769);
const INK = rgb(0.13, 0.15, 0.2);
const MUTED = rgb(0.38, 0.42, 0.5);
const RULE = rgb(0.86, 0.88, 0.92);
const TINT = rgb(0.955, 0.965, 0.98);
const GREEN = rgb(0.06, 0.47, 0.3);

// Les polices standard du PDF couvrent le français (accents, œ, €, guillemets) ;
// les autres caractères (espaces fines, flèches, émojis) sont remplacés.
const WIN_ANSI_EXTRA = new Set('’‘“”–—…œŒ€•™'.split(''));
export const pdfText = (v) => String(v ?? '')
  .replace(/[    ]/g, ' ')
  .replace(/[→⇒]/g, '->')
  .replace(/×/g, 'x')
  .split('')
  .map((c) => (c.charCodeAt(0) < 256 || WIN_ANSI_EXTRA.has(c) ? c : '?'))
  .join('')
  .replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
export const money = (n) => (n === null || n === undefined ? '—' : `${pdfText(Math.round(Number(n)).toLocaleString('fr-FR'))} FCFA`);
export const day = (iso) => (iso ? pdfText(new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })) : '');
/** +22890112233 → +228 90 11 22 33 (numéros togolais) ; les autres restent tels quels. */
export const phone = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('228') ? `+228 ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)} ${d.slice(9)}` : v || '';
};
const qty = (n) => pdfText(Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));

function wrap(text, font, size, width) {
  const lines = [];
  for (const para of pdfText(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(tryLine, size) <= width) line = tryLine;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Ligne d'identification légale (seulement les champs renseignés par l'administration). */
const legalLine = (legal) => [
  legal.legalName, legal.legalForm, legal.capital && `capital ${legal.capital}`,
  legal.rccm && `RCCM ${legal.rccm}`, legal.nif && `NIF ${legal.nif}`,
].filter(Boolean).join(' · ');

/**
 * Document commun.
 * @param {object} d
 *   kind, number, meta [[label, value]], party {title, lines[]}, items, totals [[label, value, strong]],
 *   sections [{title, text}], signature {left, right, leftNote}, stamp {text, color}, extra (page) => void
 */
async function render(d) {
  const { business: biz, legal } = d.settings;
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfText(`${d.kind} ${d.number} — E-MAN PROD`));
  pdf.setAuthor('E-MAN PROD');
  pdf.setCreator('Espace E-MAN PROD');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Buffer.from(LOGO_PNG_BASE64, 'base64'));
  const W = 595.28, H = 841.89, M = 46, BOTTOM = 86;
  let page = pdf.addPage([W, H]);
  // Tampon (BROUILLON, ACQUITTÉE, ANNULÉE…) dessiné en premier : il reste sous le texte.
  if (d.stamp) page.drawText(pdfText(d.stamp.text), { x: 150, y: 380, size: 60, font: bold, color: d.stamp.color || rgb(0.93, 0.94, 0.97), rotate: degrees(32) });
  const text = (t, x, y, { f = font, size = 10, color = INK } = {}) => page.drawText(pdfText(t), { x, y, size, font: f, color });
  const right = (t, x, y, opts = {}) => text(t, x - (opts.f || font).widthOfTextAtSize(pdfText(t), opts.size || 10), y, opts);

  const header = (first) => {
    // Logo et coordonnées à gauche, type et numéro du document à droite.
    const lh = 46, lw = lh * (logo.width / logo.height);
    page.drawImage(logo, { x: M, y: H - 30 - lh, width: lw, height: lh });
    const sites = (biz.sites || []).map((s) => `${s.label} : ${s.address}`);
    const info = [
      ...(sites.length ? sites : ['Lomé, Togo']),
      [biz.phone && `Tél. / WhatsApp ${phone(biz.phone)}`, biz.email].filter(Boolean).join(' · '),
    ];
    info.forEach((l, i) => text(l, M, H - 92 - i * 11, { size: 8, color: MUTED }));
    right(d.kind.toUpperCase(), W - M, H - 50, { f: bold, size: first ? 20 : 14, color: NAVY });
    right(d.number, W - M, H - 68, { f: bold, size: 11, color: INK });
    const top = H - 92 - info.length * 11 - 6;
    page.drawRectangle({ x: M, y: top, width: (W - 2 * M) / 2, height: 2.5, color: BLUE });
    page.drawRectangle({ x: M + (W - 2 * M) / 2, y: top, width: (W - 2 * M) / 2, height: 2.5, color: RED });
    return top - 22;
  };
  const footer = (n, count) => {
    page.drawLine({ start: { x: M, y: 58 }, end: { x: W - M, y: 58 }, thickness: 0.6, color: RULE });
    const id = legalLine(legal);
    text(id || 'E-MAN PROD', M, 45, { size: 7.5, color: MUTED });
    text(biz.slogan || 'E-man Prod, la référence !', M, 34, { size: 7.5, color: MUTED });
    right(`${d.kind} ${d.number} · page ${n} / ${count}`, W - M, 34, { size: 7.5, color: MUTED });
  };
  let y = header(true);
  const ensure = (h) => {
    if (y - h < BOTTOM) {
      page = pdf.addPage([W, H]);
      y = header(false);
      return true;
    }
    return false;
  };

  // Informations du document et bloc client / bénéficiaire.
  const metaTop = y;
  d.meta.filter(([, v]) => v).forEach(([label, value], i) => {
    text(label, M, y - i * 15, { size: 8.5, color: MUTED });
    text(value, M + 104, y - i * 15, { f: bold, size: 9.5 });
  });
  const metaH = d.meta.filter(([, v]) => v).length * 15;
  let partyH = 0;
  if (d.party) {
    const bx = W / 2 + 10, bw = W - M - bx;
    const lines = d.party.lines.filter(Boolean).flatMap((l, i) => wrap(l, i === 0 ? bold : font, i === 0 ? 10.5 : 9, bw - 24).map((t) => [t, i === 0]));
    partyH = 26 + lines.length * 13 + 8;
    page.drawRectangle({ x: bx, y: metaTop - partyH + 12, width: bw, height: partyH, color: TINT });
    text(d.party.title, bx + 12, metaTop - 4, { f: bold, size: 8, color: MUTED });
    lines.forEach(([l, b], i) => text(l, bx + 12, metaTop - 20 - i * 13, { f: b ? bold : font, size: b ? 10.5 : 9 }));
  }
  y = metaTop - Math.max(metaH, partyH) - 22;

  if (d.intro) {
    for (const l of wrap(d.intro, font, 10, W - 2 * M)) { ensure(14); text(l, M, y, { size: 10 }); y -= 14; }
    y -= 8;
  }

  // Tableau des prestations.
  if (d.items) {
    const cols = [
      { label: 'Désignation', x: M, w: 228 },
      { label: 'Qté', x: M + 236, w: 46, align: 'right' },
      { label: 'Unité', x: M + 290, w: 52 },
      { label: 'Prix unitaire', x: M + 346, w: 76, align: 'right' },
      { label: 'Montant', x: W - M - 74, w: 74, align: 'right' },
    ];
    const headRow = () => {
      page.drawRectangle({ x: M - 6, y: y - 7, width: W - 2 * M + 12, height: 22, color: NAVY });
      for (const c of cols) (c.align === 'right' ? right(c.label, c.x + c.w, y, { f: bold, size: 8.5, color: rgb(1, 1, 1) }) : text(c.label, c.x, y, { f: bold, size: 8.5, color: rgb(1, 1, 1) }));
      y -= 26;
    };
    headRow();
    if (!d.items.length) { text('Aucune ligne.', M, y, { size: 9, color: MUTED }); y -= 18; }
    for (const it of d.items) {
      const lines = wrap(it.label, bold, 9.5, cols[0].w);
      const desc = it.description ? wrap(it.description, font, 8.5, cols[0].w) : [];
      const h = lines.length * 12 + desc.length * 11 + 14;
      if (ensure(h)) headRow();
      lines.forEach((l, i) => text(l, cols[0].x, y - i * 12, { f: bold, size: 9.5 }));
      desc.forEach((l, i) => text(l, cols[0].x, y - lines.length * 12 - i * 11, { size: 8.5, color: MUTED }));
      right(qty(it.quantity), cols[1].x + cols[1].w, y, { size: 9.5 });
      text(it.unit || '', cols[2].x, y, { size: 9.5 });
      right(it.unit_price_fcfa === null || it.unit_price_fcfa === undefined ? 'À chiffrer' : money(it.unit_price_fcfa), cols[3].x + cols[3].w, y, { size: 9.5 });
      right(it.line_total_fcfa === null || it.line_total_fcfa === undefined ? '—' : money(it.line_total_fcfa), cols[4].x + cols[4].w, y, { f: bold, size: 9.5 });
      y -= h;
      // Séparateur entre deux lignes, sous les jambages et au-dessus de la ligne suivante.
      page.drawLine({ start: { x: M - 6, y: y + 14 }, end: { x: W - M + 6, y: y + 14 }, thickness: 0.5, color: RULE });
    }
    y -= 6;
  }

  // Totaux.
  if (d.totals?.length) {
    ensure(d.totals.length * 18 + 10);
    for (const [label, value, strong] of d.totals) {
      if (strong) page.drawRectangle({ x: W - M - 230, y: y - 7, width: 236, height: 24, color: TINT });
      right(label, W - M - 100, y, { f: strong ? bold : font, size: strong ? 10.5 : 9.5, color: strong ? INK : MUTED });
      right(value, W - M, y, { f: strong ? bold : font, size: strong ? 12 : 9.5 });
      y -= strong ? 24 : 16;
    }
    y -= 6;
  }

  // Tableau complémentaire (paiements reçus, émargement…).
  if (d.table) {
    ensure(40);
    text(d.table.title, M, y, { f: bold, size: 10, color: NAVY });
    // Lignes hautes (émargement) : laisser la place de l'en-tête sous le titre.
    y -= 18 + Math.max(0, (d.table.rowHeight || 18) - 20);
    const tw = W - 2 * M;
    const xs = d.table.widths.reduce((acc, w, i) => [...acc, (acc[i] ?? M) + w], [M]);
    const row = (cells, head) => {
      const rh = d.table.rowHeight || 18;
      if (ensure(rh + 4) && !head) row(d.table.head, true);
      if (head) page.drawRectangle({ x: M - 4, y: y - 6, width: tw + 8, height: rh, color: TINT });
      cells.forEach((c, i) => {
        const align = d.table.align?.[i];
        const t = String(c ?? '');
        if (align === 'right') right(t, xs[i + 1] - 4, y, { f: head ? bold : font, size: head ? 8 : 9, color: head ? MUTED : INK });
        else text(t, xs[i], y, { f: head ? bold : font, size: head ? 8 : 9, color: head ? MUTED : INK });
      });
      if (d.table.grid) {
        page.drawLine({ start: { x: M - 4, y: y - 6 }, end: { x: W - M + 4, y: y - 6 }, thickness: 0.5, color: RULE });
        if (!head) xs.slice(1, -1).forEach((x) => page.drawLine({ start: { x: x - 6, y: y - 6 }, end: { x: x - 6, y: y - 6 + rh }, thickness: 0.5, color: RULE }));
      }
      y -= rh;
    };
    row(d.table.head, true);
    if (!d.table.rows.length) { text(d.table.empty || '—', M, y, { size: 9, color: MUTED }); y -= 16; }
    for (const r of d.table.rows) row(r, false);
    y -= 10;
  }

  // Conditions et mentions.
  for (const sct of (d.sections || []).filter((x) => x.text)) {
    const lines = wrap(sct.text, font, 8.8, W - 2 * M);
    ensure(20 + Math.min(lines.length, 4) * 12);
    text(sct.title, M, y, { f: bold, size: 9.5, color: NAVY });
    y -= 14;
    for (const l of lines) { ensure(12); text(l, M, y, { size: 8.8, color: INK }); y -= 12; }
    y -= 8;
  }

  // Zone de signature.
  if (d.signature) {
    const h = 92, bw = (W - 2 * M - 16) / 2;
    ensure(h + 14);
    y -= 4;
    const box = (x, title, note) => {
      page.drawRectangle({ x, y: y - h, width: bw, height: h, borderColor: RULE, borderWidth: 1 });
      text(title, x + 10, y - 16, { f: bold, size: 9 });
      text('Date, nom et signature', x + 10, y - 29, { size: 8, color: MUTED });
      if (note) wrap(note, bold, 8.5, bw - 20).forEach((l, i) => text(l, x + 10, y - 50 - i * 11, { f: bold, size: 8.5, color: GREEN }));
    };
    if (d.signature.left) box(M, d.signature.left, d.signature.leftNote);
    if (d.signature.right) box(M + bw + 16, d.signature.right, d.signature.rightNote);
    y -= h + 14;
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => { page = p; footer(i + 1, pages.length); });
  return pdf.save();
}

const customerLines = (x) => [x.name, x.company, x.address, phone(x.phone), x.email];

// ---------------------------------------------------------------------------------------
export async function quotePdf(actor, id) {
  const q = await getQuote(actor, id);
  const team = isTeam(actor, 'quotes');
  const ready = !['nouveau', 'en_etude'].includes(q.status);
  if (!team && !ready) throw new HttpError(409, 'Votre devis est en cours de préparation : il sera téléchargeable dès son envoi.');
  const settings = await documentSettings();
  const docs = settings.documents;
  const unpriced = q.items.some((i) => i.unit_price_fcfa === null);
  const validity = q.valid_until
    ? `Ce devis est valable jusqu’au ${day(q.valid_until)}.`
    : `Ce devis est valable ${docs.quote_validity_days} jours à compter de son envoi.`;
  const acceptedOnline = q.status === 'accepte' && q.decided_at && q.user_id
    && (q.history || []).some((h) => h.action === 'quote.status_changed' && h.data?.to === 'accepte' && h.actor_role === 'client');
  const bytes = await render({
    settings,
    kind: 'Devis',
    number: q.number,
    meta: [
      ['Date de la demande', day(q.created_at)],
      ['Date du devis', q.sent_at ? day(q.sent_at) : null],
      ['Valable jusqu’au', q.valid_until ? day(q.valid_until) : null],
    ],
    party: { title: 'CLIENT', lines: customerLines({ name: q.customer_name, company: q.customer_company, phone: q.customer_phone, email: q.customer_email }) },
    intro: q.message ? `Objet : ${q.message}` : null,
    items: q.items,
    totals: [
      ...(q.discount_fcfa > 0 ? [['Sous-total', money(q.subtotal_fcfa)], ['Remise', `- ${money(q.discount_fcfa)}`]] : []),
      ['Total', unpriced ? 'À chiffrer' : money(q.total_fcfa), true],
    ],
    sections: [
      { title: 'Validité', text: validity },
      { title: 'Conditions', text: [docs.quote_conditions, 'Montants en francs CFA (XOF).'].filter(Boolean).join('\n') },
      { title: 'Paiement', text: docs.payment_instructions },
    ],
    signature: {
      left: `Le client — « ${docs.signature_label || 'Bon pour accord'} »`,
      leftNote: acceptedOnline ? `Accepté en ligne le ${day(q.decided_at)} depuis l’espace client.` : null,
      right: 'Pour E-MAN PROD',
    },
    stamp: !ready ? { text: 'BROUILLON' } : q.status === 'annule' ? { text: 'ANNULÉ' } : q.status === 'expire' ? { text: 'EXPIRÉ' } : q.status === 'refuse' ? { text: 'REFUSÉ' } : null,
  });
  return { bytes, filename: `devis-${q.number}.pdf` };
}

const ORDER_STATUS = { confirmee: 'Confirmée', en_production: 'En production', terminee: 'Terminée, prête', livree: 'Livrée', annulee: 'Annulée' };

export async function orderPdf(actor, id) {
  const o = await getOrder(actor, id);
  const settings = await documentSettings();
  const bytes = await render({
    settings,
    kind: 'Bon de commande',
    number: o.number,
    meta: [
      ['Date de commande', day(o.created_at)],
      ['Devis d’origine', o.quote_number],
      ['Date prévue', o.due_on ? day(o.due_on) : null],
      ['Livrée le', o.delivered_at ? day(o.delivered_at) : null],
      ['Statut', ORDER_STATUS[o.status]],
    ],
    party: { title: 'CLIENT', lines: customerLines({ name: o.customer_name, phone: o.customer_phone, email: o.customer_email }) },
    items: o.items,
    totals: [
      ...(o.discount_fcfa > 0 ? [['Sous-total', money(o.subtotal_fcfa)], ['Remise', `- ${money(o.discount_fcfa)}`]] : []),
      ['Total de la commande', o.items.some((i) => i.unit_price_fcfa === null) ? 'À chiffrer' : money(o.total_fcfa), true],
      ...(o.amount_paid_fcfa > 0 ? [['Déjà réglé (paiements enregistrés)', money(o.amount_paid_fcfa)], ['Reste à payer', money(Math.max(o.total_fcfa - o.amount_paid_fcfa, 0))]] : []),
    ],
    sections: [
      { title: 'Conditions', text: 'Montants en francs CFA (XOF). Ce bon de commande n’est pas une facture.' },
      { title: 'Paiement', text: settings.documents.payment_instructions },
    ],
    signature: { left: 'Le client', right: 'Pour E-MAN PROD' },
    stamp: o.status === 'annulee' ? { text: 'ANNULÉE' } : null,
  });
  return { bytes, filename: `bon-de-commande-${o.number}.pdf` };
}

const METHODS = { especes: 'Espèces', mobile_money: 'Mobile Money', virement: 'Virement', cheque: 'Chèque', carte: 'Carte', autre: 'Autre', historique: 'Saisie antérieure', correction: 'Correction' };
export const methodLabel = (m) => METHODS[m] || m;

/**
 * Facture : contenu figé à l'émission. L'état du paiement vient uniquement des paiements
 * enregistrés ; « ACQUITTÉE » n'apparaît que si leur somme couvre le total.
 */
export async function invoicePdf(inv) {
  const settings = await documentSettings();
  const s = inv.snapshot;
  const paid = inv.paid_fcfa;
  const balance = Math.max(inv.total_fcfa - paid, 0);
  const settled = inv.total_fcfa > 0 && paid >= inv.total_fcfa;
  const bytes = await render({
    settings,
    kind: 'Facture',
    number: inv.invoice_number,
    meta: [
      ['Date de facture', day(inv.issued_at)],
      ['Commande', s.order_number],
      ['Devis', s.quote_number],
      ['Échéance', inv.due_date ? day(inv.due_date) : null],
      ['État du paiement', inv.cancelled_at ? 'Annulée' : settled ? 'Acquittée (paiements enregistrés)' : paid > 0 ? 'Partiellement réglée' : 'À payer'],
    ],
    party: { title: 'FACTURÉ À', lines: customerLines(s.customer) },
    items: s.items,
    totals: [
      ...(s.discount_fcfa > 0 ? [['Sous-total', money(s.subtotal_fcfa)], ['Remise', `- ${money(s.discount_fcfa)}`]] : []),
      ['Total de la facture', money(inv.total_fcfa), true],
      ['Paiements enregistrés', money(paid)],
      ['Reste à payer', money(balance)],
    ],
    table: inv.payments.length ? {
      title: 'Paiements reçus',
      head: ['Date', 'Reçu', 'Moyen', 'Montant'],
      widths: [110, 150, 150, W_TABLE - 410],
      align: [null, null, null, 'right'],
      rows: inv.payments.map((p) => [day(p.received_on), p.receipt_number || '—', methodLabel(p.method), money(p.amount_fcfa)]),
    } : null,
    sections: [
      { title: 'Conditions', text: [settings.documents.invoice_conditions, 'Montants en francs CFA (XOF).'].filter(Boolean).join('\n') },
      { title: 'Paiement', text: settled ? null : settings.documents.payment_instructions },
      { title: 'Annulation', text: inv.cancelled_at ? `Facture annulée le ${day(inv.cancelled_at)}${inv.cancel_reason ? ` : ${inv.cancel_reason}` : ''}.` : null },
    ],
    stamp: inv.cancelled_at ? { text: 'ANNULÉE' } : settled ? { text: 'ACQUITTÉE', color: rgb(0.86, 0.95, 0.9) } : null,
  });
  return { bytes, filename: `facture-${inv.invoice_number}.pdf` };
}
const W_TABLE = 595.28 - 2 * 46;

/** Reçu d'un paiement réellement enregistré. */
export async function receiptPdf(p) {
  const settings = await documentSettings();
  const bytes = await render({
    settings,
    kind: 'Reçu',
    number: p.receipt_number,
    meta: [
      ['Date du paiement', day(p.received_on)],
      ['Commande', p.order_number],
      ['Facture', p.invoice_number],
      ['Moyen de paiement', methodLabel(p.method)],
      ['Référence', p.reference],
    ],
    party: { title: 'REÇU DE', lines: customerLines({ name: p.customer_name, phone: p.customer_phone, email: p.customer_email }) },
    intro: `E-MAN PROD reconnaît avoir reçu la somme de ${money(p.amount_fcfa)} au titre de la commande ${p.order_number}.`,
    totals: [
      ['Montant reçu', money(p.amount_fcfa), true],
      ['Total de la commande', money(p.order_total_fcfa)],
      ['Total réglé à cette date', money(p.paid_to_date_fcfa)],
      ['Reste à payer', money(Math.max(p.order_total_fcfa - p.paid_to_date_fcfa, 0))],
    ],
    sections: [{ title: 'Note', text: p.note }],
    signature: { right: 'Pour E-MAN PROD' },
  });
  return { bytes, filename: `recu-${p.receipt_number}.pdf` };
}

/** Feuille d'émargement d'une session : une ligne par apprenant, une colonne par jour choisi. */
export async function attendanceSheetPdf(sess) {
  const settings = await documentSettings();
  const days = sess.days.slice(0, 6);
  const nameW = 170;
  const dayW = Math.floor((W_TABLE - nameW) / Math.max(days.length, 1));
  const mark = { present: 'Présent', retard: 'Retard', absent: 'Absent', excuse: 'Excusé' };
  const bytes = await render({
    settings,
    kind: 'Feuille de présence',
    number: sess.label,
    meta: [['Formation', sess.training_title], ['Lieu', sess.site], ['Horaires', sess.schedule], ['Apprenants', String(sess.learners.length)]],
    table: {
      title: 'Émargement',
      head: ['Apprenant', ...days.map((d) => pdfText(new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })))],
      widths: [nameW, ...days.map(() => dayW)],
      rows: sess.learners.map((l) => [l.full_name, ...days.map((d) => mark[l.attendance[d]] || '')]),
      empty: 'Aucun apprenant inscrit.',
      rowHeight: 30,
      grid: true,
    },
    sections: [{ title: 'Note', text: days.length < sess.days.length ? `Feuille limitée à 6 jours : ${sess.days.length} jours au total.` : null }],
    signature: { left: 'Formateur ou formatrice', right: 'Pour E-MAN PROD' },
  });
  return { bytes, filename: `presences-${sess.training_slug}-${sess.starts_on}.pdf` };
}

/** Attestation ou certificat (A4 paysage). N'est appelé que pour un document émis et non révoqué. */
export async function certificatePdf(c, { verifyUrl }) {
  const { business: biz, legal } = await documentSettings();
  const pdf = await PDFDocument.create();
  const title = c.kind === 'certificat' ? 'Certificat de formation' : 'Attestation de formation';
  pdf.setTitle(pdfText(`${title} ${c.number}`));
  pdf.setAuthor('E-MAN PROD');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBoldItalic);
  const logo = await pdf.embedPng(Buffer.from(LOGO_PNG_BASE64, 'base64'));
  const W = 841.89, H = 595.28;
  const page = pdf.addPage([W, H]);
  const center = (t, y, { f = font, size = 12, color = INK } = {}) => {
    const s = pdfText(t);
    page.drawText(s, { x: (W - f.widthOfTextAtSize(s, size)) / 2, y, size, font: f, color });
  };
  page.drawRectangle({ x: 22, y: 22, width: W - 44, height: H - 44, borderColor: NAVY, borderWidth: 2.5 });
  page.drawRectangle({ x: 30, y: 30, width: W - 60, height: H - 60, borderColor: RULE, borderWidth: 0.8 });
  page.drawRectangle({ x: 30, y: H - 34, width: (W - 60) / 2, height: 4, color: BLUE });
  page.drawRectangle({ x: 30 + (W - 60) / 2, y: H - 34, width: (W - 60) / 2, height: 4, color: RED });
  const lh = 58, lw = lh * (logo.width / logo.height);
  page.drawImage(logo, { x: (W - lw) / 2, y: H - 110, width: lw, height: lh });
  center(title.toUpperCase(), H - 160, { f: bold, size: 26, color: NAVY });
  center('E-MAN PROD atteste que', H - 205, { size: 13, color: MUTED });
  center(c.holder_name, H - 250, { f: serif, size: 34, color: INK });
  center('a suivi la formation', H - 290, { size: 13, color: MUTED });
  center(`« ${c.training_title} »`, H - 325, { f: bold, size: 20, color: NAVY });
  if (c.session_label) center(c.session_label, H - 352, { size: 12, color: INK });
  const facts = [c.conditions?.duration && `Durée : ${c.conditions.duration}`, c.conditions?.attendance_rate !== undefined && c.conditions?.attendance_rate !== null && `Assiduité : ${c.conditions.attendance_rate} %`, c.conditions?.result === 'reussi' && 'Évaluation réussie'].filter(Boolean);
  if (facts.length) center(facts.join('   ·   '), H - 378, { size: 10.5, color: MUTED });
  const place = (biz.sites || [])[0]?.address?.split(',').pop()?.trim() || 'Lomé';
  page.drawText(pdfText(`Fait à ${place}, le ${day(c.issued_at)}`), { x: 80, y: 130, size: 11, font, color: INK });
  page.drawText(pdfText('Pour E-MAN PROD'), { x: W - 280, y: 130, size: 11, font: bold, color: INK });
  page.drawLine({ start: { x: W - 280, y: 84 }, end: { x: W - 80, y: 84 }, thickness: 0.6, color: RULE });
  page.drawText(pdfText(c.signatory || 'La direction'), { x: W - 280, y: 70, size: 9, font, color: MUTED });
  page.drawText(pdfText(`N° ${c.number} · Vérification : ${verifyUrl}`), { x: 80, y: 62, size: 8.5, font, color: MUTED });
  const id = legalLine(legal);
  if (id) page.drawText(pdfText(id), { x: 80, y: 50, size: 7.5, font, color: MUTED });
  return { bytes: await pdf.save(), filename: `${c.kind}-${c.number}.pdf` };
}

export function sendPdf(res, { bytes, filename }) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(Buffer.from(bytes));
}
