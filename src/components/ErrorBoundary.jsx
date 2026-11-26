import React from 'react';

/**
 * Barrière d'erreur : si un composant plante à l'affichage, on montre un message et un bouton
 * « Recharger » au lieu d'une page blanche. L'erreur est envoyée à la console (journaux du navigateur).
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[E-MAN PROD] Erreur d’affichage', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main id="contenu" className="crashScreen" role="alert">
        <div className="crashBox">
          <p className="crashBrand">E-MAN PROD</p>
          <h1>Un problème d’affichage est survenu</h1>
          <p>La page n’a pas pu s’afficher. Rechargez-la ; si le problème revient, écrivez-nous sur WhatsApp.</p>
          <div className="crashActions">
            <button type="button" className="btn btnPrimary" onClick={() => window.location.reload()}>Recharger la page</button>
            <a className="btn btnGhost" href="/">Retour à l’accueil</a>
          </div>
        </div>
      </main>
    );
  }
}
