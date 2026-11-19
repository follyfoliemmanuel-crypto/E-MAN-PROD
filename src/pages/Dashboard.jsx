import React, { useCallback, useEffect, useState } from 'react';
import {
  MessageCircle, Search, Plus, LayoutDashboard, FileText, Package, GraduationCap, FolderOpen, Bell, LifeBuoy, UserRound, ShieldCheck,
  Users, ClipboardList, Images, Layers, Image as ImageIcon, PenLine, UserCog, LogOut, Menu, Megaphone, Settings2,
} from 'lucide-react';
import { MEDIA_SLOTS, PLACEHOLDERS } from '../config.js';
import { useCatalog } from '../lib/catalog.jsx';
import { CoursesAdmin, GalleryAdmin, PrestationsAdmin } from './admin.jsx';
import { QuotesPanel, OrdersPanel, ProfilePanel } from './requests.jsx';
import { SecurityPanel, TeamPanel } from './security.jsx';
import { ClientHome, QuoteRequestForm, MyTrainings, MyDocuments, NotificationsSection, SupportSection, AvatarEditor, EmailPrefs } from './space/client.jsx';
import { SettingsAdmin, AnnouncementsAdmin } from './space/settings.jsx';
import { TeamHome, ClientsAdmin, TeamCreateForm, SupportInbox, ContentAdmin, StaffInvite, MemberHistory } from './space/team.jsx';
import { ConfirmProvider, SectionHead, Loading, ErrorBox, useStackedTables } from './space/ui.jsx';
import { useMedia } from '../lib/media.jsx';
import { SmartImage } from '../components/visual.jsx';
import { useApp } from '../context.js';
import { navigate } from '../lib/router.jsx';
import {
  DEMO, auth, fetchRegistrations, updateRegistration, saveMedia, resetMedia, TRAINING_STATUSES, formatDate, space, security, avatarUrl,
} from '../lib/api.js';

const tone = (s) => ({ 'Terminé': 'done', 'Inscrit': 'done', 'Contacté': 'work', 'Annulé': 'off' }[s] || 'new');

