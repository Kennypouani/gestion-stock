// ============================================================
// CONNEXION — Page de login affichée tant que l'utilisateur
// n'est pas connecté. Affiche le formulaire + les comptes de test.
// ============================================================

import { useState, useEffect } from 'react';
import { connexion, getConfigPublique } from '../api';

function Connexion({ onConnecte }) {
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  // null = pas encore su. On n'affiche les comptes de démonstration
  // que si le serveur confirme qu'ils existent ET que la sécurité
  // stricte est désactivée (jamais en production).
  const [comptesDemoVisibles, setComptesDemoVisibles] = useState(false);

  useEffect(() => {
    getConfigPublique()
      .then((c) => setComptesDemoVisibles(c.comptes_demo === true && c.securite_stricte !== true))
      .catch(() => setComptesDemoVisibles(false)); // Serveur muet → rien n'est révélé
  }, []);

  async function soumettre(e) {
    e.preventDefault(); // Empêche le rechargement de la page
    setErreur(null);
    setEnCours(true);
    try {
      const utilisateur = await connexion(email, motDePasse);
      onConnecte(utilisateur); // Prévient App : on est connecté !
    } catch (err) {
      // Affiche le message français renvoyé par le serveur
      setErreur(err.message);
    } finally {
      setEnCours(false); // Se déclenche dans tous les cas
    }
  }

  // Remplit automatiquement le formulaire avec un compte de test
  function remplirCompte(emailCompte) {
    setEmail(emailCompte);
    setMotDePasse(
      emailCompte === 'admin@magasin.fr'
        ? 'admin123'
        : emailCompte === 'gerant@magasin.fr'
          ? 'gerant123'
          : 'employe123'
    );
    setErreur(null);
  }

  return (
    <div className="page-connexion">
      <div className="boite-connexion">
        <h1>🛒 Gestion de Stock</h1>
        <p className="sous-titre">Connectez-vous pour accéder à l'application</p>

        {/* --- Message d'erreur (mauvais mot de passe, etc.) --- */}
        {erreur && <div className="message message-erreur">❌ {erreur}</div>}

        {/* --- Formulaire --- */}
        <form className="formulaire-connexion" onSubmit={soumettre}>
          <div className="champ">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="exemple@magasin.fr"
              required
              autoFocus
            />
          </div>
          <div className="champ">
            <label>Mot de passe</label>
            <input
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <button type="submit" className="btn-principal btn-connexion" disabled={enCours}>
            {enCours ? 'Connexion en cours…' : '🔑 Se connecter'}
          </button>
        </form>

        {/* --- Comptes de démonstration (cliquer pour remplir) ---
            Masqués en sécurité stricte : des identifiants publics
            n'ont rien à faire sur l'écran de connexion d'un site réel. */}
        {comptesDemoVisibles && (
          <div className="comptes-test">
            <p className="titre-test">Comptes de démonstration :</p>
            <button type="button" onClick={() => remplirCompte('admin@magasin.fr')}>
              👔 Administrateur — admin@magasin.fr
            </button>
            <button type="button" onClick={() => remplirCompte('gerant@magasin.fr')}>
              🧑‍🏫 Gérant — gerant@magasin.fr
            </button>
            <button type="button" onClick={() => remplirCompte('awa@magasin.fr')}>
              🧑‍💼 Employé — awa@magasin.fr
            </button>
            <p className="astuce">Astuce : cliquez sur un compte, puis « Se connecter ».</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Connexion;
