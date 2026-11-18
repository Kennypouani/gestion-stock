// ============================================================
// CONNEXION — Page de login affichée tant que l'utilisateur
// n'est pas connecté. Affiche le formulaire + les comptes de test.
// Le même écran propose l'INSCRIPTION : le profil est verrouillé sur
// « Administrateur » (imposé par le serveur, pas par ce formulaire).
// Le compte est créé inactif et doit être activé avant la connexion.
// ============================================================

import { useState, useEffect } from 'react';
import { connexion, inscription, getConfigPublique } from '../api';

const INSCRIPTION_VIDE = {
  nom: '',
  email: '',
  mot_de_passe: '',
  confirmation: '',
};

// Profil imposé par le formulaire d'inscription (et par le serveur)
const PROFIL_INSCRIPTION = '👔 Administrateur — tout le réseau';

function Connexion({ onConnecte, messageInitial = null, onOuvrirPolitique, onOuvrirConditions }) {
  // 'connexion' ou 'inscription'
  const [mode, setMode] = useState('connexion');

  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  // messageInitial : raison affichée d'emblée (ex. session expirée)
  const [erreur, setErreur] = useState(messageInitial);
  const [succes, setSucces] = useState(null);
  const [enCours, setEnCours] = useState(false);

  // Champs du formulaire d'inscription
  const [form, setForm] = useState(INSCRIPTION_VIDE);

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
    setSucces(null);
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

  // --- Inscription : crée un compte en attente d'activation ---
  async function soumettreInscription(e) {
    e.preventDefault();
    setErreur(null);
    setSucces(null);
    setEnCours(true);
    try {
      const reponse = await inscription(form);
      // Retour à l'écran de connexion, email déjà rempli
      setEmail(form.email.trim());
      setMotDePasse('');
      setMode('connexion');
      setForm(INSCRIPTION_VIDE);
      setSucces(reponse.message || 'Compte créé — en attente d’activation');
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  function changerMode(nouveau) {
    setMode(nouveau);
    setErreur(null);
    setSucces(null);
  }

  function changerChamp(e) {
    const { name, value } = e.target;
    setForm((a) => ({ ...a, [name]: value }));
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
    setSucces(null);
  }

  const enInscription = mode === 'inscription';

  return (
    <div className="page-connexion">
      <div className="boite-connexion">
        <h1>🛒 Gestion de Stock</h1>
        <p className="sous-titre">
          {enInscription
            ? 'Créez votre compte administrateur'
            : 'Connectez-vous pour accéder à l’application'}
        </p>

        {/* --- Message d'erreur (mauvais mot de passe, etc.) --- */}
        {erreur && <div className="message message-erreur">❌ {erreur}</div>}
        {succes && <div className="message message-succes">✅ {succes}</div>}

        {/* ================= FORMULAIRE DE CONNEXION ================= */}
        {!enInscription && (
          <>
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

            {/* --- Bouton « S'inscrire » --- */}
            <div className="bascule-mode">
              <span>Pas encore de compte ?</span>
              <a
                href="/"
                className="lien-bascule"
                onClick={(e) => {
                  e.preventDefault();
                  changerMode('inscription');
                }}
              >
                📝 Créer un compte administrateur
              </a>
            </div>

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
          </>
        )}

        {/* ================= FORMULAIRE D'INSCRIPTION ================= */}
        {enInscription && (
          <>
            <form className="formulaire-connexion" onSubmit={soumettreInscription}>
              <div className="champ">
                <label>Nom complet *</label>
                <input
                  name="nom"
                  value={form.nom}
                  onChange={changerChamp}
                  placeholder="Ex : Mariam Koné"
                  maxLength={80}
                  required
                  autoFocus
                />
              </div>
              <div className="champ">
                <label>Email *</label>
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={changerChamp}
                  placeholder="prenom@magasin.fr"
                  required
                />
              </div>
              {/* Profil verrouillé : champ non modifiable */}
              <div className="champ">
                <label>Profil</label>
                <input
                  value={PROFIL_INSCRIPTION}
                  readOnly
                  disabled
                  className="champ-verrouille"
                  aria-describedby="aide-profil"
                />
                <small id="aide-profil">
                  🔒 Profil verrouillé : ce formulaire crée uniquement des comptes administrateur.
                </small>
              </div>
              <div className="champ">
                <label>Mot de passe * (8 caractères min.)</label>
                <input
                  type="password"
                  name="mot_de_passe"
                  value={form.mot_de_passe}
                  onChange={changerChamp}
                  placeholder="••••••••"
                  minLength={8}
                  required
                />
              </div>
              <div className="champ">
                <label>Confirmer le mot de passe *</label>
                <input
                  type="password"
                  name="confirmation"
                  value={form.confirmation}
                  onChange={changerChamp}
                  placeholder="••••••••"
                  minLength={8}
                  required
                />
              </div>
              <button type="submit" className="btn-principal btn-connexion" disabled={enCours}>
                {enCours ? 'Création du compte…' : '📝 Créer mon compte'}
              </button>
              <p className="note-inscription">
                Votre compte sera créé en <strong>profil administrateur</strong>, sans aucune
                boutique. À la première connexion, vous créerez <strong>votre boutique</strong> pour
                accéder à vos produits, votre stock et vos ventes.
              </p>
            </form>

            {/* --- Lien vers le formulaire de connexion --- */}
            <div className="bascule-mode">
              <span>Vous avez déjà un compte ?</span>
              <a
                href="/"
                className="lien-bascule"
                onClick={(e) => {
                  e.preventDefault();
                  changerMode('connexion');
                }}
              >
                ← Revenir au formulaire de connexion
              </a>
            </div>
          </>
        )}

        {/* Documents légaux : accessibles avant toute connexion */}
        <div className="pied-connexion">
          <div className="liens-document">
            <button type="button" className="lien-politique" onClick={onOuvrirPolitique}>
              🔒 Politique de confidentialité
            </button>
            <span className="separateur">·</span>
            <button type="button" className="lien-politique" onClick={onOuvrirConditions}>
              📄 Conditions générales
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Connexion;
