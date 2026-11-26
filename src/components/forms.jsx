import React, { useState } from 'react';
import { MessageCircle, Check } from 'lucide-react';
import { whatsappLink } from '../config.js';
import { useCatalog } from '../lib/catalog.jsx';
import { formatDay } from '../lib/api.js';
import { submitOrder, submitTraining, auth, DEMO } from '../lib/api.js';
import { Link } from '../lib/router.jsx';
import { PasswordInput } from './PasswordInput.jsx';

const PHONE_PATTERN = '[+0-9 .\\-]{8,20}';

function useForm(initial) {
  const [values, setValues] = useState(initial);
  const set = (k) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setValues((v) => ({ ...v, [k]: value }));
  };
  return [values, set, setValues];
}

function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="fieldLabel">{label}</span>
      {children}
      {hint && <span className="fieldHint">{hint}</span>}
    </label>
  );
}

/** Champ piège invisible : les personnes ne le voient pas, les robots le remplissent. */
function Honeypot({ value, onChange }) {
  return (
    <div className="hpField" aria-hidden="true">
      <label>Site web (laisser vide)<input type="text" name="website" tabIndex={-1} autoComplete="off" value={value} onChange={onChange} /></label>
    </div>
  );
}

function Consent({ checked, onChange, onNavigate }) {
  return (
    <label className="consent">
      <input type="checkbox" required checked={checked} onChange={onChange} />
      <span>
        J’accepte qu’E-MAN PROD utilise ces informations pour répondre à ma demande.{' '}
        <Link to="/confidentialite" onClick={onNavigate}>Confidentialité</Link>
      </span>
    </label>
  );
}

const ErrorLine = ({ error }) => (error ? <p className="formError" role="alert">{error}</p> : null);

function Submit({ busy, children }) {
  return (
    <button className="btn btnPrimary btnBlock" disabled={busy} aria-busy={busy}>
      {busy ? 'Envoi en cours…' : children}
    </button>
  );
}

