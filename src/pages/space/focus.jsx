// Cadrage d'une photo du site : on touche le point important (visage, logo, produit) ; le
// recadrage automatique de chaque écran le garde en vue. Aperçus téléphone, tablette, ordinateur.
import React, { useState } from 'react';
import { Crosshair } from 'lucide-react';
import { saveMedia } from '../../lib/api.js';

const parse = (f) => { const m = /^(\d{1,3})% (\d{1,3})%$/.exec(f || ''); return m ? [Number(m[1]), Number(m[2])] : [50, 50]; };
const fmt = ([x, y]) => `${Math.round(x)}% ${Math.round(y)}%`;
const clamp = (v) => Math.max(0, Math.min(100, v));
const FRAMES = [['Téléphone', '360 / 580', 'mobile'], ['Tablette', '820 / 760', 'main'], ['Ordinateur', '1440 / 720', 'main'], ['Grand écran', '2560 / 900', 'main']];

function Picker({ url, point, onChange, label }) {
  const set = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    onChange([clamp(((e.clientX - r.left) / r.width) * 100), clamp(((e.clientY - r.top) / r.height) * 100)]);
  };
  return (
    <div className="focusPicker" role="slider" tabIndex={0} aria-label={label} aria-valuetext={`${Math.round(point[0])} % depuis la gauche, ${Math.round(point[1])} % depuis le haut`}
      onClick={set}
      onKeyDown={(e) => {
        const d = e.shiftKey ? 10 : 2;
        const k = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
        if (k) { e.preventDefault(); onChange([clamp(point[0] + k[0]), clamp(point[1] + k[1])]); }
      }}>
      <img src={url} alt="" draggable={false} />
      <span className="focusMark" style={{ left: `${point[0]}%`, top: `${point[1]}%` }} aria-hidden="true" />
    </div>
  );
}

export function FocusEditor({ slot, current, notify, onSaved }) {
  const [open, setOpen] = useState(false);
  const [main, setMain] = useState(parse(current.focus));
  const [split, setSplit] = useState(Boolean(current.focus_mobile));
  const [mobile, setMobile] = useState(parse(current.focus_mobile || current.focus));
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn btnGhost btnSmall" onClick={() => setOpen(true)}>
        <Crosshair size={16} aria-hidden="true" /> Cadrage{current.focus ? ' (réglé)' : ''}
      </button>
    );
  }
  const pos = (kind) => fmt(kind === 'mobile' && split ? mobile : main);
  return (
    <div className="focusEditor" role="group" aria-label="Cadrage de la photo">
      <p className="muted">Touchez le point important de la photo (visage, logo, produit) : chaque écran recadre autour de lui. Flèches du clavier pour ajuster.</p>
      <div className="focusGrid">
        <div>
          <strong className="focusLabel">{split ? 'Ordinateur et tablette' : 'Tous les écrans'}</strong>
          <Picker url={current.url} point={main} onChange={setMain} label="Point important de la photo" />
        </div>
        {split && (
          <div>
            <strong className="focusLabel">Téléphone</strong>
            <Picker url={current.url} point={mobile} onChange={setMobile} label="Point important sur téléphone" />
          </div>
        )}
      </div>
      <label className="checkLine">
        <input type="checkbox" checked={split} onChange={(e) => { setSplit(e.target.checked); if (e.target.checked) setMobile(main); }} />
        <span>Choisir un point différent pour les téléphones</span>
      </label>
      <div className="focusPreviews" aria-label="Aperçus">
        {FRAMES.map(([name, ratio, kind]) => (
          <figure key={name}>
            <span className="focusFrame" style={{ aspectRatio: ratio }}>
              <img src={current.url} alt="" style={{ objectPosition: pos(kind) }} />
            </span>
            <figcaption>{name}</figcaption>
          </figure>
        ))}
      </div>
      <div className="mediaActions">
        <button type="button" className="btn btnPrimary btnSmall" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            await saveMedia({ slot, focus: fmt(main), focus_mobile: split ? fmt(mobile) : null });
            notify('Cadrage enregistré : il s’applique tout de suite sur le site.');
            setOpen(false); onSaved?.();
          } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); }
        }}>{busy ? 'Enregistrement…' : 'Enregistrer le cadrage'}</button>
        <button type="button" className="btn btnGhost btnSmall" onClick={() => { setMain([50, 50]); setMobile([50, 50]); setSplit(false); }}>Recentrer</button>
        <button type="button" className="btn btnGhost btnSmall" onClick={() => setOpen(false)}>Fermer</button>
      </div>
    </div>
  );
}
