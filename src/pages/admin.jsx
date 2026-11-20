// Écrans d'administration du contenu : formations (informations pratiques et
// sessions), réalisations, visibilité des prestations.
import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { fetchCatalog, manage, formatDay, uploadFile, space, fileUrl, TRAINING_STATUSES, updateRegistration } from '../lib/api.js';
import { useConfirm, Loading, EmptyState } from './space/ui.jsx';
import { SessionFollowUp } from './space/learning.jsx';
import { useCatalog } from '../lib/catalog.jsx';
import { Link } from '../lib/router.jsx';
import { FICHE_REFERENCE } from '../content/fiche-formations.js';

/** Catalogue complet (éléments masqués et sessions passées inclus). */
function useAdminCatalog() {
  const publicCatalog = useCatalog();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      setData(await fetchCatalog({ all: true }));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  // Après une modification : recharger la vue admin ET le contenu public.
  const refresh = useCallback(async () => { await reload(); publicCatalog.reload(); }, [reload, publicCatalog]);
  return { data, error, refresh };
}

function useAction(notify, refresh) {
  const [busy, setBusy] = useState(false);
  const run = async (action, payload, message) => {
    setBusy(true);
    try {
      await manage(action, payload);
      notify(message);
      await refresh();
      return true;
    } catch (e) {
      notify(e.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return [busy, run];
}

/** Bouton de suppression en deux temps (pas de boîte de dialogue du navigateur). */
function DeleteButton({ onConfirm, label = 'Supprimer' }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" className={'btn btnSmall ' + (armed ? 'btnDanger' : 'btnGhost')} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      <Trash2 size={15} aria-hidden="true" /> {armed ? 'Confirmer la suppression' : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Formations
// ---------------------------------------------------------------------------
export function CoursesAdmin({ notify }) {
  const { data, error, refresh } = useAdminCatalog();
  const [creating, setCreating] = useState(false);
  if (error) return <p className="formError" role="alert">{error}</p>;
  if (!data) return <Loading />;
  const archived = data.courses.filter((c) => c.archived_at);
  return (
    <div className="adminBlock">
      <p className="muted adminIntro">
        Tant qu’un champ est vide, la fiche affiche « À préciser » ou « Nous consulter » : rien n’est inventé. Une formation archivée quitte le site ; ses inscriptions restent consultables.
      </p>
      {creating ? <NewTrainingForm poles={data.poles} notify={notify} onDone={() => { setCreating(false); refresh(); }} onCancel={() => setCreating(false)} />
        : <button type="button" className="btn btnPrimary btnSmall" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> Nouvelle formation</button>}
      {data.poles.map((pole) => (
        <section key={pole.slug} className="adminGroup">
          <h2 className="subTitle">Pôle {pole.number} : {pole.title}</h2>
          <ul className="adminList">
            {data.courses.filter((c) => c.pole_slug === pole.slug && !c.archived_at).map((c) => (
              <CourseAdminRow key={c.slug} c={c} notify={notify} refresh={refresh} />
            ))}
          </ul>
        </section>
      ))}
      {archived.length > 0 && (
        <section className="adminGroup">
          <h2 className="subTitle">Formations archivées ({archived.length})</h2>
          <ul className="adminList">{archived.map((c) => <CourseAdminRow key={c.slug} c={c} notify={notify} refresh={refresh} />)}</ul>
        </section>
      )}
    </div>
  );
}

const slugify = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const lines = (t) => t.split('\n').map((x) => x.trim()).filter(Boolean);

function NewTrainingForm({ poles, notify, onDone, onCancel }) {
  // Valeurs de départ reprises de la fiche (frais d'inscription, niveau) : modifiables avant de créer.
  const [f, setF] = useState(() => ({
    title: '', category_slug: poles[0]?.slug || '', domain: '', summary: '', description: '', objectives: '', program: '', published: false,
    ...factsOf({ level: FICHE_REFERENCE.level, registration_fee_fcfa: FICHE_REFERENCE.registration_fee_fcfa }),
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  return (
    <form className="spaceBlock spaceForm" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        const { title, category_slug, domain, summary, description, published } = f;
        await manage('training.create', { title, category_slug, domain, summary, description, published, ...factsPayload(f), slug: slugify(f.title), objectives: lines(f.objectives), program: lines(f.program) });
        notify(`Formation « ${f.title} » créée${f.published ? ' et publiée' : ' (non publiée)'}.`);
        onDone();
      } catch (err) {
        notify(err.message, 'error');
      } finally {
        setBusy(false);
      }
    }}>
      <h2 className="subTitle">Nouvelle formation</h2>
      <div className="fieldRow">
        <label className="field"><span className="fieldLabel">Titre</span><input required minLength={2} maxLength={160} value={f.title} onChange={set('title')} /></label>
        <label className="field"><span className="fieldLabel">Pôle</span><select value={f.category_slug} onChange={set('category_slug')}>{poles.map((p) => <option key={p.slug} value={p.slug}>Pôle {p.number} : {p.title}</option>)}</select></label>
      </div>
      <label className="field"><span className="fieldLabel">Domaine</span><input required minLength={2} maxLength={120} value={f.domain} onChange={set('domain')} placeholder="ex. Bureautique" /></label>
      <label className="field"><span className="fieldLabel">Résumé</span><textarea required minLength={10} maxLength={400} rows={2} value={f.summary} onChange={set('summary')} /></label>
      <label className="field"><span className="fieldLabel">Description</span><textarea maxLength={4000} rows={3} value={f.description} onChange={set('description')} /></label>
      <div className="fieldRow">
        <label className="field"><span className="fieldLabel">Objectifs (un par ligne)</span><textarea rows={4} value={f.objectives} onChange={set('objectives')} /></label>
        <label className="field"><span className="fieldLabel">Programme (un module par ligne)</span><textarea rows={4} value={f.program} onChange={set('program')} /></label>
      </div>
      <TrainingFacts f={f} setF={setF} uid="new" />
      <label className="consent"><input type="checkbox" checked={f.published} onChange={set('published')} /><span>Publier sur le site tout de suite</span></label>
      <div className="formActions"><button className="btn btnPrimary btnSmall" disabled={busy}>{busy ? 'Création…' : 'Créer la formation'}</button><button type="button" className="btn btnGhost btnSmall" onClick={onCancel}>Annuler</button></div>
    </form>
  );
}

function TrainingTexts({ c, run, busy }) {
  const [f, setF] = useState({ title: c.title, domain: c.domain, summary: c.summary, description: c.description || '', objectives: (c.objectives || []).join('\n'), program: (c.program || []).join('\n') });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <details className="subDetails">
      <summary>Textes, objectifs et programme</summary>
      <form className="form adminForm" onSubmit={(e) => { e.preventDefault(); run('training.update', { slug: c.slug, ...f, objectives: lines(f.objectives), program: lines(f.program) }, 'Textes enregistrés.'); }}>
        <div className="fieldRow">
          <label className="field"><span className="fieldLabel">Titre</span><input required minLength={2} maxLength={160} value={f.title} onChange={set('title')} /></label>
          <label className="field"><span className="fieldLabel">Domaine</span><input required minLength={2} maxLength={120} value={f.domain} onChange={set('domain')} /></label>
        </div>
        <label className="field"><span className="fieldLabel">Résumé</span><textarea required minLength={10} maxLength={400} rows={2} value={f.summary} onChange={set('summary')} /></label>
        <label className="field"><span className="fieldLabel">Description</span><textarea maxLength={4000} rows={3} value={f.description} onChange={set('description')} /></label>
        <div className="fieldRow">
          <label className="field"><span className="fieldLabel">Objectifs (un par ligne)</span><textarea rows={5} value={f.objectives} onChange={set('objectives')} /></label>
          <label className="field"><span className="fieldLabel">Programme (un module par ligne)</span><textarea rows={5} value={f.program} onChange={set('program')} /></label>
        </div>
        <button className="btn btnPrimary btnSmall" disabled={busy}>Enregistrer les textes</button>
      </form>
    </details>
  );
}

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

/** Liste éditable : ajouter, modifier, supprimer des lignes (durées, frais, conditions). */
function RowsEditor({ legend, hint, rows, setRows, blank, render, addLabel, max, suggestions }) {
  const update = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="settingGroup rowsEditor">
      <legend>{legend}</legend>
      {hint && <small className="muted">{hint}</small>}
      {rows.length === 0 && <p className="muted rowsEmpty">Aucune ligne pour l’instant.</p>}
      <ul className="rowsList">
        {rows.map((r, i) => (
          <li key={i} className="rowsItem">
            {render(r, (patch) => update(i, patch), i)}
            <button type="button" className="iconBtn" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Supprimer la ligne ${i + 1} (${legend})`}><Trash2 size={16} aria-hidden="true" /></button>
          </li>
        ))}
      </ul>
      <div className="rowsAdd">
        <button type="button" className="btn btnGhost btnSmall" disabled={rows.length >= max} onClick={() => setRows([...rows, { ...blank }])}><Plus size={15} aria-hidden="true" /> {addLabel}</button>
        {suggestions?.filter((x) => !rows.some((r) => r.label === x)).map((x) => (
          <button key={x} type="button" className="chipBtn" disabled={rows.length >= max} onClick={() => setRows([...rows, { ...blank, label: x }])}>+ {x}</button>
        ))}
      </div>
    </fieldset>
  );
}

/** Durées, prix, frais et conditions d'admission d'une formation : tout est libre et modifiable. */
export function TrainingFacts({ f, setF, uid }) {
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <>
      <RowsEditor
        legend="Durées proposées" addLabel="Ajouter une durée" max={12} blank={{ label: '', price_fcfa: '', note: '' }}
        hint="Une ligne par formule. Le prix par durée est facultatif (sinon, le prix de la formation s’applique)."
        suggestions={FICHE_REFERENCE.duration_suggestions}
        rows={f.duration_options} setRows={(v) => setF((x) => ({ ...x, duration_options: v }))}
        render={(r, up, i) => (
          <>
            <label className="field"><span className="fieldLabel">Durée</span><input id={`${uid}-d${i}`} aria-label={`Durée ${i + 1}`} required maxLength={120} value={r.label} onChange={(e) => up({ label: e.target.value })} placeholder="ex. 6 mois + stage" /></label>
            <label className="field"><span className="fieldLabel">Prix pour cette durée (FCFA)</span><input aria-label={`Prix de la durée ${i + 1} (FCFA)`} type="number" min="0" step="500" inputMode="numeric" value={r.price_fcfa ?? ''} onChange={(e) => up({ price_fcfa: e.target.value })} placeholder="Facultatif" /></label>
            <label className="field"><span className="fieldLabel">Précision</span><input aria-label={`Précision de la durée ${i + 1}`} maxLength={160} value={r.note || ''} onChange={(e) => up({ note: e.target.value })} placeholder="ex. cours du soir" /></label>
          </>
        )}
      />
      <fieldset className="settingGroup">
        <legend>Prix et frais</legend>
        <div className="fieldRow three">
          <label className="field"><span className="fieldLabel">Frais d’inscription (FCFA)</span><input type="number" min="0" step="500" inputMode="numeric" value={f.registration_fee_fcfa} onChange={set('registration_fee_fcfa')} placeholder="Vide = non affiché" /></label>
          <label className="field"><span className="fieldLabel">Prix de la formation (FCFA)</span><input type="number" min="0" step="500" inputMode="numeric" value={f.price_fcfa} onChange={set('price_fcfa')} placeholder="Vide = « Nous consulter »" /></label>
          <label className="field"><span className="fieldLabel">Précision sur le prix</span><input maxLength={200} value={f.price_note} onChange={set('price_note')} placeholder="ex. par mois, matériel compris" /></label>
        </div>
        <label className="field"><span className="fieldLabel">Modalités de paiement</span><textarea rows={2} maxLength={600} value={f.payment_terms} onChange={set('payment_terms')} placeholder="ex. inscription à l’entrée, puis paiement mensuel ; Mobile Money accepté" /></label>
      </fieldset>
      <RowsEditor
        legend="Frais supplémentaires" addLabel="Ajouter des frais" max={12} blank={{ label: '', amount_fcfa: '' }}
        hint="ex. kit, tenue, attestation, stage. Laissez vide s’il n’y en a pas."
        rows={f.extra_fees} setRows={(v) => setF((x) => ({ ...x, extra_fees: v }))}
        render={(r, up, i) => (
          <>
            <label className="field"><span className="fieldLabel">Intitulé</span><input aria-label={`Frais supplémentaires ${i + 1} : intitulé`} required minLength={2} maxLength={120} value={r.label} onChange={(e) => up({ label: e.target.value })} placeholder="ex. Kit de formation" /></label>
            <label className="field"><span className="fieldLabel">Montant (FCFA)</span><input aria-label={`Frais supplémentaires ${i + 1} : montant (FCFA)`} type="number" required min="0" step="500" inputMode="numeric" value={r.amount_fcfa ?? ''} onChange={(e) => up({ amount_fcfa: e.target.value })} /></label>
          </>
        )}
      />
      <fieldset className="settingGroup">
        <legend>Admission</legend>
        <label className="field"><span className="fieldLabel">Niveau scolaire requis</span><input maxLength={120} value={f.level} onChange={set('level')} placeholder={`ex. ${FICHE_REFERENCE.level}`} /></label>
      </fieldset>
      <RowsEditor
        legend="Conditions d’admission" addLabel="Ajouter une condition" max={20} blank={{ label: '' }}
        hint="Une condition par ligne : pièces à fournir, âge, matériel, entretien…"
        rows={f.admission_requirements} setRows={(v) => setF((x) => ({ ...x, admission_requirements: v }))}
        render={(r, up, i) => (
          <label className="field"><span className="fieldLabel">Condition</span><input aria-label={`Condition d’admission ${i + 1}`} required minLength={2} maxLength={300} value={r.label} onChange={(e) => up({ label: e.target.value })} placeholder="ex. Savoir lire et écrire le français" /></label>
        )}
      />
    </>
  );
}

/** Valeurs du formulaire → données envoyées au serveur (montants en nombres, listes nettoyées). */
export function factsPayload(f) {
  return {
    level: f.level, price_fcfa: num(f.price_fcfa), price_note: f.price_note, payment_terms: f.payment_terms,
    registration_fee_fcfa: num(f.registration_fee_fcfa),
    duration_options: f.duration_options.filter((o) => o.label.trim()).map((o) => ({ label: o.label.trim(), price_fcfa: num(o.price_fcfa), note: o.note?.trim() || null })),
    extra_fees: f.extra_fees.filter((o) => o.label.trim()).map((o) => ({ label: o.label.trim(), amount_fcfa: num(o.amount_fcfa) })),
    admission_requirements: f.admission_requirements.map((r) => r.label.trim()).filter(Boolean),
  };
}
export const factsOf = (c = {}) => ({
  level: c.level || '', price_fcfa: c.price_fcfa ?? '', price_note: c.price_note || '', payment_terms: c.payment_terms || '',
  registration_fee_fcfa: c.registration_fee_fcfa ?? '',
  duration_options: (c.duration_options?.length ? c.duration_options : c.duration ? [{ label: c.duration }] : []).map((o) => ({ label: o.label || '', price_fcfa: o.price_fcfa ?? '', note: o.note || '' })),
  extra_fees: (c.extra_fees || []).map((o) => ({ label: o.label || '', amount_fcfa: o.amount_fcfa ?? '' })),
  admission_requirements: (c.admission_requirements?.length ? c.admission_requirements : c.prerequisites ? [c.prerequisites] : []).map((label) => ({ label })),
});

function CourseAdminRow({ c, notify, refresh }) {
  const [busy, run] = useAction(notify, refresh);
  const confirm = useConfirm();
  const [f, setF] = useState(() => ({ ...factsOf(c), certificate: c.certificate || '', published: c.published }));
  const [rules, setRules] = useState(() => ({ kind: c.certificate_rules?.kind || '', min_attendance: c.certificate_rules?.min_attendance ?? '', evaluation: Boolean(c.certificate_rules?.evaluation) }));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const upcoming = c.sessions.filter((s) => (s.ends_on || s.starts_on) >= new Date().toISOString().slice(0, 10));
  const priced = c.price_fcfa !== null || c.duration_options?.some((o) => o.price_fcfa != null);

  return (
    <li className="adminItem">
      <details>
        <summary>
          <span className="adminItemTitle">{c.title}</span>
          <span className="adminItemMeta">
            {c.archived_at ? <span className="tag off">Archivée</span> : !c.published && <span className="tag off">Masquée</span>}
            <span className={'tag ' + (priced ? 'done' : 'new')}>{priced ? 'Prix renseigné' : 'Prix à renseigner'}</span>
            <span className="tag work">{upcoming.length} session{upcoming.length > 1 ? 's' : ''} à venir</span>
          </span>
        </summary>
        <form
          className="form adminForm"
          onSubmit={(e) => {
            e.preventDefault();
            const certificate_rules = { kind: rules.kind || null, min_attendance: rules.min_attendance === '' ? null : Number(rules.min_attendance), evaluation: rules.evaluation };
            run('course.update', { slug: c.slug, ...factsPayload(f), certificate: f.certificate, published: f.published, certificate_rules }, `Formation « ${c.title} » enregistrée.`);
          }}
        >
          <TrainingFacts f={f} setF={setF} uid={`c-${c.slug}`} />
          <label className="field"><span className="fieldLabel">Document remis à l’issue</span><input value={f.certificate} onChange={set('certificate')} placeholder="ex. attestation de formation (si délivrée)" /></label>
          <p className="muted">Photo de la formation : <Link to="/espace?section=images">Images et bannières</Link>, rubrique Formations.</p>
          <fieldset className="settingGroup">
            <legend>Conditions de délivrance</legend>
            <div className="fieldRow three">
              <label className="field"><span className="fieldLabel">Document délivré</span>
                <select value={rules.kind} onChange={(e) => setRules({ ...rules, kind: e.target.value })}>
                  <option value="">Aucun</option><option value="attestation">Attestation de formation</option><option value="certificat">Certificat</option>
                </select></label>
              <label className="field"><span className="fieldLabel">Assiduité minimale (%)</span>
                <input type="number" min="0" max="100" inputMode="numeric" value={rules.min_attendance} disabled={!rules.kind} onChange={(e) => setRules({ ...rules, min_attendance: e.target.value })} placeholder="Pas d’exigence" /></label>
              <label className="consent"><input type="checkbox" checked={rules.evaluation} disabled={!rules.kind} onChange={(e) => setRules({ ...rules, evaluation: e.target.checked })} /><span>Évaluation réussie exigée</span></label>
            </div>
            <small className="muted">Le document n’est émis qu’une fois la formation terminée, ces conditions remplies, et après votre validation pour chaque apprenant.</small>
          </fieldset>
          {!c.archived_at && <label className="consent"><input type="checkbox" checked={f.published} onChange={set('published')} /><span>Formation visible sur le site</span></label>}
          <div className="mediaActions">
            <button className="btn btnPrimary btnSmall" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
            {!c.archived_at && <Link to={`/formations/${c.slug}`} className="btn btnGhost btnSmall">Voir la fiche</Link>}
            <button type="button" className="btn btnGhost btnSmall" disabled={busy} onClick={async () => {
              const archiving = !c.archived_at;
              if (await confirm({ title: archiving ? `Archiver « ${c.title} » ?` : `Désarchiver « ${c.title} » ?`, text: archiving ? 'Elle quitte le site et la liste courante. Ses sessions et inscriptions restent consultables.' : 'Elle revient dans la liste, non publiée : publiez-la ensuite si besoin.', confirm: archiving ? 'Archiver' : 'Désarchiver' })) {
                run('training.archive', { slug: c.slug, archived: archiving }, archiving ? 'Formation archivée.' : 'Formation désarchivée.');
              }
            }}>{c.archived_at ? 'Désarchiver' : 'Archiver'}</button>
          </div>
        </form>
        <TrainingTexts c={c} run={run} busy={busy} />
        <SessionsAdmin c={c} notify={notify} refresh={refresh} />
      </details>
    </li>
  );
}

const emptySession = { starts_on: '', ends_on: '', schedule: '', site: '', seats: '', status: 'ouverte' };

function SessionForm({ initial, onSubmit, busy, submitLabel, children }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="sessionForm" onSubmit={(e) => { e.preventDefault(); onSubmit(f, () => setF(emptySession)); }}>
      <label className="field"><span className="fieldLabel">Début</span><input type="date" required value={f.starts_on} onChange={set('starts_on')} /></label>
      <label className="field"><span className="fieldLabel">Fin</span><input type="date" value={f.ends_on || ''} onChange={set('ends_on')} /></label>
      <label className="field"><span className="fieldLabel">Horaires</span><input value={f.schedule || ''} onChange={set('schedule')} placeholder="ex. lun.–ven., 8 h – 12 h" /></label>
      <label className="field"><span className="fieldLabel">Lieu</span>
        <select value={f.site || ''} onChange={set('site')}>
          <option value="">Non précisé</option>
          <option>Baguida (siège)</option>
          <option>Agbavi Yésuvito (annexe)</option>
        </select>
      </label>
      <label className="field"><span className="fieldLabel">Places</span><input type="number" min="1" inputMode="numeric" value={f.seats ?? ''} onChange={set('seats')} placeholder="Illimité" /></label>
      <label className="field"><span className="fieldLabel">Inscriptions</span>
        <select value={f.status} onChange={set('status')}><option value="ouverte">Ouvertes</option><option value="fermée">Fermées</option></select>
      </label>
      <div className="sessionActions">
        <button className="btn btnPrimary btnSmall" disabled={busy}>{submitLabel}</button>
        {children}
      </div>
    </form>
  );
}

function SessionsAdmin({ c, notify, refresh }) {
  const [busy, run] = useAction(notify, refresh);
  return (
    <div className="sessionsAdmin">
      <h3>Sessions</h3>
      {c.sessions.length === 0 && <p className="muted">Aucune session : la fiche affiche « Prochaines dates bientôt annoncées ».</p>}
      <ul className="adminList">
        {c.sessions.map((s) => (
          <li key={s.id} className="sessionRow">
            <p className="sessionSummary">
              <strong>{formatDay(s.starts_on)}{s.ends_on ? ` → ${formatDay(s.ends_on)}` : ''}</strong>
              <span className="muted">{s.seats ? `${s.seats_left} / ${s.seats} places disponibles` : 'Places non limitées'}</span>
            </p>
            <SessionForm
              initial={{ ...s, seats: s.seats ?? '' }}
              busy={busy}
              submitLabel="Enregistrer"
              onSubmit={(f) => run('session.update', { id: s.id, ...f }, 'Session enregistrée.')}
            >
              <DeleteButton onConfirm={() => run('session.delete', { id: s.id }, 'Session supprimée.')} />
            </SessionForm>
            <Learners sessionId={s.id} notify={notify} onChanged={refresh} />
            <SessionFollowUp sessionId={s.id} notify={notify} />
          </li>
        ))}
      </ul>
      <h3><Plus size={16} aria-hidden="true" /> Ajouter une session</h3>
      <SessionForm
        initial={emptySession}
        busy={busy}
        submitLabel="Ajouter la session"
        onSubmit={async (f, reset) => { if (await run('session.create', { course_slug: c.slug, ...f }, 'Session ajoutée.')) reset(); }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Réalisations : photos envoyées dans le stockage (ou adresse), catégories, publication
// ---------------------------------------------------------------------------
const PF_LABELS = { publie: 'Publiée', brouillon: 'Brouillon', masque: 'Masquée' };

export function GalleryAdmin({ notify }) {
  const { data, error, refresh } = useAdminCatalog();
  const [busy, run] = useAction(notify, refresh);
  const confirm = useConfirm();
  const [f, setF] = useState({ category_slug: '', title: '', description: '', alt: '', image_url: '', status: 'publie' });
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  if (error) return <p className="formError" role="alert">{error}</p>;
  if (!data) return <Loading />;
  const cats = data.galleryCategories || [];
  const shown = data.gallery.filter((g) => !filter || g.category === filter || g.status === filter);
  async function add(e) {
    e.preventDefault();
    setUploading(true);
    try {
      let imageUrl = f.image_url;
      let fileId = null;
      if (file) {
        const up = await uploadFile('portfolio', null, file);
        fileId = up.id;
        imageUrl = `/api/files?id=${up.id}&inline=1`;
      }
      if (!imageUrl) throw new Error('Choisissez une photo ou indiquez son adresse.');
      const r = await manage('portfolio.create', { ...f, category_slug: f.category_slug || cats[0]?.slug, image_url: imageUrl });
      if (fileId) await manage('portfolio.image', { id: r.id, file_id: fileId });
      notify(f.status === 'publie' ? 'Réalisation publiée.' : 'Réalisation enregistrée en brouillon.');
      setF({ category_slug: f.category_slug, title: '', description: '', alt: '', image_url: '', status: f.status });
      setFile(null);
      refresh();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className="adminBlock">
      <p className="muted adminIntro">Ajoutez uniquement de vraies réalisations d’E-MAN PROD, avec l’accord du client.</p>
      <form className="spaceBlock spaceForm" onSubmit={add}>
        <h2 className="subTitle">Ajouter une réalisation</h2>
        <div className="fieldRow">
          <label className="field"><span className="fieldLabel">Photo (JPG, PNG ou WebP, jusqu’à 50 Mo, allégée automatiquement)</span><input type="file" accept=".jpg,.jpeg,.png,.webp" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
          <label className="field"><span className="fieldLabel">… ou adresse d’une image</span><input value={f.image_url} onChange={set('image_url')} disabled={Boolean(file)} placeholder="https://… ou /media/photo.jpg" inputMode="url" /></label>
        </div>
        <div className="fieldRow">
          <label className="field"><span className="fieldLabel">Catégorie</span>
            <select value={f.category_slug || cats[0]?.slug} onChange={set('category_slug')}>{cats.map((c) => <option key={c.slug} value={c.slug}>{c.title}</option>)}</select>
          </label>
          <label className="field"><span className="fieldLabel">Titre</span><input required minLength={2} maxLength={120} value={f.title} onChange={set('title')} placeholder="ex. Bâche 3 × 2 m pour une pharmacie" /></label>
        </div>
        <div className="fieldRow">
          <label className="field"><span className="fieldLabel">Ce que montre la photo (accessibilité)</span><input required minLength={3} maxLength={200} value={f.alt} onChange={set('alt')} /></label>
          <label className="field"><span className="fieldLabel">Description (facultatif)</span><input maxLength={600} value={f.description} onChange={set('description')} /></label>
        </div>
        <label className="field inline"><span className="fieldLabel">Visibilité</span>
          <select value={f.status} onChange={set('status')}><option value="publie">Publier tout de suite</option><option value="brouillon">Brouillon (non visible)</option></select>
        </label>
        <button className="btn btnPrimary btnSmall" disabled={uploading}>{uploading ? 'Envoi…' : 'Ajouter'}</button>
      </form>

      <CategoriesAdmin cats={cats} items={data.gallery} run={run} busy={busy} />

      <div className="filterBar slim">
        <h2 className="subTitle">Réalisations ({data.gallery.length})</h2>
        <select aria-label="Filtrer" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Toutes</option>
          <optgroup label="Visibilité">{Object.entries(PF_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</optgroup>
          <optgroup label="Catégorie">{cats.map((c) => <option key={c.slug} value={c.slug}>{c.title}</option>)}</optgroup>
        </select>
      </div>
      {shown.length === 0 ? <EmptyState title="Aucune réalisation" text="Ajoutez une photo ci-dessus : elle apparaîtra dans la galerie du site une fois publiée." /> : (
        <ul className="galleryAdminList">
          {shown.map((g) => <GalleryRow key={g.id} g={g} cats={cats} run={run} busy={busy} confirm={confirm} />)}
        </ul>
      )}
    </div>
  );
}

function GalleryRow({ g, cats, run, busy, confirm }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ title: g.title, description: g.description || '', alt: g.alt, category_slug: g.category });
  return (
    <li className={g.status === 'publie' ? '' : 'hiddenItem'}>
      <img src={g.image_url} alt={g.alt} loading="lazy" />
      <div>
        <strong>{g.title}</strong>
        <span className="muted">{cats.find((c) => c.slug === g.category)?.title} · {PF_LABELS[g.status]}{g.published_at ? ` · publiée le ${formatDay(String(g.published_at).slice(0, 10))}` : ''}</span>
        {edit ? (
          <form className="miniForm" onSubmit={async (e) => { e.preventDefault(); if (await run('portfolio.update', { id: g.id, ...f }, 'Réalisation modifiée.')) setEdit(false); }}>
            <input aria-label="Titre" required minLength={2} maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            <input aria-label="Description" maxLength={600} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Description" />
            <input aria-label="Texte alternatif" required minLength={3} maxLength={200} value={f.alt} onChange={(e) => setF({ ...f, alt: e.target.value })} />
            <select aria-label="Catégorie" value={f.category_slug} onChange={(e) => setF({ ...f, category_slug: e.target.value })}>{cats.map((c) => <option key={c.slug} value={c.slug}>{c.title}</option>)}</select>
            <span className="mediaActions"><button className="btn btnPrimary btnSmall" disabled={busy}>Enregistrer</button><button type="button" className="btn btnGhost btnSmall" onClick={() => setEdit(false)}>Annuler</button></span>
          </form>
        ) : (
          <div className="mediaActions">
            <button type="button" className="btn btnGhost btnSmall" disabled={busy}
              onClick={() => run('portfolio.update', { id: g.id, status: g.status === 'publie' ? 'masque' : 'publie' }, g.status === 'publie' ? 'Réalisation dépubliée.' : 'Réalisation publiée.')}>
              {g.status === 'publie' ? <><EyeOff size={15} aria-hidden="true" /> Dépublier</> : <><Eye size={15} aria-hidden="true" /> Publier</>}
            </button>
            <button type="button" className="btn btnGhost btnSmall" onClick={() => setEdit(true)}>Modifier</button>
            <button type="button" className="btn btnGhost btnSmall" disabled={busy} onClick={async () => {
              if (await confirm({ title: `Supprimer « ${g.title} » ?`, text: 'La réalisation et sa photo seront définitivement effacées.', confirm: 'Supprimer', danger: true })) run('portfolio.delete', { id: g.id }, 'Réalisation supprimée.');
            }}><Trash2 size={15} aria-hidden="true" /> Supprimer</button>
          </div>
        )}
      </div>
    </li>
  );
}

function CategoriesAdmin({ cats, items, run, busy }) {
  const [title, setTitle] = useState('');
  return (
    <details className="spaceBlock">
      <summary className="subTitle">Catégories ({cats.length})</summary>
      <ul className="catList">
        {cats.map((c) => <CategoryRow key={c.slug} c={c} count={items.filter((g) => g.category === c.slug).length} run={run} busy={busy} />)}
      </ul>
      <form className="searchRow" onSubmit={async (e) => {
        e.preventDefault();
        const slug = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
        if (await run('portfolio_category.create', { slug, title }, `Catégorie « ${title} » ajoutée.`)) setTitle('');
      }}>
        <input aria-label="Nouvelle catégorie" required minLength={2} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nouvelle catégorie" />
        <button className="btn btnGhost btnSmall" disabled={busy}><Plus size={15} aria-hidden="true" /> Ajouter</button>
      </form>
    </details>
  );
}

function CategoryRow({ c, count, run, busy }) {
  const [title, setTitle] = useState(c.title);
  return (
    <li>
      <input aria-label={`Nom de la catégorie ${c.title}`} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      <span className="muted">{count} réalisation(s)</span>
      {title !== c.title && <button type="button" className="btn btnGhost btnSmall" disabled={busy} onClick={() => run('portfolio_category.update', { slug: c.slug, title }, 'Catégorie renommée.')}>Renommer</button>}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Prestations : textes et visibilité
// ---------------------------------------------------------------------------
export function PrestationsAdmin({ notify }) {
  const { data, error, refresh } = useAdminCatalog();
  const [busy, run] = useAction(notify, refresh);
  if (error) return <p className="formError" role="alert">{error}</p>;
  if (!data) return <Loading />;
  return (
    <div className="adminBlock">
      <p className="muted adminIntro">Une prestation masquée disparaît des menus, de l’accueil et du plan du site. Les photos se changent dans « Images du site ».</p>
      <ul className="adminList">
        {data.prestations.map((p) => <PrestationRow key={p.slug} p={p} run={run} busy={busy} />)}
      </ul>
    </div>
  );
}

function PrestationRow({ p, run, busy }) {
  const [f, setF] = useState({ title: p.title, summary: p.summary, intro: p.intro || '', offerings: (p.offerings || []).join('\n') });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <li className="adminItem">
      <details>
        <summary>
          <span className="adminItemTitle">{p.title}</span>
          <span className="adminItemMeta"><span className={'tag ' + (p.published ? 'done' : 'off')}>{p.published ? 'Visible' : 'Masquée'}</span></span>
        </summary>
        <form className="form adminForm" onSubmit={(e) => { e.preventDefault(); run('service.update', { slug: p.slug, ...f, offerings: f.offerings.split('\n').map((x) => x.trim()).filter(Boolean) }, `« ${f.title} » enregistrée.`); }}>
          <label className="field"><span className="fieldLabel">Titre</span><input required minLength={2} maxLength={120} value={f.title} onChange={set('title')} /></label>
          <label className="field"><span className="fieldLabel">Résumé (cartes et menus)</span><textarea required minLength={10} maxLength={400} rows={2} value={f.summary} onChange={set('summary')} /></label>
          <label className="field"><span className="fieldLabel">Présentation (page de la prestation)</span><textarea maxLength={4000} rows={4} value={f.intro} onChange={set('intro')} /></label>
          <label className="field"><span className="fieldLabel">Ce que l’atelier réalise (une ligne par élément)</span><textarea rows={5} value={f.offerings} onChange={set('offerings')} /></label>
          <div className="mediaActions">
            <button className="btn btnPrimary btnSmall" disabled={busy}>Enregistrer</button>
            <button type="button" className="btn btnGhost btnSmall" disabled={busy} onClick={() => run('service.update', { slug: p.slug, published: !p.published }, p.published ? `« ${p.title} » masquée.` : `« ${p.title} » visible.`)}>{p.published ? 'Masquer du site' : 'Afficher sur le site'}</button>
            <Link to={`/prestations/${p.slug}`} className="btn btnGhost btnSmall">Voir la page</Link>
          </div>
        </form>
      </details>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Apprenants d'une session : statut, contact, documents (attestation, support)
// ---------------------------------------------------------------------------
function Learners({ sessionId, notify, onChanged }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    try { setRows(await space.enrollments({ session: sessionId })); } catch (e) { notify(e.message, 'error'); }
  }, [sessionId, notify]);
  useEffect(() => { if (open) load(); }, [open, load]);
  return (
    <details className="subDetails" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Apprenants{rows ? ` (${rows.length})` : ''}</summary>
      {!rows ? <Loading lines={1} /> : !rows.length ? <p className="muted">Aucune inscription à cette session.</p> : (
        <ul className="learnerList">
          {rows.map((r) => (
            <li key={r.id}>
              <span><strong>{r.full_name}</strong><small>{r.phone}{r.email ? ` · ${r.email}` : ''}</small></span>
              <select aria-label={`Statut de ${r.full_name}`} value={r.status} onChange={async (e) => {
                try { await updateRegistration(r.id, { status: e.target.value }); notify('Statut enregistré.'); load(); onChanged(); } catch (err) { notify(err.message, 'error'); load(); }
              }}>{TRAINING_STATUSES.map((st) => <option key={st}>{st}</option>)}</select>
              <label className="btn btnGhost btnSmall fileBtn">Déposer un document
                <input type="file" className="sr" accept=".pdf,.jpg,.jpeg,.png,.zip" onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  try { await uploadFile('enrollment', r.id, file); notify(`Document déposé pour ${r.full_name} : il le retrouve dans son espace.`); load(); } catch (err) { notify(err.message, 'error'); }
                }} />
              </label>
              {r.documents > 0 && <span className="muted">{r.documents} document(s)</span>}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
