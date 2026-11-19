// Paramètres (administrateurs) : coordonnées, WhatsApp, réseaux sociaux, informations légales,
// documents, e-mails (modèles, essai, journal) et notifications. Annonces aux clients.
import React, { useState } from 'react';
import { Send, Eye, Megaphone, CircleCheck, TriangleAlert } from 'lucide-react';
import { useCatalog } from '../../lib/catalog.jsx';
import { space, fetchCatalog, formatDate } from '../../lib/api.js';
import { WHATSAPP_PURPOSES, BUSINESS } from '../../config.js';
import { useLoad, Loading, ErrorBox, SectionHead, EmptyState, useConfirm } from './ui.jsx';
import { SettingForm, BusinessForm } from './team.jsx';

const TABS = [
  ['coordonnees', 'Coordonnées'], ['whatsapp', 'WhatsApp'], ['reseaux', 'Réseaux sociaux'], ['legal', 'Informations légales'],
  ['documents', 'Devis et factures'], ['emails', 'E-mails'], ['notifications', 'Notifications'], ['connexion', 'Connexion Google'],
];

export function SettingsAdmin({ notify, params = {}, go }) {
  const pub = useCatalog();
  const tab = TABS.some(([k]) => k === params.onglet) ? params.onglet : 'coordonnees';
  const [{ data, error, loading }, reload] = useLoad(() => fetchCatalog({ all: true }), []);
  const save = async (key, value) => {
    try {
      await space.saveSetting(key, value);
      notify('Paramètres enregistrés.');
      reload();
      pub.reload();
      return true;
    } catch (e) {
      notify(e.message, 'error');
      return false;
    }
  };
  const c = data?.content || {};
  return (
    <>
      <SectionHead title="Paramètres" lead="Coordonnées, numéros WhatsApp, mentions légales, documents, e-mails et connexion Google. Les changements s’appliquent au site et aux PDF dès l’enregistrement." />
      <div className="tabBar" role="tablist" aria-label="Rubriques des paramètres">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => go('parametres', { onglet: k })}>{label}</button>
        ))}
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <div role="tabpanel" key={tab}>
          {tab === 'coordonnees' && <BusinessForm value={c.business || {}} onSave={(v) => save('business', v)} />}
          {tab === 'whatsapp' && <WhatsappForm value={c.whatsapp || {}} onSave={(v) => save('whatsapp', v)} />}
          {tab === 'reseaux' && (
            <SettingForm title="Réseaux sociaux" value={c.socials || {}} onSave={(v) => save('socials', v)} fields={[
              ['facebook', 'Facebook (https://facebook.com/…)', 'input', 300], ['instagram', 'Instagram', 'input', 300], ['tiktok', 'TikTok', 'input', 300],
              ['linkedin', 'LinkedIn', 'input', 300], ['youtube', 'YouTube', 'input', 300], ['x', 'X (Twitter)', 'input', 300],
            ]} />
          )}
          {tab === 'legal' && (
            <>
              <SettingForm title="Informations légales" value={c.legal || {}} onSave={(v) => save('legal', v)} fields={[
                ['legalName', 'Raison sociale', 'input', 160], ['legalForm', 'Forme juridique', 'input', 80], ['capital', 'Capital social', 'input', 80],
                ['rccm', 'RCCM', 'input', 80], ['nif', 'NIF', 'input', 80], ['headOffice', 'Siège social', 'input', 200],
                ['director', 'Directeur de la publication', 'input', 120], ['host', 'Hébergeur', 'input', 300],
              ]} />
              <p className="muted">Ces informations apparaissent dans les mentions légales et en pied de page des devis, factures, reçus et attestations. Un champ vide n’est pas affiché.</p>
            </>
          )}
          {tab === 'documents' && <DocumentsForm value={c.documents || {}} onSave={(v) => save('documents', v)} />}
          {tab === 'emails' && <EmailsAdmin notify={notify} overrides={c.email_templates || {}} onSave={(v) => save('email_templates', v)} />}
          {tab === 'connexion' && <GoogleStatus notify={notify} />}
          {tab === 'notifications' && <NotificationsForm value={c.notifications || {}} business={c.business || {}} onSave={(v) => save('notifications', v)} />}
        </div>
      )}
    </>
  );
}

