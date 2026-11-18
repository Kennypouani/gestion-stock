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
import CreationBoutique from './components/CreationBoutique';
import PolitiqueConfidentialite from './components/PolitiqueConfidentialite';
import ConditionsGenerales from './components/ConditionsGenerales';
import { getUtilisateurCourant, deconnexion } from './api';
import { METADONNEES, appliquerMetadonnees } from './metadonnees';
import './App.css';

// L'application n'a qu'une seule adresse : les écrans sont des onglets,
// pas des pages. Les documents légaux (confidentialité, conditions
// générales) font exception : ce sont des pages publiques, consultables
// sans connexion. Tout autre chemin est une URL inconnue.
const CHEMINS_CONNUS = ['/', '/index.html', '/confidentialite', '/conditions-generales'];

function App() {
  // utilisateur = null (non connecté) ou { nom, email, role }
  const [utilisateur, setUtilisateur] = useState(null);
  const [verification, setVerification] = useState(true); // encore en cours ?
  const [onglet, setOnglet] = useState('tableau-bord');
  const [modaleMotDePasse, setModaleMotDePasse] = useState(false); // changement de mdp
  // Chemin courant : une seule source de vérité, mise à jour par la
  // navigation interne (liens des documents légaux, bouton de retour).
  // Le reste en est déduit.
  const [chemin, setChemin] = useState(() => window.location.pathname);
  const cheminInconnu = !CHEMINS_CONNUS.includes(chemin);
  const [messageConnexion, setMessageConnexion] = useState(null);

  // --- Navigation interne, sans rechargement ---
  // L'URL reste partageable et le bouton Retour du navigateur fonctionne
  function allerA(nouveauChemin) {
    if (nouveauChemin !== window.location.pathname) {
      window.history.pushState({}, '', nouveauChemin);
    }
    setChemin(nouveauChemin);
  }

  // Le navigateur revient en arrière : l'état doit suivre l'adresse réelle
  useEffect(() => {
    const surRetourNavigateur = () => setChemin(window.location.pathname);
    window.addEventListener('popstate', surRetourNavigateur);
    return () => window.removeEventListener('popstate', surRetourNavigateur);
  }, []);

  // Titre de l'onglet et description : ils suivent l'écran affiché
  useEffect(() => {
    const metadonnees =
      chemin === '/confidentialite'
        ? METADONNEES.confidentialite
        : chemin === '/conditions-generales'
          ? METADONNEES.conditions
          : cheminInconnu
            ? METADONNEES.introuvable
            : utilisateur
              ? METADONNEES.application
              : METADONNEES.connexion;
    appliquerMetadonnees(metadonnees);
  }, [chemin, cheminInconnu, utilisateur]);

  // Au chargement de la page : on vérifie si un cookie de session existe
  useEffect(() => {
    getUtilisateurCourant()
      .then((u) => setUtilisateur(u))
      .catch(() => setUtilisateur(null)) // Pas de session valide → page de connexion
      .finally(() => setVerification(false));
  }, []);

  // Session expirée ou révoquée pendant l'utilisation : l'API a répondu 401
  // (voir api.js). On ferme tout et on renvoie vers l'écran de connexion.
  useEffect(() => {
    const surSessionExpiree = () => {
      setModaleMotDePasse(false);
      setMessageConnexion('Votre session a expiré — reconnectez-vous pour continuer.');
      setUtilisateur(null);
    };
    window.addEventListener('session-expiree', surSessionExpiree);
    return () => window.removeEventListener('session-expiree', surSessionExpiree);
  }, []);

  // Recharge l'utilisateur courant (après un changement de mot de passe imposé)
  function rafraichirUtilisateur() {
    return getUtilisateurCourant()
      .then((u) => setUtilisateur(u))
      .catch(() => setUtilisateur(null));
  }

  async function seDeconnecter() {
    try {
      await deconnexion();
    } finally {
      setUtilisateur(null);
      setOnglet('tableau-bord');
    }
  }

  // --- Politique de confidentialité : document public ---
  // Servi AVANT la vérification de session : consultable sans compte.
  if (chemin === '/confidentialite') {
    return (
      <PolitiqueConfidentialite
        onRetour={() => allerA('/')}
        onOuvrirConditions={() => allerA('/conditions-generales')}
      />
    );
  }
  if (chemin === '/conditions-generales') {
    return (
      <ConditionsGenerales
        onRetour={() => allerA('/')}
        onOuvrirConfidentialite={() => allerA('/confidentialite')}
      />
    );
  }

  // --- Adresse inconnue → écran dédié, avec retour vers l'application ---
  // Testé AVANT la vérification de session : inutile d'appeler l'API
  // (et d'afficher « Vérification… ») pour une adresse qui n'existe pas.
  if (cheminInconnu) {
    return (
      <div className="page-connexion">
        <div className="boite-connexion">
          <h1>🧭 Page introuvable</h1>
          <p className="sous-titre">
            L'adresse « {chemin} » ne correspond à aucun écran de l'application.
          </p>
          <button
            type="button"
            className="btn-principal"
            onClick={() => {
              window.history.replaceState({}, '', '/');
              setChemin('/');
            }}
          >
            ⬅️ Revenir à l'application
          </button>
        </div>
      </div>
    );
  }

  // --- Écran de chargement (pendant la vérification de session) ---
  if (verification) {
    return <div className="message-chargement centrage">Vérification de la session…</div>;
  }

  // --- Non connecté → uniquement la page de connexion ---
  if (!utilisateur) {
    return (
      <Connexion
        messageInitial={messageConnexion}
        onOuvrirPolitique={() => allerA('/confidentialite')}
        onOuvrirConditions={() => allerA('/conditions-generales')}
        onConnecte={(u) => {
          setMessageConnexion(null);
          setUtilisateur(u);
        }}
      />
    );
  }

  // --- Mot de passe à changer avant tout usage ---
  // Le serveur refuse toutes les autres routes dans ce cas (403) :
  // on n'affiche donc que l'écran de changement, sans navigation.
  if (utilisateur.changement_obligatoire) {
    return (
      <div className="page-connexion">
        <ChangerMotDePasse obligatoire onTermine={rafraichirUtilisateur} />
      </div>
    );
  }

  // --- Compte sans boutique : accès à la SEULE création de boutique ---
  // Le serveur ferme aussi toutes les routes métier dans ce cas (403) :
  // cet écran n'est pas la seule barrière.
  // (si la liste est absente d'une session déjà chargée, on ne bloque pas :
  //  le serveur refusera de toute façon les données métier)
  if (Array.isArray(utilisateur.boutiques) && utilisateur.boutiques.length === 0) {
    return (
      <CreationBoutique
        pleinEcran
        onCree={rafraichirUtilisateur}
        onDeconnexion={seDeconnecter}
      />
    );
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
        { id: 'boutiques', libelle: '🏪 Boutiques' },
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
          <h1>🛒 Gestion de Stock & Supermarché</h1>
          <div className="bloc-utilisateur">
            <span className="info-utilisateur">
              {ICONE_ROLE} {utilisateur.nom}
              <span
                className={`badge-role ${estAdmin ? 'badge-admin' : estGerant ? 'badge-gerant' : ''}`}
              >
                {LIBELLE_ROLE}
                {/* Le gérant et l'employé appartiennent à UN magasin ;
                    un admin peut en gérer plusieurs */}
                {(utilisateur.boutiques || []).length > 1
                  ? ` · ${utilisateur.boutiques.length} boutiques`
                  : utilisateur.boutique && ` · ${utilisateur.boutique.nom}`}
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
        {ongletActif === 'boutiques' && estAdmin && (
          <CreationBoutique onCree={rafraichirUtilisateur} />
        )}
        {ongletActif === 'comptes' && estAdmin && (
          <EspaceAdmin utilisateurCourant={utilisateur} />
        )}
      </main>

      <footer className="pied-appli">
        <div className="liens-document">
          <button
            type="button"
            className="lien-politique"
            onClick={() => allerA('/confidentialite')}
          >
            🔒 Politique de confidentialité
          </button>
          <span className="separateur">·</span>
          <button
            type="button"
            className="lien-politique"
            onClick={() => allerA('/conditions-generales')}
          >
            📄 Conditions générales
          </button>
        </div>
      </footer>

      {/* Modale de changement de mot de passe (tous les rôles) */}
      {modaleMotDePasse && (
        <ChangerMotDePasse onFerme={() => setModaleMotDePasse(false)} />
      )}
    </div>
  );
}

export default App;
