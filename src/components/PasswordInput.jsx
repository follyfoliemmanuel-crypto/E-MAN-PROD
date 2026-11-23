// Champ mot de passe avec un bouton pour l'afficher ou le masquer (œil).
// Le mot de passe redevient masqué après chaque envoi du formulaire (sécurité sur écran partagé).
import React, { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export function PasswordInput({ className = '', ...props }) {
  const [shown, setShown] = useState(false);
  // Masqué de nouveau quand le champ est vidé (formulaire envoyé ou réinitialisé).
  useEffect(() => { if (!props.value) setShown(false); }, [props.value]);
  return (
    <span className={`pwField ${className}`}>
      <input {...props} type={shown ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button type="button" className="pwToggle" onClick={() => setShown((s) => !s)} aria-pressed={shown}
        aria-label={shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} title={shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
        {shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </span>
  );
}