function WhatsappForm({ value, onSave }) {
  const [f, setF] = useState(() => Object.fromEntries(Object.keys(WHATSAPP_PURPOSES).map((k) => [k, { number: value[k]?.number || '', message: value[k]?.message || '' }])));
  const set = (k, field, v) => setF((x) => ({ ...x, [k]: { ...x[k], [field]: v } }));
  return (
    <form className="spaceBlock settingForm" onSubmit={(e) => {
      e.preventDefault();
      onSave(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, { number: v.number.trim() || null, message: v.message.trim() }])));
    }}>
      <h2 className="subTitle">Boutons WhatsApp</h2>
      <p className="muted">Laissez un numéro vide pour utiliser le numéro principal (+{BUSINESS.whatsapp}). Le message est proposé au client, qui peut le modifier avant l’envoi.</p>
      {Object.entries(WHATSAPP_PURPOSES).map(([k, p]) => (
        <fieldset key={k} className="settingGroup">
          <legend>{p.label}</legend>
          <div className="fieldRow">
            <label className="field"><span className="fieldLabel">Numéro WhatsApp</span><input type="tel" value={f[k].number} placeholder="Numéro principal" onChange={(e) => set(k, 'number', e.target.value)} /></label>
            <label className="field grow"><span className="fieldLabel">Message prérempli</span><input maxLength={300} value={f[k].message} placeholder={p.message} onChange={(e) => set(k, 'message', e.target.value)} /></label>
          </div>
        </fieldset>
      ))}
      <button className="btn btnPrimary btnSmall">Enregistrer</button>
    </form>
  );
}

function DocumentsForm({ value, onSave }) {
  const [f, setF] = useState({
    quote_validity_days: value.quote_validity_days ?? 30, quote_conditions: value.quote_conditions || '', invoice_conditions: value.invoice_conditions || '',
    payment_instructions: value.payment_instructions || '', signature_label: value.signature_label || 'Bon pour accord',
  });
  const area = (k, label, help, max) => (
    <label className="field"><span className="fieldLabel">{label}</span>
      <textarea rows={3} maxLength={max} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      {help && <small className="muted">{help}</small>}
    </label>
  );
  return (
    <form className="spaceBlock settingForm" onSubmit={(e) => { e.preventDefault(); onSave({ ...f, quote_validity_days: Number(f.quote_validity_days) }); }}>
      <h2 className="subTitle">Devis, factures et reçus</h2>
      <div className="fieldRow">
        <label className="field"><span className="fieldLabel">Validité des devis (jours)</span>
          <input type="number" min={1} max={365} required value={f.quote_validity_days} onChange={(e) => setF({ ...f, quote_validity_days: e.target.value })} /></label>
        <label className="field"><span className="fieldLabel">Mention de la zone de signature</span>
          <input maxLength={60} value={f.signature_label} onChange={(e) => setF({ ...f, signature_label: e.target.value })} /></label>
      </div>
      {area('quote_conditions', 'Conditions imprimées sur les devis', 'Par exemple : acompte demandé à la commande, délais, livraison. Rien n’est imprimé si le champ est vide.', 2000)}
      {area('invoice_conditions', 'Conditions imprimées sur les factures', null, 2000)}
      {area('payment_instructions', 'Moyens de paiement acceptés', 'Numéros Mobile Money, coordonnées bancaires… tels que vous souhaitez les communiquer.', 1000)}
      <button className="btn btnPrimary btnSmall">Enregistrer</button>
    </form>
  );
}

const CLIENT_EVENTS = {
  quote_received: 'Demande de devis reçue', quote_sent: 'Devis disponible', quote_decision: 'Devis accepté ou refusé',
  order_confirmed: 'Commande confirmée', order_update: 'Changement de statut d’une commande', order_ready: 'Commande prête',
  invoice_issued: 'Facture émise', enrollment_confirmed: 'Inscription à une formation confirmée', certificate_issued: 'Attestation disponible',
  message_new: 'Réponse de l’équipe', announcement: 'Information importante (si demandé à la publication)',
};
const TEAM_EVENTS = { client_new: 'Nouveau client inscrit', quote_new: 'Demande de devis', order_new: 'Commande créée', enrollment_new: 'Inscription à une formation', message_new: 'Nouveau message d’un client' };

