// ============================================================
// APP — Composant principal : la page entière de l'application
// Il gère la session (connecté ?) et les 3 onglets
// ============================================================

import { useState, useEffect } from 'react';
import Connexion from './components/Connexion';
import TableauDeBord from './components/TableauDeBord';
import Produits from './components/Produits';
import Mouvements from './components/Mouvements';
import Caisse from './components/Caisse';
import Fournisseurs from './components/Fournisseurs';
import EspaceAdmin from './components/EspaceAdmin';
import ChangerMotDePasse from './components/ChangerMotDePasse';
import { getUtilisateurCourant, deconnexion } from './api';
import './App.css';

function App() {
  // utilisateur = null (non connecté) ou { nom, email, role }
  const [utilisateur, setUtilisateur] = useState(null);
  const [verification, setVerification] = useState(true); // encore en cours ?
  const [onglet, setOnglet] = useState('tableau-bord');
  const [modaleMotDePasse, setModaleMotDePasse] = useState(false); // changement de mdp

  // Au chargement de la page : on vérifie si un cookie de session existe
  useEffect(() => {
    getUtilisateurCourant()
      .then((u) => setUtilisateur(u))
      .catch(() => setUtilisateur(null)) // Pas de session valide → page de connexion
      .finally(() => setVerification(false));
  }, []);

  async function seDeconnecter() {
    try {
      await deconnexion();
    } finally {
      setUtilisateur(null);
      setOnglet('tableau-bord');
    }
  }

  // --- Écran de chargement (pendant la vérification de session) ---
  if (verification) {
    return <div className="message-chargement centrage">Vérification de la session…</div>;
  }

  // --- Non connecté → uniquement la page de connexion ---
  if (!utilisateur) {
    return <Connexion onConnecte={setUtilisateur} />;
  }

  const estAdmin = utilisateur.role === 'admin';
  const estGerant = utilisateur.role === 'gerant';
  // « gérer » = créer/modifier les produits ET voir les mouvements :
  // l'admin le fait sur tout le réseau, le gérant sur SA boutique.
  // L'employé (caisse) n'en a pas le droit — le serveur refuse aussi (403).
  const peutGerer = estAdmin || estGerant;

  const LIBELLE_ROLE = estAdmin ? 'ADMIN' : estGerant ? 'GÉRANT' : 'EMPLOYÉ';
  const ICONE_ROLE = estAdmin ? '👔' : estGerant ? '🧑‍🏫' : '🧑‍💼';

  // --- Onglets autorisés selon le rôle ---
  // employé  → caisse + stock (il encaisse, il ne gère pas)
  // gérant   → les écrans de SA boutique (chiffres, catalogue, mouvements,
  //            caisse, fournisseurs/bons de commande)
  // admin    → tout + la gestion des comptes et des sauvegardes
  const ONGLETS = estAdmin
    ? [
        { id: 'tableau-bord', libelle: '📊 Tableau de bord' },
        { id: 'produits', libelle: '📦 Produits' },
        { id: 'mouvements', libelle: '🔄 Mouvements' },
        { id: 'caisse', libelle: '🧾 Caisse' },
        { id: 'fournisseurs', libelle: '🚚 Fournisseurs' },
        { id: 'comptes', libelle: '👥 Comptes' },
      ]
    : estGerant
      ? [
          { id: 'tableau-bord', libelle: '📊 Tableau de bord' },
          { id: 'produits', libelle: '📦 Produits' },
          { id: 'mouvements', libelle: '🔄 Mouvements' },
          { id: 'caisse', libelle: '🧾 Caisse' },
          { id: 'fournisseurs', libelle: '🚚 Fournisseurs' },
        ]
      : [
          { id: 'caisse', libelle: '🧾 Caisse' },
          { id: 'produits', libelle: '📦 Produits' },
        ];

  // Onglet effectif : si l'état pointe vers un onglet interdit
  // (ex : changement de rôle en cours de session), on retombe sur la caisse
  const ongletActif = ONGLETS.some((o) => o.id === onglet) ? onglet : ONGLETS[0].id;

  return (
    <div className="app">
      {/* --- En-tête avec le titre, l'utilisateur et la navigation --- */}
      <header className="entete">
        <div className="ligne-entete">
          <h1>🛒 Gestion de Stock — Supermarché</h1>
          <div className="bloc-utilisateur">
            <span className="info-utilisateur">
              {ICONE_ROLE} {utilisateur.nom}
              <span
                className={`badge-role ${estAdmin ? 'badge-admin' : estGerant ? 'badge-gerant' : ''}`}
              >
                {LIBELLE_ROLE}
                {/* Le gérant et l'employé appartiennent à UN magasin */}
                {utilisateur.boutique && ` · ${utilisateur.boutique.nom}`}
              </span>
            </span>
            <button className="btn-mot-de-passe" onClick={() => setModaleMotDePasse(true)} title="Changer mon mot de passe">
              🔑
            </button>
            <button className="btn-deconnexion" onClick={seDeconnecter}>
              🚪 Déconnexion
            </button>
          </div>
        </div>
        <nav className="navigation">
          {ONGLETS.map((o) => (
            <button
              key={o.id}
              className={ongletActif === o.id ? 'actif' : ''}
              onClick={() => setOnglet(o.id)}
            >
              {o.libelle}
            </button>
          ))}
        </nav>
      </header>

      {/* --- Contenu : un seul composant affiché à la fois --- */}
      <main className="contenu">
        {ongletActif === 'tableau-bord' && peutGerer && <TableauDeBord />}
        {ongletActif === 'produits' && (
          <Produits peutGerer={peutGerer} estAdmin={estAdmin} />
        )}
        {ongletActif === 'mouvements' && peutGerer && <Mouvements peutGerer={peutGerer} />}
        {ongletActif === 'caisse' && <Caisse utilisateur={utilisateur} />}
        {ongletActif === 'fournisseurs' && peutGerer && (
          <Fournisseurs estAdmin={estAdmin} />
        )}
        {ongletActif === 'comptes' && estAdmin && (
          <EspaceAdmin utilisateurCourant={utilisateur} />
        )}
      </main>

      {/* Modale de changement de mot de passe (tous les rôles) */}
      {modaleMotDePasse && (
        <ChangerMotDePasse onFerme={() => setModaleMotDePasse(false)} />
      )}
    </div>
  );
}

export default App;
