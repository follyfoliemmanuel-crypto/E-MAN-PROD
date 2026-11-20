// Éléments communs des espaces client et administrateur :
// chargement, pages vides, cartes statistiques, fenêtre de confirmation, graphiques.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState, useMemo } from 'react';

/** Charge des données ; `reload` relance. Les erreurs du serveur sont affichées telles quelles. */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  // Une relecture en arrière-plan qui échoue (réseau coupé, temps réel) garde l'affichage en place
  // au lieu de le remplacer par une erreur : seule la PREMIÈRE lecture d'un élément affiche l'erreur.
  const shownFor = useRef(null);
  const key = useMemo(() => ({}), deps); // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = await fn();
      shownFor.current = key;
      setState({ loading: false, data, error: '' });
    } catch (e) {
      setState((s) => (shownFor.current === key && s.data ? { ...s, loading: false } : { loading: false, data: null, error: e.message }));
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return [state, load];
}

export function Loading({ lines = 3 }) {
  return (
    <div className="skeleton" role="status" aria-label="Chargement">
      {Array.from({ length: lines }, (_, i) => <span key={i} style={{ width: `${92 - i * 14}%` }} />)}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  return (
    <div className="errorBox" role="alert">
      <p>{error}</p>
      {onRetry && <button type="button" className="btn btnGhost btnSmall" onClick={onRetry}>Réessayer</button>}
    </div>
  );
}

/** Page vide : ce qui manque, et comment commencer. */
export function EmptyState({ title, text, action }) {
  return (
    <div className="emptyBox">
      <p className="emptyTitle">{title}</p>
      {text && <p className="muted">{text}</p>}
      {action}
    </div>
  );
}

export function SectionHead({ title, lead, actions }) {
  return (
    <header className="sectionHeadSpace">
      <div>
        <h1 className="spaceTitle">{title}</h1>
        {lead && <p className="muted">{lead}</p>}
      </div>
      {actions && <div className="sectionActions">{actions}</div>}
    </header>
  );
}

export function StatCard({ label, value, hint, tone }) {
  return (
    <div className={`statCard${tone ? ' ' + tone : ''}`}>
      <span className="statLabel">{label}</span>
      <strong className="statValue">{value ?? '—'}</strong>
      {hint && <span className="statHint">{hint}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirmation : fenêtre native <dialog>, accessible au clavier.
// ---------------------------------------------------------------------------
const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [ask, setAsk] = useState(null);
  const ref = useRef(null);
  const confirm = useCallback((opts) => new Promise((resolve) => setAsk({ ...opts, resolve })), []);
  useEffect(() => {
    if (ask && ref.current && !ref.current.open) ref.current.showModal();
  }, [ask]);
  const close = (answer) => {
    ref.current?.close();
    ask?.resolve(answer);
    setAsk(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {ask && (
        <dialog ref={ref} className="confirmDialog" aria-labelledby="confirm-title" onCancel={(e) => { e.preventDefault(); close(false); }}>
          <h2 id="confirm-title">{ask.title}</h2>
          {ask.text && <p>{ask.text}</p>}
          <div className="confirmActions">
            <button type="button" className="btn btnGhost btnSmall" onClick={() => close(false)} autoFocus>Annuler</button>
            <button type="button" className={`btn btnSmall ${ask.danger ? 'btnDanger' : 'btnPrimary'}`} onClick={() => close(true)}>{ask.confirm || 'Confirmer'}</button>
          </div>
        </dialog>
      )}
    </ConfirmContext.Provider>
  );
}

/** const confirm = useConfirm(); if (await confirm({ title, text, confirm, danger })) … */
export const useConfirm = () => useContext(ConfirmContext) || (async () => true);

// ---------------------------------------------------------------------------
// Graphiques (SVG). Couleurs : paire bleu / orange validée pour le daltonisme
// (outil dataviz : séparation ΔE ≥ 24, contraste ≥ 3:1). Chaque graphique a sa
// légende, une infobulle au survol et un tableau des chiffres.
// ---------------------------------------------------------------------------
const SERIES = ['var(--series-1)', 'var(--series-2)'];
const monthLabel = (m) => new Date(m + '-15').toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
const fmt = (n) => Number(n).toLocaleString('fr-FR');
const compact = (n) => new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

function niceMax(v) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

/** Barres groupées par mois (une ou deux séries de même unité). */
export function MonthChart({ title, rows, series, unit = '', height = 220 }) {
  const [hover, setHover] = useState(null);
  const [table, setTable] = useState(false);
  const W = 640, H = height, L = 46, B = 26, T = 12;
  const max = niceMax(Math.max(1, ...rows.flatMap((r) => series.map((s) => Number(r[s.key]) || 0))));
  const band = (W - L - 8) / rows.length;
  const bw = Math.min(18, (band - 10) / series.length);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const empty = rows.every((r) => series.every((s) => !Number(r[s.key])));
  return (
    <figure className="chartCard">
      <figcaption className="chartHead">
        <span className="chartTitle">{title}</span>
        {series.length > 1 && (
          <span className="legend">{series.map((s, i) => <span key={s.key}><i style={{ background: SERIES[i] }} />{s.label}</span>)}</span>
        )}
        <button type="button" className="linkBtn chartToggle" onClick={() => setTable((t) => !t)}>{table ? 'Voir le graphique' : 'Voir les chiffres'}</button>
      </figcaption>
      {empty && <p className="muted chartEmpty">Pas encore de données sur les 12 derniers mois.</p>}
      {table ? (
        <div className="tableScroll"><table className="table compact">
          <thead><tr><th scope="col">Mois</th>{series.map((s) => <th scope="col" key={s.key}>{s.label}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.month}><td>{monthLabel(r.month)} {r.month.slice(0, 4)}</td>{series.map((s) => <td key={s.key} className="num">{fmt(r[s.key] || 0)}{unit}</td>)}</tr>)}</tbody>
        </table></div>
      ) : !empty && (
        <div className="chartBox">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={W} y1={y(t)} y2={y(t)} className="gridLine" />
                <text x={L - 6} y={y(t) + 4} className="axisText" textAnchor="end">{compact(Math.round(t))}</text>
              </g>
            ))}
            {rows.map((r, i) => {
              const x0 = L + i * band + (band - bw * series.length - 2 * (series.length - 1)) / 2;
              return (
                <g key={r.month} onMouseEnter={() => setHover(i)}>
                  <rect x={L + i * band} y={T} width={band} height={H - T - B} fill="transparent" />
                  {series.map((s, j) => {
                    const v = Number(r[s.key]) || 0;
                    const top = y(v);
                    return v > 0 && <rect key={s.key} x={x0 + j * (bw + 2)} y={top} width={bw} height={Math.max(H - B - top, 1)} rx="3" fill={SERIES[j]} opacity={hover === null || hover === i ? 1 : 0.45} />;
                  })}
                  <text x={L + i * band + band / 2} y={H - 8} className="axisText" textAnchor="middle">{monthLabel(r.month)}</text>
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="chartTip" style={{ left: `${((L + (hover + 0.5) * band) / W) * 100}%` }}>
              <strong>{monthLabel(rows[hover].month)} {rows[hover].month.slice(0, 4)}</strong>
              {series.map((s, j) => <span key={s.key}><i style={{ background: SERIES[j] }} />{s.label} : {fmt(rows[hover][s.key] || 0)}{unit}</span>)}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

/** Barres horizontales : une valeur par catégorie, étiquetée directement. */
export function BarList({ title, rows, empty = 'Pas encore de données.' }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <figure className="chartCard">
      <figcaption className="chartHead"><span className="chartTitle">{title}</span></figcaption>
      {!rows.length ? <p className="muted chartEmpty">{empty}</p> : (
        <ul className="barList">
          {rows.map((r) => (
            <li key={r.label} title={`${r.label} : ${fmt(r.n)}`}>
              <span className="barLabel">{r.label}</span>
              <span className="barTrack"><span className="barFill" style={{ width: `${(r.n / max) * 100}%` }} /></span>
              <span className="barValue">{fmt(r.n)}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

/**
 * Sur petit écran, les tableaux deviennent des fiches empilées (voir style.css).
 * Chaque cellule reçoit le titre de sa colonne en data-label, lu depuis l'en-tête.
 */
export function useStackedTables(root) {
  useEffect(() => {
    if (!root || typeof MutationObserver === 'undefined') return undefined;
    const label = () => {
      for (const t of root.querySelectorAll('table.table:not(.compact):not(.itemsTable)')) {
        t.classList.add('stack');
        const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
        for (const tr of t.querySelectorAll('tbody tr')) {
          [...tr.children].forEach((td, i) => { if (heads[i] && td.dataset.label !== heads[i]) td.dataset.label = heads[i]; });
        }
      }
    };
    label();
    const obs = new MutationObserver(label);
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [root]);
}