function NotificationsForm({ value, business, onSave }) {
  const [client, setClient] = useState(() => Object.fromEntries(Object.keys(CLIENT_EVENTS).map((k) => [k, value.client_email?.[k] !== false])));
  const [team, setTeam] = useState(() => Object.fromEntries(Object.keys(TEAM_EVENTS).map((k) => [k, value.team_email?.[k] ?? k !== 'message_new'])));
  const [to, setTo] = useState(value.team_email_to || '');
  return (
    <form className="spaceBlock settingForm" onSubmit={(e) => { e.preventDefault(); onSave({ client_email: client, team_email: team, team_email_to: to.trim() || null }); }}>
      <h2 className="subTitle">Notifications</h2>
      <p className="muted">Les notifications s’affichent toujours dans les espaces. Ces réglages décident seulement des e-mails, envoyés uniquement si un fournisseur d’e-mails est configuré.</p>
      <fieldset className="settingGroup"><legend>E-mails aux clients</legend>
        <ul className="toggleList">{Object.entries(CLIENT_EVENTS).map(([k, label]) => (
          <li key={k}><label className="check"><input type="checkbox" checked={client[k]} onChange={(e) => setClient({ ...client, [k]: e.target.checked })} /> <span>{label}</span></label></li>
        ))}</ul>
        <small className="muted">Chaque client peut aussi couper certains e-mails depuis son profil.</small>
      </fieldset>
      <fieldset className="settingGroup"><legend>Alertes e-mail à l’équipe</legend>
        <ul className="toggleList">{Object.entries(TEAM_EVENTS).map(([k, label]) => (
          <li key={k}><label className="check"><input type="checkbox" checked={team[k]} onChange={(e) => setTeam({ ...team, [k]: e.target.checked })} /> <span>{label}</span></label></li>
        ))}</ul>
        <label className="field"><span className="fieldLabel">Adresse qui reçoit les alertes</span>
          <input type="email" value={to} placeholder={business.email || 'emanprod3@gmail.com'} onChange={(e) => setTo(e.target.value)} />
          <small className="muted">Vide : l’adresse de l’entreprise ({business.email || 'emanprod3@gmail.com'}).</small></label>
      </fieldset>
      <button className="btn btnPrimary btnSmall">Enregistrer</button>
    </form>
  );
}

/**
 * Connexion Google : état lu sur le serveur. Les identifiants restent dans les
 * variables d'environnement (jamais saisis ni affichés dans le navigateur).
 */
function GoogleStatus({ notify }) {
  const [{ data, error, loading }, reload] = useLoad(() => space.authStatus(), []);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const g = data.google;
  const copy = async (v) => {
    try { await navigator.clipboard.writeText(v); notify('Copié.'); } catch { notify('Copie impossible : sélectionnez le texte à la main.', 'error'); }
  };
  return (
    <section className={`spaceBlock mailStatus ${g.configured ? 'ok' : 'warn'}`} aria-labelledby="google-status">
      <h2 className="subTitle" id="google-status">{g.configured ? <><CircleCheck size={18} aria-hidden="true" /> Connexion Google active</> : <><TriangleAlert size={18} aria-hidden="true" /> Connexion Google pas encore activée</>}</h2>
      <p className="muted">{g.configured
        ? 'Les boutons « Se connecter avec Google » et « S’inscrire avec Google » fonctionnent.'
        : 'Les boutons Google sont affichés, mais grisés avec la mention « bientôt disponible ». Les visiteurs se connectent avec leur e-mail en attendant.'}</p>
      <dl className="kv">
        <dt>Identifiant client</dt><dd>{g.client_id || 'manquant (GOOGLE_CLIENT_ID)'}</dd>
        <dt>Code secret</dt><dd>{g.secret ? 'renseigné' : 'manquant (GOOGLE_CLIENT_SECRET)'}</dd>
        <dt>Comptes reliés à Google</dt><dd>{g.linked_accounts}</dd>
      </dl>
      <h3 className="subTitle">À déclarer dans Google Cloud</h3>
      <p className="muted">Console Google Cloud → API et services → Identifiants → votre « ID client OAuth » (type Application Web).</p>
      <dl className="kv">
        <dt>Origine JavaScript autorisée</dt><dd><code>{g.origin}</code> <button type="button" className="linkBtn" onClick={() => copy(g.origin)}>Copier</button></dd>
        <dt>URI de redirection autorisée</dt><dd><code>{g.redirect_uri}</code> <button type="button" className="linkBtn" onClick={() => copy(g.redirect_uri)}>Copier</button></dd>
      </dl>
      {!g.configured && <p className="muted">Ensuite, ajoutez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans les variables d’environnement Vercel, puis redéployez. Le guide pas à pas est dans docs/CONFIGURATION.md.</p>}
    </section>
  );
}

const STATUS_LABEL = { envoye: ['Accepté par le fournisseur', 'done'], echec: ['Échec', 'off'], non_configure: ['Non envoyé : fournisseur non configuré', 'new'], desactive: ['Non envoyé : désactivé', 'new'] };

