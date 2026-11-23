import React, { useCallback, useEffect, useState } from 'react';
import {
  MessageCircle, Search, Plus, LayoutDashboard, FileText, Package, GraduationCap, FolderOpen, Bell, LifeBuoy, UserRound, ShieldCheck,
  Users, ClipboardList, Images, Layers, Image as ImageIcon, PenLine, UserCog, LogOut, Menu, Megaphone, Settings2, MessagesSquare, ListChecks,
} from 'lucide-react';
import { ClientMessaging, ChatInbox } from './space/chat.jsx';
import { MfaPanel, MfaGate } from './space/mfa.jsx';
import { RequestTimeline, PublicProfileForm, PresencePrivacy } from './space/extras.jsx';
import { NotifyInvite } from './space/push.jsx';
import { onChat } from '../lib/live.js';
import { MEDIA_SLOTS, PLACEHOLDERS } from '../config.js';
import { useCatalog } from '../lib/catalog.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { CoursesAdmin, GalleryAdmin, PrestationsAdmin } from './admin.jsx';
import { QuotesPanel, OrdersPanel, ProfilePanel } from './requests.jsx';
import { SecurityPanel, TeamPanel } from './security.jsx';
import { PushSettings } from './space/push.jsx';
import { ClientHome, QuoteRequestForm, OrderRequestForm, MyTrainings, MyDocuments, NotificationsSection, SupportSection, AvatarEditor, EmailPrefs } from './space/client.jsx';
import { SettingsAdmin, AnnouncementsAdmin } from './space/settings.jsx';
import { TeamHome, ClientsAdmin, TeamCreateForm, SupportInbox, ContentAdmin, StaffInvite, MemberHistory } from './space/team.jsx';
import { ConfirmProvider, SectionHead, Loading, ErrorBox, useStackedTables } from './space/ui.jsx';
import { useMedia } from '../lib/media.jsx';
import { SmartImage } from '../components/visual.jsx';
import { useApp } from '../context.js';
import { navigate } from '../lib/router.jsx';
import {
  DEMO, auth, fetchRegistrations, updateRegistration, saveMedia, resetMedia, uploadFile, TRAINING_STATUSES, formatDate, space, security, avatarUrl,
} from '../lib/api.js';

const tone = (s) => ({ 'Terminé': 'done', 'Inscrit': 'done', 'Contacté': 'work', 'Annulé': 'off' }[s] || 'new');

