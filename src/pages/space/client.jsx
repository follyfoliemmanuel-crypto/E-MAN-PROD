// Espace client : accueil, demande de devis, formations, documents, notifications, assistance, profil.
import React, { useState } from 'react';
import { Paperclip, Plus, Trash2, MessageCircle, Phone, Mail, FileText, Download, Megaphone, Award, Receipt, Check } from 'lucide-react';
import { BUSINESS, whatsappLink } from '../../config.js';
import { useCatalog } from '../../lib/catalog.jsx';
import { TrainingForm } from '../../components/forms.jsx';
import {
  DEMO, QUOTE_LABELS, ORDER_LABELS, space, fetchQuotes, fetchOrders, fetchRegistrations, uploadFile, fileUrl,
  quotePdfUrl, orderPdfUrl, avatarUrl, formatAmount, formatDate, formatDay,
  invoicePdfUrl, receiptPdfUrl, certificatePdfUrl, PAYMENT_METHOD_LABELS, INVOICE_STATE,
} from '../../lib/api.js';
import { useLoad, Loading, ErrorBox, EmptyState, SectionHead, StatCard } from './ui.jsx';
import { LimitHint } from '../../lib/limits.jsx';
import { Avatar } from '../../components/Avatar.jsx';

const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`);
const ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,.ai,.eps,.psd,.cdr,.zip';
const ENROLL_TONE = { 'Inscrit': 'done', 'Terminé': 'done', 'Contacté': 'work', 'Annulé': 'off' };

// ---------------------------------------------------------------------------
// Accueil
// ---------------------------------------------------------------------------
export function ClientHome({ user, go, unread }) {
  const [{ data, error, loading }, reload] = useLoad(async () => {
    const [quotes, orders, regs, notes, ann] = await Promise.all([fetchQuotes(), fetchOrders(), fetchRegistrations(), space.notifications(), space.announcements()]);
    return { quotes, orders, regs, notes: notes.notifications.slice(0, 5), announcements: ann.announcements.slice(0, 3) };
  }, []);
  const hour = new Date().getHours();
  const hello = hour < 18 ? 'Bonjour' : 'Bonsoir';
  return (
    <>
      <SectionHead title={`${hello} ${user.first_name || user.full_name.split(' ')[0]},`} lead="Bienvenue dans votre espace E-MAN PROD : vos devis, commandes, formations et documents au même endroit." />
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <>
          <div className="statGrid">
            <StatCard label="Devis en cours" value={data.quotes.filter((q) => ['nouveau', 'en_etude', 'envoye'].includes(q.status)).length} hint={`${data.quotes.filter((q) => q.status === 'envoye').length} à valider de votre côté`} />
            <StatCard label="Commandes en cours" value={data.orders.filter((o) => ['confirmee', 'en_production', 'terminee'].includes(o.status)).length} hint={`${data.orders.filter((o) => o.status === 'terminee').length} prête(s) à retirer`} />
            <StatCard label="Inscriptions" value={data.regs.filter((r) => r.status !== 'Annulé').length} hint={`${data.regs.filter((r) => r.status === 'Inscrit').length} confirmée(s)`} />
            <StatCard label="Notifications non lues" value={unread} />
          </div>
          <div className="quickActions">
            <button type="button" className="btn btnPrimary" onClick={() => go('devis', { nouveau: 1 })}><Plus size={18} aria-hidden="true" /> Demander un devis</button>
            <button type="button" className="btn btnGhost" onClick={() => go('formations', { inscrire: 1 })}>S’inscrire à une formation</button>
            <button type="button" className="btn btnGhost" onClick={() => go('assistance')}>Contacter l’assistance</button>
          </div>
          {data.quotes.some((q) => q.status === 'envoye') && (
            <div className="notice">
              Vous avez {data.quotes.filter((q) => q.status === 'envoye').length} devis à consulter.{' '}
              <button type="button" className="linkBtn" onClick={() => go('devis')}>Voir mes devis</button>
            </div>
          )}
          {data.announcements.length > 0 && (
            <section className="spaceBlock announceBlock" aria-labelledby="ann-title">
              <h2 className="subTitle" id="ann-title"><Megaphone size={18} aria-hidden="true" /> Informations</h2>
              <ul className="announceList">
                {data.announcements.map((a) => (
                  <li key={a.id}>
                    <strong>{a.title}</strong>
                    <p>{a.body}</p>
                    <small>{formatDate(a.published_at)}{a.link && <> · <a href={a.link}>En savoir plus</a></>}</small>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="spaceBlock">
            <h2 className="subTitle">Dernières nouvelles</h2>
            {data.notes.length ? (
              <ul className="noteList">
                {data.notes.map((n) => <li key={n.id} className={n.read_at ? '' : 'unread'}><strong>{n.title}</strong>{n.body && <span>{n.body}</span>}<time>{formatDate(n.created_at)}</time></li>)}
              </ul>
            ) : <EmptyState title="Rien de nouveau pour l’instant" text="Vous serez prévenu ici dès que l’atelier répond à une demande ou fait avancer une commande." />}
          </section>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Nouvelle demande de devis : plusieurs prestations, quantités, précisions, fichiers
// ---------------------------------------------------------------------------
export function QuoteRequestForm({ user, notify, onDone, onCancel }) {
  const cat = useCatalog();
  const blank = { service_slug: '', label: '', quantity: 1, unit: '', description: '' };
  const [items, setItems] = useState([{ ...blank }]);
  const [message, setMessage] = useState('');
  const [phone, setPhone] = useState(user.phone || '');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (i, k) => (e) => setItems((l) => l.map((it, j) => (j === i ? { ...it, [k]: e.target.value } : it)));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const lines = items.map((it) => ({ ...it, label: it.label || cat.prestations.find((p) => p.slug === it.service_slug)?.title || '' }));
      const q = await space.createQuote({ name: user.full_name, phone, email: user.email, message, items: lines });
      const failed = [];
      for (const f of files) {
        try { await uploadFile('quote', q.id, f); } catch (err) { failed.push(`${f.name} : ${err.message}`); }
      }
      notify(`Demande ${q.number} envoyée. Nous vous répondons rapidement.`);
      if (failed.length) notify(`Fichier(s) non joint(s) — ${failed.join(' ; ')}`, 'error');
      onDone(q);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="spaceForm" onSubmit={submit}>
      <h2 className="subTitle">Nouvelle demande de devis</h2>
      <p className="muted">Ajoutez une ligne par prestation. L’atelier fixe les prix et vous envoie le devis dans votre espace.</p>
      {items.map((it, i) => (
        <fieldset key={i} className="lineEditor">
          <legend>Prestation {i + 1}</legend>
          <div className="fieldRow">
            <label className="field"><span className="fieldLabel">Prestation</span>
              <select required={!it.label} value={it.service_slug} onChange={set(i, 'service_slug')}>
                <option value="">Choisir…</option>
                {cat.prestations.map((p) => <option key={p.slug} value={p.slug}>{p.title}</option>)}
              </select>
            </label>
            <label className="field"><span className="fieldLabel">Ce dont vous avez besoin</span>
              <input maxLength={160} value={it.label} onChange={set(i, 'label')} placeholder="ex. Bâche 3 × 2 m, flyers A5…" />
            </label>
          </div>
          <div className="fieldRow">
            <label className="field"><span className="fieldLabel">Quantité</span><input type="number" min="1" step="any" required value={it.quantity} onChange={set(i, 'quantity')} /></label>
            <label className="field"><span className="fieldLabel">Unité (facultatif)</span><input maxLength={30} value={it.unit} onChange={set(i, 'unit')} placeholder="pièces, m², lots…" /></label>
          </div>
          <label className="field"><span className="fieldLabel">Précisions (format, couleurs, finitions, délai…)</span>
            <textarea rows={2} maxLength={2000} value={it.description} onChange={set(i, 'description')} />
          </label>
          {items.length > 1 && <button type="button" className="btn btnGhost btnSmall" onClick={() => setItems((l) => l.filter((_, j) => j !== i))}><Trash2 size={15} aria-hidden="true" /> Retirer cette prestation</button>}
        </fieldset>
      ))}
      <button type="button" className="btn btnGhost btnSmall" disabled={items.length >= 20} onClick={() => setItems((l) => [...l, { ...blank }])}><Plus size={16} aria-hidden="true" /> Ajouter une prestation</button>
      <label className="field"><span className="fieldLabel">Votre besoin en quelques mots</span>
        <textarea required minLength={5} rows={3} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="ex. Ouverture de ma boutique le 15 décembre, j’ai besoin de…" />
      </label>
      <div className="fieldRow">
        <label className="field"><span className="fieldLabel">Téléphone ou WhatsApp</span><input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label className="field"><span className="fieldLabel">Images ou documents (logo, maquette…)</span>
          <input type="file" multiple accept={ACCEPT} disabled={DEMO} onChange={(e) => setFiles([...e.target.files].slice(0, 10))} />
          <LimitHint purpose="quote" formats="JPG, PNG, PDF, AI, EPS, PSD, CDR ou ZIP" per=" par fichier" after=", 10 fichiers" />
        </label>
      </div>
      {files.length > 0 && <ul className="fileList">{files.map((f) => <li key={f.name}><Paperclip size={14} aria-hidden="true" />{f.name} <span className="muted">{size(f.size)}</span></li>)}</ul>}
      {error && <p className="formError" role="alert">{error}</p>}
      <div className="formActions">
        <button className="btn btnPrimary" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer la demande'}</button>
        <button type="button" className="btn btnGhost" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Mes formations et mes inscriptions
// ---------------------------------------------------------------------------
export function MyTrainings({ notify, params, go }) {
  const cat = useCatalog();
  const [{ data, error, loading }, reload] = useLoad(() => fetchRegistrations(), []);
  const [open, setOpen] = useState(null);
  const [choose, setChoose] = useState(params.inscrire ? '' : null);
  const course = choose ? cat.course(choose) : null;
  return (
    <>
      <SectionHead title="Mes formations" lead="Vos inscriptions, leurs dates et les documents remis par le centre de formation."
        actions={<button type="button" className="btn btnPrimary btnSmall" onClick={() => setChoose('')}>S’inscrire à une formation</button>} />
      {choose !== null && (
        <section className="spaceBlock">
          <label className="field"><span className="fieldLabel">Formation</span>
            <select value={choose} onChange={(e) => setChoose(e.target.value)}>
              <option value="">Choisir une formation…</option>
              {cat.poles.map((p) => (
                <optgroup key={p.slug} label={`Pôle ${p.number} : ${p.title}`}>
                  {cat.coursesOf(p.slug).map((c) => <option key={c.slug} value={c.slug}>{c.title}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          {course && <TrainingForm key={course.slug} course={course} onClose={() => { setChoose(null); reload(); }} />}
          <button type="button" className="btn btnGhost btnSmall" onClick={() => setChoose(null)}>Fermer</button>
        </section>
      )}
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data.length ? (
        <EmptyState title="Aucune inscription pour le moment" text="Parcourez le centre de formation et inscrivez-vous à une session : sa date, son statut et vos documents apparaîtront ici."
          action={<button type="button" className="btn btnGhost btnSmall" onClick={() => go('catalogue')}>Voir les formations</button>} />
      ) : (
        <ul className="cardList">
          {data.map((r) => (
            <li key={r.id} className="infoCard">
              <div className="infoCardHead">
                <strong>{r.course}</strong>
                <span className={`tag ${ENROLL_TONE[r.status] || 'new'}`}>{r.status}</span>
              </div>
              <p className="muted">
                {r.session_starts_on ? `Session du ${formatDay(r.session_starts_on)}${r.session_ends_on ? ` au ${formatDay(r.session_ends_on)}` : ''}` : 'Prochaine session : date communiquée par le centre'}
                {r.session_schedule && ` · ${r.session_schedule}`}{r.session_site && ` · ${r.session_site}`}
              </p>
              <p className="infoFacts">
                {r.training_duration && <span>Durée : {r.training_duration}</span>}
                {r.training_level && <span>Niveau : {r.training_level}</span>}
                {r.training_price_fcfa !== null && r.training_price_fcfa !== undefined && <span>Tarif : {formatAmount(r.training_price_fcfa)}</span>}
                {r.training_certificate && <span>Remis : {r.training_certificate}</span>}
              </p>
              <div className="infoCardActions">
                <button type="button" className="btn btnGhost btnSmall" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Masquer' : `Documents (${r.documents || 0})`}</button>
                {r.course_slug && <a className="btn btnGhost btnSmall" href={`/formations/${r.course_slug}`}>Fiche de la formation</a>}
              </div>
              {open === r.id && <EnrollmentDocs id={r.id} />}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const ATTEND = { present: 'Présent', retard: 'En retard', absent: 'Absent', excuse: 'Excusé' };

/** Suivi d'une inscription : documents personnels, supports de la session, présences, attestation. */
function EnrollmentDocs({ id }) {
  const [{ data, error }] = useLoad(async () => {
    const [e, l] = await Promise.all([space.enrollment(id), DEMO ? null : space.learner(id)]);
    return { files: e.registration.files || [], ...(l || { attendance: [], session_documents: [], certificate: null, attendance_rate: null }) };
  }, [id]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading lines={1} />;
  const fileItem = (f) => <li key={f.id}><FileText size={14} aria-hidden="true" /><a href={fileUrl(f.id)}>{f.original_name}</a> <span className="muted">{size(f.size_bytes)}</span></li>;
  return (
    <div className="learnerPanel">
      {data.certificate && (
        <p className="certLine"><Award size={18} aria-hidden="true" />
          <span><strong>{data.certificate.kind === 'certificat' ? 'Certificat' : 'Attestation'} n° {data.certificate.number}</strong><small>Délivré(e) le {formatDate(data.certificate.issued_at)}</small></span>
          <a className="btn btnPrimary btnSmall" href={certificatePdfUrl(data.certificate.id)}><Download size={15} aria-hidden="true" /> Télécharger</a>
        </p>
      )}
      <h3 className="miniTitle">Mes documents</h3>
      {data.files.length ? <ul className="fileList">{data.files.map(fileItem)}</ul> : <p className="muted">Aucun document personnel pour le moment (convocation, attestation…).</p>}
      <h3 className="miniTitle">Supports de la session</h3>
      {data.session_documents.length ? <ul className="fileList">{data.session_documents.map(fileItem)}</ul> : <p className="muted">Les supports de cours apparaîtront ici une fois votre place confirmée.</p>}
      {data.attendance.length > 0 && (
        <>
          <h3 className="miniTitle">Présences {data.attendance_rate !== null && <span className="muted">· assiduité {data.attendance_rate} %</span>}</h3>
          <ul className="attendList">{data.attendance.map((a) => <li key={a.day} className={`att-${a.status}`}><span>{formatDay(a.day)}</span><span>{ATTEND[a.status]}</span></li>)}</ul>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mes documents
// ---------------------------------------------------------------------------
export function MyDocuments() {
  const [{ data, error, loading }, reload] = useLoad(() => space.documents(), []);
  if (loading && !data) return <><SectionHead title="Mes documents" /><Loading /></>;
  if (error) return <><SectionHead title="Mes documents" /><ErrorBox error={error} onRetry={reload} /></>;
  const invoices = data.invoices || [], receipts = data.receipts || [], certs = data.certificates || [];
  const nothing = !data.files.length && !data.quotes.length && !data.orders.length && !invoices.length && !receipts.length && !certs.length;
  return (
    <>
      <SectionHead title="Mes documents" lead="Devis, bons de commande, factures, reçus et attestations en PDF, et tous les fichiers échangés avec l’atelier." />
      {nothing ? <EmptyState title="Aucun document pour le moment" text="Vos devis envoyés, vos bons de commande et les fichiers joints à vos demandes apparaîtront ici." /> : (
        <div className="docGrid">
          {data.quotes.length > 0 && (
            <section className="spaceBlock"><h2 className="subTitle">Devis</h2>
              <ul className="docList">{data.quotes.map((q) => (
                <li key={q.id}><FileText size={16} aria-hidden="true" /><span><strong>Devis {q.number}</strong><small>{QUOTE_LABELS[q.status]} · {formatAmount(q.total_fcfa)}</small></span>
                  <a className="btn btnGhost btnSmall" href={quotePdfUrl(q.id)}><Download size={15} aria-hidden="true" /> PDF</a></li>
              ))}</ul>
            </section>
          )}
          {data.orders.length > 0 && (
            <section className="spaceBlock"><h2 className="subTitle">Bons de commande</h2>
              <ul className="docList">{data.orders.map((o) => (
                <li key={o.id}><FileText size={16} aria-hidden="true" /><span><strong>Commande {o.number}</strong><small>{ORDER_LABELS[o.status]} · {formatAmount(o.total_fcfa)}</small></span>
                  <a className="btn btnGhost btnSmall" href={orderPdfUrl(o.id)}><Download size={15} aria-hidden="true" /> PDF</a></li>
              ))}</ul>
            </section>
          )}
          {invoices.length > 0 && (
            <section className="spaceBlock"><h2 className="subTitle">Factures</h2>
              <ul className="docList">{invoices.map((f) => {
                const [label, tone] = INVOICE_STATE[f.payment_state];
                return (
                  <li key={f.id}><FileText size={16} aria-hidden="true" /><span><strong>Facture {f.invoice_number}</strong>
                    <small>Commande {f.order_number} · {formatAmount(f.total_fcfa)} · <span className={`tag ${tone}`}>{label}</span>{f.payment_state === 'partielle' && ` · reste ${formatAmount(f.total_fcfa - f.paid_fcfa)}`}</small></span>
                    <a className="btn btnGhost btnSmall" href={invoicePdfUrl(f.id)}><Download size={15} aria-hidden="true" /> PDF</a></li>
                );
              })}</ul>
            </section>
          )}
          {receipts.length > 0 && (
            <section className="spaceBlock"><h2 className="subTitle">Reçus de paiement</h2>
              <ul className="docList">{receipts.map((r) => (
                <li key={r.id}><Receipt size={16} aria-hidden="true" /><span><strong>Reçu {r.receipt_number}</strong><small>{formatAmount(r.amount_fcfa)} · {PAYMENT_METHOD_LABELS[r.method]} · {formatDay(r.received_on)} · commande {r.order_number}</small></span>
                  <a className="btn btnGhost btnSmall" href={receiptPdfUrl(r.id)}><Download size={15} aria-hidden="true" /> PDF</a></li>
              ))}</ul>
            </section>
          )}
          {certs.length > 0 && (
            <section className="spaceBlock"><h2 className="subTitle">Attestations et certificats</h2>
              <ul className="docList">{certs.map((c) => (
                <li key={c.id}><Award size={16} aria-hidden="true" /><span><strong>{c.kind === 'certificat' ? 'Certificat' : 'Attestation'} {c.number}</strong><small>{c.training_title} · {formatDate(c.issued_at)}</small></span>
                  <a className="btn btnGhost btnSmall" href={certificatePdfUrl(c.id)}><Download size={15} aria-hidden="true" /> PDF</a></li>
              ))}</ul>
            </section>
          )}
          {data.files.length > 0 && (
            <section className="spaceBlock"><h2 className="subTitle">Fichiers</h2>
              <ul className="docList">{data.files.map((f) => (
                <li key={f.id}><Paperclip size={16} aria-hidden="true" /><span><strong>{f.original_name}</strong><small>{f.about ? `${f.about} · ` : ''}{f.source === 'client' ? 'envoyé par vous' : 'envoyé par l’atelier'} · {size(f.size_bytes)} · {formatDate(f.created_at)}</small></span>
                  <a className="btn btnGhost btnSmall" href={fileUrl(f.id)}><Download size={15} aria-hidden="true" /> Télécharger</a></li>
              ))}</ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
const linkToSection = (link = '') => {
  const p = new URLSearchParams(link.split('?')[1] || '');
  if (p.get('devis')) return ['devis', { id: p.get('devis') }];
  if (p.get('commande')) return ['commandes', { id: p.get('commande') }];
  if (p.get('onglet') === 'inscriptions') return ['inscriptions', {}];
  if (p.get('section')) return [p.get('section'), Object.fromEntries([...p].filter(([k]) => k !== 'section'))];
  return null;
};

const CATEGORY_LABELS = { quotes: 'Devis', orders: 'Commandes', trainings: 'Formations', messages: 'Messages', announcements: 'Informations', team: 'Équipe', account: 'Compte', general: 'Autres' };
const when = (d) => new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: new Date(d).getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: '2-digit', minute: '2-digit' });

/** Centre de notifications : filtres, historique complet (par pages), marquer comme lu ou non lu. */
export function NotificationsSection({ go, onRead }) {
  const [filter, setFilter] = useState({ unread: false, category: '' });
  const [pages, setPages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [{ data, error, loading }, reload] = useLoad(async () => {
    const r = await space.notifications({ unread: filter.unread ? 1 : undefined, category: filter.category || undefined });
    setPages([]);
    return r;
  }, [filter.unread, filter.category]);
  const list = data ? [...data.notifications, ...pages.flatMap((p) => p.notifications)] : [];
  const hasMore = pages.length ? pages[pages.length - 1].has_more : data?.has_more;
  const more = async () => {
    setBusy(true);
    try {
      const r = await space.notifications({ unread: filter.unread ? 1 : undefined, category: filter.category || undefined, before: list[list.length - 1].created_at });
      setPages((p) => [...p, r]);
    } finally { setBusy(false); }
  };
  const refresh = () => { reload(); onRead(); };
  const toggle = async (n) => { await (n.read_at ? space.unreadNotifications([n.id]) : space.readNotifications([n.id])); refresh(); };
  const markAll = async () => { await space.readNotifications(); refresh(); };
  const cats = Object.keys(CATEGORY_LABELS).filter((c) => data?.unread_by_category?.[c] || filter.category === c || list.some((n) => n.category === c));
  return (
    <>
      <SectionHead title="Notifications" lead="L’historique de tout ce qui concerne vos demandes, commandes et formations."
        actions={data?.unread > 0 && <button type="button" className="btn btnGhost btnSmall" onClick={markAll}><Check size={15} aria-hidden="true" /> Tout marquer comme lu</button>} />
      <div className="filterRow" role="group" aria-label="Filtrer les notifications">
        <button type="button" className={`chip ${!filter.unread && !filter.category ? 'on' : ''}`} aria-pressed={!filter.unread && !filter.category} onClick={() => setFilter({ unread: false, category: '' })}>Toutes</button>
        <button type="button" className={`chip ${filter.unread ? 'on' : ''}`} aria-pressed={filter.unread} onClick={() => setFilter((f) => ({ ...f, unread: !f.unread }))}>
          Non lues{data?.unread ? ` (${data.unread})` : ''}
        </button>
        {cats.map((c) => (
          <button key={c} type="button" className={`chip ${filter.category === c ? 'on' : ''}`} aria-pressed={filter.category === c} onClick={() => setFilter((f) => ({ ...f, category: f.category === c ? '' : c }))}>
            {CATEGORY_LABELS[c]}{data?.unread_by_category?.[c] ? ` (${data.unread_by_category[c]})` : ''}
          </button>
        ))}
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : !list.length ? (
        <EmptyState title={filter.unread ? 'Tout est lu' : 'Aucune notification'} text={filter.unread ? 'Vous avez consulté toutes vos notifications.' : 'Vous serez prévenu ici, et par e-mail si votre adresse est confirmée, à chaque étape de vos demandes.'} />
      ) : (
        <>
          <ul className="noteList big">
            {list.map((n) => {
              const target = linkToSection(n.link || '');
              return (
                <li key={n.id} className={n.read_at ? '' : 'unread'}>
                  <strong>{n.title}</strong>{n.body && <span>{n.body}</span>}
                  <time dateTime={n.created_at}>{CATEGORY_LABELS[n.category] || ''} · {when(n.created_at)}</time>
                  <span className="noteActions">
                    {target && <button type="button" className="linkBtn" onClick={async () => { if (!n.read_at) await space.readNotifications([n.id]); onRead(); go(target[0], target[1]); }}>Voir</button>}
                    <button type="button" className="linkBtn muted" onClick={() => toggle(n)}>{n.read_at ? 'Marquer comme non lue' : 'Marquer comme lue'}</button>
                  </span>
                </li>
              );
            })}
          </ul>
          {hasMore && <button type="button" className="btn btnGhost btnSmall" disabled={busy} aria-busy={busy} onClick={more}>{busy ? 'Chargement…' : 'Afficher les plus anciennes'}</button>}
        </>
      )}
    </>
  );
}

/** Choix des e-mails reçus (les notifications dans l'espace restent toujours visibles). */
export function EmailPrefs({ notify }) {
  const [{ data, error }, reload] = useLoad(() => space.emailPrefs(), []);
  const [local, setLocal] = useState({});
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading lines={2} />;
  const set = async (key, email) => {
    setLocal((l) => ({ ...l, [key]: email }));
    try {
      await space.setEmailPrefs({ [key]: email });
      notify(email ? 'E-mails réactivés.' : 'Vous ne recevrez plus ces e-mails.');
    } catch (err) {
      setLocal((l) => ({ ...l, [key]: !email }));
      notify(err.message, 'error');
    }
  };
  return (
    <section className="spaceBlock" aria-labelledby="prefs-title">
      <h2 className="subTitle" id="prefs-title">E-mails reçus</h2>
      <p className="muted">Les notifications restent toujours dans votre espace. Les e-mails de sécurité (mot de passe, confirmation d’adresse) sont toujours envoyés.</p>
      <ul className="toggleList">
        {data.categories.map((c) => (
          <li key={c.key}><label className="check"><input type="checkbox" checked={local[c.key] ?? c.email} onChange={(e) => set(c.key, e.target.checked)} /> <span>{c.label}</span></label></li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Assistance (côté client)
// ---------------------------------------------------------------------------
export function SupportSection({ notify }) {
  return (
    <>
      <SectionHead title="Assistance" lead="Une question sur une demande, un fichier ou votre compte ? Écrivez à l’équipe : la réponse arrive ici." />
      <div className="supportGrid">
        <SupportThread who="me" notify={notify} side="client" />
        <aside className="spaceBlock contactCard">
          <h2 className="subTitle">Nous joindre directement</h2>
          <a className="contactLine" href={whatsappLink(undefined, 'support')} target="_blank" rel="noreferrer"><MessageCircle size={18} aria-hidden="true" />WhatsApp {BUSINESS.phoneDisplay}</a>
          <a className="contactLine" href={`tel:+${BUSINESS.whatsapp}`}><Phone size={18} aria-hidden="true" />Appeler</a>
          <a className="contactLine" href={`mailto:${BUSINESS.email}`}><Mail size={18} aria-hidden="true" />{BUSINESS.email}</a>
          <ul className="siteMini">{BUSINESS.sites.map((s) => <li key={s.id || s.name}><strong>{s.role}</strong> {s.name}{s.city ? `, ${s.city}` : ''}</li>)}</ul>
        </aside>
      </div>
    </>
  );
}

/** Fil d'assistance : `who` = 'me' (client) ou l'identifiant du client (équipe). */
export function SupportThread({ who, notify, side, onSent }) {
  const [{ data, error, loading }, reload] = useLoad(() => space.supportMessages(who), [who]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <section className="spaceBlock thread">
      {loading && !data ? <Loading lines={2} /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.messages.length ? (
        <ol className="messages">
          {data.messages.map((m) => (
            <li key={m.id} className={m.author_role === (side === 'client' ? 'client' : 'admin') ? 'mine' : undefined}>
              <p>{m.body}</p>
              <small>{m.author_role === 'admin' ? `E-MAN PROD${m.author_name ? ` (${m.author_name})` : ''}` : m.author_name || 'Client'} · {new Date(m.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
            </li>
          ))}
        </ol>
      ) : <EmptyState title="Pas encore de message" text={side === 'client' ? 'Écrivez votre question ci-dessous : un membre de l’équipe vous répond ici.' : 'Aucun message dans cette conversation.'} />}
      <form className="messageForm" onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        try {
          await space.supportSend(text.trim(), side === 'client' ? null : who);
          setText('');
          reload();
          onSent?.();
        } catch (err) {
          notify(err.message, 'error');
        } finally {
          setBusy(false);
        }
      }}>
        <label className="sr" htmlFor={`support-${who}`}>Votre message</label>
        <textarea id={`support-${who}`} rows={2} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder={side === 'client' ? 'Votre question…' : 'Votre réponse…'} disabled={DEMO} />
        <button className="btn btnPrimary btnSmall" disabled={busy || !text.trim()}>Envoyer</button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Photo de profil
// ---------------------------------------------------------------------------
export function AvatarEditor({ user, notify, onChange }) {
  const [busy, setBusy] = useState(false);
  const url = avatarUrl(user.avatar_file_id);
  return (
    <div className="avatarEditor">
      <Avatar user={user} size={88} className="big" alt={url ? 'Votre photo de profil' : ''} />
      <div>
        <label className={`btn btnGhost btnSmall fileBtn${busy ? ' busy' : ''}`}>
          {busy ? 'Envoi…' : url ? 'Changer la photo' : 'Ajouter une photo'}
          <input type="file" className="sr" accept=".jpg,.jpeg,.png,.webp" disabled={busy || DEMO} onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setBusy(true);
            try {
              const f = await uploadFile('avatar', null, file);
              const r = await space.setAvatar(f.id);
              notify('Photo de profil enregistrée.');
              onChange(r.avatar_file_id);
            } catch (err) {
              notify(err.message, 'error');
            } finally {
              setBusy(false);
            }
          }} />
        </label>
        {url && <button type="button" className="linkBtn" disabled={busy} onClick={async () => { await space.removeAvatar(); onChange(null); notify('Photo retirée.'); }}>Retirer</button>}
        <p className="hint">JPG, PNG ou WebP, 2 Mo maximum. Visible de vous et de l’équipe E-MAN PROD.</p>
      </div>
    </div>
  );
}
