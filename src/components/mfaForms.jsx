// Code Google Authenticator : étape de connexion et reconfirmation avant une action sensible.
import React, { useEffect, useRef, useState } from 'react';
import { mfaApi } from '../lib/api.js';

function CodeField({ recovery, value, onChange, autoFocus = true }) {
  const ref = useRef(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [recovery, autoFocus]);
  return (
    <label className="field">
      <span className="fieldLabel">{recovery ? 'Code de récupération' : 'Code à 6 chiffres'}</span>
      <input ref={ref} className="codeInput" value={value} required
        {...(recovery
          ? { autoComplete: 'off', maxLength: 11, placeholder: 'xxxxx-xxxxx', spellCheck: false, autoCapitalize: 'none' }
          : { inputMode: 'numeric', autoComplete: 'one-time-code', pattern: '[0-9 ]{6,7}', maxLength: 7, placeholder: '123 456' })}
        onChange={(e) => onChange(recovery ? e.target.value : e.target.value.replace(/[^\d ]/g, ''))} />
    </label>
  );
}

/** Après le mot de passe (ou Google), sur un appareil qui n'est pas de confiance. */
export function MfaLoginForm({ onDone, notify, onExpired }) {
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await mfaApi.verify(code.replace(/\s/g, recovery ? '' : ''), remember);
      notify('Vous êtes connecté.');
      onDone(r.user);
    } catch (err) {
      setError(err.message);
      if (err.data?.code === 'mfa_expired') setTimeout(() => onExpired?.(), 1800);
    } finally { setBusy(false); }
  }
  return (
    <form className="form mfaForm" onSubmit={submit}>
      <h2 className="formTitle">Vérification en deux étapes</h2>
      <p className="muted">
        {recovery ? 'Saisissez un de vos codes de récupération (chaque code ne sert qu’une fois).'
          : 'Ouvrez Google Authenticator sur votre téléphone et saisissez le code affiché pour E-MAN PROD.'}
      </p>
      {error && <p className="formError" role="alert">{error}</p>}
      <CodeField recovery={recovery} value={code} onChange={setCode} />
      <label className="checkLine">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>Faire confiance à cet appareil (ne plus demander le code ici pendant un mois). Décochez sur un ordinateur partagé.</span>
      </label>
      <button className="btn btnPrimary btnBlock" disabled={busy}>{busy ? 'Vérification…' : 'Valider'}</button>
      <button type="button" className="linkBtn" onClick={() => { setRecovery((r) => !r); setCode(''); setError(''); }}>
        {recovery ? 'Utiliser le code de Google Authenticator' : 'Téléphone perdu ? Utiliser un code de récupération'}
      </button>
    </form>
  );
}

/** Action sensible : code récent exigé (10 minutes). */
export function StepUpForm({ onDone }) {
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form className="form mfaForm" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError('');
      try { await mfaApi.confirm(code); onDone(true); } catch (err) { setError(err.message); } finally { setBusy(false); }
    }}>
      <h2 className="formTitle">Confirmez avec votre code</h2>
      <p className="muted">Cette action est sensible. Saisissez le code de Google Authenticator : il reste valable 10 minutes pour les actions suivantes.</p>
      {error && <p className="formError" role="alert">{error}</p>}
      <CodeField recovery={recovery} value={code} onChange={setCode} />
      <button className="btn btnPrimary btnBlock" disabled={busy}>{busy ? 'Vérification…' : 'Confirmer'}</button>
      <button type="button" className="linkBtn" onClick={() => { setRecovery((r) => !r); setCode(''); }}>{recovery ? 'Utiliser le code à 6 chiffres' : 'Utiliser un code de récupération'}</button>
    </form>
  );
}
