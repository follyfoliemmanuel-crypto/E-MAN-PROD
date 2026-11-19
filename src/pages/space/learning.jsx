// Suivi d'une session de formation (équipe « formations ») : appel du jour, résultats,
// supports de cours, feuille de présence en PDF et délivrance des attestations.
import React, { useState } from 'react';
import { Download, Award, Paperclip, FileText } from 'lucide-react';
import { space, uploadFile, fileUrl, rosterPdfUrl, certificatePdfUrl, formatDay } from '../../lib/api.js';
import { useLoad, Loading, ErrorBox, useConfirm } from './ui.jsx';

const MARKS = [['present', 'Présent'], ['retard', 'Retard'], ['absent', 'Absent'], ['excuse', 'Excusé']];
const today = () => new Date().toISOString().slice(0, 10);

export function SessionFollowUp({ sessionId, notify }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="subDetails" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Suivi : présences, supports et attestations</summary>
      {open && <Roster sessionId={sessionId} notify={notify} />}
    </details>
  );
}

function Roster({ sessionId, notify }) {
  const confirm = useConfirm();
  const [{ data, error, loading }, reload] = useLoad(() => space.roster(sessionId), [sessionId]);
  const [day, setDay] = useState(null);
  const [marks, setMarks] = useState({});
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState(null);
  if (loading && !data) return <Loading lines={2} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const pastDays = data.days.filter((d) => d <= today());
  const current = day || (pastDays.includes(today()) ? today() : pastDays[pastDays.length - 1]) || null;
  const confirmed = data.learners.filter((l) => ['Inscrit', 'Terminé'].includes(l.status));
  const markOf = (l) => (marks[current]?.[l.id] !== undefined ? marks[current][l.id] : l.attendance[current] || '');
  const setMark = (id, v) => setMarks((m) => ({ ...m, [current]: { ...(m[current] || {}), [id]: v } }));

  const saveDay = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const list = confirmed.map((l) => ({ enrollment_id: l.id, status: markOf(l) || null }));
      await space.attendance(sessionId, current, list);
      setMarks((m) => ({ ...m, [current]: undefined }));
      notify(`Appel du ${formatDay(current)} enregistré.`);
      reload();
    } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); }
  };
  const setResult = async (l, v) => {
    try { await space.result(l.id, v || null); notify('Résultat enregistré.'); reload(); } catch (err) { notify(err.message, 'error'); }
  };
  const openChecks = async (l) => {
    try { setChecks({ learner: l, ...(await space.eligibility(l.id)) }); } catch (err) { notify(err.message, 'error'); }
  };
  const issue = async () => {
    const l = checks.learner;
    const ok = await confirm({
      title: `Délivrer le document à ${l.full_name} ?`,
      text: 'Vous confirmez avoir vérifié les conditions de délivrance. Le document sera numéroté, téléchargeable par l’apprenant et vérifiable en ligne.',
      confirm: 'Délivrer',
    });
    if (!ok) return;
    try {
      const r = await space.issueCertificate(l.id);
      notify(`Document ${r.certificate.number} délivré.`);
      setChecks(null);
      reload();
    } catch (err) { notify(err.message, 'error'); }
  };
  const revoke = async (l) => {
    const ok = await confirm({ title: `Révoquer le document ${l.certificate.number} ?`, text: 'Il ne sera plus téléchargeable et la vérification en ligne indiquera qu’il a été révoqué.', confirm: 'Révoquer', danger: true });
    if (!ok) return;
    try { await space.revokeCertificate(l.certificate.id, 'Révoqué depuis le suivi de session'); notify('Document révoqué.'); reload(); } catch (err) { notify(err.message, 'error'); }
  };

  return (
    <div className="roster">
      <div className="formActions">
        <a className="btn btnGhost btnSmall" href={rosterPdfUrl(sessionId)}><Download size={15} aria-hidden="true" /> Feuille de présence (PDF)</a>
        <label className="btn btnGhost btnSmall fileBtn"><Paperclip size={15} aria-hidden="true" /> Ajouter un support de cours
          <input type="file" className="sr" accept=".pdf,.jpg,.jpeg,.png,.zip,.docx,.xlsx,.pptx" onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try { await uploadFile('session', sessionId, file); notify(`Support ajouté : visible des inscrits confirmés.`); reload(); } catch (err) { notify(err.message, 'error'); }
          }} />
        </label>
      </div>
      {data.documents.length > 0 && (
        <ul className="fileList">{data.documents.map((f) => <li key={f.id}><FileText size={14} aria-hidden="true" /><a href={fileUrl(f.id)}>{f.original_name}</a></li>)}</ul>
      )}

      {!confirmed.length ? <p className="muted">Aucune place confirmée : confirmez les inscriptions (statut « Inscrit ») pour faire l’appel.</p> : !current ? (
        <p className="muted">La session commence le {formatDay(data.session.starts_on)} : l’appel sera possible à partir de ce jour.</p>
      ) : (
        <form className="attendanceForm" onSubmit={saveDay}>
          <label className="field"><span className="fieldLabel">Jour de cours</span>
            <select value={current} onChange={(e) => setDay(e.target.value)}>
              {pastDays.map((d) => <option key={d} value={d}>{formatDay(d)}{data.days_taken.includes(d) ? ' · appel fait' : ''}</option>)}
            </select></label>
          <div className="tableScroll"><table className="table compact attendanceTable">
            <thead><tr><th>Apprenant</th><th>Présence</th><th>Assiduité</th><th>Évaluation</th><th>Attestation</th></tr></thead>
            <tbody>{confirmed.map((l) => (
              <tr key={l.id}>
                <td><strong>{l.full_name}</strong><br /><small className="muted">{l.status}</small></td>
                <td>
                  <select aria-label={`Présence de ${l.full_name} le ${formatDay(current)}`} value={markOf(l)} onChange={(e) => setMark(l.id, e.target.value)}>
                    <option value="">—</option>{MARKS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </td>
                <td>{l.attendance_rate === null ? '—' : `${l.attendance_rate} %`}</td>
                <td>
                  <select aria-label={`Évaluation de ${l.full_name}`} value={l.result || ''} onChange={(e) => setResult(l, e.target.value)}>
                    <option value="">Non saisie</option><option value="reussi">Réussie</option><option value="non_reussi">Non réussie</option>
                  </select>
                </td>
                <td>
                  {l.certificate ? (
                    <span className="certCell"><a href={certificatePdfUrl(l.certificate.id)}><Award size={14} aria-hidden="true" /> {l.certificate.number}</a>
                      <button type="button" className="linkBtn muted" onClick={() => revoke(l)}>Révoquer</button></span>
                  ) : <button type="button" className="linkBtn" onClick={() => openChecks(l)}>Vérifier les conditions</button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
          <button className="btn btnPrimary btnSmall" disabled={busy} aria-busy={busy}>{busy ? 'Enregistrement…' : `Enregistrer l’appel du ${formatDay(current)}`}</button>
        </form>
      )}

      {checks && (
        <div className="checksPanel" role="region" aria-label={`Conditions pour ${checks.learner.full_name}`}>
          <h4>Conditions de délivrance — {checks.learner.full_name}</h4>
          <ul className="checkList">
            {checks.checks.map((c) => <li key={c.key} className={c.ok ? 'ok' : 'ko'}><span>{c.ok ? '✓' : '✗'}</span> {c.label} <small className="muted">{c.detail}</small></li>)}
          </ul>
          <div className="formActions">
            <button type="button" className="btn btnGhost btnSmall" onClick={() => setChecks(null)}>Fermer</button>
            <button type="button" className="btn btnPrimary btnSmall" disabled={!checks.eligible} onClick={issue}>
              {checks.eligible ? 'Valider et délivrer' : 'Conditions non remplies'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
