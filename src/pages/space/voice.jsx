// Lecteur de messages vocaux intégré aux bulles (façon WhatsApp) : forme d'onde calculée sur le
// vrai son, progression animée, avance / recul en touchant ou en glissant sur l'onde, vitesse.
//
// Le fichier est chargé UNE fois (par le site, avec les droits vérifiés : /api/files?stream=1),
// gardé en mémoire le temps de la visite, puis lu localement : la lecture et le déplacement dans
// l'enregistrement sont instantanés et rien n'est téléchargé dans les Téléchargements.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';

export const BARS = 40;
const cache = new Map(); // id → Promise<{ url, peaks|null, duration|null }>

/** Onde de remplacement (avant décodage, ou si le navigateur ne sait pas décoder) : stable par fichier. */
export function pseudoPeaks(seed = 'x', n = BARS) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Array.from({ length: n }, (_, i) => {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const r = ((h >>> 0) % 1000) / 1000;
    return 0.25 + 0.6 * r * (0.6 + 0.4 * Math.sin((i / n) * Math.PI));
  });
}

/** Niveaux (0 à 1) de N tranches du son : la vraie forme d'onde. */
export async function peaksOf(arrayBuffer, n = BARS) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  try {
    const audio = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const data = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / n));
    const out = [];
    for (let i = 0; i < n; i++) {
      let sum = 0; let count = 0;
      for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 16) { sum += data[j] * data[j]; count += 1; }
      out.push(Math.sqrt(sum / Math.max(1, count)));
    }
    const max = Math.max(...out, 0.0001);
    // Racine carrée : les passages calmes restent visibles, comme sur WhatsApp.
    return { peaks: out.map((v) => Math.max(0.14, Math.min(1, Math.sqrt(v / max)))), duration: audio.duration, buffer: audio };
  } catch {
    return null;
  } finally {
    ctx.close?.().catch?.(() => {});
  }
}

function load(id, src) {
  if (!cache.has(id)) {
    cache.set(id, (async () => {
      const r = await fetch(src, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(r.status === 404 ? 'Message vocal introuvable.' : 'Lecture impossible pour le moment.');
      const buf = await r.arrayBuffer();
      const type = r.headers.get('content-type') || 'audio/webm';
      const url = URL.createObjectURL(new Blob([buf], { type }));
      const wave = await peaksOf(buf);
      return { url, peaks: wave?.peaks || null, duration: wave?.duration || null, buffer: wave?.buffer || null };
    })().catch((err) => { cache.delete(id); throw err; }));
  }
  return cache.get(id);
}

/**
 * Lecture de secours par Web Audio : certains navigateurs (Safari sur iPhone selon la version)
 * refusent un enregistrement WebM dans le lecteur audio, mais savent le décoder. On joue alors le
 * son décodé directement, avec les mêmes commandes (pause, reprise, avancer, vitesse).
 */
function webAudioEngine(buffer, { onEnd }) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  let src = null; let offset = 0; let t0 = 0; let rate = 1; let playing = false;
  const stopSrc = () => { if (src) { src.onended = null; try { src.stop(); } catch { /* déjà arrêté */ } src.disconnect(); src = null; } };
  const api = {
    get time() { return playing ? Math.min(buffer.duration, offset + (ctx.currentTime - t0) * rate) : offset; },
    get playing() { return playing; },
    async play() {
      await ctx.resume();
      stopSrc();
      if (offset >= buffer.duration - 0.05) offset = 0;
      src = ctx.createBufferSource(); src.buffer = buffer; src.playbackRate.value = rate; src.connect(ctx.destination);
      src.onended = () => { playing = false; offset = 0; stopSrc(); onEnd(); };
      t0 = ctx.currentTime; src.start(0, offset); playing = true;
    },
    pause() { if (!playing) return; offset = api.time; playing = false; stopSrc(); },
    seek(t) { const was = playing; api.pause(); offset = Math.max(0, Math.min(buffer.duration, t)); if (was) api.play(); },
    setRate(r) { const t = api.time; rate = r; if (playing) { offset = t; api.play(); } },
    close() { stopSrc(); ctx.close?.().catch?.(() => {}); },
  };
  return api;
}