const waLink = (phone, text) => `https://wa.me/${String(phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

// Sections de l'espace, selon le rôle et les droits. L'affichage ne donne aucun droit :
// chaque donnée est demandée au serveur, qui vérifie le droit à chaque requête.
const CLIENT_SECTIONS = [
  ['accueil', 'Accueil', LayoutDashboard], ['devis', 'Mes devis', FileText], ['commandes', 'Mes commandes', Package],
  ['formations', 'Mes formations', GraduationCap], ['documents', 'Mes documents', FolderOpen], ['notifications', 'Notifications', Bell],
  ['assistance', 'Assistance', LifeBuoy], ['profil', 'Mon profil', UserRound], ['securite', 'Sécurité', ShieldCheck],
];
const TEAM_SECTIONS = [
  ['tableau', 'Tableau de bord', LayoutDashboard, null], ['clients', 'Clients', Users, 'clients'], ['devis', 'Devis', FileText, 'quotes'],
  ['commandes', 'Commandes', Package, 'orders'], ['inscriptions', 'Inscriptions', ClipboardList, 'trainings'], ['formations', 'Formations', GraduationCap, 'trainings'],
  ['realisations', 'Réalisations', Images, 'content'], ['prestations', 'Prestations', Layers, 'content'], ['images', 'Images et bannières', ImageIcon, 'content'],
  ['contenu', 'Textes du site', PenLine, 'content'], ['assistance', 'Assistance', LifeBuoy, 'support'], ['annonces', 'Annonces', Megaphone, 'admin'],
  ['equipe', 'Équipe', UserCog, 'admin'], ['parametres', 'Paramètres', Settings2, 'admin'],
  ['notifications', 'Notifications', Bell, null], ['profil', 'Mon profil', UserRound, null], ['securite', 'Sécurité', ShieldCheck, null],
];

function readLocation() {
  const p = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const params = Object.fromEntries(p);
  // Liens des notifications et des e-mails (v2.5) : ?devis=…, ?commande=…, ?onglet=inscriptions
  if (params.devis) return { section: 'devis', params: { id: params.devis } };
  if (params.commande) return { section: 'commandes', params: { id: params.commande } };
  if (params.onglet === 'inscriptions') return { section: 'inscriptions', params: {} };
  const { section, ...rest } = params;
  return { section: section || null, params: rest };
}

export default function Dashboard() {
  const { user, ready, openAuth, logout, notify, setUser } = useApp();
  const [loc, setLoc] = useState(readLocation);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mainEl, setMainEl] = useState(null);
  useStackedTables(mainEl);
  const [unread, setUnread] = useState(0);
  const isClient = !user || user.role === 'client';
  const isAdmin = user?.role === 'admin';
  const can = (p) => isAdmin || (user?.role === 'staff' && (user.permissions || []).includes(p));
  const sections = isClient ? CLIENT_SECTIONS : TEAM_SECTIONS.filter(([, , , perm]) => !perm || (perm === 'admin' ? isAdmin : can(perm)));
  const current = sections.find(([k]) => k === loc.section)?.[0] || sections[0][0];

  const refreshUnread = useCallback(async () => {
    if (!user || DEMO) return;
    try { setUnread((await space.notifications()).unread); } catch { /* sans gravité */ }
  }, [user]);
  useEffect(() => { refreshUnread(); const t = setInterval(refreshUnread, 60000); return () => clearInterval(t); }, [refreshUnread]);

  const go = useCallback((section, params = {}) => {
    setLoc({ section, params });
    setMenuOpen(false);
    const q = new URLSearchParams({ section, ...params }).toString();
    window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
    window.scrollTo({ top: 0 });
  }, []);

  if (!ready) return <main id="contenu" className="wrap dash"><Loading /></main>;
  if (!user) {
    return (
      <main id="contenu">
        <header className="pageHead wrap">
          <h1 className="pageTitle">Espace client</h1>
          <p className="pageLead">Connectez-vous pour suivre vos devis, vos commandes et vos inscriptions.</p>
          <button type="button" className="btn btnPrimary" onClick={openAuth}>Se connecter</button>
        </header>
      </main>
    );
  }

  const initials = ((user.first_name?.[0] || user.full_name?.[0] || '?') + (user.last_name?.[0] || '')).toUpperCase();
  const label = sections.find(([k]) => k === current)?.[1];
  return (
    <ConfirmProvider>
      <main id="contenu" className="space">
        <aside className={`spaceNav${menuOpen ? ' open' : ''}`} aria-label="Menu de l’espace">
          <div className="spaceUser">
            {user.avatar_file_id ? <img className="avatar" src={avatarUrl(user.avatar_file_id)} alt="" /> : <span className="avatar" aria-hidden="true">{initials}</span>}
            <span><strong>{user.full_name}</strong><small>{isAdmin ? 'Administrateur' : user.role === 'staff' ? 'Équipe' : 'Client'}</small></span>
          </div>
          <nav>
            <ul>
              {sections.map(([key, text, Icon]) => (
                <li key={key}>
                  <button type="button" className={current === key ? 'active' : ''} aria-current={current === key ? 'page' : undefined} onClick={() => go(key)}>
                    <Icon size={18} aria-hidden="true" /><span>{text}</span>
                    {key === 'notifications' && unread > 0 && <span className="badgeCount" aria-label={`${unread} non lues`}>{unread}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <button type="button" className="btn btnGhost btnSmall spaceLogout" onClick={logout}><LogOut size={16} aria-hidden="true" /> Se déconnecter</button>
        </aside>
        <div className="spaceMain" ref={setMainEl}>
          <div className="spaceTopbar">
            <button type="button" className="btn btnGhost btnSmall menuSpace" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}><Menu size={18} aria-hidden="true" /> {label}</button>
            <button type="button" className="iconBtn bell" aria-label={`Notifications${unread ? ` : ${unread} non lues` : ''}`} onClick={() => go('notifications')}>
              <Bell size={20} aria-hidden="true" />{unread > 0 && <span className="badgeCount">{unread}</span>}
            </button>
          </div>
          {!DEMO && !user.email_verified && <VerifyBanner notify={notify} />}
          <Section key={current + JSON.stringify(loc.params)} section={current} params={loc.params} user={user} setUser={setUser} notify={notify}
            go={go} can={can} isAdmin={isAdmin} isClient={isClient} unread={unread} refreshUnread={refreshUnread} />
        </div>
      </main>
    </ConfirmProvider>
  );
}

function Section({ section, params, user, setUser, notify, go, can, isAdmin, isClient, unread, refreshUnread }) {
  const [creating, setCreating] = useState(Boolean(params.nouveau));
  switch (section) {
    case 'accueil': return <ClientHome user={user} go={go} unread={unread} />;
    case 'tableau': return <TeamHome user={user} go={go} />;
    case 'devis':
      if (creating) {
        return isClient
          ? <QuoteRequestForm user={user} notify={notify} onCancel={() => setCreating(false)} onDone={(q) => go('devis', { id: q.id })} />
          : <TeamCreateForm kind="quote" notify={notify} onCancel={() => setCreating(false)} onDone={(q) => go('devis', { id: q.id })} />;
      }
      return (
        <>
          <SectionHead title={isClient ? 'Mes devis' : 'Devis'} lead={isClient ? 'Vos demandes, les devis de l’atelier et leur suivi.' : 'Demandes reçues, devis à chiffrer et à envoyer.'}
            actions={<button type="button" className="btn btnPrimary btnSmall" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> {isClient ? 'Nouvelle demande' : 'Nouveau devis'}</button>} />
          <QuotesPanel isAdmin={can('quotes')} notify={notify} search="" initialId={params.id || null} onChanged={refreshUnread} />
        </>
      );
    case 'commandes':
      if (creating && !isClient) return <TeamCreateForm kind="order" notify={notify} onCancel={() => setCreating(false)} onDone={(o) => go('commandes', { id: o.id })} />;
      return (
        <>
          <SectionHead title={isClient ? 'Mes commandes' : 'Commandes'} lead={isClient ? 'Suivez l’avancement de vos commandes et téléchargez vos bons de commande.' : 'Production, paiements, collaborateurs et commentaires internes.'}
            actions={!isClient && <button type="button" className="btn btnPrimary btnSmall" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> Nouvelle commande</button>} />
          <OrdersPanel isAdmin={can('orders')} notify={notify} search="" initialId={params.id || null} onChanged={refreshUnread} />
        </>
      );
    case 'formations':
      return isClient ? <MyTrainings notify={notify} params={params} go={(s) => (s === 'catalogue' ? navigate('/formations') : go(s))} />
        : <><SectionHead title="Formations" lead="Créer, modifier, archiver ; tarifs, durées, dates, places et apprenants." /><CoursesAdmin notify={notify} /></>;
    case 'inscriptions': return <Registrations notify={notify} />;
    case 'documents': return <MyDocuments />;
    case 'notifications': return <NotificationsSection go={go} onRead={refreshUnread} />;
    case 'assistance': return isClient ? <SupportSection notify={notify} /> : <SupportInbox notify={notify} params={params} />;
    case 'clients': return <ClientsAdmin notify={notify} isAdmin={isAdmin} />;
    case 'realisations': return <><SectionHead title="Réalisations" lead="Photos de vos travaux, catégories, publication." /><GalleryAdmin notify={notify} /></>;
    case 'prestations': return <><SectionHead title="Prestations" lead="Textes des pages prestations et visibilité sur le site." /><PrestationsAdmin notify={notify} /></>;
    case 'images': return <><SectionHead title="Images et bannières" lead="Photos du carrousel d’accueil, des pages, des prestations et des formations." /><MediaAdmin notify={notify} /></>;
    case 'contenu': return <ContentAdmin notify={notify} isAdmin={isAdmin} />;
    case 'equipe': return <TeamSection notify={notify} me={user} />;
    case 'parametres': return <SettingsAdmin notify={notify} params={params} go={go} />;
    case 'annonces': return <AnnouncementsAdmin notify={notify} />;
    case 'profil':
      return (
        <>
          <SectionHead title="Mon profil" lead="Vos informations et vos coordonnées." />
          <section className="spaceBlock"><AvatarEditor user={user} notify={notify} onChange={(id) => setUser({ ...user, avatar_file_id: id })} /></section>
          <section className="spaceBlock"><ProfilePanel notify={notify} /></section>
          {isClient && <EmailPrefs notify={notify} />}
          {isClient && <section className="spaceBlock"><TestimonialForm notify={notify} /></section>}
        </>
      );
    case 'securite': return <><SectionHead title="Sécurité" lead="Appareils connectés, mot de passe et connexion Google." /><SecurityPanel notify={notify} /></>;
    default: return null;
  }
}

function Registrations({ notify }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const load = useCallback(async () => {
    try { setRows(await fetchRegistrations()); setError(''); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const shown = (rows || []).filter((r) => !q || [r.full_name, r.course, r.status, r.phone].join(' ').toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <SectionHead title="Inscriptions" lead="Toutes les demandes d’inscription ; confirmez les places, contactez les apprenants." />
      <div className="filterBar"><label className="searchBox"><Search size={16} aria-hidden="true" /><span className="sr">Rechercher</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, formation, téléphone" /></label></div>
      {error ? <ErrorBox error={error} onRetry={load} /> : !rows ? <Loading /> : <TrainingTable rows={shown} isAdmin notify={notify} onSaved={load} filtered={Boolean(q)} />}
    </>
  );
}

function TeamSection({ notify, me }) {
  const [history, setHistory] = useState(null);
  const [version, setVersion] = useState(0);
  return (
    <>
      <SectionHead title="Équipe" lead="Collaborateurs, droits, désactivation, historique des actions et journal de sécurité." />
      <StaffInvite notify={notify} onDone={() => setVersion((v) => v + 1)} />
      <HistoryPicker onPick={setHistory} version={version} />
      {history && <MemberHistory id={history.id} name={history.full_name} onClose={() => setHistory(null)} />}
      <TeamPanel key={version} notify={notify} me={me} />
    </>
  );
}

function HistoryPicker({ onPick, version }) {
  const [team, setTeam] = useState([]);
  useEffect(() => { security.team().then((r) => setTeam(r.team)).catch(() => {}); }, [version]);
  if (!team.length) return null;
  return (
    <section className="spaceBlock">
      <h2 className="subTitle">Historique des actions</h2>
      <div className="chipRow">{team.map((u) => <button key={u.id} type="button" className="chip" onClick={() => onPick(u)}>{u.full_name}</button>)}</div>
    </section>
  );
}

function TestimonialForm({ notify }) {
  const [f, setF] = useState({ content: '', rating: '', author_title: '', consent: false });
  const [sent, setSent] = useState(false);
  if (sent) return <p className="notice">Merci ! Votre avis sera publié après relecture par l’équipe.</p>;
  return (
    <form className="spaceForm" onSubmit={async (e) => {
      e.preventDefault();
      try {
        await callAccount({ action: 'testimonial', ...f, rating: f.rating || null });
        setSent(true);
        notify('Avis envoyé, merci.');
      } catch (err) {
        notify(err.message, 'error');
      }
    }}>
      <h2 className="subTitle">Donner mon avis</h2>
      <label className="field"><span className="fieldLabel">Votre avis sur E-MAN PROD</span><textarea required minLength={10} maxLength={1000} rows={3} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} /></label>
      <div className="fieldRow">
        <label className="field"><span className="fieldLabel">Note (facultatif)</span><select value={f.rating} onChange={(e) => setF({ ...f, rating: e.target.value })}><option value="">—</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 5</option>)}</select></label>
        <label className="field"><span className="fieldLabel">Fonction ou entreprise (facultatif)</span><input maxLength={120} value={f.author_title} onChange={(e) => setF({ ...f, author_title: e.target.value })} /></label>
      </div>
      <label className="consent"><input type="checkbox" required checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} /><span>J’accepte qu’E-MAN PROD publie cet avis sur son site avec mon nom.</span></label>
      <button className="btn btnPrimary btnSmall" disabled={DEMO}>Envoyer mon avis</button>
    </form>
  );
}

const callAccount = (body) => fetch('/api/account', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Erreur du serveur.'); return d; });

function VerifyBanner({ notify }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="notice">
      Confirmez votre adresse e-mail pour retrouver ici les demandes envoyées avant la création de votre compte.{' '}
      <button
        type="button"
        className="linkBtn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await auth.resend();
            notify(r.verificationSent ? 'Lien de confirmation envoyé : vérifiez votre boîte de réception et les indésirables.'
              : r.verification === 'terminal' ? 'Développement : le lien est affiché dans le terminal.'
                : r.verification === 'echec' ? 'L’e-mail n’a pas pu être envoyé. Réessayez plus tard ou contactez-nous.' : 'L’envoi d’e-mails n’est pas encore activé.', r.verificationSent || r.verification === 'terminal' ? undefined : 'error');
          } catch (e) {
            notify(e.message, 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        Renvoyer le lien
      </button>
    </div>
  );
}

function Empty({ filtered, what }) {
  return <p className="empty">{filtered ? 'Aucun résultat pour cette recherche.' : `Aucune ${what} pour le moment.`}</p>;
}

function TrainingTable({ rows, isAdmin, notify, onSaved, filtered }) {
  if (!rows.length) return <Empty filtered={filtered} what="inscription" />;
  return (
    <div className="tableScroll">
      <table className="table">
        <thead>
          <tr><th scope="col">Date</th><th scope="col">Nom</th><th scope="col">Formation</th><th scope="col">Message</th><th scope="col">Statut</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{formatDate(r.created_at)}</td>
              <td>
                {r.full_name}
                {isAdmin && <small><a className="waLink" href={waLink(r.phone, `Bonjour ${r.full_name}, ici E-MAN PROD au sujet de la formation « ${r.course} ».`)} target="_blank" rel="noreferrer"><MessageCircle size={13} aria-hidden="true" />{r.phone}</a></small>}
              </td>
              <td className="wide">{r.course}<small>{r.session_starts_on ? `Session du ${formatDate(r.session_starts_on)}` : 'Prochaine session'}</small></td>
              <td className="wide">{r.message || '—'}</td>
              <td>
                {isAdmin ? (
                  <select
                    aria-label={`Statut de l’inscription de ${r.full_name}`}
                    className={`tag ${tone(r.status)}`}
                    value={r.status}
                    onChange={async (e) => {
                      try {
                        await updateRegistration(r.id, { status: e.target.value });
                        notify('Inscription enregistrée.');
                        onSaved();
                      } catch (err) {
                        notify(err.message, 'error');
                      }
                    }}
                  >
                    {TRAINING_STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                ) : (
                  <>
                    <span className={`tag ${tone(r.status)}`}>{r.status}</span>
                    {!['Terminé', 'Annulé'].includes(r.status) && (
                      <button type="button" className="linkBtn" onClick={async () => {
                        try {
                          await updateRegistration(r.id, { status: 'Annulé' });
                          notify('Inscription annulée.');
                          onSaved();
                        } catch (err) {
                          notify(err.message, 'error');
                        }
                      }}>Annuler</button>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Images du site : remplacer chaque visuel provisoire par une vraie photo.
// ---------------------------------------------------------------------------
function MediaAdmin({ notify }) {
  const media = useMedia();
  const cat = useCatalog();
  // Emplacements fixes + un emplacement par prestation et par formation.
  const slots = [
    ...MEDIA_SLOTS,
    ...cat.prestations.map((p) => ({ slot: `prestation-${p.slug}`, group: 'Prestations', label: p.title, fallback: PLACEHOLDERS[p.placeholder], alt: p.title })),
    ...cat.courses.map((c) => ({ slot: `course-${c.slug}`, group: 'Formations', label: c.title, fallback: PLACEHOLDERS[c.placeholder], alt: `Formation ${c.title}` })),
  ];
  const groups = [...new Set(slots.map((m) => m.group))];
  return (
    <div className="mediaAdmin">
      <p className="muted mediaIntro">
        Collez l’adresse d’une photo (https://…) ou le chemin d’un fichier déposé dans <code>public/media/</code> (par exemple <code>/media/bache.jpg</code>).
        Utilisez uniquement des photos dont vous avez les droits, et ne présentez une photo comme une réalisation d’E-MAN PROD que si c’en est une.
      </p>
      {groups.map((g) => (
        <section key={g} className="mediaGroup">
          <h2 className="subTitle">{g}</h2>
          <ul className="mediaList">
            {slots.filter((m) => m.group === g).map((m) => (
              <MediaRow key={m.slot} def={m} current={media.get(m.slot, m.fallback)} onSaved={media.reload} notify={notify} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function MediaRow({ def, current, onSaved, notify }) {
  const custom = current && !current.placeholder;
  const [url, setUrl] = useState(custom ? current.url : '');
  const [alt, setAlt] = useState(custom ? current.alt : '');
  const [credit, setCredit] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUrl(custom ? current.url : '');
    setAlt(custom ? current.alt : '');
  }, [custom, current?.url, current?.alt]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await saveMedia({ slot: def.slot, url, alt, credit });
      notify(`Image enregistrée : ${def.label}.`);
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      await resetMedia(def.slot);
      notify(`Visuel provisoire rétabli : ${def.label}.`);
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="mediaRow">
      <SmartImage slot={def.slot} fallback={def.fallback} className="mediaThumb" />
      <form className="mediaForm" onSubmit={save}>
        <div className="mediaHead">
          <strong>{def.label}</strong>
          <span className={'tag ' + (custom ? 'done' : 'new')}>{custom ? 'Photo personnalisée' : 'Visuel provisoire'}</span>
        </div>
        <label className="field"><span className="fieldLabel">Adresse de l’image</span>
          <input required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… ou /media/photo.jpg" inputMode="url" />
        </label>
        <div className="fieldRow">
          <label className="field"><span className="fieldLabel">Description (pour l’accessibilité)</span>
            <input required minLength={3} maxLength={200} value={alt} onChange={(e) => setAlt(e.target.value)} placeholder={def.alt} />
          </label>
          <label className="field"><span className="fieldLabel">Crédit ou source (facultatif)</span>
            <input maxLength={200} value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="Photographe, banque d’images…" />
          </label>
        </div>
        <div className="mediaActions">
          <button className="btn btnPrimary btnSmall" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
          {custom && <button type="button" className="btn btnGhost btnSmall" disabled={busy} onClick={reset}>Revenir au visuel provisoire</button>}
        </div>
      </form>
    </li>
  );
}