function Confirmation({ title, children, waText, purpose = 'quote', onClose, onAgain }) {
  return (
    <div className="confirm" role="status">
      <span className="confirmStamp" aria-hidden="true"><Check size={30} strokeWidth={2.5} /></span>
      <h2 className="formTitle">{title}</h2>
      {children}
      <a className="btn btnWhatsapp btnBlock" href={whatsappLink(waText, purpose)} target="_blank" rel="noreferrer">
        <MessageCircle size={18} aria-hidden="true" /> Envoyer aussi sur WhatsApp
      </a>
      <div className="confirmLinks">
        {onAgain && <button type="button" className="linkBtn" onClick={onAgain}>Faire une autre demande</button>}
        {onClose && <button type="button" className="linkBtn" onClick={onClose}>Fermer</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demande de devis
// ---------------------------------------------------------------------------
export function QuoteForm({ initialService = '', onClose, title = 'Demander un devis', intro }) {
  const cat = useCatalog();
  const prestationOptions = cat.prestations.map((p) => p.title);
  // Une prestation passée en paramètre mais absente de la liste reste sélectionnable.
  if (initialService && initialService !== 'Autre demande' && !prestationOptions.includes(initialService)) prestationOptions.unshift(initialService);
  const blank = { name: '', phone: '', email: '', service: initialService, quantity: '', details: '', consent: false, website: '' };
  const [f, set, setF] = useForm(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const reference = await submitOrder(f);
      setDone({ reference, name: f.name, service: f.service });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Confirmation
        title="Demande envoyée"
        onClose={onClose}
        onAgain={() => { setF(blank); setDone(null); }}
        waText={`Bonjour E-MAN PROD, je viens d’envoyer la demande ${done.reference} (${done.service}) au nom de ${done.name}.`}
      >
        <p className="confirmRef">Référence <strong>{done.reference}</strong></p>
        <p className="muted">Nous vous rappelons pour le prix et le délai. Vous avez des fichiers ou une photo de ce que vous voulez ? Envoyez-les sur WhatsApp avec cette référence.</p>
      </Confirmation>
    );
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <h2 className="formTitle">{title}</h2>
      {intro && <p className="muted formIntro">{intro}</p>}
      <Field label="Ce dont vous avez besoin">
        <select required value={f.service} onChange={set('service')}>
          <option value="">Choisir une prestation</option>
          {prestationOptions.map((t) => <option key={t}>{t}</option>)}
          <option>Autre demande</option>
        </select>
      </Field>
      <Field label="Description" hint="Format, support, couleurs, date souhaitée.">
        <textarea required minLength={5} rows={4} value={f.details} onChange={set('details')} placeholder="Ex. une bâche de 3 × 2 m pour ma boutique, à récupérer samedi" />
      </Field>
      <Field label="Quantité (facultatif)">
        <input value={f.quantity} onChange={set('quantity')} placeholder="Ex. 500 flyers A5" />
      </Field>
      <div className="fieldRow">
        <Field label="Votre nom">
          <input required minLength={2} autoComplete="name" value={f.name} onChange={set('name')} />
        </Field>
        <Field label="Téléphone ou WhatsApp">
          <input required type="tel" inputMode="tel" autoComplete="tel" pattern={PHONE_PATTERN} title="8 chiffres minimum" value={f.phone} onChange={set('phone')} placeholder="90 12 34 56" />
        </Field>
      </div>
      <Field label="E-mail (facultatif)" hint="Pour retrouver cette demande dans votre espace client.">
        <input type="email" autoComplete="email" value={f.email} onChange={set('email')} />
      </Field>
      <Honeypot value={f.website} onChange={set('website')} />
      <Consent checked={f.consent} onChange={set('consent')} onNavigate={onClose} />
      <ErrorLine error={error} />
      <Submit busy={busy}>Envoyer la demande</Submit>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Inscription à une formation (fiche formation) : choix de la session
// ---------------------------------------------------------------------------
export function TrainingForm({ course, onClose }) {
  const open = (course.sessions || []).filter((s) => s.status === 'ouverte' && s.seats_left !== 0);
  const blank = { name: '', phone: '', email: '', session_id: open[0]?.id || '', message: '', consent: false, website: '' };
  const [f, set, setF] = useForm(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await submitTraining({ ...f, course: course.title, course_slug: course.slug, session_id: f.session_id || null });
      const s = open.find((x) => x.id === f.session_id);
      setDone({ name: f.name, session: s ? formatDay(s.starts_on) : null });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Confirmation
        title="Demande d’inscription envoyée"
        onClose={onClose}
        onAgain={() => { setF(blank); setDone(null); }}
        purpose="training"
        waText={`Bonjour E-MAN PROD, je viens de demander une inscription à la formation « ${course.title} »${done.session ? ` (session du ${done.session})` : ''} au nom de ${done.name}.`}
      >
        <p className="muted">{done.session ? `Session du ${done.session} : nous vous rappelons pour confirmer votre place et les modalités.` : 'Nous vous prévenons dès que les prochaines dates sont fixées.'}</p>
      </Confirmation>
    );
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <h2 className="formTitle">S’inscrire</h2>
      <p className="muted formIntro">Formation « {course.title} ». Nous vous rappelons pour confirmer votre place et les modalités.</p>
      <Field label="Session">
        <select value={f.session_id} onChange={set('session_id')}>
          {open.map((s) => (
            <option key={s.id} value={s.id}>
              {formatDay(s.starts_on)}{s.site ? ` · ${s.site}` : ''}{s.seats_left ? ` · ${s.seats_left} place${s.seats_left > 1 ? 's' : ''}` : ''}
            </option>
          ))}
          <option value="">{open.length ? 'Être informé d’une autre session' : 'Être informé de la prochaine session'}</option>
        </select>
      </Field>
      <div className="fieldRow">
        <Field label="Votre nom">
          <input required minLength={2} autoComplete="name" value={f.name} onChange={set('name')} />
        </Field>
        <Field label="Téléphone ou WhatsApp">
          <input required type="tel" inputMode="tel" autoComplete="tel" pattern={PHONE_PATTERN} title="8 chiffres minimum" value={f.phone} onChange={set('phone')} placeholder="90 12 34 56" />
        </Field>
      </div>
      <Field label="E-mail (facultatif)">
        <input type="email" autoComplete="email" value={f.email} onChange={set('email')} />
      </Field>
      <Field label="Message (facultatif)">
        <textarea rows={3} value={f.message} onChange={set('message')} placeholder="Votre niveau, vos disponibilités" />
      </Field>
      <Honeypot value={f.website} onChange={set('website')} />
      <Consent checked={f.consent} onChange={set('consent')} onNavigate={onClose} />
      <ErrorLine error={error} />
      <Submit busy={busy}>Envoyer ma demande d’inscription</Submit>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Connexion, création de compte, mot de passe oublié
// ---------------------------------------------------------------------------
/** Logo Google officiel (quatre couleurs), dessiné en SVG. */
const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
    <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.7l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
  </svg>
);

/**
 * Bouton Google, toujours présent en connexion et en inscription :
 * - configuré : simple lien, la redirection est préparée par le serveur (state, nonce, PKCE) ;
 * - pas encore configuré : grisé, avec une mention claire (jamais un bouton qui échoue) ;
 * - démonstration : ouvre le tableau de bord fictif, comme le formulaire.
 */
function GoogleButton({ mode, available, onDemo }) {
  const text = mode === 'signup' ? 'S’inscrire avec Google' : 'Se connecter avec Google';
  if (DEMO) return <button type="button" className="btn btnGoogle btnBlock" onClick={onDemo}><GoogleMark /> {text}</button>;
  if (available) return <a className="btn btnGoogle btnBlock" href="/api/auth/google?return=%2Fespace"><GoogleMark /> {text}</a>;
  return (
    <>
      <button type="button" className="btn btnGoogle btnBlock" disabled aria-describedby="google-soon"><GoogleMark /> {text}</button>
      <p id="google-soon" className="hint googleSoon">Connexion Google bientôt disponible. En attendant, utilisez votre e‑mail ci-dessous.</p>
    </>
  );
}

export function AuthForm({ onDone, notify, startDemo, google = false, initialMode = 'login', serverIssue = '', onMfa, onClose }) {
  const [mode, setMode] = useState(initialMode === 'signup' ? 'signup' : 'login');
  // Inscription : Google d'abord (un clic, adresse déjà vérifiée) ; l'e-mail reste possible.
  const [emailSignup, setEmailSignup] = useState(!google);
  const [f, set] = useForm({ first_name: '', last_name: '', phone: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (DEMO) {
      if (mode === 'forgot') setInfo('Mode démonstration : aucun e-mail n’est envoyé.');
      else startDemo();
      return;
    }
    setBusy(true);
    try {
      if (mode === 'forgot') {
        const r = await auth.forgot({ email: f.email });
        setInfo(r.mail
          ? 'Si un compte existe avec cette adresse, vous allez recevoir un lien pour choisir un nouveau mot de passe.'
          : 'La réinitialisation par e-mail n’est pas encore activée. Écrivez-nous sur WhatsApp pour récupérer votre compte.');
      } else if (mode === 'signup') {
        const r = await auth.signup({ first_name: f.first_name, last_name: f.last_name, phone: f.phone, email: f.email, password: f.password });
        if (r.pending) {
          // Même réponse que l'adresse soit nouvelle ou déjà inscrite : la suite se passe dans la boîte mail.
          setInfo(`Dernière étape : ouvrez l’e-mail envoyé à ${f.email} et cliquez sur le lien pour activer votre espace. Pensez à regarder dans les courriers indésirables.${r.verification === 'terminal' ? ' (Développement : le lien est affiché dans le terminal.)' : ''}`);
          return;
        }
        onDone(r.user);
        notify(r.verificationSent ? 'Compte créé. Confirmez votre adresse avec le lien reçu par e-mail.' : r.verification === 'terminal' ? 'Compte créé. (Développement : le lien de confirmation est affiché dans le terminal.)' : 'Compte créé.');
      } else {
        const r = await auth.login({ email: f.email, password: f.password });
        // Compte de l'équipe, appareil non reconnu : étape « code Google Authenticator ».
        if (r.mfa_required) { onMfa?.(); return; }
        onDone(r.user);
        notify('Vous êtes connecté.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const switchTo = (m) => { setMode(m); setError(''); setInfo(''); };
  const titles = { login: 'Se connecter', signup: 'Créer un compte', forgot: 'Mot de passe oublié' };
  return (
    <form className="form" onSubmit={onSubmit}>
      {mode !== 'forgot' && (
        <div className="authTabs" role="tablist" aria-label="Connexion ou inscription">
          <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => switchTo('login')}>Connexion</button>
          <button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => switchTo('signup')}>Inscription</button>
        </div>
      )}
      <h2 className="formTitle">{titles[mode]}</h2>
      {serverIssue && !DEMO && <p className="formError" role="alert">{serverIssue}</p>}
      {DEMO && <p className="formInfo">Mode démonstration : les comptes seront actifs une fois la base de données branchée. Chaque bouton ouvre un tableau de bord rempli de données fictives.</p>}
      {mode === 'signup' && <p className="muted formIntro">Suivez vos devis, commandes, factures et inscriptions aux formations. Utilisez l’adresse e-mail de vos demandes : elles apparaîtront dans votre espace.</p>}
      {mode !== 'forgot' && (
        <>
          <GoogleButton mode={mode} available={google} onDemo={startDemo} />
          {mode === 'signup' && google && <p className="hint googleSoon">Recommandé : en un clic, sans mot de passe à retenir.</p>}
          {mode === 'signup' && !emailSignup ? (
            <button type="button" className="btn btnGhost btnBlock" onClick={() => setEmailSignup(true)}>Créer un compte avec mon e-mail</button>
          ) : <p className="orLine"><span>ou avec votre e-mail</span></p>}
        </>
      )}
      {mode === 'signup' && (
        <p className="hint signupLegal">
          En créant un compte, vous acceptez nos <Link to="/conditions-generales" onClick={onClose}>conditions générales</Link> et
          notre <Link to="/confidentialite" onClick={onClose}>politique de confidentialité</Link>.
        </p>
      )}
      {mode === 'signup' && !emailSignup ? null : <>
      {mode === 'signup' && (
        <>
          <div className="fieldRow">
            <Field label="Prénom"><input required maxLength={60} autoComplete="given-name" value={f.first_name} onChange={set('first_name')} /></Field>
            <Field label="Nom"><input required maxLength={60} autoComplete="family-name" value={f.last_name} onChange={set('last_name')} /></Field>
          </div>
          <Field label="Téléphone (facultatif)"><input type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} /></Field>
        </>
      )}
      <Field label="Adresse e-mail"><input required type="email" autoComplete="email" value={f.email} onChange={set('email')} /></Field>
      {mode !== 'forgot' && (
        <Field label="Mot de passe" hint={mode === 'signup' ? '10 caractères minimum. Une courte phrase est plus sûre et plus facile à retenir.' : undefined}>
          <PasswordInput required minLength={mode === 'signup' ? 10 : 1} maxLength={128} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={f.password} onChange={set('password')} />
        </Field>
      )}
      <ErrorLine error={error} />
      {info && <p className="formInfo" role="status">{info}</p>}
      <Submit busy={busy}>{mode === 'login' ? 'Se connecter' : mode === 'signup' ? 'Créer mon compte' : 'Recevoir le lien'}</Submit>
      </>}
      <div className="authSwitch">
        {mode === 'login' && <button type="button" className="linkBtn" onClick={() => switchTo('forgot')}>Mot de passe oublié</button>}
        {mode === 'forgot' && <button type="button" className="linkBtn" onClick={() => switchTo('login')}>Retour à la connexion</button>}
      </div>
    </form>
  );
}

export function NewPasswordForm({ token, onDone, notify, onMfa }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await auth.reset({ token, password });
      if (r.mfa_required) { notify('Mot de passe enregistré. Confirmez avec Google Authenticator.'); onMfa?.(); return; }
      onDone(r.user);
      notify('Mot de passe enregistré. Vous êtes connecté.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form" onSubmit={onSubmit}>
      <h2 className="formTitle">Choisir un nouveau mot de passe</h2>
      <Field label="Nouveau mot de passe" hint="10 caractères minimum. Une courte phrase est plus sûre et plus facile à retenir.">
        <PasswordInput required minLength={10} maxLength={128} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <ErrorLine error={error} />
      <Submit busy={busy}>Enregistrer le mot de passe</Submit>
    </form>
  );
}
