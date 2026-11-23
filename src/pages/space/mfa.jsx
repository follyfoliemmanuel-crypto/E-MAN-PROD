// Double authentification (équipe) : activation par QR code, codes de récupération,
// appareils de confiance révocables.
import React, { useState } from 'react';
import { KeyRound, ShieldCheck, ShieldAlert, Copy, Download, MonitorSmartphone, Trash2 } from 'lucide-react';
import { mfaApi, formatDate } from '../../lib/api.js';
import { useLoad, Loading, ErrorBox, useConfirm } from './ui.jsx';

function RecoveryCodes({ codes, notify }) {
  const text = `Codes de récupération E-MAN PROD (chacun ne sert qu’une fois)\n${new Date().toLocaleString('fr-FR')}\n\n${codes.join('\n')}\n`;
  return (
    <div className="recoveryBox" role="region" aria-label="Codes de récupération">
      <p><strong>Gardez ces codes en lieu sûr</strong> (papier rangé, gestionnaire de mots de passe). Ils permettent d’entrer si vous perdez votre téléphone. Ils ne seront plus affichés.</p>
      <ol className="recoveryCodes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ol>
      <div className="mfaActions">
        <button type="button" className="btn btnGhost btnSmall" onClick={async () => { try { await navigator.clipboard.writeText(codes.join('\n')); notify('Codes copiés.'); } catch { notify('Copie impossible : notez-les à la main.', 'error'); } }}>
          <Copy size={16} aria-hidden="true" /> Copier
        </button>
        <a className="btn btnGhost btnSmall" download="codes-recuperation-eman-prod.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}>
          <Download size={16} aria-hidden="true" /> Télécharger
        </a>
      </div>
    </div>
  );
}

/** Activation : QR code → code à 6 chiffres → codes de récupération. */
export function MfaSetup({ notify, onEnabled }) {
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (codes) {
    return (
      <div className="mfaSetup">
        <p className="okLine" role="status"><ShieldCheck size={18} aria-hidden="true" /> Double authentification activée.</p>
        <RecoveryCodes codes={codes.list} notify={notify} />
        <button type="button" className="btn btnPrimary" onClick={() => onEnabled(codes.user)}>J’ai rangé mes codes, continuer</button>
      </div>
    );
  }
  if (!setup) {
    return (
      <div className="mfaSetup">
        <ol className="mfaSteps">
          <li>Installez <strong>Google Authenticator</strong> sur votre téléphone (Play Store ou App Store).</li>
          <li>Affichez le QR code ci-dessous et scannez-le avec l’application.</li>
          <li>Saisissez le code à 6 chiffres affiché pour confirmer.</li>
        </ol>
        {error && <p className="formError" role="alert">{error}</p>}
        <button type="button" className="btn btnPrimary" disabled={busy} onClick={async () => {
          setBusy(true); setError('');
          try { setSetup(await mfaApi.setup()); } catch (err) { setError(err.message); } finally { setBusy(false); }
        }}><KeyRound size={16} aria-hidden="true" /> {busy ? 'Préparation…' : 'Afficher le QR code'}</button>
      </div>
    );
  }
  return (
    <form className="mfaSetup" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError('');
      try { const r = await mfaApi.enable(code); setCodes({ list: r.recovery_codes, user: r.user }); setSetup(null); notify('Double authentification activée.'); }
      catch (err) { setError(err.message); } finally { setBusy(false); }
    }}>
      <div className="qrRow">
        {/* SVG produit par le serveur (aucun script, aucun lien) */}
        <div className="qrBox" dangerouslySetInnerHTML={{ __html: setup.qr_svg }} />
        <div>
          <p>Scannez ce QR code avec Google Authenticator.</p>
          <p className="muted">Sur ce téléphone même ? Dans l’application : <strong>+</strong> → <strong>Saisir une clé de configuration</strong>, compte <strong>{setup.account}</strong>, clé :</p>
          <p><code className="mfaKey">{setup.key}</code></p>
        </div>
      </div>
      {error && <p className="formError" role="alert">{error}</p>}
      <label className="field">
        <span className="fieldLabel">Code affiché dans Google Authenticator</span>
        <input className="codeInput" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} placeholder="123 456" />
      </label>
      <button className="btn btnPrimary" disabled={busy}>{busy ? 'Vérification…' : 'Activer'}</button>
    </form>
  );
}

