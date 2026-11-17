// ============================================================
// ERROR BOUNDARY — filet de sécurité de l'interface
// Si un composant plante pendant le rendu, React démonte tout
// l'arbre et laisse une page blanche. Ce composant attrape
// l'erreur et affiche un message lisible + un bouton de rechargement.
// ============================================================

import { Component } from 'react';

class ErrorBoundary extends Component {
  state = { erreur: null };

  static getDerivedStateFromError(erreur) {
    return { erreur };
  }

  componentDidCatch(erreur, infos) {
    // Trace complète dans la console du navigateur, pour le diagnostic
    console.error('Erreur interface :', erreur, infos);
  }

  render() {
    if (!this.state.erreur) return this.props.children;

    return (
      <div className="page-connexion">
        <div className="boite-connexion">
          <h1>⚠️ Une erreur est survenue</h1>
          <p className="sous-titre">
            Cet écran n'a pas pu s'afficher. Vos données n'ont pas été modifiées.
          </p>
          <button
            type="button"
            className="btn-principal"
            onClick={() => window.location.reload()}
          >
            🔄 Recharger la page
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
