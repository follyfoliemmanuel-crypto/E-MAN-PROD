// Sécurité du compte (tout utilisateur) et gestion de l'équipe (administrateur).
// L'écran n'accorde aucun droit : chaque action est vérifiée par le serveur.
import React, { useCallback, useEffect, useState } from 'react';
import { DEMO, security, formatDate, mfaApi } from '../lib/api.js';
import { PasswordInput } from '../components/PasswordInput.jsx';

const PERMISSION_LABELS = {
  quotes: 'Devis et messages des devis',
  orders: 'Commandes',
  trainings: 'Formations, sessions et inscriptions',
  content: 'Contenu du site : prestations, réalisations, images, avis',
  clients: 'Fiches clients (lecture et notes)',
};
const ROLE_LABELS = { client: 'Client', staff: 'Staff', admin: 'Administrateur' };
const METHOD_LABELS = { password: 'Mot de passe', google: 'Google', reset: 'Lien de réinitialisation', verify: 'Lien de confirmation' };

/** Nom lisible d'un navigateur à partir de son « user agent ». */
function device(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' · ');
}
const when = (iso) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function useLoad(fn) {
  const [state, setState] = useState({ data: null, error: '' });
  const load = useCallback(async () => {
    try {
      setState({ data: await fn(), error: '' });
    } catch (e) {
      setState({ data: null, error: e.message });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return [state, load];
}

export function SecurityPanel({ notify, onLoggedOut }) {
  const [{ data, error }, reload] = useLoad(() => security.sessions());
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [busy, setBusy] = useState(false);
  if (error) return <p className="formError" role="alert">{error}</p>;
  if (!data) return <p className="empty">Chargement…</p>;
  const run = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      notify(done);
      reload();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="securityPanel">
      <section className="recordBlock">
        <h2 className="subTitle">Appareils connectés</h2>
        <p className="muted">Une session dure au plus 30 jours et se ferme après 14 jours sans utilisation. Fermez celles que vous ne reconnaissez pas.</p>
        <ul className="sessionsList">
          {data.sessions.map((s) => (
            <li key={s.id}>
              <div>
                <strong>{device(s.user_agent)}</strong>{s.current && <span className="tag done">Cet appareil</span>}
                <small>Connexion : {METHOD_LABELS[s.method] || s.method} · ouverte le {when(s.created_at)} · dernière activité {when(s.last_seen_at)}</small>
              </div>
              {!s.current && <button type="button" className="btn btnGhost btnSmall" disabled={busy} onClick={() => run(() => security.revoke({ id: s.id }), 'Session fermée.')}>Fermer</button>}
            </li>
          ))}
        </ul>
        {data.sessions.length > 1 && (
          <button type="button" className="btn btnGhost btnSmall" disabled={busy} onClick={() => run(() => security.revoke({ others: true }), 'Vos autres appareils sont déconnectés.')}>Déconnecter tous mes autres appareils</button>
        )}
      </section>

      <section className="recordBlock">
        <h2 className="subTitle">{data.has_password ? 'Changer mon mot de passe' : 'Créer un mot de passe'}</h2>
        {!data.has_password && <p className="muted">Votre compte utilise la connexion Google. Un mot de passe vous permet aussi de vous connecter avec votre e-mail.</p>}
        <form className="pwForm" onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await security.password(pw);
            setPw({ current_password: '', new_password: '' });
          }, 'Mot de passe enregistré. Vos autres appareils ont été déconnectés.');
        }}>
          {data.has_password && (
            <label className="field"><span className="fieldLabel">Mot de passe actuel</span>
              <PasswordInput required autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
            </label>
          )}
          <label className="field"><span className="fieldLabel">Nouveau mot de passe</span>
            <PasswordInput required minLength={10} maxLength={128} autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
            <span className="hint">10 caractères minimum. Évitez les mots de passe courants, votre nom ou votre e-mail.</span>
          </label>
          <button className="btn btnPrimary btnSmall" disabled={busy || DEMO}>Enregistrer</button>
        </form>
      </section>

      <section className="recordBlock">
        <h2 className="subTitle">Connexion Google</h2>
        {data.google ? (
          <>
            <p>Compte Google relié : <strong>{data.google.email}</strong> (depuis le {formatDate(data.google.created_at)}).</p>
            {data.has_password
              ? <button type="button" className="btn btnGhost btnSmall" disabled={busy} onClick={() => run(() => security.unlinkGoogle(), 'Connexion Google retirée.')}>Retirer la connexion Google</button>
              : <p className="hint">Créez d’abord un mot de passe pour pouvoir retirer la connexion Google.</p>}
          </>
        ) : <p className="muted">Aucun compte Google relié. Il le sera automatiquement si vous utilisez « Continuer avec Google » avec la même adresse e-mail.</p>}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Équipe (administrateur)
