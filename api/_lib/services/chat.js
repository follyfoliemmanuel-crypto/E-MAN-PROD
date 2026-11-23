// Messagerie privée client ↔ équipe E-MAN PROD (une conversation par client).
//
// Elle prolonge le fil « Assistance » existant (table messages, colonne support_user_id) : les
// anciens messages font partie de l'historique. Règles, toutes vérifiées ici, côté serveur :
// - un client n'accède qu'à SA conversation (l'identifiant vient de sa session, jamais du navigateur) ;
// - l'équipe n'y accède qu'avec le droit « support » (l'administrateur l'a toujours) ;
// - envoyé : le message est en base ; reçu : un appareil de l'autre partie l'a reçu (connexion
//   temps réel ouverte ou conversation chargée) ; lu : l'autre partie a ouvert la conversation.
import { query, one } from '../db.js';
import { HttpError } from '../http.js';
import { notifyUser, notifyTeam, isTeam } from '../activity.js';

export const ONLINE_SECONDS = 50;
const PAGE = 40;
const TEAM_ROLES = `(u.role = 'admin' or (u.role = 'staff' and 'support' = any(u.permissions)))`;

/** Conversation demandée → identifiant du client, et le côté de la personne connectée. */
export async function conversationOf(actor, who) {
  if (!actor?.id) throw new HttpError(401, 'Connectez-vous pour continuer.');
  if (!who || who === 'me' || who === actor.id) {
    if (actor.role !== 'client') throw new HttpError(400, 'Choisissez la conversation d’un client.');
    return { clientId: actor.id, side: 'client' };
  }
  if (!isTeam(actor, 'support')) throw new HttpError(404, 'Conversation introuvable.');
  const u = await one(`select id from users where id = $1 and role = 'client'`, [who]);
  if (!u) throw new HttpError(404, 'Conversation introuvable.');
  return { clientId: u.id, side: 'team' };
}

// ------------------------------------------------------------------- Présence
export async function touchPresence(userId, connId) {
  await query(
    `insert into presence (user_id, conn_id, seen_at) values ($1, $2, now())
     on conflict (user_id, conn_id) do update set seen_at = now() returning user_id`, [userId, connId]);
  await query('update users set last_active_at = now() where id = $1 returning id', [userId]);
  // Ménage : connexions coupées depuis longtemps.
  if (Math.random() < 0.05) await query(`delete from presence where seen_at < now() - interval '10 minutes' returning user_id`);
}
export async function dropPresence(userId, connId) {
  await query('delete from presence where user_id = $1 and conn_id = $2 returning user_id', [userId, connId]);
  await query('update users set last_active_at = now() where id = $1 returning id', [userId]);
}
export async function onlineIds(ids) {
  if (!ids.length) return new Set();
  const rows = await query(
    `select distinct user_id from presence where user_id = any($1::uuid[]) and seen_at > now() - make_interval(secs => $2)`,
    [`{${ids.join(',')}}`, ONLINE_SECONDS]);
  return new Set(rows.map((r) => r.user_id));
}
/** Présence affichable : « dernière activité » seulement si la personne l'autorise. */
const presence = (row, online) => ({ online, last_active_at: online || !row.show_last_seen ? null : row.last_active_at });

// ------------------------------------------------------------------- Profils
/** Profils publics de l'équipe, vus par les clients : jamais l'e-mail, le téléphone ni le rôle exact. */
export async function teamProfiles() {
  const rows = await query(
    `select u.id, coalesce(u.public_name, u.full_name) as name, u.first_name, u.last_name, u.job_title, u.bio,
            u.avatar_file_id, u.show_last_seen, u.last_active_at
       from users u where u.disabled_at is null and ${TEAM_ROLES}
      order by (u.role = 'admin') desc, u.created_at limit 20`);
  const online = await onlineIds(rows.map((r) => r.id));
  const members = rows.map((r) => ({
    id: r.id, name: r.name, first_name: r.public_name ? null : r.first_name, last_name: r.public_name ? null : r.last_name,
    job_title: r.job_title, bio: r.bio, avatar_file_id: r.avatar_file_id, company: 'E-MAN PROD', ...presence(r, online.has(r.id)),
  }));
  const last = members.map((m) => m.last_active_at).filter(Boolean).sort().pop() || null;
  return { company: 'E-MAN PROD', members, online: members.some((m) => m.online), last_active_at: members.some((m) => m.online) ? null : last };
}

/** Profil d'un client, vu par l'équipe « support ». */
export async function clientProfile(actor, clientId) {
  await conversationOf(actor, clientId);
  const r = await one(
    `select u.id, u.full_name, u.first_name, u.last_name, u.email, u.phone, u.avatar_file_id, u.created_at,
            u.show_last_seen, u.last_active_at, p.company_name, p.city, p.whatsapp, p.client_type,
            (select count(*)::int from quotes where user_id = u.id) as quotes,
            (select count(*)::int from orders where user_id = u.id) as orders
       from users u left join client_profiles p on p.user_id = u.id where u.id = $1`, [clientId]);
  const online = (await onlineIds([r.id])).has(r.id);
  const { show_last_seen: _s, last_active_at: _l, ...rest } = r;
  return { ...rest, ...presence(r, online) };
}

