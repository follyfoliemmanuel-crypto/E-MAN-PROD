// Temps réel : flux Server-Sent Events (SSE) des notifications d'une personne.
//
// Pourquoi SSE et pas WebSocket : les fonctions Vercel ne peuvent pas garder un serveur WebSocket,
// mais savent envoyer une réponse en continu (streaming). Le navigateur (EventSource) se reconnecte
// tout seul et reprend là où il s'était arrêté (Last-Event-ID).
//
// Ce que le flux envoie : uniquement les notifications de la personne connectée (même règle que la
// cloche de son espace) et son nombre de non lues. Le contenu des messages n'y passe pas : la page
// relit la conversation par l'API habituelle, qui revérifie les droits. Aucun client ne peut donc
// recevoir quoi que ce soit d'une conversation qui n'est pas la sienne.
//
// Neon (pilote HTTP) ne permet pas LISTEN/NOTIFY : la fonction interroge la base toutes les
// ~1,2 s, avec une requête indexée très légère (notifications_user_created_idx).
import { z } from 'zod';
import { query, one } from '../db.js';
import { can } from '../auth.js';
import { touchPresence, dropPresence, ONLINE_SECONDS } from './chat.js';

/** Dernier identifiant reçu par le navigateur (en-tête Last-Event-ID) : « date|uuid », 120 caractères au plus. */
const LastEventId = z.string().max(120).regex(/^[0-9T:.Z+-]*(\|[0-9a-f-]{36})?$/i).catch('');

export const LIVE = {
  tickMs: Number(process.env.LIVE_TICK_MS) || 1200,
  // Durée d'une connexion : un peu moins que la durée maximale d'une fonction Vercel (300 s sur
  // l'offre Hobby). Le navigateur se reconnecte aussitôt, sans rien perdre.
  maxSeconds: Number(process.env.LIVE_MAX_SECONDS) || 270,
  heartbeatMs: 15000,
  sessionCheckMs: 30000,
  // Fenêtre de relecture : une notification écrite par une transaction plus lente (horodatée un peu
  // avant la précédente lue) est quand même vue. Les doublons sont écartés par identifiant.
  overlapSeconds: 30,
  // Messagerie : statuts, « écrit… » et présence relus tous les 2 tours (≈ 2,4 s).
  signalEvery: 2,
  presenceEvery: 4,
  presenceTouchMs: 20000,
};