/** Rubrique Paramètres → Sécurité de connexion (équipe). */
export function MfaPanel({ notify, onUserChange }) {
  const [{ data, error }, reload] = useLoad(() => mfaApi.status(), []);
  const [codes, setCodes] = useState(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  if (!data.team) return null;
  const run = async (fn, ok) => { setBusy(true); try { const r = await fn(); if (ok) notify(ok); await reload(); return r; } catch (err) { notify(err.message, 'error'); return null; } finally { setBusy(false); } };
  return (
    <section className="spaceBlock mfaPanel" aria-labelledby="mfa-title">
      <h2 className="subTitle" id="mfa-title">Google Authenticator (double authentification)</h2>
      {!data.enabled ? (
        <>
          <p className="notice"><ShieldAlert size={18} aria-hidden="true" /> {data.required ? 'Obligatoire pour l’équipe : tant qu’elle n’est pas activée, votre compte n’a pas accès aux outils de gestion.' : 'Protégez votre compte : même avec votre mot de passe, personne ne pourra entrer sans votre téléphone.'}</p>
          <MfaSetup notify={notify} onEnabled={(u) => { reload(); onUserChange?.(u); }} />
        </>
      ) : (
        <>
          <p className="okLine"><ShieldCheck size={18} aria-hidden="true" /> Activée. Le code est demandé sur tout nouvel appareil, après une déconnexion, un changement de mot de passe, ou au bout de {data.trust_days} jours.</p>
          <p className="muted">Codes de récupération restants : <strong>{data.recovery_left}</strong> sur 10.{data.recovery_left < 3 ? ' Créez-en de nouveaux.' : ''}</p>
          {codes && <RecoveryCodes codes={codes} notify={notify} />}
          <div className="mfaActions">
            <button type="button" className="btn btnGhost btnSmall" disabled={busy} onClick={async () => {
              if (!(await confirm({ title: 'Créer de nouveaux codes ?', text: 'Les anciens codes de récupération ne fonctionneront plus.', confirm: 'Créer' }))) return;
              const r = await run(() => mfaApi.recovery());
              if (r) setCodes(r.recovery_codes);
            }}><KeyRound size={16} aria-hidden="true" /> Nouveaux codes de récupération</button>
            {!data.required && (
              <button type="button" className="btn btnGhost btnSmall" disabled={busy} onClick={async () => {
                const code = window.prompt('Code Google Authenticator pour désactiver :');
                if (code) await run(() => mfaApi.disable(code), 'Double authentification désactivée.');
              }}>Désactiver</button>
            )}
          </div>
          <h3 className="miniTitle"><MonitorSmartphone size={16} aria-hidden="true" /> Appareils de confiance</h3>
          {!data.devices.length ? <p className="muted">Aucun : le code sera demandé à chaque connexion.</p> : (
            <ul className="sessionsList">
              {data.devices.map((d) => (
                <li key={d.id}>
                  <span>
                    <strong>{d.label || 'Appareil'}{d.id === data.current_device ? ' · cet appareil' : ''}</strong>
                    <small>Approuvé le {formatDate(d.created_at)} · dernière utilisation {formatDate(d.last_used_at)} · jusqu’au {formatDate(d.expires_at)}</small>
                  </span>
                  <button type="button" className="btn btnGhost btnSmall" disabled={busy} onClick={async () => {
                    if (!(await confirm({ title: 'Révoquer cet appareil ?', text: 'Ses sessions sont fermées et le code sera redemandé.', confirm: 'Révoquer' }))) return;
                    const r = await run(() => mfaApi.revokeDevice({ id: d.id }), 'Appareil révoqué.');
                    if (r?.signed_out) window.location.href = '/';
                  }}><Trash2 size={16} aria-hidden="true" /> Révoquer</button>
                </li>
              ))}
            </ul>
          )}
          {data.devices.length > 1 && (
            <button type="button" className="btn btnGhost btnSmall" disabled={busy} onClick={async () => {
              if (!(await confirm({ title: 'Révoquer tous les appareils ?', text: 'Toutes les sessions ouvertes grâce à eux sont fermées, y compris peut-être celle-ci.', confirm: 'Tout révoquer' }))) return;
              const r = await run(() => mfaApi.revokeDevice({ all: true }), 'Tous les appareils sont révoqués.');
              if (r?.signed_out) window.location.href = '/';
            }}>Révoquer tous les appareils</button>
          )}
        </>
      )}
    </section>
  );
}

/** Équipe sans double authentification alors qu'elle est obligatoire : écran d'activation. */
export function MfaGate({ user, notify, setUser }) {
  return (
    <section className="spaceBlock mfaGate">
      <h1 className="pageTitle">Protégez votre compte avant de continuer</h1>
      <p>Bonjour {user.first_name || user.full_name}. Les comptes de l’équipe E-MAN PROD sont protégés par <strong>Google Authenticator</strong> : en plus du mot de passe, un code à 6 chiffres affiché sur votre téléphone est demandé sur chaque nouvel appareil.</p>
      <p className="muted">Sur votre appareil habituel, le code n’est pas redemandé à chaque visite (appareil de confiance, durée limitée).</p>
      <MfaSetup notify={notify} onEnabled={(u) => { if (u) setUser(u); window.location.reload(); }} />
    </section>
  );
}