// ------------------------------------------------------------------- Messages
const MSG_COLS = `m.id, m.author_id, m.author_role, m.kind, m.body, m.voice_ms, m.created_at, m.delivered_at, m.read_at,
  coalesce(u.public_name, u.full_name) as author_name, u.first_name as author_first_name, u.last_name as author_last_name,
  u.avatar_file_id as author_avatar,
  coalesce((select json_agg(json_build_object('id', f.id, 'original_name', f.original_name, 'mime_type', f.mime_type,
                     'size_bytes', f.size_bytes::float8) order by f.created_at)
              from uploaded_files f where f.message_id = m.id and f.status = 'ready'), '[]'::json) as files`;

/** Ouvrir la conversation : les messages de l'autre partie deviennent « reçus » et « lus ». */
async function markRead(c) {
  const other = c.side === 'client' ? 'admin' : 'client';
  const rows = await query(
    `update messages set read_at = now(), delivered_at = coalesce(delivered_at, now()), changed_at = now()
      where support_user_id = $1 and author_role = $2 and read_at is null returning id`, [c.clientId, other]);
  return rows.length;
}

export async function listChat(actor, who, { before = null, limit = PAGE, mark = true } = {}) {
  const c = await conversationOf(actor, who);
  if (mark) {
    const n = await markRead(c);
    // Les notifications « nouveau message » de cette conversation deviennent lues aussi (pas de doublon).
    if (n) {
      await query(
        `update notifications set read_at = now() where user_id = $1 and read_at is null and kind like 'message.%'
           and (link like '%section=messagerie%' or link like '%section=assistance%') ${c.side === 'team' ? 'and link like $2' : ''} returning id`,
        c.side === 'team' ? [actor.id, `%${c.clientId}%`] : [actor.id]);
    }
  }
  const n = Math.min(Math.max(Number(limit) || PAGE, 1), 100);
  const params = [c.clientId, n + 1];
  if (before) params.push(before);
  const rows = await query(
    `select ${MSG_COLS} from messages m left join users u on u.id = m.author_id
      where m.support_user_id = $1 ${before ? 'and m.created_at < $3::timestamptz' : ''}
      order by m.created_at desc, m.id desc limit $2`, params);
  const hasMore = rows.length > n;
  const messages = rows.slice(0, n).reverse();
  return {
    conversation: c.clientId, side: c.side, me: actor.id, messages, has_more: hasMore,
    peer: c.side === 'client' ? { kind: 'team', ...(await teamProfiles()) } : { kind: 'client', ...(await clientProfile(actor, c.clientId)) },
  };
}

const preview = (kind, body, files) => (kind === 'voice' ? '🎤 Message vocal' : body?.trim() ? body.slice(0, 140) : `📎 ${files.map((f) => f.original_name).join(', ').slice(0, 120)}`);

/**
 * @param {{body?: string, kind?: 'text'|'file'|'voice', file_ids?: string[], voice_ms?: number}} msg
 */
