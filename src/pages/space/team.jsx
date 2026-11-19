// Espace administrateur et STAFF : statistiques, clients, création de devis et de commandes,
// assistance, contenu du site, collaborateurs. Chaque écran n'est montré qu'aux comptes qui
// ont le droit correspondant ; le serveur revérifie ce droit à chaque requête.
import React, { useState } from 'react';
import { Plus, Trash2, Search, MessageCircle } from 'lucide-react';
import { useCatalog } from '../../lib/catalog.jsx';
import { DEMO, space, manage, fetchCatalog, security, formatAmount, formatDate, QUOTE_LABELS, ORDER_LABELS } from '../../lib/api.js';
import { useLoad, Loading, ErrorBox, EmptyState, SectionHead, StatCard, MonthChart, BarList, useConfirm } from './ui.jsx';
import { SupportThread } from './client.jsx';

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
const TYPES = { particulier: 'Particulier', entreprise: 'Entreprise', association: 'Association', etablissement: 'Établissement' };
const PERMISSION_LABELS = {
  quotes: 'Devis', orders: 'Commandes', trainings: 'Formations et inscriptions', content: 'Contenu du site', clients: 'Fiches clients', support: 'Assistance',
};

// ---------------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------------
export function TeamHome({ user, go }) {
  const [{ data, error, loading }, reload] = useLoad(() => space.stats(), []);
  return (
    <>
      <SectionHead title={`Bonjour ${user.first_name || user.full_name.split(' ')[0]}`}
        lead={DEMO ? 'Mode démonstration : aucune statistique n’est affichée tant que la base n’est pas branchée.' : 'Chiffres calculés en direct sur la base de données.'}
        actions={<button type="button" className="btn btnGhost btnSmall" onClick={reload}>Actualiser</button>} />
      {loading && !data ? <Loading lines={4} /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data.sections.length ? (
        <EmptyState title="Aucune statistique disponible" text={DEMO ? 'Les statistiques réelles apparaîtront une fois la base de données branchée.' : 'Votre compte n’a accès à aucun domaine chiffré.'} />
      ) : (
        <>
          <div className="statGrid">
            {data.clients && <>
              <StatCard label="Clients" value={fmt(data.clients.clients)} hint={`${fmt(data.clients.verified)} avec e-mail confirmé`} />
              <StatCard label="Nouveaux clients" value={fmt(data.clients.new_clients)} hint="30 derniers jours" />
            </>}
            {data.quotes && <>
              <StatCard label="Demandes de devis" value={fmt(data.quotes.total)} hint={`${fmt(data.quotes.last_30_days)} sur 30 jours`} />
              <StatCard label="Devis à traiter" value={fmt(data.quotes.to_process)} hint={`${fmt(data.quotes.waiting_client)} en attente du client`} tone={data.quotes.to_process ? 'attention' : ''} />
              <StatCard label="Devis acceptés" value={fmt(data.quotes.accepted)} />
            </>}
            {data.orders && <>
              <StatCard label="Commandes" value={fmt(data.orders.total)} hint={`${fmt(data.orders.confirmed)} à lancer`} />
              <StatCard label="En production" value={fmt(data.orders.in_production)} />
              <StatCard label="Terminées ou livrées" value={fmt(data.orders.done)} />
              <StatCard label="Reste à encaisser" value={`${fmt(Math.max(data.orders.ordered_fcfa - data.orders.paid_fcfa, 0))} FCFA`} hint={`${fmt(data.orders.paid_fcfa)} FCFA encaissés`} />
            </>}
            {data.enrollments && <StatCard label="Inscriptions aux formations" value={fmt(data.enrollments.total)} hint={`${fmt(data.enrollments.confirmed)} confirmées, ${fmt(data.enrollments.pending)} à traiter`} />}
          </div>
          <div className="chartGrid">
            {data.quotes_by_month && data.orders_by_month && (
              <MonthChart title="Devis et commandes par mois (12 mois)" rows={data.quotes_by_month.map((q, i) => ({ month: q.month, quotes: q.n, orders: data.orders_by_month[i]?.n || 0 }))}
                series={[{ key: 'quotes', label: 'Demandes de devis' }, { key: 'orders', label: 'Commandes' }]} />
            )}
            {data.quotes_by_month && !data.orders_by_month && <MonthChart title="Demandes de devis par mois" rows={data.quotes_by_month} series={[{ key: 'n', label: 'Demandes' }]} />}
            {data.orders_by_month && <MonthChart title="Montant commandé par mois (FCFA)" rows={data.orders_by_month} series={[{ key: 'total_fcfa', label: 'Montant commandé' }]} unit=" FCFA" />}
            {data.clients_by_month && <MonthChart title="Nouveaux clients par mois" rows={data.clients_by_month} series={[{ key: 'n', label: 'Nouveaux clients' }]} />}
            {data.quotes && (
              <BarList title="Où en sont les devis" rows={[
                { label: 'À traiter', n: data.quotes.to_process }, { label: 'Envoyés, en attente du client', n: data.quotes.waiting_client },
                { label: 'Acceptés', n: data.quotes.accepted }, { label: 'Refusés, expirés ou annulés', n: data.quotes.closed },
              ]} />
            )}
            {data.enrollments_by_training && <BarList title="Inscriptions par formation" rows={data.enrollments_by_training.map((r) => ({ label: r.title, n: r.n }))} empty="Aucune inscription pour le moment." />}
          </div>
          <p className="muted small">Mis à jour le {new Date(data.generated_at).toLocaleString('fr-FR')}.</p>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------
export function ClientsAdmin({ notify, isAdmin }) {
  const [filters, setFilters] = useState({ q: '', type: '', verified: '', activity: '', status: '' });
  const [applied, setApplied] = useState(filters);
  const [open, setOpen] = useState(null);
  const [{ data, error, loading }, reload] = useLoad(() => space.clients(applied), [JSON.stringify(applied)]);
  const set = (k) => (e) => { const f = { ...filters, [k]: e.target.value }; setFilters(f); if (k !== 'q') setApplied(f); };
  return (
    <>
      <SectionHead title="Clients" lead="Comptes clients, leurs demandes et leur historique." />
      <form className="filterBar" onSubmit={(e) => { e.preventDefault(); setApplied(filters); }}>
        <label className="searchBox"><Search size={16} aria-hidden="true" /><span className="sr">Rechercher</span>
          <input type="search" value={filters.q} onChange={set('q')} placeholder="Nom, e-mail, téléphone, entreprise" /></label>
        <select aria-label="Type de client" value={filters.type} onChange={set('type')}><option value="">Tous les types</option>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select aria-label="Activité" value={filters.activity} onChange={set('activity')}>
          <option value="">Toute activité</option><option value="new">Nouveaux (30 jours)</option><option value="quotes">Avec devis</option><option value="orders">Avec commandes</option><option value="trainings">Avec inscriptions</option>
        </select>
        <select aria-label="E-mail" value={filters.verified} onChange={set('verified')}><option value="">E-mail : tous</option><option value="oui">E-mail confirmé</option><option value="non">Non confirmé</option></select>
        <select aria-label="Statut du compte" value={filters.status} onChange={set('status')}><option value="">Tous les comptes</option><option value="active">Actifs</option><option value="disabled">Désactivés</option></select>
        <button className="btn btnGhost btnSmall">Rechercher</button>
      </form>
      {open && <ClientDetail id={open} isAdmin={isAdmin} notify={notify} onClose={() => setOpen(null)} onChanged={reload} />}
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data.clients.length ? (
        <EmptyState title="Aucun client ne correspond" text="Modifiez la recherche ou les filtres. Les clients apparaissent ici dès qu’ils créent leur compte." />
      ) : (
        <div className="tableScroll">
          <table className="table">
            <thead><tr><th scope="col">Client</th><th scope="col">Type</th><th scope="col">Devis</th><th scope="col">Commandes</th><th scope="col">Inscriptions</th><th scope="col">Commandé</th><th scope="col">Inscrit le</th><th scope="col"><span className="sr">Ouvrir</span></th></tr></thead>
            <tbody>
              {data.clients.map((c) => (
                <tr key={c.id} className={open === c.id ? 'current' : undefined}>
                  <td>{c.full_name}{c.disabled_at && <span className="tag off">Désactivé</span>}<small>{c.email}{!c.email_verified && ' · non confirmé'}</small></td>
                  <td>{TYPES[c.client_type] || '—'}{c.company_name && <small>{c.company_name}</small>}</td>
                  <td className="num">{c.quotes}</td><td className="num">{c.orders}</td><td className="num">{c.enrollments}</td>
                  <td className="num">{formatAmount(c.ordered_fcfa)}</td>
                  <td>{formatDate(c.created_at)}</td>
                  <td><button type="button" className="btn btnGhost btnSmall" onClick={() => setOpen(c.id)} aria-label={`Ouvrir la fiche de ${c.full_name}`}>Ouvrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ClientDetail({ id, isAdmin, notify, onClose, onChanged }) {
  const confirm = useConfirm();
  const [{ data, error, loading }, reload] = useLoad(() => space.client(id), [id]);
  const [note, setNote] = useState(null);
  if (loading && !data) return <section className="recordPanel"><Loading /></section>;
  if (error) return <section className="recordPanel"><ErrorBox error={error} /></section>;
  const c = data.client;
  const n = note ?? (c.profile?.admin_note || '');
  const act = async (fn, msg) => { try { await fn(); notify(msg); reload(); onChanged(); } catch (e) { notify(e.message, 'error'); } };
  return (
    <section className="recordPanel" aria-label={`Fiche de ${c.user.full_name}`}>
      <header className="recordHead">
        <div><h2 className="subTitle">{c.user.full_name}</h2><p className="muted">{c.user.email} · {c.user.phone || 'pas de téléphone'} · client depuis le {formatDate(c.user.created_at)}</p></div>
        {c.user.disabled_at && <span className="tag off">Compte désactivé</span>}
        <button type="button" className="btn btnGhost btnSmall" onClick={onClose}>Fermer</button>
      </header>
      <p className="infoFacts">
        <span>{TYPES[c.profile?.client_type] || 'Particulier'}</span>{c.profile?.company_name && <span>{c.profile.company_name}</span>}{c.profile?.city && <span>{c.profile.city}</span>}
        {c.profile?.whatsapp && <a className="waLink" href={`https://wa.me/${c.profile.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"><MessageCircle size={13} aria-hidden="true" />{c.profile.whatsapp}</a>}
        <span>Dernière connexion : {c.user.last_login_at ? formatDate(c.user.last_login_at) : 'jamais'}</span>
      </p>
      <div className="recordGrid">
        <div className="recordBlock"><h3 className="blockTitle">Devis ({c.quotes.length})</h3>
          {c.quotes.length ? <ul className="miniList">{c.quotes.map((q) => <li key={q.id}><strong>{q.number}</strong> {QUOTE_LABELS[q.status]} · {q.total_fcfa ? formatAmount(q.total_fcfa) : 'à chiffrer'}<small>{q.summary}</small></li>)}</ul> : <p className="muted">Aucun devis.</p>}
        </div>
        <div className="recordBlock"><h3 className="blockTitle">Commandes ({c.orders.length})</h3>
          {c.orders.length ? <ul className="miniList">{c.orders.map((o) => <li key={o.id}><strong>{o.number}</strong> {ORDER_LABELS[o.status]} · {formatAmount(o.total_fcfa)}<small>{o.summary}</small></li>)}</ul> : <p className="muted">Aucune commande.</p>}
        </div>
        <div className="recordBlock"><h3 className="blockTitle">Inscriptions ({c.enrollments.length})</h3>
          {c.enrollments.length ? <ul className="miniList">{c.enrollments.map((e) => <li key={e.id}><strong>{e.training_title}</strong> {e.status}</li>)}</ul> : <p className="muted">Aucune inscription.</p>}
        </div>
      </div>
      <form className="noteForm" onSubmit={(e) => { e.preventDefault(); act(() => space.note(id, n), 'Note enregistrée.'); }}>
        <label className="field"><span className="fieldLabel">Note interne (jamais visible du client)</span><textarea rows={2} maxLength={4000} value={n} onChange={(e) => setNote(e.target.value)} /></label>
        <button className="btn btnGhost btnSmall">Enregistrer la note</button>
      </form>
      {isAdmin && (
        <div className="recordActions">
          <button type="button" className="btn btnGhost btnSmall" onClick={async () => { if (await confirm({ title: 'Fermer toutes ses sessions ?', text: 'Le client devra se reconnecter sur tous ses appareils.', confirm: 'Fermer les sessions' })) act(() => security.revokeUser(id), 'Sessions fermées.'); }}>Fermer ses sessions</button>
          <button type="button" className={`btn btnSmall ${c.user.disabled_at ? 'btnGhost' : 'btnDanger'}`} onClick={async () => {
            if (await confirm({ title: c.user.disabled_at ? 'Réactiver ce compte ?' : 'Désactiver ce compte ?', text: c.user.disabled_at ? 'Le client pourra de nouveau se connecter.' : 'Le client ne pourra plus se connecter. Ses devis, commandes et inscriptions sont conservés.', confirm: c.user.disabled_at ? 'Réactiver' : 'Désactiver', danger: !c.user.disabled_at })) {
              act(() => security.disable(id, !c.user.disabled_at), c.user.disabled_at ? 'Compte réactivé.' : 'Compte désactivé.');
            }
          }}>{c.user.disabled_at ? 'Réactiver le compte' : 'Désactiver le compte'}</button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Création d'un devis (chiffré) ou d'une commande directe par l'équipe
// ---------------------------------------------------------------------------
export function TeamCreateForm({ kind, notify, onDone, onCancel }) {
  const cat = useCatalog();
  const [clientQuery, setClientQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [client, setClient] = useState(null);
  const [f, setF] = useState({ name: '', phone: '', email: '', message: '', due_on: '', source: 'atelier' });
  const blank = { service_slug: '', label: '', quantity: 1, unit: '', unit_price_fcfa: '', description: '' };
  const [items, setItems] = useState([{ ...blank }]);
  const [busy, setBusy] = useState(false);
  const setItem = (i, k) => (e) => setItems((l) => l.map((it, j) => (j === i ? { ...it, [k]: e.target.value } : it)));
  const total = items.reduce((s, it) => s + (it.unit_price_fcfa === '' ? 0 : Number(it.quantity || 0) * Number(it.unit_price_fcfa)), 0);
  async function findClient() {
    try { setMatches((await space.clients({ q: clientQuery })).clients.slice(0, 6)); } catch (e) { notify(e.message, 'error'); }
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const lines = items.map((it) => ({ ...it, label: it.label || cat.prestations.find((p) => p.slug === it.service_slug)?.title || '' }));
      const base = { name: f.name, phone: f.phone, email: f.email || null, user_id: client?.id || null, items: lines };
      const r = kind === 'quote'
        ? await space.createQuote({ ...base, message: f.message || 'Devis préparé par l’atelier.', source: f.source })
        : (await space.createOrder({ ...base, due_on: f.due_on || null, admin_note: f.message || null })).order;
      notify(kind === 'quote' ? `Devis ${r.number} créé. Vérifiez-le puis envoyez-le au client.` : `Commande ${r.number} créée.`);
      onDone(r);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="spaceForm" onSubmit={submit}>
      <h2 className="subTitle">{kind === 'quote' ? 'Nouveau devis' : 'Nouvelle commande (sans devis)'}</h2>
      <div className="clientPicker">
        <label className="field"><span className="fieldLabel">Client existant (facultatif)</span>
          <span className="searchRow"><input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Nom ou e-mail" /><button type="button" className="btn btnGhost btnSmall" onClick={findClient}>Chercher</button></span>
        </label>
        {matches.length > 0 && !client && (
          <ul className="pickList">{matches.map((m) => <li key={m.id}><button type="button" className="linkBtn" onClick={() => { setClient(m); setF((x) => ({ ...x, name: m.full_name, phone: m.phone || x.phone, email: m.email })); setMatches([]); }}>{m.full_name} · {m.email}</button></li>)}</ul>
        )}
        {client && <p className="notice">Rattaché au compte de <strong>{client.full_name}</strong> : il le verra dans son espace. <button type="button" className="linkBtn" onClick={() => setClient(null)}>Détacher</button></p>}
      </div>
      <div className="fieldRow three">
        <label className="field"><span className="fieldLabel">Nom du client</span><input required minLength={2} maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span className="fieldLabel">Téléphone</span><input required type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label className="field"><span className="fieldLabel">E-mail (facultatif)</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      </div>
      {items.map((it, i) => (
        <fieldset key={i} className="lineEditor">
          <legend>Ligne {i + 1}</legend>
          <div className="fieldRow">
            <label className="field"><span className="fieldLabel">Prestation</span>
              <select value={it.service_slug} onChange={setItem(i, 'service_slug')}><option value="">Autre / libre</option>{cat.prestations.map((p) => <option key={p.slug} value={p.slug}>{p.title}</option>)}</select>
            </label>
            <label className="field"><span className="fieldLabel">Intitulé</span><input required={!it.service_slug} maxLength={160} value={it.label} onChange={setItem(i, 'label')} /></label>
          </div>
          <div className="fieldRow three">
            <label className="field"><span className="fieldLabel">Quantité</span><input type="number" min="0.01" step="any" required value={it.quantity} onChange={setItem(i, 'quantity')} /></label>
            <label className="field"><span className="fieldLabel">Unité</span><input maxLength={30} value={it.unit} onChange={setItem(i, 'unit')} placeholder="pièce" /></label>
            <label className="field"><span className="fieldLabel">Prix unitaire (FCFA)</span><input type="number" min="0" step="1" value={it.unit_price_fcfa} onChange={setItem(i, 'unit_price_fcfa')} placeholder={kind === 'quote' ? 'À chiffrer' : ''} required={kind === 'order'} /></label>
          </div>
          <label className="field"><span className="fieldLabel">Détail</span><input maxLength={2000} value={it.description} onChange={setItem(i, 'description')} /></label>
          {items.length > 1 && <button type="button" className="btn btnGhost btnSmall" onClick={() => setItems((l) => l.filter((_, j) => j !== i))}><Trash2 size={15} aria-hidden="true" /> Retirer</button>}
        </fieldset>
      ))}
      <button type="button" className="btn btnGhost btnSmall" onClick={() => setItems((l) => [...l, { ...blank }])}><Plus size={16} aria-hidden="true" /> Ajouter une ligne</button>
      <div className="fieldRow">
        {kind === 'quote' ? (
          <label className="field"><span className="fieldLabel">Demande reçue par</span>
            <select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="atelier">À l’atelier</option><option value="whatsapp">WhatsApp</option><option value="telephone">Téléphone</option><option value="admin">Autre</option></select>
          </label>
        ) : <label className="field"><span className="fieldLabel">Date promise</span><input type="date" value={f.due_on} onChange={(e) => setF({ ...f, due_on: e.target.value })} /></label>}
        <label className="field"><span className="fieldLabel">{kind === 'quote' ? 'Description du besoin' : 'Note interne'}</span><input maxLength={4000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></label>
      </div>
      <p className="itemsTotal">Total : <strong>{formatAmount(total)}</strong></p>
      <div className="formActions">
        <button className="btn btnPrimary" disabled={busy}>{busy ? 'Création…' : kind === 'quote' ? 'Créer le devis' : 'Créer la commande'}</button>
        <button type="button" className="btn btnGhost" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Assistance (équipe)
// ---------------------------------------------------------------------------
export function SupportInbox({ notify, params }) {
  const [{ data, error, loading }, reload] = useLoad(() => space.supportThreads(), []);
  const [open, setOpen] = useState(params.client || null);
  return (
    <>
      <SectionHead title="Assistance" lead="Questions envoyées par les clients depuis leur espace." />
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data.threads.length ? (
        <EmptyState title="Aucune demande d’assistance" text="Les messages écrits par les clients dans « Assistance » arrivent ici." />
      ) : (
        <div className="inboxGrid">
          <ul className="threadList">
            {data.threads.map((t) => (
              <li key={t.user_id}><button type="button" className={open === t.user_id ? 'current' : ''} onClick={() => setOpen(t.user_id)}>
                <strong>{t.full_name}</strong>{t.unread > 0 && <span className="badgeCount">{t.unread}</span>}
                <small>{t.last_role === 'client' ? '' : 'Vous : '}{t.last_body.slice(0, 70)}</small>
              </button></li>
            ))}
          </ul>
          {open ? <SupportThread key={open} who={open} notify={notify} side="team" onSent={reload} /> : <EmptyState title="Choisissez une conversation" />}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Contenu du site : textes, coordonnées, WhatsApp, témoignages
// ---------------------------------------------------------------------------
export function ContentAdmin({ notify, isAdmin }) {
  const pub = useCatalog();
  const [{ data, error, loading }, reload] = useLoad(() => fetchCatalog({ all: true }), []);
  if (loading && !data) return <><SectionHead title="Textes du site" /><Loading /></>;
  if (error) return <><SectionHead title="Textes du site" /><ErrorBox error={error} onRetry={reload} /></>;
  const save = async (key, value) => {
    try {
      await manage('setting.update', { key, value });
      notify('Enregistré : visible sur le site.');
      reload();
      pub.reload();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const c = data.content || {};
  return (
    <>
      <SectionHead title="Textes du site" lead="Les textes affichés sur le site. Les coordonnées, numéros WhatsApp et mentions légales se règlent dans Paramètres." />
      <SettingForm title="Bandeau d’accueil" fields={[
        ['eyebrow', 'Accroche au-dessus du titre', 'input', 80], ['title', 'Titre', 'input', 90], ['lead', 'Texte', 'textarea', 300],
      ]} value={{ eyebrow: '', title: 'DONNEZ VIE À VOS IDÉES AVEC E-MAN PROD', lead: 'Impression, création graphique, communication visuelle et formation professionnelle : nous transformons vos idées en réalisations exceptionnelles.', ...c.home }}
        disabled={!isAdmin} onSave={(v) => save('home', v)} />
      <SettingForm title="Page « À propos »" fields={[['title', 'Titre', 'input', 120], ['lead', 'Présentation', 'textarea', 2000], ['activities', 'Activités (une par ligne)', 'lines', 40]]}
        value={c.about || {}} disabled={!isAdmin} onSave={(v) => save('about', v)} />
      <SettingForm title="E-MAN CARS" fields={[['title', 'Titre', 'input', 120], ['tagline', 'Accroche', 'input', 200], ['intro', 'Présentation', 'textarea', 2000], ['contactText', 'Texte de contact', 'input', 400], ['phone', 'Numéro WhatsApp d’E-MAN CARS (si différent)', 'input', 20]]}
        value={c.cars || {}} disabled={!isAdmin} onSave={(v) => save('cars', { ...c.cars, ...v })} />
      {!isAdmin && <p className="notice">Seul un administrateur peut modifier les textes officiels.</p>}
      <TestimonialsAdmin rows={data.testimonials || []} notify={notify} onChanged={() => { reload(); pub.reload(); }} />
    </>
  );
}

export function SettingForm({ title, fields, value, disabled, onSave }) {
  const toForm = (v) => Object.fromEntries(fields.map(([k, , type]) => [k, type === 'lines' ? (v[k] || []).join('\n') : v[k] || '']));
  const [f, setF] = useState(() => toForm(value));
  return (
    <form className="spaceBlock settingForm" onSubmit={(e) => {
      e.preventDefault();
      onSave(Object.fromEntries(fields.map(([k, , type]) => [k, type === 'lines' ? f[k].split('\n').map((x) => x.trim()).filter(Boolean) : f[k]])));
    }}>
      <h2 className="subTitle">{title}</h2>
      {fields.map(([k, label, type, max]) => (
        <label key={k} className="field"><span className="fieldLabel">{label}</span>
          {type === 'input' ? <input maxLength={max} value={f[k]} disabled={disabled} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            : <textarea rows={type === 'lines' ? 4 : 3} maxLength={type === 'lines' ? 4000 : max} value={f[k]} disabled={disabled} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}
        </label>
      ))}
      {!disabled && <button className="btn btnPrimary btnSmall">Enregistrer</button>}
    </form>
  );
}

export function BusinessForm({ value, disabled, onSave }) {
  const [f, setF] = useState({ slogan: value.slogan || '', email: value.email || '', phone: value.phone || '', whatsapp: value.whatsapp || '', hours: value.hours || '' });
  const [sites, setSites] = useState(value.sites?.length ? value.sites : [{ label: 'Siège', address: '' }]);
  return (
    <form className="spaceBlock settingForm" onSubmit={(e) => { e.preventDefault(); onSave({ ...f, sites: sites.filter((s) => s.address.trim()) }); }}>
      <h2 className="subTitle">Coordonnées et numéros WhatsApp</h2>
      <div className="fieldRow">
        <label className="field"><span className="fieldLabel">Téléphone</span><input type="tel" required value={f.phone} disabled={disabled} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label className="field"><span className="fieldLabel">WhatsApp (si différent)</span><input type="tel" value={f.whatsapp} disabled={disabled} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} /></label>
      </div>
      <div className="fieldRow">
        <label className="field"><span className="fieldLabel">E-mail</span><input type="email" required value={f.email} disabled={disabled} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="field"><span className="fieldLabel">Slogan</span><input maxLength={120} value={f.slogan} disabled={disabled} onChange={(e) => setF({ ...f, slogan: e.target.value })} /></label>
      </div>
      <label className="field"><span className="fieldLabel">Horaires</span><input maxLength={300} value={f.hours} disabled={disabled} onChange={(e) => setF({ ...f, hours: e.target.value })} placeholder="ex. Lundi – samedi, 8 h – 18 h" /></label>
      {sites.map((s, i) => (
        <div key={i} className="fieldRow">
          <label className="field"><span className="fieldLabel">Site {i + 1}</span><input maxLength={60} value={s.label} disabled={disabled} onChange={(e) => setSites((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></label>
          <label className="field"><span className="fieldLabel">Adresse</span><input maxLength={200} value={s.address} disabled={disabled} onChange={(e) => setSites((l) => l.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))} /></label>
        </div>
      ))}
      {!disabled && <div className="formActions">
        {sites.length < 6 && <button type="button" className="btn btnGhost btnSmall" onClick={() => setSites((l) => [...l, { label: 'Annexe', address: '' }])}><Plus size={16} aria-hidden="true" /> Ajouter un site</button>}
        <button className="btn btnPrimary btnSmall">Enregistrer</button>
      </div>}
    </form>
  );
}

const T_LABELS = { en_attente: 'À relire', publie: 'Publié', refuse: 'Refusé' };
function TestimonialsAdmin({ rows, notify, onChanged }) {
  const confirm = useConfirm();
  const run = async (action, payload, msg) => { try { await manage(action, payload); notify(msg); onChanged(); } catch (e) { notify(e.message, 'error'); } };
  return (
    <section className="spaceBlock">
      <h2 className="subTitle">Témoignages clients</h2>
      <p className="muted">Proposés par les clients depuis leur espace, avec leur accord. Un avis n’apparaît sur le site qu’une fois publié ici.</p>
      {!rows.length ? <EmptyState title="Aucun avis reçu" text="Les clients peuvent proposer un avis depuis leur espace, une fois une commande terminée." /> : (
        <ul className="cardList">
          {rows.map((t) => (
            <li key={t.id} className="infoCard">
              <div className="infoCardHead"><strong>{t.author_name}{t.author_title && `, ${t.author_title}`}</strong><span className={`tag ${t.status === 'publie' ? 'done' : t.status === 'refuse' ? 'off' : 'new'}`}>{T_LABELS[t.status]}</span></div>
              <p>« {t.content} »</p>
              <div className="infoCardActions">
                {t.status !== 'publie' && <button type="button" className="btn btnPrimary btnSmall" onClick={() => run('testimonial.update', { id: t.id, status: 'publie' }, 'Avis publié.')}>Publier</button>}
                {t.status === 'publie' && <button type="button" className="btn btnGhost btnSmall" onClick={() => run('testimonial.update', { id: t.id, status: 'en_attente' }, 'Avis retiré du site.')}>Dépublier</button>}
                {t.status === 'en_attente' && <button type="button" className="btn btnGhost btnSmall" onClick={() => run('testimonial.update', { id: t.id, status: 'refuse' }, 'Avis refusé.')}>Refuser</button>}
                <button type="button" className="btn btnGhost btnSmall" onClick={async () => { if (await confirm({ title: 'Supprimer cet avis ?', text: 'Il sera définitivement effacé.', confirm: 'Supprimer', danger: true })) run('testimonial.delete', { id: t.id }, 'Avis supprimé.'); }}>Supprimer</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Collaborateurs : création de comptes STAFF et historique des actions
// ---------------------------------------------------------------------------
export function StaffInvite({ notify, onDone }) {
  const [f, setF] = useState({ first_name: '', last_name: '', email: '', permissions: [] });
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const toggle = (p) => setF((x) => ({ ...x, permissions: x.permissions.includes(p) ? x.permissions.filter((y) => y !== p) : [...x.permissions, p] }));
  return (
    <form className="spaceBlock spaceForm" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        const r = await space.invite(f);
        notify(r.emailed ? `Invitation envoyée à ${f.email}.` : 'Compte créé. Transmettez le lien ci-dessous à la personne.');
        setLink(r.link);
        setF({ first_name: '', last_name: '', email: '', permissions: [] });
        onDone();
      } catch (err) {
        notify(err.message, 'error');
      } finally {
        setBusy(false);
      }
    }}>
      <h2 className="subTitle">Créer un compte STAFF</h2>
      <p className="muted">La personne reçoit un lien (72 h) pour choisir son mot de passe. Elle n’aura accès qu’aux domaines cochés.</p>
      <div className="fieldRow three">
        <label className="field"><span className="fieldLabel">Prénom</span><input required maxLength={60} value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></label>
        <label className="field"><span className="fieldLabel">Nom</span><input required maxLength={60} value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></label>
        <label className="field"><span className="fieldLabel">E-mail</span><input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      </div>
      <fieldset className="permList"><legend>Droits accordés</legend>
        {Object.entries(PERMISSION_LABELS).map(([k, v]) => <label key={k} className="check"><input type="checkbox" checked={f.permissions.includes(k)} onChange={() => toggle(k)} /> {v}</label>)}
      </fieldset>
      <button className="btn btnPrimary btnSmall" disabled={busy || !f.permissions.length}>{busy ? 'Création…' : 'Créer le compte'}</button>
      {link && (
        <div className="notice">
          L’envoi d’e-mails n’est pas activé : transmettez ce lien à la personne, de préférence en main propre ou par un message privé. Il ne sert qu’une fois.
          <input className="linkCopy" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Lien d’invitation" />
        </div>
      )}
    </form>
  );
}

const ACTION_LABELS = {
  'quote.created': 'Devis créé', 'quote.updated': 'Devis modifié', 'quote.status_changed': 'Statut de devis', 'quote.converted': 'Devis transformé en commande',
  'order.created': 'Commande créée', 'order.updated': 'Commande modifiée', 'order.status_changed': 'Statut de commande', 'order.comment': 'Commentaire interne',
  'enrollment.status_changed': 'Statut d’inscription', 'training.updated': 'Formation modifiée', 'training.created': 'Formation créée', 'session.created': 'Session créée',
  'portfolio.created': 'Réalisation ajoutée', 'portfolio.updated': 'Réalisation modifiée', 'portfolio.deleted': 'Réalisation supprimée', 'service.updated': 'Prestation modifiée',
  'setting.updated': 'Réglage modifié', 'file.uploaded': 'Fichier ajouté', 'file.deleted': 'Fichier supprimé',
};
export function MemberHistory({ id, name, onClose }) {
  const [{ data, error, loading }] = useLoad(() => space.activity(id), [id]);
  return (
    <section className="recordPanel">
      <header className="recordHead"><div><h2 className="subTitle">Historique de {name}</h2><p className="muted">200 dernières actions.</p></div><button type="button" className="btn btnGhost btnSmall" onClick={onClose}>Fermer</button></header>
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} /> : !data.actions.length ? <EmptyState title="Aucune action enregistrée" /> : (
        <div className="tableScroll"><table className="table compact">
          <thead><tr><th scope="col">Date</th><th scope="col">Action</th><th scope="col">Détail</th></tr></thead>
          <tbody>{data.actions.map((a, i) => (
            <tr key={i}><td>{new Date(a.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
              <td>{ACTION_LABELS[a.action] || a.action}</td>
              <td className="wide">{[a.data?.number, a.data?.to && `→ ${a.data.to}`, a.data?.text, a.data?.title, a.data?.name].filter(Boolean).join(' · ')}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
