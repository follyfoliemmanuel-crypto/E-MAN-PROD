// Paiements, reçus et facture d'une commande (fiche commande, équipe et client).
// L'état « acquittée » d'une facture découle des paiements enregistrés, jamais d'un choix manuel.
import React, { useState } from 'react';
import { Download, Receipt, FileText, Plus } from 'lucide-react';
import {
  DEMO, space, formatAmount, formatDay, invoicePdfUrl, receiptPdfUrl, PAYMENT_METHOD_LABELS, INVOICE_STATE,
} from '../../lib/api.js';
import { useLoad, Loading, ErrorBox, useConfirm } from './ui.jsx';

const METHODS = ['especes', 'mobile_money', 'virement', 'cheque', 'carte', 'autre'];
const today = () => new Date().toISOString().slice(0, 10);

export function OrderBilling({ order, team, notify, onChanged }) {
  const confirm = useConfirm();
  const [{ data, error, loading }, reload] = useLoad(async () => {
    if (DEMO) return { pay: { payments: [], paid_fcfa: 0, balance_fcfa: order.total_fcfa }, invoices: [] };
    const [pay, inv] = await Promise.all([space.payments(order.id), space.invoices(order.id)]);
    return { pay, invoices: inv.invoices };
  }, [order.id, order.total_fcfa, order.amount_paid_fcfa]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cancelFor, setCancelFor] = useState(null);
  if (loading && !data) return <div className="recordBlock"><Loading lines={2} /></div>;
  if (error) return <div className="recordBlock"><ErrorBox error={error} onRetry={reload} /></div>;
  const { pay, invoices } = data;
  const active = invoices.find((i) => !i.cancelled_at);
  const cancelled = order.status === 'annulee';
  const priced = order.total_fcfa > 0 && !(order.items || []).some((i) => i.unit_price_fcfa === null);
  const done = async (msg) => { notify(msg); await reload(); onChanged?.(); };

  const submitPayment = async (e) => {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!Number.isInteger(amount) || amount <= 0) return notify('Indiquez un montant entier en FCFA.', 'error');
    const ok = await confirm({
      title: `Enregistrer un paiement de ${formatAmount(amount)} ?`,
      text: 'Ne l’enregistrez qu’une fois l’argent effectivement reçu. Un reçu numéroté sera créé et le client prévenu.',
      confirm: 'Enregistrer le paiement',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await space.recordPayment({ order_id: order.id, amount_fcfa: amount, method: form.method, reference: form.reference || null, received_on: form.received_on, note: form.note || null });
      setForm(null);
      await done('Paiement enregistré, reçu créé.');
    } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); }
  };
  const issue = async () => {
    const ok = await confirm({ title: 'Émettre la facture ?', text: `Montant : ${formatAmount(order.total_fcfa)}. Les lignes sont figées dans la facture ; pour corriger ensuite, il faudra l’annuler et en émettre une nouvelle.`, confirm: 'Émettre la facture' });
    if (!ok) return;
    try { const r = await space.issueInvoice(order.id); await done(`Facture ${r.invoice.invoice_number} émise.`); } catch (err) { notify(err.message, 'error'); }
  };
  const cancel = async (e) => {
    e.preventDefault();
    try { await space.cancelInvoice(cancelFor.id, cancelFor.reason.trim()); setCancelFor(null); await done(`Facture ${cancelFor.number} annulée.`); } catch (err) { notify(err.message, 'error'); }
  };

  return (
    <div className="recordBlock billing">
      <h3 className="blockTitle">Paiements et facture</h3>
      <dl className="billingSum">
        <div><dt>Total</dt><dd>{formatAmount(pay.total_fcfa ?? order.total_fcfa)}</dd></div>
        <div><dt>Réglé</dt><dd>{formatAmount(pay.paid_fcfa)}</dd></div>
        <div><dt>Reste à payer</dt><dd className={pay.balance_fcfa > 0 ? 'due' : 'ok'}>{formatAmount(pay.balance_fcfa)}</dd></div>
      </dl>
      {pay.payments.length > 0 ? (
        <ul className="docList compact">
          {pay.payments.map((p) => (
            <li key={p.id}><Receipt size={15} aria-hidden="true" />
              <span><strong>{formatAmount(p.amount_fcfa)}</strong>
                <small>{formatDay(p.received_on)} · {PAYMENT_METHOD_LABELS[p.method]}{p.reference ? ` · réf. ${p.reference}` : ''}{team && p.recorded_by_name ? ` · noté par ${p.recorded_by_name}` : ''}{p.method === 'historique' ? ' · sans reçu' : ''}</small></span>
              {p.receipt_number && <a className="btn btnGhost btnSmall" href={receiptPdfUrl(p.id)}><Download size={14} aria-hidden="true" /> Reçu {p.receipt_number}</a>}
            </li>
          ))}
        </ul>
      ) : <p className="muted">Aucun paiement enregistré.</p>}

      {invoices.map((inv) => {
        const [label, tone] = INVOICE_STATE[inv.payment_state];
        return (
          <p key={inv.id} className="invoiceLine"><FileText size={15} aria-hidden="true" />
            <span><strong>Facture {inv.invoice_number}</strong> <span className={`tag ${tone}`}>{label}</span></span>
            <a className="btn btnGhost btnSmall" href={invoicePdfUrl(inv.id)}><Download size={14} aria-hidden="true" /> PDF</a>
            {team && !inv.cancelled_at && <button type="button" className="linkBtn muted" onClick={() => setCancelFor({ id: inv.id, number: inv.invoice_number, reason: '' })}>Annuler</button>}
          </p>
        );
      })}

      {cancelFor && (
        <form className="paymentForm" onSubmit={cancel}>
          <label className="field wideField"><span className="fieldLabel">Motif de l’annulation de la facture {cancelFor.number}</span>
            <input required minLength={3} maxLength={300} value={cancelFor.reason} onChange={(e) => setCancelFor({ ...cancelFor, reason: e.target.value })} placeholder="ex. erreur sur la quantité" /></label>
          <div className="formActions">
            <button type="button" className="btn btnGhost btnSmall" onClick={() => setCancelFor(null)}>Garder la facture</button>
            <button className="btn btnDanger btnSmall">Annuler la facture</button>
          </div>
        </form>
      )}
      {team && !cancelled && (
        <div className="formActions">
          {pay.balance_fcfa > 0 && !form && <button type="button" className="btn btnGhost btnSmall" onClick={() => setForm({ amount: String(pay.balance_fcfa), method: 'especes', reference: '', received_on: today(), note: '' })}><Plus size={15} aria-hidden="true" /> Enregistrer un paiement reçu</button>}
          {!active && <button type="button" className="btn btnGhost btnSmall" disabled={!priced} title={priced ? undefined : 'Fixez le prix de toutes les lignes d’abord'} onClick={issue}><FileText size={15} aria-hidden="true" /> Émettre la facture</button>}
        </div>
      )}
      {form && (
        <form className="paymentForm" onSubmit={submitPayment}>
          <label className="field"><span className="fieldLabel">Montant reçu (FCFA)</span>
            <input className="amount" type="number" min="1" max={pay.balance_fcfa || undefined} step="1" inputMode="numeric" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
          <label className="field"><span className="fieldLabel">Moyen de paiement</span>
            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}</select></label>
          <label className="field"><span className="fieldLabel">Date de réception</span>
            <input type="date" max={today()} required value={form.received_on} onChange={(e) => setForm({ ...form, received_on: e.target.value })} /></label>
          <label className="field"><span className="fieldLabel">Référence (transaction Mobile Money, chèque…)</span>
            <input maxLength={120} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></label>
          <div className="formActions">
            <button type="button" className="btn btnGhost btnSmall" onClick={() => setForm(null)}>Annuler</button>
            <button className="btn btnPrimary btnSmall" disabled={busy} aria-busy={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </form>
      )}
    </div>
  );
}