export async function postChat(actor, who, { body = '', kind = 'text', file_ids: fileIds = [], voice_ms: voiceMs = null, name = null }) {
  const c = await conversationOf(actor, who);
  const text = String(body || '').trim();
  const ids = [...new Set(fileIds || [])];
  if (ids.length > 5) throw new HttpError(400, '5 fichiers au plus par message.');
  let files = [];
  if (ids.length) {
    // Uniquement des fichiers envoyés par cette personne, vérifiés, pas encore rattachés.
    files = await query(
      `select id, original_name, mime_type from uploaded_files
        where id = any($1::uuid[]) and owner_id = $2 and purpose = 'message' and message_id is null and status = 'ready'`,
      [`{${ids.join(',')}}`, actor.id]);
    if (files.length !== ids.length) throw new HttpError(400, 'Un fichier joint est introuvable ou pas encore vérifié. Renvoyez-le.');
  }
  if (kind === 'voice') {
    if (files.length !== 1 || !files[0].mime_type.startsWith('audio/')) throw new HttpError(400, 'Message vocal : un enregistrement audio est attendu.');
    if (!Number.isFinite(Number(voiceMs)) || voiceMs < 300 || voiceMs > 300000) throw new HttpError(400, 'Message vocal : 5 minutes au plus.');
  } else {
    if (files.some((f) => f.mime_type.startsWith('audio/'))) throw new HttpError(400, 'Un enregistrement audio s’envoie comme message vocal.');
    if (!text && !files.length) throw new HttpError(400, 'Message vide.');
  }
  const finalKind = kind === 'voice' ? 'voice' : files.length && !text ? 'file' : 'text';
  const role = c.side === 'client' ? 'client' : 'admin';
  const stored = finalKind === 'voice' ? 'Message vocal' : text || files.map((f) => f.original_name).join(', ').slice(0, 4000);
  const row = await one(
    `insert into messages (support_user_id, author_id, author_role, body, kind, voice_ms)
     values ($1, $2, $3, $4, $5, $6) returning id, created_at`,
    [c.clientId, actor.id, role, stored, finalKind, finalKind === 'voice' ? Math.round(voiceMs) : null]);
  if (files.length) await query('update uploaded_files set message_id = $1 where id = any($2::uuid[]) returning id', [row.id, `{${ids.join(',')}}`]);
  await query('delete from typing where thread_user_id = $1 and user_id = $2 returning user_id', [c.clientId, actor.id]);

  const voice = finalKind === 'voice';
  const short = preview(finalKind, text, files);
  if (role === 'admin') {
    const title = voice ? 'Nouveau message vocal de l’équipe E-MAN PROD' : 'Nouveau message de l’équipe E-MAN PROD';
    // E-mail seulement si le client n'est pas en ligne (sinon il le voit déjà à l'écran).
    const online = (await onlineIds([c.clientId])).has(c.clientId);
    await notifyUser(c.clientId, {
      kind: voice ? 'message.voice' : 'message.new', category: 'messages', title, body: short, link: '/espace?section=messagerie',
      ...(online ? {} : { email: 'message_new', vars: { sujet: title }, emailBody: voice ? 'Vous avez reçu un message vocal. Écoutez-le dans votre espace, rubrique Messagerie.' : text || short }),
    });
  } else {
    const who2 = name || 'un client';
    await notifyTeam('support', {
      kind: voice ? 'message.voice' : 'message.new', title: voice ? `Message vocal de ${who2}` : `Message de ${who2}`,
      body: short, link: `/espace?section=messagerie&client=${c.clientId}`, event: 'message_new',
    });
  }
  return { id: row.id, created_at: row.created_at, kind: finalKind };
}

/** « écrit un message… » : valable 6 secondes, renouvelé tant que la personne tape. */
export async function setTyping(actor, who) {
  const c = await conversationOf(actor, who);
  await query(
    `insert into typing (thread_user_id, user_id, until) values ($1, $2, now() + interval '6 seconds')
     on conflict (thread_user_id, user_id) do update set until = excluded.until returning user_id`, [c.clientId, actor.id]);
  return { ok: true };
}

/** Équipe : conversations triées par activité récente (+ clients trouvés par la recherche). */
export async function threads(actor, { search = '' } = {}) {
  if (!isTeam(actor, 'support')) throw new HttpError(403, 'Accès réservé : votre compte n’a pas ce droit.');
  const like = search ? `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const rows = await query(
    `with t as (
       select support_user_id as id, max(created_at) as last_at,
              (array_agg(body order by created_at desc, id desc))[1] as last_body,
              (array_agg(kind order by created_at desc, id desc))[1] as last_kind,
              (array_agg(author_role order by created_at desc, id desc))[1] as last_role,
              (array_agg(author_id order by created_at desc, id desc))[1] as last_author,
              (array_agg(read_at order by created_at desc, id desc))[1] as last_read_at,
              (array_agg(delivered_at order by created_at desc, id desc))[1] as last_delivered_at,
              count(*) filter (where author_role = 'client' and read_at is null)::int as unread
         from messages where support_user_id is not null group by support_user_id)
     select u.id, u.full_name, u.first_name, u.last_name, u.email, u.avatar_file_id, u.show_last_seen, u.last_active_at,
            t.last_at, t.last_body, t.last_kind, t.last_role, t.last_author, t.last_read_at, t.last_delivered_at, coalesce(t.unread, 0) as unread
       from users u ${like ? 'left' : ''} join t on t.id = u.id
      where u.role = 'client' ${like ? `and (u.full_name ilike $1 or u.email ilike $1 or coalesce(u.phone, '') ilike $1)` : ''}
      order by t.last_at desc nulls last, u.full_name limit 200`, like ? [like] : []);
  const online = await onlineIds(rows.map((r) => r.id));
  return rows.map(({ email, show_last_seen: _s, last_active_at: _l, ...r }) => ({ ...r, email: like ? email : undefined, ...presence({ show_last_seen: _s, last_active_at: _l }, online.has(r.id)) }));
}

/** Nombre de messages non lus (menu « Messagerie »). */
export async function unreadCount(actor) {
  if (actor.role === 'client') {
    return (await one(`select count(*)::int as n from messages where support_user_id = $1 and author_role = 'admin' and read_at is null`, [actor.id])).n;
  }
  if (!isTeam(actor, 'support')) return 0;
  return (await one(`select count(*)::int as n from messages where support_user_id is not null and author_role = 'client' and read_at is null`)).n;
}