// ---------------------------------------------------------------------------
export function TeamPanel({ notify, me }) {
  const [{ data, error }, reload] = useLoad(() => security.team());
  const [{ data: logData }, reloadLog] = useLoad(() => security.log());
  const [search, setSearch] = useState('');
  const [found, setFound] = useState([]);
  const [busy, setBusy] = useState(false);
  if (error) return <p className="formError" role="alert">{error}</p>;
  if (!data) return <p className="empty">Chargement…</p>;
  const run = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      notify(done);
      reload();
      reloadLog();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="teamPanel">
      <p className="muted">
        <strong>Administrateur</strong> : accès complet. <strong>Staff</strong> : seulement les domaines cochés.
        <strong> Client</strong> : uniquement ses propres demandes. Un compte doit avoir confirmé son adresse e-mail pour rejoindre l’équipe.
      </p>
      <ul className="teamList">
        {data.team.map((u) => <MemberRow key={u.id} u={u} me={me} busy={busy} run={run} />)}
      </ul>

      <section className="recordBlock">
        <h2 className="subTitle">Ajouter un membre</h2>
        <form className="searchRow" onSubmit={async (e) => {
          e.preventDefault();
          try {
            setFound((await security.clients(search)).clients.filter((c) => c.role === 'client').slice(0, 8));
          } catch (err) {
            notify(err.message, 'error');
          }
        }}>
          <input aria-label="Rechercher un compte client" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom ou e-mail du compte" />
          <button className="btn btnGhost btnSmall">Rechercher</button>
        </form>
        {found.length > 0 && <ul className="teamList">{found.map((u) => <MemberRow key={u.id} u={{ ...u, permissions: [] }} me={me} busy={busy} run={run} />)}</ul>}
      </section>

      <section className="recordBlock">
        <h2 className="subTitle">Journal de sécurité</h2>
        <p className="muted">Connexions, échecs, blocages, changements de rôle et accès refusés. Les adresses IP sont remplacées par une empreinte.</p>
        <div className="tableScroll">
          <table className="table">
            <thead><tr><th scope="col">Date</th><th scope="col">Évènement</th><th scope="col">Compte</th><th scope="col">Détail</th></tr></thead>
            <tbody>
              {(logData?.events || []).slice(0, 80).map((ev, i) => (
                <tr key={i} className={/failed|forbidden|rate_limited|google_failed|upload_blocked/.test(ev.action) ? 'warn' : undefined}>
                  <td>{when(ev.created_at)}</td>
                  <td>{ev.action}</td>
                  <td>{ev.actor_email || ev.data?.email || '—'}</td>
                  <td className="wide">{[ev.data?.reason, ev.data?.what, ev.data?.method, ev.data?.to && `→ ${ev.data.to}`].filter(Boolean).join(' · ') || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MemberRow({ u, me, busy, run }) {
  const [role, setRole] = useState(u.role);
  const [perms, setPerms] = useState(u.permissions || []);
  const self = u.id === me.id;
  const toggle = (p) => setPerms((list) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]));
  return (
    <li className="memberRow">
      <div className="memberHead">
        <strong>{u.full_name}</strong> <span className="muted">{u.email}</span>
        <span className={`tag ${u.disabled_at ? 'off' : u.role === 'admin' ? 'done' : 'work'}`}>{u.disabled_at ? 'Désactivé' : ROLE_LABELS[u.role]}</span>
        {!u.email_verified && <span className="tag new">E-mail non confirmé</span>}
      </div>
      {self ? <p className="hint">C’est votre compte : un autre administrateur peut seul modifier votre rôle.</p> : (
        <form className="memberForm" onSubmit={(e) => {
          e.preventDefault();
          run(() => security.setRole({ user_id: u.id, role, permissions: role === 'staff' ? perms : [] }), `Rôle de ${u.full_name} enregistré.`);
        }}>
          <label className="field inline"><span className="fieldLabel">Rôle</span>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          {role === 'staff' && (
            <fieldset className="permList">
              <legend>Droits accordés</legend>
              {Object.entries(PERMISSION_LABELS).map(([k, v]) => (
                <label key={k} className="check"><input type="checkbox" checked={perms.includes(k)} onChange={() => toggle(k)} /> {v}</label>
              ))}
            </fieldset>
          )}
          <div className="memberActions">
            <button className="btn btnPrimary btnSmall" disabled={busy}>Enregistrer</button>
            <button type="button" className="btn btnGhost btnSmall" disabled={busy} onClick={() => run(() => security.revokeUser(u.id), `Sessions de ${u.full_name} fermées.`)}>Fermer ses sessions</button>
            <button type="button" className="btn btnGhost btnSmall" disabled={busy} onClick={() => run(() => security.disable(u.id, !u.disabled_at), u.disabled_at ? 'Compte réactivé.' : 'Compte désactivé.')}>{u.disabled_at ? 'Réactiver' : 'Désactiver le compte'}</button>
            {u.role !== 'client' && (
              <button type="button" className="btn btnGhost btnSmall" disabled={busy} title="Téléphone perdu sans code de récupération"
                onClick={() => window.confirm(`Réinitialiser Google Authenticator de ${u.full_name} ? Ses sessions seront fermées et il devra le réactiver.`) && run(() => mfaApi.resetFor(u.id), `Google Authenticator de ${u.full_name} réinitialisé.`)}>
                Réinitialiser Google Authenticator
              </button>
            )}
          </div>
        </form>
      )}
    </li>
  );
}