const parseCursor = (raw) => {
  const at = String(raw || '').split('|')[0];
  return /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d\d:?\d\d)$/.test(at) && !Number.isNaN(Date.parse(at)) ? at : null;
};

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{id: string, session_id: string}} user  personne connectée (vérifiée par l'appelant)
 */
export async function streamNotifications(req, res, user, { cursor: rawCursor, conn = null } = {}) {
  const lastEvent = LastEventId.parse(req.headers['last-event-id'] ?? '');
  let cursor = parseCursor(lastEvent) || parseCursor(rawCursor)
    || (await one(`select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as t`)).t;
  const sent = new Set();
  // Reprise : la dernière notification déjà reçue n'est pas renvoyée. Celles d'avant, dans la fenêtre
  // de relecture, peuvent l'être : le navigateur les écarte par identifiant (aucun doublon affiché).
  const lastId = String(lastEvent || rawCursor || '').split('|')[1];
  if (/^[0-9a-f-]{36}$/i.test(lastId || '')) sent.add(lastId);
  let closed = false;
  req.on('close', () => { closed = true; });
  res.on?.('close', () => { closed = true; });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const write = (chunk) => { if (!closed) { res.write(chunk); res.flush?.(); } };
  // retry : délai de reconnexion conseillé au navigateur.
  write(`retry: 1500\n: E-MAN PROD temps réel\n\n`);

  const started = Date.now();
  let lastBeat = started;
  let lastCheck = started;
  const unread = async () => (await one('select count(*)::int as n from notifications where user_id = $1 and read_at is null', [user.id])).n;
  write(`event: hello\ndata: ${JSON.stringify({ unread: await unread(), at: cursor })}\n\n`);

  // --- Messagerie : la conversation du client, ou toutes (équipe « support »). ---------------
  const isClient = user.role === 'client';
  const support = !isClient && can(user, 'support');
  const chatOn = isClient || support;
  let chatSince = (await one(`select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as t`)).t;
  let typingKey = '';
  let presenceKey = '';
  let lastTouch = 0;
  let tick = 0;
  const signals = async () => {
    // Reçu : un appareil de la personne est connecté, donc les messages qui lui sont destinés lui parviennent.
    if (isClient) {
      await query(`update messages set delivered_at = now(), changed_at = now() where support_user_id = $1 and author_role = 'admin' and delivered_at is null returning id`, [user.id]);
    } else {
      await query(`update messages set delivered_at = now(), changed_at = now() where support_user_id is not null and author_role = 'client' and delivered_at is null returning id`);
    }
    // Conversations qui ont bougé (nouveau message, reçu, lu) : seulement leurs identifiants.
    const moved = await query(
      `select support_user_id as id, to_char(max(changed_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at
         from messages where changed_at > $1::timestamptz and support_user_id is not null ${isClient ? 'and support_user_id = $2' : ''}
        group by support_user_id limit 100`, isClient ? [chatSince, user.id] : [chatSince]);
    if (moved.length) {
      chatSince = moved.map((m) => m.at).sort().pop();
      write(`event: chat\ndata: ${JSON.stringify({ threads: moved.map((m) => m.id) })}\n\n`);
    }
    // « écrit un message… » : côté client, l'équipe qui écrit ; côté équipe, les clients qui écrivent.
    const typing = await query(
      isClient
        ? `select t.thread_user_id as thread, coalesce(u.public_name, u.full_name) as name from typing t join users u on u.id = t.user_id
            where t.thread_user_id = $1 and t.user_id <> $1 and t.until > now()`
        : `select t.thread_user_id as thread, u.full_name as name from typing t join users u on u.id = t.user_id
            where t.user_id = t.thread_user_id and t.until > now() limit 50`, isClient ? [user.id] : []);
    const key = typing.map((t) => `${t.thread}:${t.name}`).sort().join('|');
    if (key !== typingKey) { typingKey = key; write(`event: typing\ndata: ${JSON.stringify({ typing })}\n\n`); }
  };
  const presenceSignal = async () => {
    // Côté client : l'équipe est-elle en ligne ? Côté équipe : quels clients sont en ligne ?
    const rows = await query(
      isClient
        ? `select distinct p.user_id from presence p join users u on u.id = p.user_id
            where p.seen_at > now() - make_interval(secs => $1) and u.disabled_at is null
              and (u.role = 'admin' or (u.role = 'staff' and 'support' = any(u.permissions)))`
        : `select distinct p.user_id from presence p join users u on u.id = p.user_id
            where p.seen_at > now() - make_interval(secs => $1) and u.role = 'client' limit 500`, [ONLINE_SECONDS]);
    const ids = rows.map((r) => r.user_id).sort();
    const key = ids.join(',');
    if (key !== presenceKey) {
      presenceKey = key;
      write(`event: presence\ndata: ${JSON.stringify(isClient ? { team_online: ids.length > 0 } : { online: ids })}\n\n`);
    }
  };
  const touch = async () => { if (conn) { await touchPresence(user.id, conn); lastTouch = Date.now(); } };
  await touch();
  if (chatOn) { await signals().catch(() => {}); await presenceSignal().catch(() => {}); }

  while (!closed && Date.now() - started < LIVE.maxSeconds * 1000) {
    const rows = await query(
      `select id, kind, category, title, link, created_at,
              to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor
         from notifications
        where user_id = $1 and created_at > $2::timestamptz - make_interval(secs => $3)
        order by created_at, id limit 50`,
      [user.id, cursor, LIVE.overlapSeconds],
    );
    const fresh = rows.filter((r) => !sent.has(r.id));
    if (fresh.length) {
      const n = await unread();
      for (const r of fresh) {
        sent.add(r.id);
        if (r.cursor > cursor) cursor = r.cursor;
        const { cursor: c, ...data } = r;
        write(`id: ${c}|${r.id}\nevent: notification\ndata: ${JSON.stringify({ ...data, unread: n })}\n\n`);
      }
      // La mémoire des identifiants envoyés ne garde que la fenêtre de relecture.
      if (sent.size > 500) for (const id of [...sent].slice(0, sent.size - 300)) sent.delete(id);
    }
    tick += 1;
    if (chatOn && tick % LIVE.signalEvery === 0) await signals().catch(() => {});
    if (chatOn && tick % LIVE.presenceEvery === 0) await presenceSignal().catch(() => {});
    const now = Date.now();
    if (now - lastTouch >= LIVE.presenceTouchMs) await touch().catch(() => {});
    if (now - lastBeat >= LIVE.heartbeatMs) { write(`: ping\n\n`); lastBeat = now; }
    if (now - lastCheck >= LIVE.sessionCheckMs) {
      lastCheck = now;
      // Session fermée (déconnexion, mot de passe changé) ou compte désactivé : le flux s'arrête.
      const ok = await one(
        `select 1 as ok from sessions s join users u on u.id = s.user_id
          where s.id = $1 and s.expires_at > now() and u.disabled_at is null`, [user.session_id]);
      if (!ok) { write(`event: bye\ndata: {"reason":"session"}\n\n`); break; }
    }
    await new Promise((r) => setTimeout(r, LIVE.tickMs));
  }
  // Fin de connexion : cette connexion n'est plus « en ligne » (les autres appareils le restent).
  if (conn) await dropPresence(user.id, conn).catch(() => {});
  if (!closed) res.end();
}
