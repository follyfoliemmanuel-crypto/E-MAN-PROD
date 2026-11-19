// Espace client et administration : devis, commandes, messages, fichiers, profil.
// Les règles (qui peut faire quoi, quand) sont appliquées par le serveur ; l'écran
// n'affiche que les actions que le serveur autorise (champ « allowed »).
import React, { useCallback, useEffect, useState } from 'react';
import { MessageCircle, Paperclip, Plus, Trash2, X, Download } from 'lucide-react';
import { LimitHint } from '../lib/limits.jsx';
import {
  DEMO, QUOTE_LABELS, ORDER_LABELS, PAYMENT_LABELS,
  fetchQuotes, getQuote, updateQuote, quoteStatus, convertQuote,
  fetchOrders, getOrder, updateOrder, fetchMessages, sendMessage, uploadFile, fileUrl,
  fetchAccount, saveAccount, formatAmount, formatDate, quotePdfUrl, orderPdfUrl, space,
} from '../lib/api.js';
import { OrderBilling } from './space/billing.jsx';
import { useConfirm } from './space/ui.jsx';

const waLink = (phone, text) => `https://wa.me/${String(phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
const QUOTE_TONE = { nouveau: 'new', en_etude: 'work', envoye: 'work', accepte: 'done', refuse: 'off', expire: 'off', annule: 'off' };
const ORDER_TONE = { confirmee: 'new', en_production: 'work', terminee: 'work', livree: 'done', annulee: 'off' };
const HISTORY_LABELS = {
  'quote.created': 'Demande reçue', 'quote.updated': 'Devis modifié', 'quote.status_changed': 'Statut', 'quote.converted': 'Commande créée',
  'order.created': 'Commande créée', 'order.updated': 'Commande modifiée', 'order.status_changed': 'Statut',
  'file.uploaded': 'Fichier ajouté', 'file.deleted': 'Fichier retiré', 'migration.imported': 'Reprise de l’ancienne demande',
};

function useLoader(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      setState({ loading: false, data: await fn(), error: '' });
    } catch (e) {
      setState({ loading: false, data: null, error: e.message });
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return [state, load];
}

const Empty = ({ filtered, what }) => <p className="empty">{filtered ? 'Aucun résultat pour cette recherche.' : `Aucun${what.endsWith('e') ? 'e' : ''} ${what} pour le moment.`}</p>;

// ---------------------------------------------------------------------------
// Devis
// ---------------------------------------------------------------------------
export function QuotesPanel({ isAdmin, notify, search, onChanged, initialId = null }) {
  const [open, setOpen] = useState(initialId);
  const [status, setStatus] = useState('');
  const [{ loading, data, error }, reload] = useLoader(() => fetchQuotes(status ? { status } : {}), [status]);
  const rows = (data || []).filter((q) => !search || [q.number, q.customer_name, q.customer_phone, q.summary].join(' ').toLowerCase().includes(search));
  const refresh = () => { reload(); onChanged?.(); };
  if (loading && !data) return <p className="empty">Chargement…</p>;
  if (error) return <p className="formError" role="alert">{error}</p>;
  return (
    <>
      <div className="filterBar slim">
        <select aria-label="Filtrer par statut" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les statuts</option>{Object.entries(QUOTE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {open && <QuoteDetail id={open} isAdmin={isAdmin} notify={notify} onClose={() => setOpen(null)} onChanged={refresh} />}
      {!rows.length ? <Empty filtered={Boolean(search || status)} what="demande de devis" /> : (
        <div className="tableScroll">
          <table className="table">
            <thead><tr>
              <th scope="col">Numéro</th>{isAdmin && <th scope="col">Client</th>}<th scope="col">Prestations</th>
              <th scope="col">Statut</th><th scope="col">Total</th><th scope="col"><span className="sr">Ouvrir</span></th>
            </tr></thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id} className={open === q.id ? 'current' : undefined}>
                  <td className="ref">{q.number}<small>{formatDate(q.created_at)}</small></td>
                  {isAdmin && <td>{q.customer_name}<small>{q.customer_phone}</small></td>}
                  <td className="wide">{q.summary}{q.order_number && <small>Commande {q.order_number}</small>}</td>
                  <td><span className={`tag ${QUOTE_TONE[q.status]}`}>{QUOTE_LABELS[q.status]}</span></td>
                  <td className="num">{q.total_fcfa ? formatAmount(q.total_fcfa) : 'À chiffrer'}</td>
                  <td><button type="button" className="btn btnGhost btnSmall" onClick={() => setOpen(q.id)} aria-label={`Ouvrir le devis ${q.number}`}>Ouvrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const QUOTE_ACTIONS = {
  admin: { en_etude: 'Mettre en étude', envoye: 'Envoyer le devis au client', accepte: 'Marquer comme accepté', refuse: 'Marquer comme refusé', expire: 'Marquer comme expiré', annule: 'Annuler la demande' },
  client: { accepte: 'Accepter le devis', refuse: 'Refuser le devis', annule: 'Annuler ma demande' },
};

function QuoteDetail({ id, isAdmin, notify, onClose, onChanged }) {
  const confirm = useConfirm();
  const [{ loading, data: q, error }, reload] = useLoader(() => getQuote(id), [id]);
  const [busy, setBusy] = useState(false);
  const run = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      if (done) notify(done);
      await reload();
      onChanged();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  if (loading && !q) return <section className="recordPanel"><p className="muted">Chargement…</p></section>;
  if (error) return <section className="recordPanel"><p className="formError" role="alert">{error}</p></section>;
  const editable = isAdmin && ['nouveau', 'en_etude'].includes(q.status);
  const labels = isAdmin ? QUOTE_ACTIONS.admin : QUOTE_ACTIONS.client;
  return (
    <section className="recordPanel" aria-labelledby={`devis-${q.id}`}>
      <header className="recordHead">
        <div>
          <h2 id={`devis-${q.id}`} className="subTitle">Devis {q.number}</h2>
          <p className="muted">
            Reçu le {formatDate(q.created_at)}
            {q.sent_at && <> · envoyé le {formatDate(q.sent_at)}</>}
            {q.valid_until && <> · valable jusqu’au {formatDate(q.valid_until)}</>}
          </p>
        </div>
        <span className={`tag ${QUOTE_TONE[q.status]}`}>{QUOTE_LABELS[q.status]}</span>
        <button type="button" className="iconBtn" onClick={onClose} aria-label="Fermer le devis"><X size={18} aria-hidden="true" /></button>
      </header>

      {isAdmin && (
        <p className="recordClient">
          <strong>{q.customer_name}</strong>{q.customer_company && ` · ${q.customer_company}`}{' · '}
          <a className="waLink" href={waLink(q.customer_phone, `Bonjour ${q.customer_name}, ici E-MAN PROD au sujet de votre demande ${q.number}.`)} target="_blank" rel="noreferrer"><MessageCircle size={13} aria-hidden="true" />{q.customer_phone}</a>
          {q.customer_email && ` · ${q.customer_email}`}
          {!q.user_id && <span className="muted"> · sans compte client</span>}
        </p>
      )}
      {q.message && <blockquote className="recordMessage">{q.message}</blockquote>}

      {editable ? <ItemsEditor quote={q} busy={busy} onSave={(patch) => run(() => updateQuote(q.id, patch), 'Devis enregistré.')} />
        : <ItemsTable items={q.items} subtotal={q.subtotal_fcfa} discount={q.discount_fcfa} total={q.total_fcfa} />}

      <div className="recordActions">
        {(q.allowed || []).filter((to) => labels[to]).map((to) => (
          <button key={to} type="button" disabled={busy} className={`btn btnSmall ${['accepte', 'envoye'].includes(to) ? 'btnPrimary' : to === 'annule' || to === 'refuse' ? 'btnDangerGhost' : 'btnGhost'}`}
            onClick={async () => {
              const ask = { annule: ['Annuler ce devis ?', 'Il restera dans l’historique avec le statut « Annulé ».'], refuse: [isAdmin ? 'Marquer ce devis comme refusé ?' : 'Refuser ce devis ?', 'Vous pourrez toujours faire une nouvelle demande.'], accepte: [isAdmin ? 'Marquer ce devis comme accepté ?' : `Accepter le devis de ${formatAmount(q.total_fcfa)} ?`, isAdmin ? 'À faire si le client a donné son accord par téléphone ou WhatsApp.' : 'L’atelier confirmera la commande et ses modalités (acompte, délai).'], envoye: ['Envoyer ce devis au client ?', q.user_id ? 'Il le verra dans son espace et sera prévenu.' : 'Ce client n’a pas de compte : envoyez-lui aussi le PDF par WhatsApp ou e-mail.'] }[to];
              if (ask && !(await confirm({ title: ask[0], text: ask[1], confirm: labels[to], danger: to === 'annule' || to === 'refuse' }))) return;
              run(() => quoteStatus(q.id, to), `Devis ${q.number} : ${QUOTE_LABELS[to].toLowerCase()}.`);
            }}>
            {labels[to]}
          </button>
        ))}
        {isAdmin && q.status === 'accepte' && !q.order && (
          <button type="button" disabled={busy} className="btn btnPrimary btnSmall" onClick={() => run(async () => {
            const o = await convertQuote(q.id);
            notify(`Commande ${o.number} créée.`);
          })}>Créer la commande</button>
        )}
        {q.order && <span className="muted">Commande {q.order.number}</span>}
        {(isAdmin || !['nouveau', 'en_etude'].includes(q.status)) && <a className="btn btnGhost btnSmall" href={quotePdfUrl(q.id)}><Download size={15} aria-hidden="true" /> Télécharger le PDF{isAdmin && ['nouveau', 'en_etude'].includes(q.status) ? ' (brouillon)' : ''}</a>}
      </div>

      <div className="recordGrid">
        <Files list={q.files} purpose="quote" targetId={q.id} canAdd={!['annule', 'refuse', 'expire'].includes(q.status)} notify={notify} onAdded={reload} />
        <History items={q.history} labels={QUOTE_LABELS} />
      </div>
      <Thread target={{ quote_id: q.id }} isAdmin={isAdmin} notify={notify} />
    </section>
  );
}

function ItemsTable({ items, subtotal, discount, total }) {
  return (
    <div className="tableScroll">
      <table className="table itemsTable">
        <thead><tr><th scope="col">Prestation</th><th scope="col">Quantité</th><th scope="col">Prix unitaire</th><th scope="col">Montant</th></tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td className="wide">{i.label}{i.description && <small>{i.description}</small>}</td>
              <td className="num">{Number(i.quantity).toLocaleString('fr-FR')} {i.unit || ''}</td>
              <td className="num">{formatAmount(i.unit_price_fcfa)}</td>
              <td className="num">{i.line_total_fcfa === null ? '—' : formatAmount(i.line_total_fcfa)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {discount > 0 && <tr><td colSpan={3}>Remise</td><td className="num">− {formatAmount(discount)}</td></tr>}
          <tr><td colSpan={3}><strong>Total</strong>{subtotal !== total && <small>Sous-total {formatAmount(subtotal)}</small>}</td><td className="num"><strong>{items.some((i) => i.unit_price_fcfa === null) ? 'À chiffrer' : formatAmount(total)}</strong></td></tr>
        </tfoot>
      </table>
    </div>
  );
}

export function ItemsEditor({ quote, busy, onSave, withValidity = true, saveLabel = 'Enregistrer le devis' }) {
  const fromQuote = () => quote.items.map((i) => ({ service_slug: i.service_slug, label: i.label, description: i.description || '', quantity: i.quantity, unit: i.unit || '', unit_price_fcfa: i.unit_price_fcfa ?? '' }));
  const [items, setItems] = useState(fromQuote);
  const [discount, setDiscount] = useState(quote.discount_fcfa || '');
  const [validUntil, setValidUntil] = useState(quote.valid_until || '');
  useEffect(() => { setItems(fromQuote()); setDiscount(quote.discount_fcfa || ''); }, [quote]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i, k) => (e) => setItems((list) => list.map((it, j) => (j === i ? { ...it, [k]: e.target.value } : it)));
  const lineTotal = (it) => (it.unit_price_fcfa === '' ? null : Math.round(Number(it.quantity || 0) * Number(it.unit_price_fcfa)));
  const sub = items.reduce((s, it) => s + (lineTotal(it) || 0), 0);
  return (
    <form className="itemsEditor" onSubmit={(e) => {
      e.preventDefault();
      onSave({ items, discount_fcfa: discount === '' ? 0 : discount, ...(withValidity && validUntil ? { valid_until: validUntil } : {}) });
    }}>
      <div className="tableScroll">
        <table className="table itemsTable">
          <thead><tr><th scope="col">Prestation</th><th scope="col">Quantité</th><th scope="col">Unité</th><th scope="col">Prix unitaire (FCFA)</th><th scope="col">Montant</th><th scope="col"><span className="sr">Retirer</span></th></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td className="wide">
                  <input aria-label={`Intitulé de la ligne ${i + 1}`} required minLength={2} maxLength={160} value={it.label} onChange={set(i, 'label')} />
                  <input aria-label={`Détail de la ligne ${i + 1}`} className="soft" maxLength={2000} value={it.description} onChange={set(i, 'description')} placeholder="Détail (format, finition…)" />
                </td>
                <td><input aria-label={`Quantité, ligne ${i + 1}`} className="amount" type="number" min="0.01" step="any" required value={it.quantity} onChange={set(i, 'quantity')} /></td>
                <td><input aria-label={`Unité, ligne ${i + 1}`} className="unit" maxLength={30} value={it.unit} onChange={set(i, 'unit')} placeholder="pièce" /></td>
                <td><input aria-label={`Prix unitaire, ligne ${i + 1}`} className="amount" type="number" min="0" step="1" inputMode="numeric" value={it.unit_price_fcfa} onChange={set(i, 'unit_price_fcfa')} placeholder="À chiffrer" /></td>
                <td className="num">{lineTotal(it) === null ? '—' : formatAmount(lineTotal(it))}</td>
                <td>{items.length > 1 && <button type="button" className="iconBtn" onClick={() => setItems((l) => l.filter((_, j) => j !== i))} aria-label={`Retirer la ligne ${i + 1}`}><Trash2 size={16} aria-hidden="true" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="itemsFoot">
        <button type="button" className="btn btnGhost btnSmall" onClick={() => setItems((l) => [...l, { label: '', description: '', quantity: 1, unit: '', unit_price_fcfa: '' }])}><Plus size={16} aria-hidden="true" /> Ajouter une ligne</button>
        <label className="field inline"><span className="fieldLabel">Remise (FCFA)</span><input className="amount" type="number" min="0" step="1" value={discount} onChange={(e) => setDiscount(e.target.value)} /></label>
        {withValidity && <label className="field inline"><span className="fieldLabel">Valable jusqu’au</span><input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></label>}
        <p className="itemsTotal">Total : <strong>{formatAmount(Math.max(sub - Number(discount || 0), 0))}</strong></p>
        <button className="btn btnPrimary btnSmall" disabled={busy}>{busy ? 'Enregistrement…' : saveLabel}</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------
export function OrdersPanel({ isAdmin, notify, search, onChanged, initialId = null }) {
  const [open, setOpen] = useState(initialId);
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(false);
  const [{ loading, data, error }, reload] = useLoader(() => fetchOrders({ status, ...(mine ? { assigned: 'me' } : {}) }), [status, mine]);
  const rows = (data || []).filter((o) => !search || [o.number, o.customer_name, o.customer_phone, o.summary].join(' ').toLowerCase().includes(search));
  if (loading && !data) return <p className="empty">Chargement…</p>;
  if (error) return <p className="formError" role="alert">{error}</p>;
  return (
    <>
      <div className="filterBar slim">
        <select aria-label="Filtrer par statut" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les statuts</option>{Object.entries(ORDER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {isAdmin && <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Seulement celles qui me sont confiées</label>}
      </div>
      {open && <OrderDetail id={open} isAdmin={isAdmin} notify={notify} onClose={() => setOpen(null)} onChanged={() => { reload(); onChanged?.(); }} />}
      {!rows.length ? <Empty filtered={Boolean(search || status || mine)} what="commande" /> : (
        <div className="tableScroll">
          <table className="table">
            <thead><tr>
              <th scope="col">Numéro</th>{isAdmin && <th scope="col">Client</th>}<th scope="col">Prestations</th>
              <th scope="col">Statut</th><th scope="col">Paiement</th><th scope="col">Total</th><th scope="col"><span className="sr">Ouvrir</span></th>
            </tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className={open === o.id ? 'current' : undefined}>
                  <td className="ref">{o.number}<small>{formatDate(o.created_at)}</small></td>
                  {isAdmin && <td>{o.customer_name}<small>{o.customer_phone}</small></td>}
                  <td className="wide">{o.summary}{o.due_on && <small>Prévue le {formatDate(o.due_on)}</small>}{isAdmin && o.assigned_name && <small>Suivie par {o.assigned_name}</small>}</td>
                  <td><span className={`tag ${ORDER_TONE[o.status]}`}>{ORDER_LABELS[o.status]}</span></td>
                  <td>{PAYMENT_LABELS[o.payment_status]}</td>
                  <td className="num">{formatAmount(o.total_fcfa)}</td>
                  <td><button type="button" className="btn btnGhost btnSmall" onClick={() => setOpen(o.id)} aria-label={`Ouvrir la commande ${o.number}`}>Ouvrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function OrderDetail({ id, isAdmin, notify, onClose, onChanged }) {
  const confirm = useConfirm();
  const [{ loading, data: o, error }, reload] = useLoader(() => getOrder(id), [id]);
  const [{ data: members }] = useLoader(() => (isAdmin ? space.members().then((r) => r.members) : Promise.resolve([])), [isAdmin]);
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  useEffect(() => { if (o) setV({ status: o.status, due_on: o.due_on || '', admin_note: o.admin_note || '', assigned_to: o.assigned_to || '' }); }, [o]);
  if (loading && !o) return <section className="recordPanel"><p className="muted">Chargement…</p></section>;
  if (error) return <section className="recordPanel"><p className="formError" role="alert">{error}</p></section>;
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  async function save(e) {
    e.preventDefault();
    const patch = {};
    if (v.status !== o.status) patch.status = v.status;
    if ((v.due_on || null) !== (o.due_on || null)) patch.due_on = v.due_on;
    if ((v.admin_note || '') !== (o.admin_note || '')) patch.admin_note = v.admin_note;
    if ((v.assigned_to || '') !== (o.assigned_to || '')) patch.assigned_to = v.assigned_to || null;
    if (!Object.keys(patch).length) return notify('Aucune modification.');
    if (patch.status === 'annulee' && !(await confirm({ title: `Annuler la commande ${o.number} ?`, text: 'Le client sera prévenu. Une commande annulée ne peut plus être relancée.', confirm: 'Annuler la commande', danger: true }))) return;
    if (patch.status === 'livree' && !(await confirm({ title: 'Marquer la commande comme livrée ?', text: 'Ses lignes et sa date ne pourront plus être modifiées.', confirm: 'Marquer livrée' }))) return;
    setBusy(true);
    try {
      await updateOrder(o.id, patch);
      notify(`Commande ${o.number} enregistrée.`);
      await reload();
      onChanged();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  const closed = ['livree', 'annulee'].includes(o.status);
  return (
    <section className="recordPanel" aria-labelledby={`commande-${o.id}`}>
      <header className="recordHead">
        <div>
          <h2 id={`commande-${o.id}`} className="subTitle">Commande {o.number}</h2>
          <p className="muted">
            Créée le {formatDate(o.created_at)}{o.quote_number && <> · devis {o.quote_number}</>}
            {o.due_on && <> · prévue le {formatDate(o.due_on)}</>}{o.delivered_at && <> · livrée le {formatDate(o.delivered_at)}</>}
          </p>
        </div>
        <span className={`tag ${ORDER_TONE[o.status]}`}>{ORDER_LABELS[o.status]}</span>
        <button type="button" className="iconBtn" onClick={onClose} aria-label="Fermer la commande"><X size={18} aria-hidden="true" /></button>
      </header>
      {isAdmin && <p className="recordClient"><strong>{o.customer_name}</strong> · <a className="waLink" href={waLink(o.customer_phone, `Bonjour ${o.customer_name}, ici E-MAN PROD au sujet de votre commande ${o.number}.`)} target="_blank" rel="noreferrer"><MessageCircle size={13} aria-hidden="true" />{o.customer_phone}</a></p>}
      {isAdmin && ['confirmee', 'en_production'].includes(o.status)
        ? <ItemsEditor quote={o} busy={busy} withValidity={false} saveLabel="Enregistrer les lignes" onSave={async (patch) => {
          setBusy(true);
          try { await updateOrder(o.id, patch); notify('Lignes de la commande enregistrées.'); await reload(); onChanged(); } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); }
        }} />
        : <ItemsTable items={o.items} subtotal={o.subtotal_fcfa} discount={o.discount_fcfa} total={o.total_fcfa} />}
      <p className="recordActions"><a className="btn btnGhost btnSmall" href={orderPdfUrl(o.id)}><Download size={15} aria-hidden="true" /> Bon de commande (PDF)</a></p>
      <OrderBilling order={o} team={isAdmin} notify={notify} onChanged={() => { reload(); onChanged(); }} />
      {isAdmin && v && (
        <form className="orderForm" onSubmit={save}>
          <label className="field"><span className="fieldLabel">Statut</span>
            <select value={v.status} onChange={set('status')} disabled={closed}>
              {[o.status, ...(o.allowed || [])].map((s) => <option key={s} value={s}>{ORDER_LABELS[s]}</option>)}
            </select>
          </label>
          <label className="field"><span className="fieldLabel">Date promise</span><input type="date" value={v.due_on} onChange={set('due_on')} disabled={closed} /></label>
          <label className="field"><span className="fieldLabel">Suivie par</span>
            <select value={v.assigned_to} onChange={set('assigned_to')} disabled={closed}>
              <option value="">Personne</option>{(members || []).map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </label>
          <label className="field wideField"><span className="fieldLabel">Note interne</span><input maxLength={4000} value={v.admin_note} onChange={set('admin_note')} /></label>
          <button className="btn btnPrimary btnSmall" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        </form>
      )}
      <div className="recordGrid">
        <Files list={o.files} purpose="order" targetId={o.id} canAdd={!closed} notify={notify} onAdded={reload} />
        <History items={(o.history || []).filter((h) => h.action !== 'order.comment')} labels={ORDER_LABELS} />
      </div>
      {isAdmin && (
        <div className="recordBlock">
          <h3 className="blockTitle">Commentaires internes (jamais visibles du client)</h3>
          {(o.history || []).filter((h) => h.action === 'order.comment').length ? (
            <ul className="commentList">{o.history.filter((h) => h.action === 'order.comment').map((h, i) => <li key={i}><p>{h.data.text}</p><small>{h.actor_name || 'Équipe'} · {new Date(h.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></li>)}</ul>
          ) : <p className="muted">Aucun commentaire.</p>}
          <form className="messageForm" onSubmit={async (e) => {
            e.preventDefault();
            if (!comment.trim()) return;
            try { await space.orderComment(o.id, comment.trim()); setComment(''); reload(); } catch (err) { notify(err.message, 'error'); }
          }}>
            <label className="sr" htmlFor={`comment-${o.id}`}>Commentaire interne</label>
            <textarea id={`comment-${o.id}`} rows={2} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="ex. BAT validé par téléphone, impression lancée" />
            <button className="btn btnGhost btnSmall" disabled={!comment.trim()}>Ajouter</button>
          </form>
        </div>
      )}
      <Thread target={{ order_id: o.id }} isAdmin={isAdmin} notify={notify} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Éléments communs : fichiers, historique, messages
// ---------------------------------------------------------------------------
const ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,.ai,.eps,.psd,.cdr,.zip';
const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`);

