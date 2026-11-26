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
//   POST {action: 'anonymize', user_id, confirm: 'ANONYMISER'}   admin + MFA récent : droit à l'effacement d'un client
//   GET ?push=1                          mes appareils abonnés aux notifications push + clé publique VAPID
//   POST {action: 'push_subscribe', subscription} · {action: 'push_unsubscribe', id | endpoint} · {action: 'push_test'}
import { z } from 'zod';
import { handler, send, readJson, readQuery, Q } from './_lib/http.js';
import { requireUser, requireAdmin, requirePermission, PERMISSIONS } from './_lib/auth.js';
import * as security from './_lib/services/security.js';
import * as dashboard from './_lib/services/dashboard.js';
import { deleteFile } from './_lib/services/files.js';
import { actorOf, USER_EMAIL_CATEGORIES } from './_lib/activity.js';
import * as s from './_lib/schemas.js';
import * as clients from './_lib/services/clients.js';
import { submitTestimonial } from './_lib/services/content.js';
import * as pushSubs from './_lib/services/pushSubs.js';
import { rateLimit, logSecurity } from './_lib/auth.js';
import { query, one } from './_lib/db.js';
import { notifyUser } from './_lib/activity.js';
import { assertRecentMfa, revokeDevices } from './_lib/mfa.js';

const b64url = (min, max) => z.string().min(min).max(max).regex(/^[A-Za-z0-9_-]+=*$/, 'Clé invalide.');
const pushSchema = z.object({
  endpoint: z.string().url('Adresse invalide.').max(1000).refine((u) => u.startsWith('https://') || u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost'), 'Adresse invalide.'),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: b64url(80, 100), auth: b64url(16, 30) }),
});

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
  // Profil visible dans la messagerie. Nom public, fonction et présentation : équipe seulement.
  public_name: s.text('Nom public', { max: 80 }),
  job_title: s.text('Fonction', { max: 80 }),
  bio: s.text('Présentation', { max: 600 }),
  show_last_seen: z.boolean({ invalid_type_error: 'Dernière activité : oui ou non.' }).optional(),
  email_prefs: z.record(z.enum(Object.keys(USER_EMAIL_CATEGORIES)), z.boolean(), { invalid_type_error: 'Préférences invalides.' }).optional(),
});

export default handler({
  async GET(req, res) {
    const user = await requireUser(req);
    const actor = actorOf(user);
    const q = readQuery(req, {
      team: Q.flag, security: Q.flag, stats: Q.flag, documents: Q.flag, activity: Q.text(20), actor: Q.id('Collaborateur'), clients: Q.flag,
      q: Q.text(100), type: Q.text(40), verified: Q.text(5), status: Q.text(20), role: Q.text(10), user: Q.id('Client'), history: Q.flag, prefs: Q.flag, push: Q.flag,
    });
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
    if (q.push === '1') return send(res, 200, await pushSubs.pushStatus(user.id));
    send(res, 200, await clients.getAccount(actor));
  },

  async PATCH(req, res) {
    const user = await requireUser(req);
    const patch = s.parsePatch(patchSchema, await readJson(req));
    send(res, 200, await clients.updateAccount(actorOf(user), patch));
  },

  async POST(req, res) {
    const body = await readJson(req);
    if (body.action === 'push_subscribe' || body.action === 'push_unsubscribe' || body.action === 'push_test') {
      // Toujours le compte de la session : impossible d'abonner un appareil au compte de quelqu'un d'autre.
      const me = actorOf(await requireUser(req));
      await rateLimit(`push:${me.id}`, 30, 60, 'Trop de changements de notifications. Réessayez dans un moment.');
      if (body.action === 'push_subscribe') {
        const sub = s.parse(pushSchema, body.subscription);
        return send(res, 201, await pushSubs.subscribe(me, sub, s.parse(z.string().max(400).catch(''), req.headers['user-agent'] || '')));
      }
      if (body.action === 'push_unsubscribe') {
        const t = s.parse(z.object({ id: s.optionalUuid('Appareil'), endpoint: z.string().url().max(1000).optional().nullable() }), body);
        if (!t.id && !t.endpoint) return send(res, 400, { error: 'Appareil manquant.' });
        return send(res, 200, await pushSubs.unsubscribe(me, t));
      }
      await rateLimit(`push-test:${me.id}`, 5, 10, 'Trop d’essais. Réessayez dans quelques minutes.');
      return send(res, 200, await pushSubs.testPush(me));
    }
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
      assertRecentMfa(admin);
      const p = s.parse(z.object({
        first_name: s.text('Prénom', { min: 1, max: 60, req: true }),
        last_name: s.text('Nom', { min: 1, max: 60, req: true }),
        email: s.email({ req: true }),
        permissions: s.list(z.string(), 'Permissions', { max: 10 }),
      }), body);
      return send(res, 201, await security.inviteStaff(req, admin, p));
    }
    if (body.action === 'mfa_reset') {
      // Téléphone perdu SANS code de récupération : un AUTRE administrateur, lui-même reconfirmé,
      // réinitialise la double authentification. Jamais sur simple demande non vérifiée.
      const admin = await requireAdmin(req);
      assertRecentMfa(admin);
      const { user_id: id } = s.parse(z.object({ user_id: s.uuid('Compte') }), body);
      if (id === admin.id) return send(res, 409, { error: 'Vous ne pouvez pas réinitialiser votre propre double authentification : utilisez un code de récupération.' });
      const target = await one(`select id, role from users where id = $1 and role in ('admin', 'staff')`, [id]);
      if (!target) return send(res, 404, { error: 'Compte de l’équipe introuvable.' });
      await query('update users set mfa_secret_enc = null, mfa_pending_enc = null, mfa_enabled_at = null, mfa_last_step = null where id = $1 returning id', [id]);
      await query('delete from mfa_recovery_codes where user_id = $1 returning id', [id]);
      await revokeDevices(id);
      await query('delete from sessions where user_id = $1 returning id', [id]);
      await logSecurity(req, 'auth.mfa_reset_by_admin', { userId: admin.id, role: 'admin', data: { target: id } });
      await notifyUser(id, { kind: 'security.alert', category: 'account', title: 'Double authentification réinitialisée', body: 'Un administrateur a réinitialisé votre Google Authenticator. Reconnectez-vous et activez-le de nouveau.', link: '/espace?section=parametres' }).catch(() => {});
      return send(res, 200, { ok: true });
    }
    if (body.action === 'anonymize') {
      // Droit à l'effacement d'un client : administrateur, code Google Authenticator récent, confirmation écrite.
      const admin = await requireAdmin(req);
      assertRecentMfa(admin);
      const p = s.parse(z.object({ user_id: s.uuid('Client'), confirm: z.literal('ANONYMISER', { errorMap: () => ({ message: 'Tapez ANONYMISER pour confirmer.' }) }) }), body);
      return send(res, 200, await clients.anonymizeClient(actorOf(admin), p.user_id));
    }
    if (body.action === 'role' || body.action === 'disable' || body.action === 'revoke_sessions') {
      const admin = await requireAdmin(req);
      assertRecentMfa(admin);
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
