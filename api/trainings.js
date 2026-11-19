// /api/trainings — inscriptions aux formations
//   POST           demande d'inscription (public), avec choix de la session
//   GET            liste (client : les siennes ; admin : toutes, ?user= ?session=)
//   GET ?id=       détail et historique
//   PATCH {id, …}  admin : statut (« Inscrit » seulement s'il reste une place), note
//                  client : annuler sa propre inscription
import { z } from 'zod';
import { handler, send, readJson, clientIp } from './_lib/http.js';
import { currentUser, requireUser, rateLimit } from './_lib/auth.js';
import { actorOf } from './_lib/activity.js';
import * as s from './_lib/schemas.js';
import * as enrollments from './_lib/services/enrollments.js';

const createSchema = z.object({
  name: s.customer.name,
  phone: s.customer.phone,
  email: s.customer.email,
  message: s.text('Message', { max: 2000 }),
  // Fiche formation : formation et session vérifiées en base. Sinon, intitulé libre.
  course_slug: s.optionalSlug('Formation'),
  session_id: s.optionalUuid('Session'),
  course: s.text('Formation', { min: 2, max: 120 }),
});

const patchSchema = z.object({
  status: s.oneOf(s.ENROLLMENT_STATUSES, 'Statut'),
  admin_note: s.text('Note interne', { max: 4000 }),
});

export default handler({
  async POST(req, res) {
    const data = s.parse(createSchema, await readJson(req));
    await rateLimit(`training:phone:${data.phone}`, 5, 60, 'Trop de demandes envoyées avec ce numéro. Écrivez-nous sur WhatsApp.');
    await rateLimit(`training:ip:${clientIp(req)}`, 20, 60, 'Trop de demandes envoyées. Écrivez-nous sur WhatsApp.');
    const user = await currentUser(req);
    const e = await enrollments.createEnrollment(actorOf(user), {
      ...data, training_slug: data.course_slug, userEmail: user?.email,
    });
    send(res, 201, { ok: true, id: e.id });
  },

  async GET(req, res) {
    const actor = actorOf(await requireUser(req));
    if (req.query?.id) return send(res, 200, { registration: await enrollments.getEnrollment(actor, s.parse(s.uuid('Inscription'), req.query.id)) });
    const f = s.parse(z.object({ user: s.optionalUuid('Client'), session: s.optionalUuid('Session') }), req.query || {});
    const rows = await enrollments.listEnrollments(actor, { userId: f.user, sessionId: f.session });
    // « course » : nom de champ attendu par le site depuis la v1.
    send(res, 200, { registrations: rows.map((r) => ({ ...r, course: r.training_title, course_slug: r.training_slug })) });
  },

  async PATCH(req, res) {
    const actor = actorOf(await requireUser(req));
    const body = await readJson(req);
    const id = s.parse(s.uuid('Inscription'), body.id);
    const { id: _id, ...rest } = body;
    const patch = s.parsePatch(patchSchema, rest);
    send(res, 200, { registration: await enrollments.updateEnrollment(actor, id, patch) });
  },
});
