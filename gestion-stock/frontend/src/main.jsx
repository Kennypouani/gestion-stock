// ============================================================
// POINT D'ENTRÉE — C'est ici que React « démarre » l'application
// Il cherche la balise <div id="root"> dans index.html et y injecte App
// ============================================================

import { StrictMode } from 'react';     // Mode strict : détecte les erreurs courantes
import { createRoot } from 'react-dom/client'; // Crée la racine de l'arbre React
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Tout plantage d'un composant affiche un message au lieu d'une page blanche */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