function EmailsAdmin({ notify, overrides, onSave }) {
  const [{ data, error, loading }, reload] = useLoad(() => space.emailStatus(), []);
  const [key, setKey] = useState('quote_sent');
  const [draft, setDraft] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const tpl = data.templates.find((t) => t.key === key);
  const cur = { subject: draft[key]?.subject ?? overrides[key]?.subject ?? '', intro: draft[key]?.intro ?? overrides[key]?.intro ?? '' };
  const setCur = (field, v) => setDraft((d) => ({ ...d, [key]: { ...cur, [field]: v } }));
  const show = async () => {
    try { setPreview(await space.emailPreview(key, cur.subject, cur.intro)); } catch (e) { notify(e.message, 'error'); }
  };
  const saveTpl = async () => {
    const next = { ...overrides, [key]: { subject: cur.subject.trim(), intro: cur.intro.trim() } };
    if (await onSave(next)) setDraft((d) => ({ ...d, [key]: undefined }));
  };
  const test = async () => {
    setBusy(true);
    try {
      const r = await space.emailTest(key);
      if (r.status === 'envoye') notify(`E-mail d’essai accepté par le fournisseur pour ${r.to} (identifiant ${r.id}). Vérifiez la boîte de réception et les indésirables.`);
      else if (r.status === 'non_configure') notify('Aucun e-mail envoyé : le fournisseur n’est pas configuré (voir ci-dessus).', 'error');
      else notify(`Échec de l’envoi : ${r.error || 'erreur inconnue'}`, 'error');
      reload();
    } catch (e) { notify(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <section className={`spaceBlock mailStatus ${data.configured ? 'ok' : 'warn'}`} aria-labelledby="mail-status">
        <h2 className="subTitle" id="mail-status">{data.configured ? <><CircleCheck size={18} aria-hidden="true" /> Envoi d’e-mails configuré</> : <><TriangleAlert size={18} aria-hidden="true" /> Envoi d’e-mails non configuré</>}</h2>
        <dl className="kv">
          <dt>Fournisseur</dt><dd>{data.provider || 'aucun'}{data.provider && !data.key ? ' (clé manquante)' : ''}</dd>
          <dt>Adresse d’expédition</dt><dd>{data.from || 'non définie (MAIL_FROM)'}</dd>
          <dt>Adresse de réponse</dt><dd>{data.reply_to}</dd>
        </dl>
        {!data.configured && <p className="muted">Les notifications s’affichent dans les espaces, mais aucun e-mail ne part. Pour les activer, renseignez MAIL_PROVIDER, MAIL_API_KEY et MAIL_FROM dans Vercel (voir le guide d’installation), puis redéployez.</p>}
        <p className="muted">30 derniers jours : {Object.entries(data.last_30_days).map(([k, n]) => `${STATUS_LABEL[k]?.[0] || k} : ${n}`).join(' · ') || 'aucun e-mail'}.</p>
      </section>

      <section className="spaceBlock settingForm" aria-labelledby="tpl-title">
        <h2 className="subTitle" id="tpl-title">Modèles d’e-mails</h2>
        <label className="field"><span className="fieldLabel">Modèle</span>
          <select value={key} onChange={(e) => { setKey(e.target.value); setPreview(null); }}>
            {data.templates.map((t) => <option key={t.key} value={t.key}>{t.label}{overrides[t.key]?.subject || overrides[t.key]?.intro ? ' (personnalisé)' : ''}</option>)}
          </select></label>
        <label className="field"><span className="fieldLabel">Objet</span>
          <input maxLength={150} value={cur.subject} placeholder={tpl.subject} onChange={(e) => setCur('subject', e.target.value)} /></label>
        <label className="field"><span className="fieldLabel">Paragraphe d’introduction</span>
          <textarea rows={4} maxLength={1500} value={cur.intro} placeholder={tpl.intro} onChange={(e) => setCur('intro', e.target.value)} />
          <small className="muted">Vide : texte par défaut. Variables disponibles : {tpl.vars.map((v) => `{${v}}`).join(', ')}. Les détails (numéro, montant…) et le bouton sont ajoutés automatiquement.</small></label>
        <div className="formActions">
          <button type="button" className="btn btnGhost btnSmall" onClick={show}><Eye size={15} aria-hidden="true" /> Aperçu</button>
          <button type="button" className="btn btnGhost btnSmall" disabled={busy} aria-busy={busy} onClick={test}><Send size={15} aria-hidden="true" /> M’envoyer un essai</button>
          <button type="button" className="btn btnPrimary btnSmall" onClick={saveTpl}>Enregistrer le modèle</button>
        </div>
        {preview && (
          <div className="mailPreview">
            <p><strong>Objet :</strong> {preview.subject}</p>
            <iframe title="Aperçu de l’e-mail" sandbox="" srcDoc={preview.html} />
          </div>
        )}
      </section>

      <section className="spaceBlock" aria-labelledby="log-title">
        <h2 className="subTitle" id="log-title">Derniers e-mails</h2>
        {!data.log.length ? <EmptyState title="Aucun e-mail pour le moment" text="Chaque tentative d’envoi apparaîtra ici, avec la réponse du fournisseur." /> : (
          <div className="tableScroll"><table className="table compact">
            <thead><tr><th>Date</th><th>Destinataire</th><th>Objet</th><th>Résultat</th></tr></thead>
            <tbody>{data.log.map((l) => {
              const [label, tone] = STATUS_LABEL[l.status] || [l.status, 'new'];
              return <tr key={l.id}><td>{formatDate(l.created_at)}</td><td>{l.to_email}</td><td>{l.subject}</td><td><span className={`tag ${tone}`}>{label}</span>{l.error && <small className="muted"> {l.error}</small>}</td></tr>;
            })}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}

/** Annonces : « information importante » publiée dans l'espace de chaque client, e-mail en option. */
export function AnnouncementsAdmin({ notify }) {
  const confirm = useConfirm();
  const [{ data, error, loading }, reload] = useLoad(() => space.announcements(), []);
  const blank = { title: '', body: '', link: '', audience: 'clients', send_email: false };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const ok = await confirm({
      title: 'Publier cette information ?',
      text: `Elle apparaîtra dans l’espace de ${f.audience === 'clients' ? 'tous les clients' : 'tous les comptes'}${f.send_email ? ' et partira par e-mail (selon leurs préférences)' : ''}. Une annonce publiée ne peut pas être retirée des notifications déjà reçues.`,
      confirm: 'Publier',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await space.announce({ ...f, link: f.link.trim() || null });
      notify(`Publiée pour ${r.recipients} personne(s)${r.email_requested ? ` — ${r.emailed} e-mail(s) accepté(s) par le fournisseur` : ''}.`);
      setF(blank);
      reload();
    } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <SectionHead title="Annonces" lead="Publiez une information importante (fermeture exceptionnelle, nouvelle session, changement d’horaires) dans l’espace de vos clients." />
      <form className="spaceBlock settingForm" onSubmit={submit}>
        <h2 className="subTitle"><Megaphone size={18} aria-hidden="true" /> Nouvelle annonce</h2>
        <label className="field"><span className="fieldLabel">Titre</span><input required minLength={3} maxLength={140} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="field"><span className="fieldLabel">Texte</span><textarea required minLength={10} maxLength={4000} rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
        <div className="fieldRow">
          <label className="field"><span className="fieldLabel">Lien (facultatif)</span><input value={f.link} placeholder="/formations ou https://…" onChange={(e) => setF({ ...f, link: e.target.value })} /></label>
          <label className="field"><span className="fieldLabel">Destinataires</span>
            <select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}><option value="clients">Tous les clients</option><option value="tous">Tous les comptes (clients et équipe)</option></select></label>
        </div>
        <label className="check"><input type="checkbox" checked={f.send_email} onChange={(e) => setF({ ...f, send_email: e.target.checked })} /> <span>Envoyer aussi par e-mail</span></label>
        <button className="btn btnPrimary btnSmall" disabled={busy} aria-busy={busy}>{busy ? 'Publication…' : 'Publier'}</button>
      </form>
      <section className="spaceBlock">
        <h2 className="subTitle">Annonces publiées</h2>
        {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data.announcements.length ? (
          <EmptyState title="Aucune annonce publiée" text="Les annonces apparaissent dans l’accueil et les notifications de chaque client." />
        ) : (
          <table className="table">
            <thead><tr><th>Date</th><th>Titre</th><th>Destinataires</th><th>E-mails</th></tr></thead>
            <tbody>{data.announcements.map((a) => (
              <tr key={a.id}><td>{formatDate(a.published_at)}</td><td><strong>{a.title}</strong><br /><small className="muted">{a.author}</small></td>
                <td>{a.recipients}</td><td>{a.send_email ? `${a.emailed} accepté(s)` : 'Non demandé'}</td></tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </>
  );
}
