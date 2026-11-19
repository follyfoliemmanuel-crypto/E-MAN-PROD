// /api/account — espace client
//   GET                 mes informations et mon profil
//   GET ?history=1      mes devis, commandes et inscriptions
//   PATCH               modifier mes informations (nom, téléphone, profil)
//   GET ?clients=1      admin : liste des clients (&q=)
//   GET ?user=<id>      admin : fiche client complète avec historique
//   POST {action: 'testimonial', content, rating?, author_title?, consent: true}
//                       client : proposer un avis (publié après relecture et avec son accord)
//   POST {action: 'note', user_id, note}   équipe (droit « clients ») : note interne sur un client
//   GET ?stats=1                         équipe : statistiques (selon ses droits)
//   GET ?documents=1                     mes documents (fichiers, devis et commandes en PDF)
//   GET ?activity=1&actor=<id>           admin : historique des actions d'un collaborateur
//   POST {action: 'avatar', file_id} · {action: 'avatar_remove'}   ma photo de profil
//   POST {action: 'invite', first_name, last_name, email, permissions}   admin : créer un compte STAFF
//   GET ?team=1 · GET ?security=1        admin : équipe et permissions · journal de sécurité
//   POST {action: 'role', user_id, role, permissions}   admin : rôle et permissions d'un compte
//   POST {action: 'disable', user_id, disabled} · {action: 'revoke_sessions', user_id}   admin
import { z } from 'zod';
import { handler, send, readJson } from './_lib/http.js';
import { requireUser, requireAdmin, requirePermission, PERMISSIONS } from './_lib/auth.js';
import * as security from './_lib/services/security.js';
import * as dashboard from './_lib/services/dashboard.js';
import { deleteFile } from './_lib/services/files.js';
import { actorOf, USER_EMAIL_CATEGORIES } from './_lib/activity.js';
import * as s from './_lib/schemas.js';
import * as clients from './_lib/services/clients.js';
import { submitTestimonial } from './_lib/services/content.js';

const patchSchema = z.object({
  full_name: s.text('Nom', { min: 2, max: 120 }),
  first_name: s.text('Prénom', { min: 1, max: 60 }),
  last_name: s.text('Nom', { min: 1, max: 60 }),
  phone: s.phone('Téléphone', { req: false }),
  client_type: s.optionalOneOf(s.CLIENT_TYPES, 'Type de client'),
  company_name: s.text('Entreprise ou établissement', { max: 160 }),
  address: s.text('Adresse', { max: 300 }),
  city: s.text('Ville', { max: 120 }),
  whatsapp: s.phone('WhatsApp', { req: false }),
  preferred_contact: s.optionalOneOf(['whatsapp', 'appel', 'email'], 'Moyen de contact'),
  // Choix des e-mails reçus : { quotes: false, … } (absent = activé).
  email_prefs: z.record(z.enum(Object.keys(USER_EMAIL_CATEGORIES)), z.boolean(), { invalid_type_error: 'Préférences invalides.' }).optional(),
});