const waLink = (phone, text) => `https://wa.me/${String(phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

// Sections de l'espace, selon le rôle et les droits. L'affichage ne donne aucun droit :
// chaque donnée est demandée au serveur, qui vérifie le droit à chaque requête.
// v4 : rubriques du cahier des charges en premier ; rien n'est retiré (formations, documents,
// outils du site restent accessibles, regroupés sous « Gestion du site » pour l'équipe).
const CLIENT_SECTIONS = [
  ['accueil', 'Tableau de bord', LayoutDashboard], ['messagerie', 'Messagerie', MessagesSquare], ['devis', 'Mes devis', FileText],
  ['commandes', 'Mes commandes', Package], ['suivi', 'Suivi des demandes', ListChecks], ['formations', 'Mes formations', GraduationCap],
  ['documents', 'Mes documents', FolderOpen], ['notifications', 'Notifications', Bell], ['profil', 'Mon profil', UserRound],
  ['parametres', 'Paramètres', Settings2],
];
const TEAM_SECTIONS = [
  ['tableau', 'Tableau de bord', LayoutDashboard, null], ['clients', 'Gestion des clients', Users, 'clients'], ['messagerie', 'Messagerie', MessagesSquare, 'support'],
  ['devis', 'Gestion des devis', FileText, 'quotes'], ['commandes', 'Gestion des commandes', Package, 'orders'], ['notifications', 'Notifications', Bell, null],
  ['profil', 'Profil administrateur', UserRound, null], ['parametres', 'Paramètres', ShieldCheck, null],
  ['inscriptions', 'Inscriptions', ClipboardList, 'trainings', 'Gestion du site'], ['formations', 'Formations', GraduationCap, 'trainings', 'Gestion du site'],
  ['realisations', 'Réalisations', Images, 'content', 'Gestion du site'], ['prestations', 'Prestations', Layers, 'content', 'Gestion du site'],
  ['images', 'Images et bannières', ImageIcon, 'content', 'Gestion du site'], ['contenu', 'Textes du site', PenLine, 'content', 'Gestion du site'],
  ['annonces', 'Annonces', Megaphone, 'admin', 'Gestion du site'], ['equipe', 'Équipe', UserCog, 'admin', 'Gestion du site'],
  ['site', 'Paramètres du site', Settings2, 'admin', 'Gestion du site'],
];
/** Anciennes adresses (liens d'e-mails, favoris) → nouvelles rubriques. */
function alias(section, params = {}) {
  if (section === 'assistance') return 'messagerie';
  if (section === 'securite') return 'parametres';
  if (section === 'parametres' && params.onglet) return 'site';
  return section;
}

function readLocation() {
  const p = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const params = Object.fromEntries(p);
  // Liens des notifications et des e-mails (v2.5) : ?devis=…, ?commande=…, ?onglet=inscriptions
  if (params.devis) return { section: 'devis', params: { id: params.devis } };
  if (params.commande) return { section: 'commandes', params: { id: params.commande } };
  if (params.onglet === 'inscriptions') return { section: 'inscriptions', params: {} };
  const { section, ...rest } = params;
  return { section: section ? alias(section, rest) : null, params: rest };
}

export default function Dashboard() {
  const { user, ready, openAuth, logout, notify, setUser, spaceRequest, unread, refreshUnread, serverIssue } = useApp();
  const [loc, setLoc] = useState(() => (spaceRequest ? { section: spaceRequest.section, params: {} } : readLocation()));
  const [menuOpen, setMenuOpen] = useState(false);
  const [mainEl, setMainEl] = useState(null);
  useStackedTables(mainEl);
  const isClient = !user || user.role === 'client';
  const isAdmin = user?.role === 'admin';
  const can = (p) => isAdmin || (user?.role === 'staff' && (user.permissions || []).includes(p));
  const sections = isClient ? CLIENT_SECTIONS : TEAM_SECTIONS.filter(([, , , perm]) => !perm || (perm === 'admin' ? isAdmin : can(perm)))
    // « Profil administrateur » pour l'administrateur ; un collaborateur voit « Mon profil ».
    .map((s) => (s[0] === 'profil' && !isAdmin ? ['profil', 'Mon profil', ...s.slice(2)] : s));
  const current = sections.find(([k]) => k === loc.section)?.[0] || sections[0][0];
  // Messages non lus (menu « Messagerie »), tenus à jour en temps réel.
  const [chatUnread, setChatUnread] = useState(0);
  const refreshChat = useCallback(() => { if (!user || DEMO) return; import('../lib/api.js').then(({ chatApi }) => chatApi.unread()).then((r) => setChatUnread(r.unread)).catch(() => {}); }, [user?.id]);
  useEffect(() => { refreshChat(); return onChat((e) => { if (e.type === 'chat' || e.type === 'resync') refreshChat(); }); }, [refreshChat]);

  const go = useCallback((rawSection, params = {}) => {
    const section = alias(rawSection, params);
    setLoc({ section, params });
    setMenuOpen(false);
    const q = new URLSearchParams({ section, ...params }).toString();
    window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
    window.scrollTo({ top: 0 });
  }, []);

  // Rubrique demandée depuis le menu du profil (en-tête), y compris quand l'espace est déjà ouvert.
  useEffect(() => {
    if (spaceRequest) go(spaceRequest.section || sections[0][0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceRequest?.n]);

  if (!ready) return <main id="contenu" className="wrap dash"><Loading /></main>;
  if (!user) {
    return (
      <main id="contenu">
        <header className="pageHead wrap">
          <h1 className="pageTitle">Espace client</h1>
          <p className="pageLead">Connectez-vous pour suivre vos devis, vos commandes, vos factures et vos inscriptions.</p>
          {serverIssue && <p className="formError" role="alert">{serverIssue}</p>}
          <div className="authCtas">
            <button type="button" className="btn btnPrimary" onClick={() => openAuth('login')}>Se connecter</button>
            <button type="button" className="btn btnGhost" onClick={() => openAuth('signup')}>Créer un compte</button>
          </div>
        </header>
      </main>
    );
  }

  const label = sections.find(([k]) => k === current)?.[1];
  return (
    <ConfirmProvider>
      <main id="contenu" className="space">
        <aside className={`spaceNav${menuOpen ? ' open' : ''}`} aria-label="Menu de l’espace">
          <div className="spaceUser">
            <Avatar user={user} size={44} />
            <span><strong>{user.full_name}</strong><small>{isAdmin ? 'Administrateur' : user.role === 'staff' ? 'Équipe' : 'Client'}</small></span>
          </div>
          <nav>
            <ul>
              {sections.map(([key, text, Icon, , group], i) => (
                <React.Fragment key={key}>
                  {group && sections[i - 1]?.[4] !== group && <li className="navGroup" role="presentation">{group}</li>}
                  <li>
                    <button type="button" className={current === key ? 'active' : ''} aria-current={current === key ? 'page' : undefined} onClick={() => go(key)}>
                      <Icon size={18} aria-hidden="true" /><span>{text}</span>
                      {key === 'notifications' && unread > 0 && <span className="badgeCount" aria-label={`${unread} non lues`}>{unread}</span>}
                      {key === 'messagerie' && chatUnread > 0 && <span className="badgeCount" aria-label={`${chatUnread} message${chatUnread > 1 ? 's' : ''} non lu${chatUnread > 1 ? 's' : ''}`}>{chatUnread}</span>}
                    </button>
                  </li>
                </React.Fragment>
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
          {user.mfa_setup_required ? <MfaGate user={user} notify={notify} setUser={setUser} /> : (
            <>
              <NotifyInvite notify={notify} team={!isClient} />
              <Section key={current + JSON.stringify(loc.params)} section={current} params={loc.params} user={user} setUser={setUser} notify={notify}
                go={go} can={can} isAdmin={isAdmin} isClient={isClient} unread={unread} refreshUnread={refreshUnread} refreshChat={refreshChat} />
            </>
          )}
        </div>
      </main>
    </ConfirmProvider>
  );
}

function Section({ section, params, user, setUser, notify, go, can, isAdmin, isClient, unread, refreshUnread, refreshChat }) {
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
      // Les commandes viennent des clients ; l'équipe les confirme et fait avancer leur statut.
      if (creating && isClient) return <OrderRequestForm user={user} notify={notify} onCancel={() => setCreating(false)} onDone={(o) => { setCreating(false); go('commandes', { id: o.id }); }} />;
      return (
        <>
          <SectionHead title={isClient ? 'Mes commandes' : 'Commandes'} lead={isClient ? 'Passez commande, puis suivez son avancement : en attente, confirmée, en cours, prête, livrée.' : 'Les commandes envoyées par vos clients : confirmez-les ou refusez-les, puis faites avancer leur statut.'}
            actions={isClient && <button type="button" className="btn btnPrimary btnSmall" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> Passer une commande</button>} />
          <OrdersPanel isAdmin={can('orders')} notify={notify} search="" initialId={params.id || null} onChanged={refreshUnread} />
        </>
      );
    case 'formations':
      return isClient ? <MyTrainings notify={notify} params={params} go={(s) => (s === 'catalogue' ? navigate('/formations') : go(s))} />
        : <><SectionHead title="Formations" lead="Créer, modifier, archiver ; tarifs, durées, dates, places et apprenants." /><CoursesAdmin notify={notify} /></>;
    case 'inscriptions': return <Registrations notify={notify} />;
    case 'documents': return <MyDocuments />;
    case 'notifications': return <><NotificationsSection go={go} onRead={refreshUnread} /><PushSettings notify={notify} team={!isClient} /></>;
    case 'messagerie':
      return (
        <>
          <SectionHead title="Messagerie" lead={isClient ? 'Votre conversation privée avec l’équipe E-MAN PROD : messages, photos, documents et messages vocaux.' : 'Les conversations privées avec vos clients, les plus récentes en premier.'} />
          {isClient ? <ClientMessaging user={user} notify={notify} onChanged={() => { refreshChat(); refreshUnread(); }} />
            : <ChatInbox user={user} notify={notify} params={params} go={go} onChanged={() => { refreshChat(); refreshUnread(); }} />}
        </>
      );
    case 'assistance': return isClient ? <SupportSection notify={notify} /> : <SupportInbox notify={notify} params={params} />;
    case 'suivi': return <RequestTimeline go={go} />;
    case 'clients': return <ClientsAdmin notify={notify} isAdmin={isAdmin} />;
    case 'realisations': return <><SectionHead title="Réalisations" lead="Photos de vos travaux, catégories, publication." /><GalleryAdmin notify={notify} /></>;
    case 'prestations': return <><SectionHead title="Prestations" lead="Textes des pages prestations et visibilité sur le site." /><PrestationsAdmin notify={notify} /></>;
    case 'images': return <><SectionHead title="Images et bannières" lead="Photos du carrousel d’accueil, des pages, des prestations et des formations." /><MediaAdmin notify={notify} /></>;
    case 'contenu': return <ContentAdmin notify={notify} isAdmin={isAdmin} />;
    case 'equipe': return <TeamSection notify={notify} me={user} />;
    case 'site': return <SettingsAdmin notify={notify} params={params} go={go} />;
    case 'parametres':
      return (
        <>
          <SectionHead title="Paramètres" lead={isClient ? 'Sécurité de votre compte, notifications et confidentialité.' : 'Google Authenticator, appareils de confiance, sessions, notifications et confidentialité.'} />
          {!isClient && <MfaPanel notify={notify} onUserChange={(u) => u && setUser(u)} />}
          <SecurityPanel notify={notify} />
          <PushSettings notify={notify} team={!isClient} />
          <PresencePrivacy user={user} notify={notify} setUser={setUser} />
          {isClient && <EmailPrefs notify={notify} />}
        </>
      );
    case 'annonces': return <AnnouncementsAdmin notify={notify} />;
    case 'profil':
      return (
        <>
          <SectionHead title={isAdmin ? 'Profil administrateur' : 'Mon profil'} lead={isClient ? 'Votre photo, vos informations et vos coordonnées (visibles de l’équipe E-MAN PROD).' : 'Votre photo et ce que les clients voient de vous dans la messagerie.'} />
          <section className="spaceBlock"><AvatarEditor user={user} notify={notify} onChange={(id) => setUser({ ...user, avatar_file_id: id })} /></section>
          {!isClient && <PublicProfileForm user={user} notify={notify} setUser={setUser} />}
          <section className="spaceBlock"><ProfilePanel notify={notify} /></section>
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
        Choisissez une photo sur votre ordinateur ou votre téléphone (JPG, PNG ou WebP, jusqu’à 50 Mo) : elle est envoyée, optimisée et affichée sur le site aussitôt.
        Vous pouvez aussi coller l’adresse d’une image (https://…). Utilisez uniquement des photos dont vous avez les droits, et ne présentez une photo comme une réalisation d’E-MAN PROD que si c’en est une.
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

  // Photo envoyée depuis le tableau de bord : stockée sur Cloudinary, affichée aussitôt.
  async function sendPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const up = await uploadFile('site_media', null, file);
      await saveMedia({ slot: def.slot, file_id: up.id, alt: alt.trim().length >= 3 ? alt : def.alt, credit });
      notify(`Photo mise en ligne : ${def.label}.`);
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
      notify(def.optional ? `Photo retirée : ${def.label} n’apparaît plus sur l’accueil.` : `Visuel provisoire rétabli : ${def.label}.`);
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="mediaRow">
      {custom || !def.optional
        ? <SmartImage slot={def.slot} fallback={def.fallback} className="mediaThumb" />
        : <span className="mediaThumb mediaEmpty">Aucune photo : cette diapositive n’apparaît pas sur l’accueil.</span>}
      <form className="mediaForm" onSubmit={save}>
        <div className="mediaHead">
          <strong>{def.label}</strong>
          <span className={'tag ' + (custom ? 'done' : 'new')}>{custom ? 'Photo personnalisée' : def.optional ? 'Vide (masquée)' : 'Visuel provisoire'}</span>
        </div>
        <label className="field"><span className="fieldLabel">Envoyer une photo</span>
          <input type="file" accept=".jpg,.jpeg,.png,.webp" disabled={busy} onChange={sendPhoto} />
        </label>
        <label className="field"><span className="fieldLabel">… ou adresse d’une image</span>
          <input required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… ou /media/photo.jpg" inputMode="url" />
        </label>
        <div className="fieldRow">
          <label className="field"><span className="fieldLabel">{def.optional ? 'Description (aussi la légende sur l’accueil)' : 'Description (pour l’accessibilité)'}</span>
            <input required minLength={3} maxLength={200} value={alt} onChange={(e) => setAlt(e.target.value)} placeholder={def.alt} />
          </label>
          <label className="field"><span className="fieldLabel">Crédit ou source (facultatif)</span>
            <input maxLength={200} value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="Photographe, banque d’images…" />
          </label>
        </div>
        <div className="mediaActions">
          <button className="btn btnPrimary btnSmall" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer l’adresse'}</button>
          {custom && <button type="button" className="btn btnGhost btnSmall" disabled={busy} onClick={reset}>{def.optional ? 'Retirer la photo' : 'Revenir au visuel provisoire'}</button>}
        </div>
      </form>
    </li>
  );
}
