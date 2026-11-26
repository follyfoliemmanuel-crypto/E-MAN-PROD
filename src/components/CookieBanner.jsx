import React, { useEffect, useRef, useState } from 'react';
import { Link } from '../lib/router.jsx';
import { readConsent, saveConsent, OPEN_EVENT } from '../lib/consent.js';

/**
 * Bandeau cookies affiché à la première visite (puis via « Gérer les cookies » en pied de page).
 * Le site ne dépose que des cookies techniques ; le seul choix réel porte sur l'« affichage rapide »
 * (photos et catalogue gardés sur l'appareil). Les tests automatisés (navigator.webdriver) ne le voient
 * pas, sauf ceux qui le testent explicitement (window.__cookieBannerTest).
 */
export default function CookieBanner() {
  const automated = typeof navigator !== 'undefined' && navigator.webdriver && !(typeof window !== 'undefined' && window.__cookieBannerTest);
  const [open, setOpen] = useState(() => !automated && !readConsent());
  const [details, setDetails] = useState(false);
  const [comfort, setComfort] = useState(() => readConsent()?.comfort !== false);
  const first = useRef(null);

  useEffect(() => {
    const show = () => { setComfort(readConsent()?.comfort !== false); setDetails(true); setOpen(true); };
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);
  useEffect(() => { if (open && details) first.current?.focus(); }, [open, details]);

  if (!open) return null;
  const choose = (value) => { saveConsent(value); setOpen(false); setDetails(false); };

  return (
    <section className="cookieBar" role="region" aria-label="Cookies et stockage" data-cookie-banner>
      <div className="cookieInner">
        <div className="cookieText">
          <p className="cookieTitle">Cookies et confidentialité</p>
          <p>
            Ce site n’utilise ni publicité ni mesure d’audience. Les cookies servent uniquement à vous garder connecté à votre espace.
            Vous pouvez aussi autoriser l’affichage rapide, qui garde les photos et le catalogue sur cet appareil.{' '}
            <Link to="/confidentialite">En savoir plus</Link>
          </p>
        </div>
        {details && (
          <div className="cookieDetails">
            <label className="cookieRow">
              <input type="checkbox" checked disabled />
              <span><strong>Nécessaires</strong> Connexion, sécurité, vérification en deux étapes. Toujours actifs.</span>
            </label>
            <label className="cookieRow">
              <input ref={first} type="checkbox" checked={comfort} onChange={(e) => setComfort(e.target.checked)} data-cookie="comfort" />
              <span><strong>Affichage rapide</strong> Photos et catalogue gardés sur cet appareil pour les visites suivantes.</span>
            </label>
          </div>
        )}
        <div className="cookieActions">
          {details ? (
            <button type="button" className="btn btnPrimary btnSmall" onClick={() => choose(comfort)}>Enregistrer mes choix</button>
          ) : (
            <>
              <button type="button" className="btn btnPrimary btnSmall" onClick={() => choose(true)}>Tout accepter</button>
              <button type="button" className="btn btnGhost btnSmall" onClick={() => choose(false)}>Nécessaires uniquement</button>
              <button type="button" className="linkBtn" onClick={() => setDetails(true)}>Personnaliser</button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