export default handler({
  async GET(req, res) {
    const user = await requireUser(req);
    const actor = actorOf(user);
    const q = req.query || {};
    if (q.team === '1') {
      await requireAdmin(req);
      return send(res, 200, { team: await security.listTeam(), permissions: PERMISSIONS });
    }
    if (q.security === '1') {
      await requireAdmin(req);
      return send(res, 200, { events: await security.securityLog() });
    }
    if (q.stats === '1') {
      // Équipe : chacun ne reçoit que les statistiques de ses domaines.
      if (user.role === 'client') return send(res, 403, { error: 'Accès réservé à l’équipe.' });
      return send(res, 200, await dashboard.stats(actor));
    }
    if (q.documents === '1') return send(res, 200, await dashboard.documentsOf(user.id));
    if (q.activity === '1') {
      await requireAdmin(req);
      return send(res, 200, { actions: await security.actionsOf(s.parse(s.uuid('Collaborateur'), q.actor)) });
    }
    if (q.clients === '1') {
      await requirePermission(req, 'clients');
      const f = s.parse(z.object({
        q: s.text('Recherche', { max: 100 }),
        type: s.optionalOneOf(s.CLIENT_TYPES, 'Type de client'),
        verified: s.optionalOneOf(['oui', 'non'], 'Filtre e-mail'),
        activity: s.optionalOneOf(['orders', 'quotes', 'trainings', 'new'], 'Filtre activité'),
        status: s.optionalOneOf(['active', 'disabled'], 'Filtre statut'),
        role: s.optionalOneOf(['client', 'staff', 'admin', 'tous'], 'Rôle'),
      }), q);
      // Les comptes de l'équipe ne sont listés qu'à l'administrateur.
      if (f.role && f.role !== 'client') await requireAdmin(req);
      return send(res, 200, { clients: await clients.listClients({
        search: f.q, type: f.type, verified: f.verified === null ? null : f.verified === 'oui', activity: f.activity, status: f.status,
        role: f.role === 'tous' ? null : f.role || 'client',
      }) });
    }
    if (q.user) {
      await requirePermission(req, 'clients');
      return send(res, 200, { client: await clients.getClient(actor, s.parse(s.uuid('Client'), q.user)) });
    }
    if (q.history === '1') return send(res, 200, await clients.historyOfClient(actor, user.id));
    if (q.prefs === '1') return send(res, 200, await clients.emailPrefs(user.id));
    send(res, 200, await clients.getAccount(actor));
  },

  async PATCH(req, res) {
    const user = await requireUser(req);
    const patch = s.parsePatch(patchSchema, await readJson(req));
    send(res, 200, await clients.updateAccount(actorOf(user), patch));
  },

  async POST(req, res) {
    const body = await readJson(req);
    if (body.action === 'testimonial') {
      const user = await requireUser(req);
      const t = s.parse(z.object({
        author_name: s.text('Nom affiché', { min: 2, max: 120 }),
        author_title: s.text('Fonction ou entreprise', { max: 120 }),
        content: s.text('Avis', { min: 10, max: 1000, req: true }),
        rating: s.int('Note', { min: 1, max: 5 }),
        service_slug: s.optionalSlug('Prestation'),
        consent: z.literal(true, { errorMap: () => ({ message: 'Cochez la case pour accepter la publication de votre avis.' }) }),
      }), body);
      return send(res, 201, { testimonial: await submitTestimonial(actorOf(user), t, user) });
    }
    if (body.action === 'avatar') {
      const user = await requireUser(req);
      const { file_id: fileId } = s.parse(z.object({ file_id: s.uuid('Photo') }), body);
      const r = await clients.setAvatar(actorOf(user), fileId);
      // L'ancienne photo est effacée du stockage.
      if (r.previous && r.previous !== fileId) await deleteFile(actorOf(user), r.previous).catch(() => {});
      return send(res, 200, { avatar_file_id: r.avatar_file_id });
    }
    if (body.action === 'avatar_remove') {
      const user = await requireUser(req);
      if (user.avatar_file_id) await deleteFile(actorOf(user), user.avatar_file_id).catch(() => {});
      return send(res, 200, { avatar_file_id: null });
    }
    if (body.action === 'invite') {
      const admin = await requireAdmin(req);
      const p = s.parse(z.object({
        first_name: s.text('Prénom', { min: 1, max: 60, req: true }),
        last_name: s.text('Nom', { min: 1, max: 60, req: true }),
        email: s.email({ req: true }),
        permissions: s.list(z.string(), 'Permissions', { max: 10 }),
      }), body);
      return send(res, 201, await security.inviteStaff(req, admin, p));
    }
    if (body.action === 'role' || body.action === 'disable' || body.action === 'revoke_sessions') {
      const admin = await requireAdmin(req);
      if (body.action === 'role') {
        const p = s.parse(z.object({
          user_id: s.uuid('Compte'),
          role: s.oneOf(['client', 'staff', 'admin'], 'Rôle'),
          permissions: s.list(z.string(), 'Permissions', { max: 10 }),
        }), body);
        return send(res, 200, await security.setRole(req, admin, p));
      }
      const { user_id: id } = s.parse(z.object({ user_id: s.uuid('Compte') }), body);
      if (body.action === 'disable') return send(res, 200, await security.setDisabled(req, admin, id, s.parse(s.bool, body.disabled)));
      return send(res, 200, await security.revokeUserSessions(req, admin, id));
    }
    const actor = actorOf(await requirePermission(req, 'clients'));
    if (body.action !== 'note') return send(res, 400, { error: 'Action inconnue.' });
    const { user_id, note } = s.parse(z.object({ user_id: s.uuid('Client'), note: s.text('Note', { max: 4000 }) }), body);
    send(res, 200, await clients.setClientNote(actor, user_id, note));
  },
});