function Files({ list, purpose, targetId, canAdd, notify, onAdded }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="recordBlock">
      <h3 className="blockTitle">Fichiers</h3>
      {list?.length ? (
        <ul className="fileList">
          {list.map((f) => <li key={f.id}><Paperclip size={14} aria-hidden="true" /><a href={fileUrl(f.id)}>{f.original_name}</a> <span className="muted">{size(f.size_bytes)}</span></li>)}
        </ul>
      ) : <p className="muted">Aucun fichier.</p>}
      {canAdd && !DEMO && (
        <label className={`btn btnGhost btnSmall fileBtn${busy ? ' busy' : ''}`}>
          <Paperclip size={16} aria-hidden="true" /> {busy ? 'Envoi…' : 'Joindre un fichier'}
          <input type="file" className="sr" accept={ACCEPT} disabled={busy} onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setBusy(true);
            try {
              const sent = await uploadFile(purpose, targetId, file);
              const name = sent?.original_name || file.name;
              notify(name !== file.name || (sent?.size_bytes && sent.size_bytes < file.size)
                ? `Fichier ajouté : ${name} (compressé de ${size(file.size)} à ${size(sent.size_bytes)}).`
                : `Fichier ajouté : ${name}.`);
              onAdded();
            } catch (err) {
              notify(err.message, 'error');
            } finally {
              setBusy(false);
            }
          }} />
        </label>
      )}
      {canAdd && <p className="hint"><LimitHint purpose={purpose} formats="JPG, PNG, PDF, AI, EPS, PSD, CDR ou ZIP" /></p>}
    </div>
  );
}

