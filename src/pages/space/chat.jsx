// Messagerie privée client ↔ équipe E-MAN PROD : le même écran dans les deux espaces.
// Couleur d'une bulle = qui l'a écrite PAR RAPPORT à la personne connectée :
//   bleu clair = mes messages ; gris = les messages reçus (client, ou collègue de l'équipe).
// Statuts de mes messages : envoyé (✓), reçu (✓✓ gris), lu (✓✓ bleu).
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Paperclip, Mic, Send, Square, Trash2, Play, Pause, Check, CheckCheck, FileText, Download, X, ArrowLeft, Search, Clock, UserRound, Info,
} from 'lucide-react';
import { Avatar } from '../../components/Avatar.jsx';
import { DEMO, chatApi, uploadFile, fileUrl, formatMb } from '../../lib/api.js';
import { onChat, onLive, chatState } from '../../lib/live.js';
import { EmptyState, Loading, ErrorBox } from './ui.jsx';
import { VoicePlayer, peaksOf } from './voice.jsx';

export { VoicePlayer };

// ------------------------------------------------------------------ Dates et présence
const hm = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
function dayLabel(iso) {
  const d = new Date(iso); const now = new Date();
  if (sameDay(d, now)) return 'Aujourd’hui';
  if (sameDay(d, new Date(now.getTime() - 864e5))) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
function whenShort(iso) {
  const d = new Date(iso);
  if (sameDay(d, new Date())) return hm(iso);
  if (sameDay(d, new Date(Date.now() - 864e5))) return 'Hier';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
function lastSeen(iso) {
  const d = new Date(iso);
  if (sameDay(d, new Date())) return `vu aujourd’hui à ${hm(iso)}`;
  if (sameDay(d, new Date(Date.now() - 864e5))) return `vu hier à ${hm(iso)}`;
  return `vu le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${hm(iso)}`;
}
export const presenceText = (p) => (p?.online ? 'En ligne' : p?.last_active_at ? `Hors ligne · ${lastSeen(p.last_active_at)}` : 'Hors ligne');
export function PresenceDot({ online, label = true }) {
  return <span className={`presenceDot${online ? ' on' : ''}`} role={label ? 'img' : undefined} aria-label={label ? (online ? 'En ligne' : 'Hors ligne') : undefined} aria-hidden={label ? undefined : 'true'} />;
}
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** Taille lisible : Ko sous 1 Mo, Mo au-delà. */
const sizeText = (b) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} Ko` : formatMb(b));
const extOf = (name) => (String(name).match(/\.([a-z0-9]{1,5})$/i)?.[1] || 'fichier').toUpperCase();
const ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,.ai,.eps,.psd,.cdr,.zip,.docx,.xlsx,.pptx';

// ------------------------------------------------------------------ Enregistreur vocal
const MIME_CHOICES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
const MAX_VOICE_MS = 5 * 60 * 1000;
export const canRecord = () => typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof window.MediaRecorder !== 'undefined';
function audioFile(blob, mime) {
  const base = mime.split(';')[0];
  const ext = base === 'audio/mp4' ? 'm4a' : base === 'audio/ogg' ? 'ogg' : 'webm';
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return new File([blob], `message-vocal-${stamp}.${ext}`, { type: base });
}

function VoiceRecorder({ onCancel, onSend, notify }) {
  const [state, setState] = useState('starting'); // starting | recording | preview | sending
  const [ms, setMs] = useState(0);
  const [clip, setClip] = useState(null); // { url, file, ms, peaks }
  const [levels, setLevels] = useState(() => Array(24).fill(0.1)); // niveaux du micro en direct
  const rec = useRef(null); const stream = useRef(null); const started = useRef(0); const timer = useRef(null); const cancelled = useRef(false);
  const audioCtx = useRef(null);

  const cleanup = () => {
    clearInterval(timer.current); stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    audioCtx.current?.close?.().catch?.(() => {}); audioCtx.current = null;
  };
  useEffect(() => {
    (async () => {
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const mime = MIME_CHOICES.find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
        const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
        const chunks = [];
        r.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
        r.onstop = () => {
          const dur = Date.now() - started.current;
          cleanup();
          if (cancelled.current) return;
          const type = r.mimeType || mime || 'audio/webm';
          const blob = new Blob(chunks, { type });
          if (dur < 500 || !blob.size) { notify('Enregistrement trop court.', 'error'); onCancel(); return; }
          const file = audioFile(blob, type);
          const url = URL.createObjectURL(blob);
          setClip({ url, file, ms: Math.min(dur, MAX_VOICE_MS), peaks: null });
          setState('preview');
          // Forme d'onde réelle de l'enregistrement (aperçu et bulle « envoi en cours »).
          blob.arrayBuffer().then((b) => peaksOf(b)).then((w) => { if (w) setClip((c) => (c ? { ...c, peaks: w.peaks, buffer: w.buffer } : c)); }).catch(() => {});
        };
        rec.current = r;
        // Niveaux du micro en direct (barres animées pendant l'enregistrement).
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          audioCtx.current = new AC();
          const an = audioCtx.current.createAnalyser(); an.fftSize = 256;
          audioCtx.current.createMediaStreamSource(stream.current).connect(an);
          const buf = new Uint8Array(an.fftSize);
          const sample = () => {
            if (!audioCtx.current) return;
            an.getByteTimeDomainData(buf);
            let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
            setLevels((l) => [...l.slice(1), Math.max(0.08, Math.min(1, peak * 2.2))]);
            setTimeout(sample, 90);
          };
          sample();
        } catch { /* niveaux indisponibles : l'enregistrement continue */ }
        r.start(250);
        started.current = Date.now();
        setState('recording');
        timer.current = setInterval(() => {
          const d = Date.now() - started.current; setMs(d);
          if (d >= MAX_VOICE_MS) r.state === 'recording' && r.stop();
        }, 200);
      } catch (err) {
        cleanup();
        notify(err?.name === 'NotAllowedError'
          ? 'Micro refusé. Autorisez le micro pour ce site dans les réglages du navigateur (icône à gauche de l’adresse), puis réessayez.'
          : 'Micro indisponible sur cet appareil.', 'error');
        onCancel();
      }
    })();
    return () => { cancelled.current = true; try { if (rec.current?.state === 'recording') rec.current.stop(); } catch { /* déjà arrêté */ } cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Libère l'adresse seulement quand l'enregistrement change (pas quand sa forme d'onde arrive).
  const clipUrl = clip?.url;
  useEffect(() => () => { if (clipUrl) URL.revokeObjectURL(clipUrl); }, [clipUrl]);

  const stop = () => { if (rec.current?.state === 'recording') rec.current.stop(); };
  const cancel = () => { cancelled.current = true; stop(); cleanup(); onCancel(); };

  if (state === 'preview' || state === 'sending') {
    return (
      <div className="recorder" role="group" aria-label="Message vocal prêt">
        <button type="button" className="iconBtn" onClick={cancel} aria-label="Supprimer l’enregistrement" disabled={state === 'sending'}><Trash2 size={18} aria-hidden="true" /></button>
        <VoicePlayer id={`preview-${clip.url}`} src={clip.url} durationMs={clip.ms} mine preloaded={{ url: clip.url, peaks: clip.peaks, buffer: clip.buffer }} />
        <button type="button" className="btn btnPrimary btnSmall sendBtn" disabled={state === 'sending'} onClick={async () => { setState('sending'); if (!(await onSend(clip.file, clip.ms, clip.peaks))) setState('preview'); }}>
          <Send size={16} aria-hidden="true" /> {state === 'sending' ? 'Envoi…' : 'Envoyer'}
        </button>
      </div>
    );
  }
  return (
    <div className="recorder recording" role="group" aria-label="Enregistrement en cours">
      <button type="button" className="iconBtn" onClick={cancel} aria-label="Annuler l’enregistrement"><X size={18} aria-hidden="true" /></button>
      <span className="recDot" aria-hidden="true" />
      <span className="recTime" aria-live="off">{state === 'starting' ? 'Micro…' : mmss(ms)}</span>
      <span className="recLevels" aria-hidden="true">{levels.map((l, i) => <span key={i} style={{ '--h': l }} />)}</span>
      <span className="sr">{state === 'recording' ? 'Enregistrement en cours, 5 minutes au plus.' : ''}</span>
      <button type="button" className="btn btnPrimary btnSmall" onClick={stop} disabled={state !== 'recording'}><Square size={14} aria-hidden="true" /> Arrêter</button>
    </div>
  );
}

// ------------------------------------------------------------------ Bulle
function Ticks({ m }) {
  if (m.status === 'sending') return <span className="ticks" title="Envoi en cours"><Clock size={13} aria-hidden="true" /><span className="sr">Envoi en cours</span></span>;
  if (m.status === 'waiting') return <span className="ticks waiting" title="En attente de connexion"><Clock size={13} aria-hidden="true" /><span className="waitText">En attente du réseau</span></span>;
  if (m.status === 'error') return null;
  if (m.read_at) return <span className="ticks read" title="Lu"><CheckCheck size={15} aria-hidden="true" /><span className="sr">Lu</span></span>;
  if (m.delivered_at) return <span className="ticks" title="Reçu"><CheckCheck size={15} aria-hidden="true" /><span className="sr">Reçu</span></span>;
  return <span className="ticks" title="Envoyé"><Check size={15} aria-hidden="true" /><span className="sr">Envoyé</span></span>;
}

function Attachment({ f, local }) {
  const isImage = f.mime_type?.startsWith('image/');
  const href = local ? f.url : `${fileUrl(f.id)}&inline=1`;
  if (isImage) {
    return (
      <a className="chatImage" href={href} target="_blank" rel="noreferrer" aria-label={`Ouvrir l’image ${f.original_name}`}>
        <img src={href} alt={f.original_name} loading="lazy" decoding="async" />
      </a>
    );
  }
  return (
    <a className="chatFile" href={local ? undefined : fileUrl(f.id)} download={f.original_name} target="_blank" rel="noreferrer">
      <FileText size={22} aria-hidden="true" />
      <span><strong>{f.original_name}</strong><small>{extOf(f.original_name)} · {sizeText(f.size_bytes)}</small></span>
      {!local && <Download size={16} aria-hidden="true" />}
    </a>
  );
}

function Bubble({ m, mine, showAuthor, onRetry }) {
  const files = m.files || [];
  const voice = m.kind === 'voice' ? files.find((f) => f.mime_type?.startsWith('audio/')) : null;
  const text = m.kind === 'text' ? m.body : m.kind === 'file' && m.body && !files.some((f) => m.body.includes(f.original_name)) ? m.body : '';
  return (
    <li className={`bubbleRow ${mine ? 'mine' : 'theirs'}`} data-mine={mine ? '1' : '0'}>
      {!mine && showAuthor && <Avatar user={{ avatar_file_id: m.author_avatar, full_name: m.author_name, first_name: m.author_first_name, last_name: m.author_last_name }} size={28} className="bubbleAvatar" />}
      <div className={`bubble ${mine ? 'mine' : 'theirs'}${m.status === 'error' ? ' failed' : ''}`}>
        {!mine && showAuthor && <span className="bubbleAuthor">{m.author_name || (m.author_role === 'admin' ? 'E-MAN PROD' : 'Client')}</span>}
        {voice ? <VoicePlayer id={voice.id} src={`/api/files?id=${voice.id}&stream=1`} durationMs={m.voice_ms} mine={mine} preloaded={voice.local ? { url: voice.url, peaks: voice.peaks } : null} />
          : files.length > 0 && <div className="bubbleFiles">{files.map((f) => <Attachment key={f.id} f={f} local={f.local} />)}</div>}
        {text && <p className="bubbleText">{text}</p>}
        <span className="bubbleMeta">
          <time dateTime={m.created_at}>{hm(m.created_at)}</time>
          {mine && <Ticks m={m} />}
        </span>
        {m.status === 'error' && (
          <span className="bubbleError" role="alert">Non envoyé. <button type="button" className="linkBtn" onClick={() => onRetry(m)}>Réessayer</button></span>
        )}
        {m.progress !== undefined && m.status === 'sending' && <progress className="bubbleProgress" max={1} value={m.progress} aria-label="Envoi du fichier" />}
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ Plein écran mobile
const MOBILE = '(max-width: 900px)';
/**
 * Conversation ouverte sur téléphone : plein écran, hauteur = partie VISIBLE de l'écran
 * (visualViewport), donc le clavier ne cache jamais la barre de saisie ; la page derrière ne
 * défile plus. Sur ordinateur : rien.
 */
function useMobileFullScreen(active) {
  useEffect(() => {
    if (!active || !window.matchMedia(MOBILE).matches) return undefined;
    const root = document.documentElement;
    const vv = window.visualViewport;
    const apply = () => {
      root.style.setProperty('--vv-h', `${Math.round(vv ? vv.height : window.innerHeight)}px`);
      root.style.setProperty('--vv-top', `${Math.round(vv ? vv.offsetTop : 0)}px`);
    };
    apply();
    root.classList.add('chatLocked');
    vv?.addEventListener('resize', apply); vv?.addEventListener('scroll', apply); window.addEventListener('resize', apply);
    return () => {
      root.classList.remove('chatLocked');
      root.style.removeProperty('--vv-h'); root.style.removeProperty('--vv-top');
      vv?.removeEventListener('resize', apply); vv?.removeEventListener('scroll', apply); window.removeEventListener('resize', apply);
    };
  }, [active]);
}

/**
 * Ordinateur et tablette en paysage : la conversation se place juste sous l'en-tête du site et
 * occupe exactement la hauteur restante de la fenêtre (comme WhatsApp Web) : barre de saisie
 * toujours visible, seule la liste des messages défile.
 */
function useDesktopFit(ref) {
  useEffect(() => {
    if (window.matchMedia(MOBILE).matches) return undefined;
    const el = ref.current; if (!el) return undefined;
    const headerH = () => Math.round(document.querySelector('.header')?.getBoundingClientRect().height || 0);
    const fit = () => {
      if (window.matchMedia(MOBILE).matches) { el.style.removeProperty('--chat-h'); el.style.removeProperty('--chat-top'); return; }
      const h = headerH();
      el.style.setProperty('--chat-top', `${h + 12}px`);
      el.style.setProperty('--chat-h', `${Math.max(420, window.innerHeight - h - 24)}px`);
    };
    fit();
    const top = el.getBoundingClientRect().top + window.scrollY - headerH() - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [ref]);
}

// ------------------------------------------------------------------ Conversation
/**
 * @param {{who: string, side: 'client'|'team', me: string, notify: Function, onBack?: Function, onChanged?: Function, onOpenProfile?: Function}} p
 */
export function ChatView({ who, side, me, notify, onBack, onChanged, onOpenProfile }) {
  const [state, setState] = useState({ messages: [], hasMore: false, peer: null, conversation: null, loaded: false });
  const [error, setError] = useState(null);
  const [pending, setPending] = useState([]); // messages en cours d'envoi (affichage immédiat)
  const [olderBusy, setOlderBusy] = useState(false);
  const [typing, setTyping] = useState(null);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]); // { id, file, url, progress }
  const [recording, setRecording] = useState(false);
  const listRef = useRef(null); const topRef = useRef(null); const stick = useRef(true); const keepFrom = useRef(null);
  const lastTyping = useRef(0); const fileInput = useRef(null);
  // Rappel du parent gardé dans une référence : un nouveau rendu du parent ne recharge pas la conversation.
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;

  const load = useCallback(async () => {
    try {
      const r = await chatApi.list(who, { mark: document.visibilityState === 'visible' });
      setError(null);
      setState((s) => {
        // Les messages plus anciens déjà chargés sont gardés (historique progressif).
        const first = r.messages[0]?.created_at;
        const older = first ? s.messages.filter((m) => m.created_at < first && !r.messages.some((x) => x.id === m.id)) : [];
        return { messages: [...older, ...r.messages], hasMore: older.length ? s.hasMore : r.has_more, peer: r.peer, conversation: r.conversation, loaded: true };
      });
      changedRef.current?.();
    } catch (err) { setError(err.message); }
  }, [who]);

  useEffect(() => { setState({ messages: [], hasMore: false, peer: null, conversation: null, loaded: false }); setPending([]); stick.current = true; load(); }, [who, load]);

  // Temps réel : conversation modifiée (nouveau message, reçu, lu), « écrit… », présence.
  useEffect(() => onChat((e) => {
    const conv = state.conversation;
    if (e.type === 'resync') load();
    if (e.type === 'chat' && conv && e.threads?.includes(conv)) load();
    if (e.type === 'typing' && conv) {
      const t = (e.typing || []).find((x) => x.thread === conv);
      setTyping(t ? t.name : null);
    }
    if (e.type === 'presence' && conv) {
      setState((s) => (!s.peer ? s : { ...s, peer: { ...s.peer, online: side === 'client' ? Boolean(e.team_online) : (e.online || []).includes(conv), ...(side === 'client' ? {} : { last_active_at: (e.online || []).includes(conv) ? null : s.peer.last_active_at || new Date().toISOString() }) } }));
    }
  }), [state.conversation, side, load]);
  // Nouveau message : la notification arrive la première (≈ 1 s) → relecture immédiate.
  useEffect(() => onLive((n) => String(n?.kind || '').startsWith('message.') && /section=(messagerie|assistance)/.test(n.link || '')
    && (side === 'client' || String(n.link).includes(String(state.conversation))), () => load(), { resync: false }), [state.conversation, side, load]);
  useEffect(() => {
    const t = chatState.typing.find((x) => x.thread === state.conversation);
    setTyping(t ? t.name : null);
  }, [state.conversation]);
  // Filet de sécurité : sans aucun signal depuis 25 s, la conversation est relue (toutes les 30 s).
  const lastSignal = useRef(Date.now());
  useEffect(() => onChat(() => { lastSignal.current = Date.now(); }), []);
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine && Date.now() - lastSignal.current > 25000) { lastSignal.current = Date.now(); load(); }
    }, 30000);
    return () => clearInterval(t);
  }, [load]);
  // Retour sur l'onglet : la conversation est relue (et marquée comme lue).
  useEffect(() => {
    const v = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', v);
    return () => document.removeEventListener('visibilitychange', v);
  }, [load]);

  // Défilement : en bas à l'ouverture et à chaque nouveau message si on était déjà en bas.
  // Un message en attente déjà arrivé par le temps réel n'est pas affiché deux fois.
  const all = [...state.messages, ...pending.filter((p) => !state.messages.some((m) => m.client_ref && m.client_ref === p.ref))];
  useLayoutEffect(() => {
    const el = listRef.current; if (!el) return;
    if (keepFrom.current !== null) { el.scrollTop = el.scrollHeight - keepFrom.current; keepFrom.current = null; return; }
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [all.length, typing]);
  const onScroll = () => { const el = listRef.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
  // Clavier du téléphone ouvert / fermé : la liste rétrécit ; on garde le dernier message en vue.
  useEffect(() => {
    const vv = window.visualViewport; if (!vv) return undefined;
    const h = () => { const el = listRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; };
    vv.addEventListener('resize', h);
    return () => vv.removeEventListener('resize', h);
  }, []);
  const taRef = useRef(null);
  // Zone de texte qui grandit avec le message (5 lignes au plus), sans pousser la barre hors de l'écran.
  useLayoutEffect(() => {
    const t = taRef.current; if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(140, t.scrollHeight)}px`;
  }, [text]);
  // Une photo qui finit de charger agrandit la liste : on reste collé en bas si on y était.
  useEffect(() => {
    const el = listRef.current; if (!el) return undefined;
    const h = (e) => { if (e.target.tagName === 'IMG' && stick.current) el.scrollTop = el.scrollHeight; };
    el.addEventListener('load', h, true);
    return () => el.removeEventListener('load', h, true);
  }, []);

  const loadOlder = useCallback(async () => {
    if (olderBusy || !state.hasMore || !state.messages.length) return;
    setOlderBusy(true);
    try {
      const r = await chatApi.list(who, { before: state.messages[0].created_at, mark: false });
      keepFrom.current = listRef.current.scrollHeight - listRef.current.scrollTop;
      setState((s) => ({ ...s, messages: [...r.messages.filter((m) => !s.messages.some((x) => x.id === m.id)), ...s.messages], hasMore: r.has_more }));
    } catch (err) { notify(err.message, 'error'); } finally { setOlderBusy(false); }
  }, [olderBusy, state.hasMore, state.messages, who, notify]);
  // Chargement progressif automatique en remontant.
  useEffect(() => {
    if (!topRef.current || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((en) => { if (en[0].isIntersecting) loadOlder(); }, { root: listRef.current, rootMargin: '120px' });
    io.observe(topRef.current);
    return () => io.disconnect();
  }, [loadOlder, state.loaded]);

  // ------------------------------------------------ Envoi
  // 1. Le message s'affiche aussitôt (« envoi en cours ») ; 2. le serveur l'enregistre et le renvoie
  // (« envoyé ») ; 3. coupure réseau : « en attente », renvoyé tout seul au retour de la connexion.
  // Chaque message porte une référence unique : un renvoi ne crée jamais de doublon.
  const pendingRef = useRef([]); const flushing = useRef(false);
  pendingRef.current = pending;
  const update = (id, patch) => setPending((p) => p.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const mergeOne = (msg) => setState((s) => (s.messages.some((x) => x.id === msg.id) ? s : { ...s, messages: [...s.messages, msg].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))) }));
  async function deliver(temp) {
    stick.current = true;
    const job = temp.retry;
    try {
      const ids = [...(temp.uploaded || [])];
      for (let i = ids.length; i < job.files.length; i++) {
        const f = await uploadFile('message', null, job.files[i], { onProgress: (p) => update(temp.id, { progress: (i + p) / job.files.length }) });
        ids.push(f.id);
        update(temp.id, { uploaded: [...ids] }); // déjà envoyés : pas renvoyés en cas de nouvel essai
        temp = { ...temp, uploaded: [...ids] };
      }
      const r = await chatApi.send(who, job.voice
        ? { kind: 'voice', file_ids: ids, voice_ms: Math.round(job.voice), client_ref: temp.ref }
        : { body: job.body, file_ids: ids, kind: ids.length && !job.body ? 'file' : 'text', client_ref: temp.ref });
      mergeOne(r.message);
      setPending((p) => p.filter((m) => m.id !== temp.id));
      changedRef.current?.();
      return 'sent';
    } catch (err) {
      // Réseau coupé ou serveur momentanément indisponible : on garde le message et on réessaie.
      const transient = !err.status || err.status >= 500 || err.status === 429 || !navigator.onLine;
      if (transient) {
        const attempt = (temp.attempt || 0) + 1;
        update(temp.id, { status: 'waiting', attempt, nextAt: Date.now() + Math.min(30000, 2000 * 2 ** (attempt - 1)) });
        return 'waiting';
      }
      update(temp.id, { status: 'error', error: err.message });
      notify(err.message, 'error');
      return false;
    }
  }
  // Messages en attente : renvoyés au retour du réseau, puis à intervalles croissants (30 s au plus).
  useEffect(() => {
    // Un par un, dans l'ordre d'écriture : l'ordre des messages est conservé au retour du réseau.
    const flush = async (force = false) => {
      if (flushing.current || !navigator.onLine) return;
      const first = pendingRef.current.find((m) => m.status === 'waiting');
      if (!first || (!force && Date.now() < (first.nextAt || 0))) return;
      flushing.current = true;
      try {
        for (const m of pendingRef.current.filter((x) => x.status === 'waiting')) {
          update(m.id, { status: 'sending' });
          if ((await deliver({ ...m, status: 'sending' })) !== 'sent') break; // encore coupé : on garde l'ordre
        }
      } finally { flushing.current = false; }
    };
    const t = setInterval(() => flush(false), 2000);
    const on = () => flush(true);
    window.addEventListener('online', on);
    return () => { clearInterval(t); window.removeEventListener('online', on); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who]);
  const newRef = () => { try { return crypto.randomUUID().replace(/-/g, ''); } catch { return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`; } };
  function queue({ body = '', files: list = [], voice = null, peaks = null }) {
    const temp = {
      id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ref: newRef(), author_id: me, kind: voice ? 'voice' : list.length && !body ? 'file' : 'text', body, voice_ms: voice,
      created_at: new Date().toISOString(), status: 'sending', progress: list.length ? 0 : undefined,
      files: list.map((f, i) => ({ id: `l${Date.now()}-${i}`, local: true, url: URL.createObjectURL(f), original_name: f.name, mime_type: f.type, size_bytes: f.size, peaks })),
      retry: { body, files: list, voice },
    };
    // Des messages attendent déjà le réseau : celui-ci passe après eux (ordre conservé).
    if (pendingRef.current.some((m) => m.status === 'waiting')) {
      const waiting = { ...temp, status: 'waiting', nextAt: 0 };
      pendingRef.current = [...pendingRef.current, waiting];
      setPending((p) => [...p, waiting]);
      return Promise.resolve('waiting');
    }
    setPending((p) => [...p, temp]);
    return deliver(temp);
  }
  const retry = (m) => { update(m.id, { status: 'sending', progress: m.retry.files.length ? 0 : undefined }); deliver({ ...m, status: 'sending' }); };

  const submit = (e) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body && !files.length) return;
    queue({ body, files: files.map((f) => f.file) });
    setText(''); setFiles([]);
    lastTyping.current = 0; // le serveur a effacé « écrit… » : la prochaine frappe le signale aussitôt
  };
  const onType = (v) => {
    setText(v);
    if (v && Date.now() - lastTyping.current > 3000 && !DEMO) { lastTyping.current = Date.now(); chatApi.typing(who).catch(() => {}); }
  };
  const addFiles = (list) => {
    const chosen = [...list].slice(0, 5 - files.length);
    if (list.length > chosen.length) notify('5 fichiers au plus par message.', 'error');
    const tooBig = chosen.find((f) => f.size > 25 * 1048576 && !f.type.startsWith('image/'));
    if (tooBig) { notify(`« ${tooBig.name} » dépasse 25 Mo.`, 'error'); return; }
    setFiles((cur) => [...cur, ...chosen.map((file) => ({ id: `${file.name}-${file.size}-${Math.random()}`, file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null }))]);
  };

  const peer = state.peer;
  const title = side === 'client' ? 'E-MAN PROD' : peer?.full_name || 'Client';
  const headUser = side === 'client' ? (peer?.members?.[0] || { full_name: 'E-MAN PROD' }) : peer;
  if (error && !state.loaded) return <section className="chatPane"><ErrorBox error={error} onRetry={load} /></section>;
  return (
    <section className="chatPane" aria-label={`Conversation avec ${title}`}>
      <header className="chatHead">
        {onBack && <button type="button" className="iconBtn chatBack" onClick={onBack} aria-label="Retour aux conversations"><ArrowLeft size={20} aria-hidden="true" /></button>}
        <button type="button" className="chatWho" onClick={() => onOpenProfile?.(peer)} aria-label={`Voir le profil : ${title}`} disabled={!peer}>
          <span className="avatarWrap"><Avatar user={headUser} size={40} /><PresenceDot online={peer?.online} label={false} /></span>
          <span className="chatWhoText">
            <strong>{title}</strong>
            <small className={typing ? 'typing' : peer?.online ? 'online' : ''}>{typing ? (side === 'client' ? `${String(typing).split(' ')[0]} écrit un message…` : 'écrit un message…') : peer ? presenceText(peer) : '…'}</small>
          </span>
        </button>
        {onOpenProfile && peer && <button type="button" className="btn btnGhost btnSmall chatProfileBtn" onClick={() => onOpenProfile(peer)}><UserRound size={16} aria-hidden="true" /> Profil</button>}
      </header>

      <ol className="chatList" ref={listRef} onScroll={onScroll} aria-live="polite" aria-relevant="additions">
        <li ref={topRef} className="chatTop" aria-hidden={!state.hasMore}>
          {state.hasMore ? <button type="button" className="linkBtn" onClick={loadOlder} disabled={olderBusy}>{olderBusy ? 'Chargement…' : 'Messages précédents'}</button>
            : state.loaded && all.length > 0 ? <span className="muted">Début de la conversation</span> : null}
        </li>
        {!state.loaded ? <li className="chatLoading"><Loading lines={3} /></li>
          : !all.length ? (
            <li className="chatEmpty"><EmptyState title="Pas encore de message" text={side === 'client'
              ? 'Écrivez votre question, envoyez une photo, un document ou un message vocal : l’équipe vous répond ici.'
              : 'Écrivez le premier message à ce client.'} /></li>
          ) : all.map((m, i) => {
            const prev = all[i - 1];
            const mine = m.author_id === me;
            const newDay = !prev || !sameDay(prev.created_at, m.created_at);
            // Nom de l'auteur au début d'une suite de messages reçus (utile avec plusieurs collègues).
            const showAuthor = !mine && (newDay || prev.author_id !== m.author_id);
            return (
              <React.Fragment key={m.id}>
                {newDay && <li className="chatDay"><span>{dayLabel(m.created_at)}</span></li>}
                <Bubble m={m} mine={mine} showAuthor={showAuthor} onRetry={retry} />
              </React.Fragment>
            );
          })}
        {typing && <li className="bubbleRow theirs typingRow" aria-label="écrit un message"><div className="bubble theirs typingBubble"><span /><span /><span /></div></li>}
      </ol>

      <div className="chatCompose">
        {recording ? (
          <VoiceRecorder notify={notify} onCancel={() => setRecording(false)} onSend={async (file, ms, peaks) => { setRecording(false); return queue({ files: [file], voice: ms, peaks }); }} />
        ) : (
          <form onSubmit={submit} className="composeForm">
            {files.length > 0 && (
              <ul className="composeFiles" aria-label="Fichiers à envoyer">
                {files.map((f) => (
                  <li key={f.id}>
                    {f.url ? <img src={f.url} alt="" /> : <FileText size={20} aria-hidden="true" />}
                    <span><strong>{f.file.name}</strong><small>{extOf(f.file.name)} · {sizeText(f.file.size)}</small></span>
                    <button type="button" className="iconBtn" aria-label={`Retirer ${f.file.name}`} onClick={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))}><X size={16} aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
            )}
            <div className="composeRow">
              <button type="button" className="iconBtn" aria-label="Joindre une photo ou un document" onClick={() => fileInput.current?.click()} disabled={DEMO || files.length >= 5}>
                <Paperclip size={20} aria-hidden="true" />
              </button>
              <input ref={fileInput} type="file" className="sr" multiple accept={ACCEPT} tabIndex={-1} aria-hidden="true" onChange={(e) => { addFiles(e.target.files || []); e.target.value = ''; }} />
              <label className="sr" htmlFor={`compose-${who}`}>Votre message</label>
              <textarea ref={taRef} id={`compose-${who}`} rows={1} enterKeyHint="send" onFocus={() => { stick.current = true; setTimeout(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, 250); }} maxLength={4000} value={text} placeholder="Écrire un message…" disabled={DEMO}
                onChange={(e) => onType(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !window.matchMedia('(pointer: coarse)').matches) submit(e); }}
                onPaste={(e) => { if (e.clipboardData?.files?.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }} />
              {text.trim() || files.length || !canRecord() ? (
                <button type="submit" className="sendBtn roundSend" aria-label="Envoyer" disabled={DEMO || (!text.trim() && !files.length)}><Send size={18} aria-hidden="true" /></button>
              ) : (
                <button type="button" className="sendBtn roundSend" aria-label="Enregistrer un message vocal" disabled={DEMO} onClick={() => setRecording(true)}><Mic size={18} aria-hidden="true" /></button>
              )}
            </div>
            <p className="composeHint">Photos, PDF, Word, Excel, PowerPoint, AI, EPS, PSD, CDR, ZIP : 25 Mo max. Entrée pour envoyer, Maj + Entrée pour aller à la ligne.</p>
          </form>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Profils
export function ProfileSheet({ open, onClose, children, title }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    ref.current?.focus();
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('keydown', k); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheetBackdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <button type="button" className="iconBtn sheetClose" onClick={onClose} aria-label="Fermer"><X size={20} aria-hidden="true" /></button>
        {children}
      </aside>
    </div>
  );
}

function TeamProfile({ team }) {
  return (
    <div className="profileCard">
      <h2 className="subTitle">L’équipe E-MAN PROD</h2>
      <p className="muted">{team.online ? 'Un membre de l’équipe est en ligne.' : team.last_active_at ? `Hors ligne · ${lastSeen(team.last_active_at)}` : 'Hors ligne pour le moment : votre message sera lu dès son retour.'}</p>
      <ul className="memberList">
        {(team.members || []).map((m) => (
          <li key={m.id}>
            <span className="avatarWrap"><Avatar user={{ ...m, full_name: m.name }} size={72} /><PresenceDot online={m.online} /></span>
            <div>
              <strong className="memberName">{m.name}</strong>
              <span className="memberTitle">{m.job_title || 'Équipe'} · {m.company}</span>
              <small className={m.online ? 'online' : 'muted'}>{presenceText(m)}</small>
              {m.bio && <p className="memberBio">{m.bio}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ClientProfile({ id, go }) {
  const [p, setP] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => { chatApi.profile(id).then((r) => setP(r.profile)).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <ErrorBox error={err} />;
  if (!p) return <Loading lines={4} />;
  const since = new Date(p.created_at).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return (
    <div className="profileCard">
      <div className="profileHead">
        <span className="avatarWrap"><Avatar user={p} size={88} className="big" /><PresenceDot online={p.online} /></span>
        <div>
          <h2 className="subTitle">{p.full_name}</h2>
          <small className={p.online ? 'online' : 'muted'}>{presenceText(p)}</small>
        </div>
      </div>
      <dl className="profileFacts">
        <dt>E-mail</dt><dd><a href={`mailto:${p.email}`}>{p.email}</a></dd>
        {p.phone && <><dt>Téléphone</dt><dd><a href={`tel:${p.phone}`}>{p.phone}</a></dd></>}
        {p.whatsapp && <><dt>WhatsApp</dt><dd><a href={`https://wa.me/${p.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">{p.whatsapp}</a></dd></>}
        {p.company_name && <><dt>Entreprise</dt><dd>{p.company_name}</dd></>}
        {p.city && <><dt>Ville</dt><dd>{p.city}</dd></>}
        <dt>Client depuis</dt><dd>{since}</dd>
        <dt>Demandes</dt><dd>{p.quotes} devis · {p.orders} commande{p.orders > 1 ? 's' : ''}</dd>
      </dl>
      {go && <button type="button" className="btn btnGhost btnSmall" onClick={() => go('clients', { id: p.id })}>Ouvrir la fiche client</button>}
    </div>
  );
}

// ------------------------------------------------------------------ Espace client
export function ClientMessaging({ user, notify, onChanged, onBack }) {
  const [sheet, setSheet] = useState(false);
  const shell = useRef(null);
  useMobileFullScreen(true);
  useDesktopFit(shell);
  const [team, setTeam] = useState(null);
  const openProfile = useCallback(async (peer) => { setTeam(peer); setSheet(true); try { setTeam(await chatApi.team()); } catch { /* garde la version affichée */ } }, []);
  return (
    <div className="chatShell single full" ref={shell}>
      <ChatView who="me" side="client" me={user.id} notify={notify} onChanged={onChanged} onOpenProfile={openProfile} onBack={onBack} />
      <ProfileSheet open={sheet} onClose={() => setSheet(false)} title="Profil de l’équipe E-MAN PROD">{team && <TeamProfile team={team} />}</ProfileSheet>
    </div>
  );
}

// ------------------------------------------------------------------ Espace équipe
export function ChatInbox({ user, notify, params = {}, go, onChanged }) {
  const [threads, setThreads] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(params.client || null);
  // Présence : celle du flux temps réel dès qu'il en a donné une, sinon celle de la liste.
  const [online, setOnline] = useState(chatState.presenceKnown ? chatState.online : null);
  const [typing, setTypingList] = useState(chatState.typing);
  const [profile, setProfile] = useState(null);

  const load = useCallback(async (search = q) => {
    // Relecture en arrière-plan qui échoue (réseau coupé) : la liste affichée reste en place.
    try { setThreads((await chatApi.threads(search)).threads); setError(null); } catch (err) { setThreads((t) => { if (!t) setError(err.message); return t; }); }
  }, [q]);
  useEffect(() => { const t = setTimeout(() => load(q), q ? 300 : 0); return () => clearTimeout(t); }, [q, load]);
  useEffect(() => onChat((e) => {
    if (e.type === 'chat' || e.type === 'resync') load();
    if (e.type === 'presence' && e.online) setOnline(new Set(e.online));
    if (e.type === 'typing') setTypingList(e.typing || []);
  }), [load]);
  const parentChanged = useRef(onChanged);
  parentChanged.current = onChanged;
  const changed = useCallback(() => { load(); parentChanged.current?.(); }, [load]);
  const select = (id) => { setOpen(id); const u = new URLSearchParams(window.location.search); u.set('section', 'messagerie'); u.set('client', id); window.history.replaceState(null, '', `?${u}`); };
  const back = () => { setOpen(null); const u = new URLSearchParams(window.location.search); u.delete('client'); window.history.replaceState(null, '', `?${u}`); };
  useMobileFullScreen(Boolean(open));
  const shell = useRef(null);
  useDesktopFit(shell);

  return (
    <div className={`chatShell${open ? ' hasOpen full' : ''}`} ref={shell}>
      <aside className="chatThreads" aria-label="Conversations">
        <div className="chatSearch">
          <Search size={16} aria-hidden="true" />
          <label className="sr" htmlFor="chat-search">Rechercher un client</label>
          <input id="chat-search" type="search" placeholder="Rechercher un client (nom, e-mail, téléphone)" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {error ? <ErrorBox error={error} onRetry={() => load()} /> : !threads ? <Loading lines={4} /> : !threads.length ? (
          <EmptyState title={q ? 'Aucun client trouvé' : 'Aucune conversation'} text={q ? 'Vérifiez l’orthographe, ou cherchez par e-mail.' : 'Les messages des clients arrivent ici. Cherchez un client pour lui écrire.'} />
        ) : (
          <ul className="threadList">
            {threads.map((t) => {
              const isOnline = online ? online.has(t.id) : t.online;
              const isTyping = typing.some((x) => x.thread === t.id);
              const mineLast = t.last_author === user.id;
              const previewText = !t.last_at ? 'Aucun message : écrire au client'
                : t.last_kind === 'voice' ? '🎤 Message vocal' : t.last_kind === 'file' ? `📎 ${t.last_body}` : t.last_body;
              return (
                <li key={t.id}>
                  <button type="button" className={`threadItem${open === t.id ? ' active' : ''}${t.unread ? ' unread' : ''}`} onClick={() => select(t.id)} aria-current={open === t.id ? 'true' : undefined}>
                    <span className="avatarWrap"><Avatar user={t} size={46} /><PresenceDot online={isOnline} /></span>
                    <span className="threadText">
                      <span className="threadTop"><strong>{t.full_name}</strong>{t.last_at && <time dateTime={t.last_at}>{whenShort(t.last_at)}</time>}</span>
                      <span className="threadBottom">
                        <span className={`threadPreview${isTyping ? ' typing' : ''}`}>
                          {isTyping ? 'écrit un message…' : <>{mineLast && <Ticks m={{ read_at: t.last_read_at, delivered_at: t.last_delivered_at }} />}{mineLast ? 'Vous : ' : t.last_role === 'admin' ? 'Équipe : ' : ''}{previewText}</>}
                        </span>
                        {t.unread > 0 && <span className="badgeCount" aria-label={`${t.unread} non lu${t.unread > 1 ? 's' : ''}`}>{t.unread}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
      {open ? (
        <ChatView key={open} who={open} side="team" me={user.id} notify={notify} onBack={back} onChanged={changed} onOpenProfile={() => setProfile(open)} />
      ) : (
        <section className="chatPane chatPlaceholder"><Info size={28} aria-hidden="true" /><p>Choisissez une conversation, ou cherchez un client pour lui écrire.</p></section>
      )}
      <ProfileSheet open={Boolean(profile)} onClose={() => setProfile(null)} title="Profil du client">{profile && <ClientProfile id={profile} go={go} />}</ProfileSheet>
    </div>
  );
}