const mmss = (s) => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const slowNetwork = () => { const c = navigator.connection; return Boolean(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))); };

/**
 * @param {{ id: string, src: string, durationMs?: number, mine?: boolean, preloaded?: {url: string, peaks?: number[]} }} p
 *   preloaded : enregistrement local (aperçu avant envoi), déjà en mémoire.
 */
export function VoicePlayer({ id, src, durationMs = 0, mine = false, preloaded = null }) {
  const audioRef = useRef(null); const rootRef = useRef(null); const raf = useRef(0);
  const [state, setState] = useState(preloaded ? 'ready' : 'idle'); // idle | loading | ready | error
  const [url, setUrl] = useState(preloaded?.url || null);
  const [peaks, setPeaks] = useState(preloaded?.peaks || pseudoPeaks(id));
  const [duration, setDuration] = useState(durationMs / 1000 || 0);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState('');
  const bufferRef = useRef(preloaded?.buffer || null); const engine = useRef(null);
  useEffect(() => () => engine.current?.close(), []);

  const prepare = useCallback(async () => {
    if (url || state === 'loading') return url;
    setState('loading'); setError('');
    try {
      const r = await load(id, src);
      setUrl(r.url);
      bufferRef.current = r.buffer;
      if (r.peaks) setPeaks(r.peaks);
      if (!durationMs && r.duration) setDuration(r.duration);
      setState('ready');
      return r.url;
    } catch (err) {
      setState('error'); setError(err.message || 'Lecture impossible.');
      return null;
    }
  }, [url, state, id, src, durationMs]);

  // Préparation dès que la bulle est visible (sauf connexion lente : au premier appui).
  useEffect(() => {
    if (preloaded || url || slowNetwork() || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { prepare(); io.disconnect(); } }, { rootMargin: '200px' });
    if (rootRef.current) io.observe(rootRef.current);
    return () => io.disconnect();
  }, [preloaded, url, prepare]);
  const preUrl = preloaded?.url; const prePeaks = preloaded?.peaks; const preBuffer = preloaded?.buffer;
  useEffect(() => { if (preUrl) { setUrl(preUrl); setState('ready'); } }, [preUrl]);
  useEffect(() => { if (prePeaks) setPeaks(prePeaks); }, [prePeaks]);
  useEffect(() => { if (preBuffer) bufferRef.current = preBuffer; }, [preBuffer]);

  // Progression fluide pendant la lecture.
  const frame = useCallback(() => {
    const a = audioRef.current;
    if (engine.current) setPos(engine.current.time); else if (a) setPos(a.currentTime);
    raf.current = requestAnimationFrame(frame);
  }, []);
  /** Bascule sur la lecture Web Audio (format refusé par le lecteur du navigateur). */
  const playDecoded = async (from = 0) => {
    if (!bufferRef.current) return false;
    if (!engine.current) {
      engine.current = webAudioEngine(bufferRef.current, { onEnd: () => { setPlaying(false); cancelAnimationFrame(raf.current); setPos(0); } });
      if (!durationMs) setDuration(bufferRef.current.duration);
    }
    engine.current.setRate(rate);
    engine.current.seek(from);
    await engine.current.play();
    setPlaying(true); setState('ready'); setError('');
    cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(frame);
    return true;
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const onLoaded = () => {
    const a = audioRef.current;
    // Enregistrements du navigateur (WebM) : durée parfois « infinie » ; on force le calcul pour
    // pouvoir se déplacer dans le fichier, puis on revient au début.
    if (!Number.isFinite(a.duration)) {
      const fix = () => { a.removeEventListener('timeupdate', fix); a.currentTime = 0; };
      a.addEventListener('timeupdate', fix); a.currentTime = 1e7;
    } else if (!durationMs) setDuration(a.duration);
  };

  const toggle = async () => {
    const a = audioRef.current;
    if (playing) {
      if (engine.current) { engine.current.pause(); setPlaying(false); cancelAnimationFrame(raf.current); } else a.pause();
      return;
    }
    const u = url || (await prepare());
    if (!u) return;
    document.querySelectorAll('audio[data-voice]').forEach((o) => { if (o !== a) o.pause(); });
    window.dispatchEvent(new CustomEvent('eman:voice-play', { detail: id }));
    if (engine.current) { await playDecoded(pos); return; }
    try {
      if (a.src !== u) a.src = u;
      a.playbackRate = rate;
      if (window.__forceWebAudio) throw Object.assign(new Error('test'), { name: 'NotSupportedError' });
      await a.play();
    } catch (err) {
      // Format refusé par le lecteur du navigateur : lecture du son décodé.
      if (await playDecoded(pos).catch(() => false)) return;
      setState('error'); setError(err?.name === 'NotSupportedError' ? 'Format audio non lisible sur cet appareil.' : 'Lecture impossible.');
    }
  };
  // Un seul message vocal à la fois, quel que soit le mode de lecture.
  useEffect(() => {
    const h = (e) => { if (e.detail !== id && engine.current?.playing) { engine.current.pause(); setPlaying(false); cancelAnimationFrame(raf.current); } };
    window.addEventListener('eman:voice-play', h);
    return () => window.removeEventListener('eman:voice-play', h);
  }, [id]);
  const seekTo = (t) => {
    const a = audioRef.current; const d = duration || a?.duration || 0;
    const clamped = Math.max(0, Math.min(d || t, t));
    setPos(clamped);
    if (engine.current) engine.current.seek(clamped);
    else if (a && url) a.currentTime = clamped;
  };

  const pct = duration ? Math.min(1, pos / duration) : 0;
  const played = Math.round(pct * peaks.length);
  return (
    <div className={`voice${mine ? ' mine' : ''}${playing ? ' playing' : ''}`} ref={rootRef} data-state={state}>
      <audio ref={audioRef} data-voice preload="none"
        onPlay={() => { setPlaying(true); cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(frame); }}
        onPause={() => { setPlaying(false); cancelAnimationFrame(raf.current); }}
        onEnded={() => { setPlaying(false); cancelAnimationFrame(raf.current); setPos(0); }}
        onLoadedMetadata={onLoaded}
        onError={() => { if (url && !engine.current && !bufferRef.current) { setState('error'); setError('Format audio non lisible sur cet appareil.'); } }} />
      <button type="button" className="voiceBtn" onClick={state === 'error' ? () => { setState('idle'); setUrl(null); cache.delete(id); prepare(); } : toggle}
        aria-label={state === 'error' ? 'Réessayer la lecture' : playing ? 'Mettre en pause' : 'Écouter le message vocal'} disabled={state === 'loading' && !url}>
        {state === 'error' ? <RotateCcw size={18} aria-hidden="true" /> : playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
        {state === 'loading' && <span className="voiceSpin" aria-hidden="true" />}
      </button>
      <div className="voiceMain">
        <div className="waveform">
          {peaks.map((h, i) => <span key={i} className={i < played ? 'on' : ''} style={{ '--h': h }} />)}
          {/* Curseur accessible (clavier, lecteurs d'écran) posé sur l'onde. */}
          <input type="range" className="waveRange" min={0} max={Math.max(1, Math.round(duration * 10))} step={1} value={Math.round(pos * 10)}
            aria-label="Position dans le message vocal" aria-valuetext={`${mmss(pos)} sur ${mmss(duration)}`}
            onChange={async (e) => { if (!url) await prepare(); seekTo(Number(e.target.value) / 10); }} />
        </div>
        <div className="voiceInfo">
          <span className="voiceTime">{playing || pos > 0 ? `${mmss(pos)} / ${mmss(duration)}` : mmss(duration)}</span>
          {error ? <span className="voiceError" role="alert">{error}</span> : (
            <button type="button" className="voiceRate" aria-label={`Vitesse de lecture : ${rate} fois`}
              onClick={() => { const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; setRate(next); if (engine.current) engine.current.setRate(next); else if (audioRef.current) audioRef.current.playbackRate = next; }}>
              {rate}×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