function History({ items, labels }) {
  if (!items?.length) return null;
  return (
    <div className="recordBlock">
      <h3 className="blockTitle">Historique</h3>
      <ol className="historyList">
        {items.map((h, i) => (
          <li key={i}>
            <time dateTime={h.created_at}>{formatDate(h.created_at)}</time>
            <span>
              {HISTORY_LABELS[h.action] || h.action}
              {h.data?.to && labels[h.data.to] && ` : ${labels[h.data.to].toLowerCase()}`}
              {h.data?.total_after !== undefined && ` (total ${formatAmount(h.data.total_after)})`}
              {h.data?.total && ` (total ${formatAmount(h.data.total.to)})`}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Thread({ target, isAdmin, notify }) {
  const [{ data }, reload] = useLoader(() => fetchMessages(target), [target.quote_id, target.order_id]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="recordBlock thread">
      <h3 className="blockTitle">Messages</h3>
      {data?.length ? (
        <ol className="messages">
          {data.map((m) => (
            <li key={m.id} className={m.author_role === (isAdmin ? 'admin' : 'client') ? 'mine' : undefined}>
              <p>{m.body}</p>
              <small>{m.author_role === 'admin' ? 'E-MAN PROD' : m.author_name || 'Client'} · {formatDate(m.created_at)}</small>
            </li>
          ))}
        </ol>
      ) : <p className="muted">Pas encore de message.</p>}
      <form className="messageForm" onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        try {
          await sendMessage(target, text.trim());
          setText('');
          reload();
        } catch (err) {
          notify(err.message, 'error');
        } finally {
          setBusy(false);
        }
      }}>
        <label className="sr" htmlFor={`msg-${target.quote_id || target.order_id}`}>Votre message</label>
        <textarea id={`msg-${target.quote_id || target.order_id}`} rows={2} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder={isAdmin ? 'Écrire au client…' : 'Écrire à l’atelier…'} />
        <button className="btn btnPrimary btnSmall" disabled={busy || !text.trim()}>Envoyer</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profil client
// ---------------------------------------------------------------------------
export function ProfilePanel({ notify }) {
  const [{ loading, data, error }, reload] = useLoader(() => fetchAccount(), []);
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setV({ first_name: data.user.first_name || data.user.full_name?.split(' ')[0] || '', last_name: data.user.last_name || data.user.full_name?.split(' ').slice(1).join(' ') || '', phone: data.user.phone || '', ...Object.fromEntries(['client_type', 'company_name', 'address', 'city', 'whatsapp', 'preferred_contact'].map((k) => [k, data.profile?.[k] || ''])) });
  }, [data]);
  if (loading && !data) return <p className="empty">Chargement…</p>;
  if (error) return <p className="formError" role="alert">{error}</p>;
  if (!v) return null;
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="profileForm" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        await saveAccount(v);
        notify('Vos informations sont enregistrées.');
        reload();
      } catch (err) {
        notify(err.message, 'error');
      } finally {
        setBusy(false);
      }
    }}>
      <p className="muted">E-mail du compte : {data.user.email}</p>
      <div className="fieldRow">
        <label className="field"><span className="fieldLabel">Prénom</span><input required maxLength={60} value={v.first_name} onChange={set('first_name')} autoComplete="given-name" /></label>
        <label className="field"><span className="fieldLabel">Nom</span><input required maxLength={60} value={v.last_name} onChange={set('last_name')} autoComplete="family-name" /></label>
      </div>
      <label className="field"><span className="fieldLabel">Téléphone</span><input type="tel" value={v.phone} onChange={set('phone')} autoComplete="tel" /></label>
      <div className="fieldRow">
        <label className="field"><span className="fieldLabel">Vous êtes</span>
          <select value={v.client_type} onChange={set('client_type')}>
            <option value="particulier">Un particulier</option><option value="entreprise">Une entreprise ou un commerce</option>
            <option value="association">Une association</option><option value="etablissement">Un établissement (école, institution…)</option>
          </select>
        </label>
        <label className="field"><span className="fieldLabel">Nom de l’entreprise ou de l’établissement</span><input maxLength={160} value={v.company_name} onChange={set('company_name')} autoComplete="organization" /></label>
      </div>
      <div className="fieldRow">
        <label className="field"><span className="fieldLabel">Adresse</span><input maxLength={300} value={v.address} onChange={set('address')} autoComplete="street-address" /></label>
        <label className="field"><span className="fieldLabel">Ville</span><input maxLength={120} value={v.city} onChange={set('city')} /></label>
      </div>
      <div className="fieldRow">
        <label className="field"><span className="fieldLabel">WhatsApp (si différent)</span><input type="tel" value={v.whatsapp} onChange={set('whatsapp')} /></label>
        <label className="field"><span className="fieldLabel">Comment préférez-vous être contacté ?</span>
          <select value={v.preferred_contact} onChange={set('preferred_contact')}>
            <option value="whatsapp">WhatsApp</option><option value="appel">Appel téléphonique</option><option value="email">E-mail</option>
          </select>
        </label>
      </div>
      <button className="btn btnPrimary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer mes informations'}</button>
    </form>
  );
}
