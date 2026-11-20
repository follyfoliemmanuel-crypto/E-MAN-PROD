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
export async function streamNotifications(req, res, user, { cursor: rawCursor } = {}) {
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
    const now = Date.now();
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
  if (!closed) res.end();
}
