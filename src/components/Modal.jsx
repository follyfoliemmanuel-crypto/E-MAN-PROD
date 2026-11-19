import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

// Fenêtre basée sur l'élément natif <dialog> : le navigateur gère le piège à
// focus, la touche Échap et l'arrière-plan inerte. On ajoute seulement une
// animation d'ouverture et de fermeture.
export default function Modal({ label, onClose, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    // Sur ordinateur, on place le curseur dans le premier champ. Sur écran
    // tactile, on évite d'ouvrir le clavier d'office.
    if (window.matchMedia('(pointer: fine)').matches) {
      dialog.querySelector('input:not([type=checkbox]), select, textarea')?.focus();
    }
    document.documentElement.classList.add('modal-open');
    return () => document.documentElement.classList.remove('modal-open');
  }, []);

  function close() {
    const dialog = ref.current;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !dialog.animate) return onClose();
    dialog.classList.add('closing');
    setTimeout(onClose, 180);
  }

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={label}
      onCancel={(e) => { e.preventDefault(); close(); }}
      onMouseDown={(e) => { if (e.target === ref.current) close(); }}
    >
      <div className="sheetBody">
        <button type="button" className="sheetClose" onClick={close} aria-label="Fermer">
          <X aria-hidden="true" size={20} />
        </button>
        {typeof children === 'function' ? children(close) : children}
      </div>
    </dialog>
  );
}
