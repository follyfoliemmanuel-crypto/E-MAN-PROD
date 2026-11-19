// Suivi des apprenants : liste des participants, présences, résultats, documents de session,
// attestations et certificats. Une attestation n'est émise qu'après validation explicite par
// l'équipe « formations » des conditions fixées pour la formation.
import { randomBytes } from 'node:crypto';
import { query, one } from '../db.js';
import { HttpError } from '../http.js';
import { logActivity, notifyUser, isTeam } from '../activity.js';
import { filesOf } from './files.js';

export const ATTENDANCE = ['present', 'retard', 'absent', 'excuse'];
const ACTIVE = ['Inscrit', 'Terminé'];
const longDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
export const sessionLabel = (s) => (s.ends_on && s.ends_on !== s.starts_on ? `Session du ${longDay(s.starts_on)} au ${longDay(s.ends_on)}` : `Session du ${longDay(s.starts_on)}`);

const team = (actor) => { if (!isTeam(actor, 'trainings')) throw new HttpError(403, 'Accès réservé à l’équipe « formations ».'); };

/** Jours de cours : du début à la fin de la session, sans les dimanches (90 jours au plus). */
export function sessionDays(s) {
  const out = [];
  const start = new Date(s.starts_on + 'T12:00:00Z');
  const end = new Date((s.ends_on || s.starts_on) + 'T12:00:00Z');
  for (let d = start; d <= end && out.length < 90; d = new Date(d.getTime() + 86400000)) {
    if (d.getUTCDay() !== 0) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function loadSession(id) {
  const s = await one(
    `select s.id, s.training_slug, to_char(s.starts_on, 'YYYY-MM-DD') as starts_on, to_char(s.ends_on, 'YYYY-MM-DD') as ends_on, s.schedule, s.site, s.seats, s.status,
            t.title as training_title, t.duration, t.certificate, t.certificate_rules
       from training_sessions s join trainings t on t.slug = s.training_slug where s.id = $1`, [id]);
  if (!s) throw new HttpError(404, 'Session introuvable.');
  return s;
}

/** Taux d'assiduité : jours présents ou en retard / jours où l'appel a été fait pour la session. */
async function attendanceStats(sessionId) {
  const rows = await query(
    `select a.enrollment_id, a.status, to_char(a.day, 'YYYY-MM-DD') as day
       from attendance a join enrollments e on e.id = a.enrollment_id where e.session_id = $1`, [sessionId]);
  const taken = [...new Set(rows.map((r) => r.day))].sort();
  const by = {};
  for (const r of rows) (by[r.enrollment_id] ||= {})[r.day] = r.status;
  const rate = (eid) => {
    if (!taken.length) return null;
    const ok = taken.filter((d) => ['present', 'retard'].includes(by[eid]?.[d])).length;
    return Math.round((ok / taken.length) * 100);
  };
  return { taken, by, rate };
}

/** Liste des participants d'une session, avec présences et état des attestations. */
export async function sessionRoster(actor, sessionId) {
  team(actor);
  const s = await loadSession(sessionId);
  const [learners, stats, certs, docs] = await Promise.all([
    query(
      `select e.id, e.user_id, e.full_name, e.phone, e.email, e.status, e.result, e.created_at
         from enrollments e where e.session_id = $1 and e.status <> 'Annulé' order by e.full_name`, [sessionId]),
    attendanceStats(sessionId),
    query(`select c.id, c.enrollment_id, c.number, c.kind, c.issued_at from certificates c join enrollments e on e.id = c.enrollment_id
            where e.session_id = $1 and c.revoked_at is null`, [sessionId]),
    filesOf('session', sessionId),
  ]);
  const days = [...new Set([...sessionDays(s), ...stats.taken])].sort();
  return {
    session: { ...s, label: sessionLabel(s) },
    days, days_taken: stats.taken, documents: docs,
    learners: learners.map((l) => ({
      ...l, attendance: stats.by[l.id] || {}, attendance_rate: stats.rate(l.id),
      certificate: certs.find((c) => c.enrollment_id === l.id) || null,
    })),
  };
}

/** Appel d'un jour : une marque par apprenant (les absents non cochés restent sans marque). */
export async function markAttendance(actor, sessionId, day, marks) {
  team(actor);
  const s = await loadSession(sessionId);
  if (day < s.starts_on || day > (s.ends_on || s.starts_on)) throw new HttpError(400, 'Cette date est en dehors de la session.');
  if (day > new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'L’appel ne peut pas être fait pour un jour à venir.');
  const ids = marks.map((m) => m.enrollment_id);
  const valid = await query(`select id from enrollments where session_id = $1 and id = any($2::uuid[]) and status = any($3::text[])`, [sessionId, `{${ids.join(',')}}`, `{${ACTIVE.join(',')}}`]);
  if (valid.length !== new Set(ids).size) throw new HttpError(400, 'Un des apprenants n’est pas inscrit (place confirmée) à cette session.');
  for (const m of marks) {
    if (m.status === null) {
      await query('delete from attendance where enrollment_id = $1 and day = $2 returning day', [m.enrollment_id, day]);
    } else {
      await query(
        `insert into attendance (enrollment_id, day, status, note, recorded_by) values ($1, $2, $3, $4, $5)
         on conflict (enrollment_id, day) do update set status = excluded.status, note = excluded.note, recorded_by = excluded.recorded_by, updated_at = now()
         returning day`, [m.enrollment_id, day, m.status, m.note || null, actor.id]);
    }
  }
  await logActivity(actor, 'attendance.recorded', 'session', sessionId, { day, marks: marks.length });
  return sessionRoster(actor, sessionId);
}

export async function setResult(actor, enrollmentId, result) {
  team(actor);
  const row = await one('update enrollments set result = $2 where id = $1 returning id, session_id', [enrollmentId, result]);
  if (!row) throw new HttpError(404, 'Inscription introuvable.');
  await logActivity(actor, 'enrollment.result', 'enrollment', enrollmentId, { result });
  return { ok: true };
}

/** Conditions de délivrance d'une inscription, vérifiées une à une. */
export async function eligibility(enrollmentId) {
  const e = await one(
    `select e.id, e.user_id, e.full_name, e.status, e.result, e.session_id, e.training_slug, e.training_title,
            t.certificate_rules as rules, t.duration, t.title as t_title
       from enrollments e left join trainings t on t.slug = e.training_slug where e.id = $1`, [enrollmentId]);
  if (!e) throw new HttpError(404, 'Inscription introuvable.');
  const rules = e.rules || {};
  const checks = [];
  checks.push({ key: 'kind', label: 'Document prévu pour cette formation', ok: Boolean(rules.kind), detail: rules.kind ? (rules.kind === 'certificat' ? 'Certificat' : 'Attestation') : 'Aucun : à définir dans la fiche de la formation.' });
  checks.push({ key: 'status', label: 'Formation terminée', ok: e.status === 'Terminé', detail: `Statut : ${e.status}` });
  let rate = null;
  if (e.session_id) rate = (await attendanceStats(e.session_id)).rate(e.id);
  if (rules.min_attendance !== undefined && rules.min_attendance !== null) {
    checks.push({ key: 'attendance', label: `Assiduité d’au moins ${rules.min_attendance} %`, ok: rate !== null && rate >= rules.min_attendance, detail: rate === null ? 'Aucun appel enregistré.' : `${rate} %` });
  }
  if (rules.evaluation) checks.push({ key: 'evaluation', label: 'Évaluation réussie', ok: e.result === 'reussi', detail: e.result === 'reussi' ? 'Réussie' : e.result === 'non_reussi' ? 'Non réussie' : 'Résultat non saisi' });
  const active = await one('select id, number from certificates where enrollment_id = $1 and revoked_at is null', [enrollmentId]);
  return { enrollment: e, rules, attendance_rate: rate, checks, eligible: checks.every((c) => c.ok) && !active, existing: active };
}

/**
 * Émet l'attestation : toutes les conditions doivent être remplies et l'équipe doit
 * confirmer explicitement qu'elle les a vérifiées (`confirm: true`).
 */
export async function issueCertificate(actor, enrollmentId, { confirm, note = null }) {
  team(actor);
  const el = await eligibility(enrollmentId);
  if (el.existing) throw new HttpError(409, `Un document est déjà émis pour cette inscription (${el.existing.number}).`);
  const missing = el.checks.filter((c) => !c.ok);
  if (missing.length) throw new HttpError(409, `Conditions non remplies : ${missing.map((c) => `${c.label} (${c.detail})`).join(' ; ')}.`);
  if (confirm !== true) throw new HttpError(400, 'Confirmez que les conditions de délivrance ont été vérifiées.');
  const e = el.enrollment;
  const s = e.session_id ? await loadSession(e.session_id) : null;
  const who = await one('select full_name from users where id = $1', [actor.id]);
  const conditions = {
    attendance_rate: el.attendance_rate, result: e.result, duration: e.duration || null,
    checks: el.checks.map(({ key, label, detail }) => ({ key, label, detail })),
    validated_by: who?.full_name || null, validated_at: new Date().toISOString(), note,
  };
  const row = await one(
    `insert into certificates (verify_code, enrollment_id, kind, holder_name, training_title, session_label, conditions, issued_by)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) returning id, number`,
    [randomBytes(8).toString('hex').toUpperCase(), enrollmentId, el.rules.kind, e.full_name, e.t_title || e.training_title, s ? sessionLabel(s) : null, JSON.stringify(conditions), actor.id],
  );
  await logActivity(actor, 'certificate.issued', 'enrollment', enrollmentId, { certificate_id: row.id, number: row.number, kind: el.rules.kind });
  if (e.user_id) {
    const doc = el.rules.kind === 'certificat' ? 'certificat' : 'attestation';
    await notifyUser(e.user_id, {
      kind: 'certificate.issued', category: 'trainings', title: `Votre ${doc} est disponible`, body: e.t_title || e.training_title,
      link: '/espace?section=formations', email: 'certificate_issued', vars: { formation: e.t_title || e.training_title, numero: row.number, document: doc },
      details: [['Formation', e.t_title || e.training_title], ['Numéro', row.number]], emailBody: '',
    });
  }
  return getCertificate(actor, row.id);
}

export async function revokeCertificate(actor, id, reason) {
  team(actor);
  const row = await one(`update certificates set revoked_at = now(), revoked_reason = $2 where id = $1 and revoked_at is null returning id, enrollment_id, number`, [id, reason]);
  if (!row) throw new HttpError(404, 'Document introuvable ou déjà révoqué.');
  await logActivity(actor, 'certificate.revoked', 'enrollment', row.enrollment_id, { certificate_id: id, number: row.number, reason });
  return { ok: true };
}

export async function getCertificate(actor, id) {
  const c = await one(
    `select c.*, e.user_id, u.full_name as issued_by_name from certificates c join enrollments e on e.id = c.enrollment_id
       left join users u on u.id = c.issued_by where c.id = $1`, [id]);
  if (!c || (!isTeam(actor, 'trainings') && (!actor.id || c.user_id !== actor.id))) throw new HttpError(404, 'Document introuvable.');
  return c;
}

/** Vérification publique d'une attestation à partir de son code (imprimé sur le document). */
export async function verifyCertificate(code) {
  const c = await one(
    `select number, kind, holder_name, training_title, session_label, issued_at, revoked_at from certificates where verify_code = $1`,
    [String(code || '').toUpperCase()]);
  if (!c) return { valid: false };
  return { valid: !c.revoked_at, revoked: Boolean(c.revoked_at), ...c };
}

/** Pour l'espace client : présences, documents de session et attestation d'une inscription. */
export async function learnerView(actor, enrollmentId) {
  const e = await one('select id, user_id, session_id, status from enrollments where id = $1', [enrollmentId]);
  if (!e || (!isTeam(actor, 'trainings') && e.user_id !== actor.id)) throw new HttpError(404, 'Inscription introuvable.');
  const [stats, docs, cert] = await Promise.all([
    e.session_id ? attendanceStats(e.session_id) : null,
    e.session_id && ACTIVE.includes(e.status) ? filesOf('session', e.session_id) : [],
    one(`select id, number, kind, issued_at from certificates where enrollment_id = $1 and revoked_at is null`, [enrollmentId]),
  ]);
  return {
    attendance: stats ? Object.entries(stats.by[e.id] || {}).sort().map(([day, status]) => ({ day, status })) : [],
    attendance_rate: stats ? stats.rate(e.id) : null,
    session_documents: docs, certificate: cert,
  };
}

/** Feuille de présence en PDF : données de la session. */
export async function attendanceSheet(actor, sessionId) {
  const r = await sessionRoster(actor, sessionId);
  const days = r.days_taken.length ? r.days_taken : r.days;
  return {
    ...r.session, days,
    learners: r.learners.filter((l) => ACTIVE.includes(l.status)).map((l) => ({ full_name: l.full_name, attendance: l.attendance })),
  };
}
