// Rubriques de la v4 : suivi des demandes (client), profil public (équipe), confidentialité de la présence.
import React, { useState } from 'react';
import { FileText, Package, GraduationCap } from 'lucide-react';
import { call, saveAccount, QUOTE_LABELS, CLIENT_ORDER_LABELS, formatDate, DEMO } from '../../lib/api.js';
import { useLoad, Loading, ErrorBox, EmptyState, SectionHead } from './ui.jsx';
import { Avatar } from '../../components/Avatar.jsx';
import { presenceText } from './chat.jsx';

const CLIENT_QUOTE_LABELS = { ...QUOTE_LABELS, nouveau: 'Reçue, en cours d’étude', en_cours: 'En cours de chiffrage', envoye: 'Devis prêt : à consulter' };
const DONE = new Set(['livree', 'annulee', 'accepte', 'refuse', 'expire', 'annule', 'Terminé', 'Annulé']);

/** Client : toutes ses demandes (devis, commandes, formations) sur une seule ligne du temps. */
export function RequestTimeline({ go }) {
  const [{ data, error }, reload] = useLoad(() => (DEMO ? Promise.resolve({ quotes: [], orders: [], enrollments: [] }) : call('/api/account?history=1')), []);
  const [filter, setFilter] = useState('open');
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  const items = [
    ...data.quotes.map((q) => ({ id: q.id, type: 'devis', icon: FileText, title: `Devis ${q.number}`, sub: q.summary || q.message, status: q.status, label: CLIENT_QUOTE_LABELS[q.status] || q.status, at: q.updated_at || q.created_at, open: () => go('devis', { id: q.id }) })),
    ...data.orders.map((o) => ({ id: o.id, type: 'commande', icon: Package, title: `Commande ${o.number}`, sub: o.summary, status: o.status, label: CLIENT_ORDER_LABELS[o.status] || o.status, at: o.updated_at || o.created_at, open: () => go('commandes', { id: o.id }) })),
    ...data.enrollments.map((e) => ({ id: e.id, type: 'formation', icon: GraduationCap, title: `Formation : ${e.training_title}`, sub: e.session_starts_on ? `Session du ${formatDate(e.session_starts_on)}` : 'Session à fixer', status: e.status, label: e.status, at: e.updated_at || e.created_at, open: () => go('formations') })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const shown = items.filter((i) => (filter === 'open' ? !DONE.has(i.status) : true));
  return (
    <>
      <SectionHead title="Suivi des demandes" lead="Où en sont vos devis, vos commandes et vos inscriptions, du plus récent au plus ancien." />
      <div className="segmented" role="group" aria-label="Filtrer">
        <button type="button" aria-pressed={filter === 'open'} onClick={() => setFilter('open')}>En cours ({items.filter((i) => !DONE.has(i.status)).length})</button>
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Toutes ({items.length})</button>
      </div>
      {!shown.length ? (
        <EmptyState title={filter === 'open' ? 'Aucune demande en cours' : 'Aucune demande pour le moment'} text="Demandez un devis ou passez une commande : le suivi s’affichera ici."
          action={<button type="button" className="btn btnPrimary btnSmall" onClick={() => go('devis', { nouveau: '1' })}>Demander un devis</button>} />
      ) : (
        <ol className="timeline">
          {shown.map((i) => (
            <li key={`${i.type}-${i.id}`} className={DONE.has(i.status) ? 'done' : ''}>
              <i.icon size={20} aria-hidden="true" />
              <button type="button" className="timelineItem" onClick={i.open}>
                <strong>{i.title}</strong>
                {i.sub && <span className="muted">{String(i.sub).slice(0, 120)}</span>}
                <span className="timelineMeta"><span className={`statusPill s-${i.status}`}>{i.label}</span> <time dateTime={i.at}>mis à jour le {formatDate(i.at)}</time></span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** Équipe : ce que les clients voient dans la messagerie. Synchronisé aussitôt (relu à chaque ouverture). */
export function PublicProfileForm({ user, notify, setUser }) {
  const [f, setF] = useState({ public_name: user.public_name || '', job_title: user.job_title || '', bio: user.bio || '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <section className="spaceBlock" aria-labelledby="public-title">
      <h2 className="subTitle" id="public-title">Profil visible par les clients</h2>
      <p className="muted">Affiché dans la messagerie des clients. Votre e-mail, votre téléphone et vos droits ne sont jamais montrés.</p>
      <div className="publicPreview" aria-label="Aperçu">
        <Avatar user={user} size={56} />
        <span><strong>{f.public_name || user.full_name}</strong><small>{f.job_title || 'Équipe'} · E-MAN PROD</small><small className="online">{presenceText({ online: true })}</small></span>
      </div>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        try {
          await saveAccount({ public_name: f.public_name.trim() || null, job_title: f.job_title.trim() || null, bio: f.bio.trim() || null });
          setUser({ ...user, public_name: f.public_name.trim() || null, job_title: f.job_title.trim() || null, bio: f.bio.trim() || null });
          notify('Profil public enregistré : les clients le voient aussitôt.');
        } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); }
      }}>
        <div className="fieldRow">
          <label className="field"><span className="fieldLabel">Nom public</span><input maxLength={80} value={f.public_name} onChange={set('public_name')} placeholder={user.full_name} /></label>
          <label className="field"><span className="fieldLabel">Fonction</span><input maxLength={80} value={f.job_title} onChange={set('job_title')} placeholder="Gérant, infographiste, service client…" /></label>
        </div>
        <label className="field"><span className="fieldLabel">Présentation</span><textarea rows={3} maxLength={600} value={f.bio} onChange={set('bio')} placeholder="Quelques mots pour vos clients : ce que vous faites, quand vous répondez…" /></label>
        <button className="btn btnPrimary btnSmall" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
      </form>
    </section>
  );
}

/** Présence : « en ligne » est toujours visible ; la dernière activité, au choix de chacun. */
export function PresencePrivacy({ user, notify, setUser }) {
  const [busy, setBusy] = useState(false);
  const on = user.show_last_seen !== false;
  return (
    <section className="spaceBlock" aria-labelledby="presence-title">
      <h2 className="subTitle" id="presence-title">Confidentialité dans la messagerie</h2>
      <label className="checkLine">
        <input type="checkbox" checked={on} disabled={busy || DEMO} onChange={async (e) => {
          setBusy(true);
          try { await saveAccount({ show_last_seen: e.target.checked }); setUser({ ...user, show_last_seen: e.target.checked }); notify(e.target.checked ? 'Votre dernière activité est visible.' : 'Votre dernière activité est masquée.'); }
          catch (err) { notify(err.message, 'error'); } finally { setBusy(false); }
        }} />
        <span>Montrer ma dernière activité (« vu aujourd’hui à 14:05 ») quand je suis hors ligne. « En ligne » reste affiché quand vous avez l’espace ouvert.</span>
      </label>
    </section>
  );
}
