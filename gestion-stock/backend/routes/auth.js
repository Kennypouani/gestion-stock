// ============================================================
// ROUTES AUTH — Connexion / Déconnexion / Qui suis-je ?
// Préfixe : /api/auth
// ============================================================

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit'); // Anti force brute
const db = require('../database');
const config = require('../config');
const {
  creerSession,
  supprimerSession,
  hacherJeton,
  utilisateurConnecte,
  verifierConnexion,
  boutiquesDeUtilisateur,
} = require('../auth');
const { estMotDePasseDemo } = require('../motsDePasse');

const router = express.Router();

// --- Boutiques du compte, ajoutées aux réponses de session ---
// L'en-tête de l'application affiche « GÉRANT · Magasin principal » :
// on le fournit DÈS la connexion et sur /moi, sans appel supplémentaire.
// `boutiques` est la liste complète (un admin peut en avoir plusieurs),
// `boutique` la première, et `doit_creer_boutique` le drapeau qui
// déclenche l'écran de création quand la liste est vide.
function avecBoutiques(utilisateur) {
  if (!utilisateur) return utilisateur;
  const liste = utilisateur.boutiques || boutiquesDeUtilisateur(utilisateur.id);
  utilisateur.boutiques = liste.map((b) => ({
    id: b.id,
    nom: b.nom,
    code: b.code,
    actif: b.actif,
  }));
  utilisateur.boutique = utilisateur.boutiques[0] || null;
  utilisateur.doit_creer_boutique = utilisateur.boutiques.length === 0;
  return utilisateur;
}

// --- État du mot de passe, ajouté aux réponses de session ---
// changement_obligatoire = vrai UNIQUEMENT si la sécurité stricte est active :
// le frontend n'affiche l'écran bloquant que lorsque le serveur le refuse vraiment.
function avecEtatMotDePasse(utilisateur) {
  if (!utilisateur) return utilisateur;
  const aChanger = utilisateur.mot_de_passe_a_changer === true;
  utilisateur.mot_de_passe_a_changer = aChanger;
  utilisateur.changement_obligatoire = config.securiteStricte && aChanger;
  return utilisateur;
}

// --- Refus d'un mot de passe public (démonstration) ---
// Actif en sécurité stricte : la valeur ne doit jamais revenir en base,
// ni par une création, ni par une réinitialisation, ni par un changement volontaire.
function refusMotDePasseDemo(motDePasse) {
  if (!config.securiteStricte) return null;
  if (!estMotDePasseDemo(motDePasse)) return null;
  return 'Ce mot de passe fait partie des mots de passe de démonstration publics — choisissez-en un autre';
}

// Options du cookie de sécurité
const OPTIONS_COOKIE = {
  httpOnly: true,                              // JS dans le navigateur ne peut PAS le lire
  sameSite: 'lax',                            // Bloque les requêtes forgées depuis d'autres sites
  path: '/',                                   // Disponible sur toute l'application
  maxAge: 24 * 60 * 60 * 1000,                // 24 heures en millisecondes
  // Secure : le cookie ne part que par HTTPS.
  // Activé par défaut en production (COOKIE_SECURE), à laisser
  // désactivé uniquement pour un test HTTP en local.
  secure: config.cookieSecure,
};

// --- 1. CONNEXION ---
// POST /api/auth/connexion  { email, mot_de_passe }
// Limite : 10 échecs par IP et par tranche de 15 minutes (les réussites ne comptent pas)
const limiteurConnexion = rateLimit({
  windowMs: 15 * 60 * 1000,   // Fenêtre de 15 minutes
  max: 10,                    // Maximum 10 tentatives échouées
  skipSuccessfulRequests: true, // Une connexion réussie ne compte pas
  standardHeaders: true,
  legacyHeaders: false,
  message: { erreur: 'Trop de tentatives échouées — réessayez dans 15 minutes' },
});

// UN DEUXIÈME COMPTEUR SÉPARÉ pour le changement de mot de passe :
// sinon les deux actions se partageaient les 10 essais et une série
// d'échecs sur l'une bloquait l'autre sans raison.
const limiteurMotDePasse = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erreur: 'Trop de tentatives échouées — réessayez dans 15 minutes' },
});

router.post('/connexion', limiteurConnexion, (req, res) => {
  const { email, mot_de_passe } = req.body;

  // Validation minimale
  if (!email || !mot_de_passe) {
    return res.status(400).json({ erreur: 'Email et mot de passe obligatoires' });
  }

  try {
    // On cherche SANS filtrer sur actif : un compte en attente d'activation
    // doit pouvoir être distingué d'un mauvais mot de passe (mais seulement
    // une fois le mot de passe vérifié, jamais avant).
    const utilisateur = db
      .prepare('SELECT * FROM utilisateurs WHERE email = ?')
      .get(email.trim().toLowerCase());

    // Message IDENTIQUE que l'email n'existe pas ou que le mot de passe est faux :
    // sinon on révélerait quels comptes existent (énumération d'utilisateurs)
    if (!utilisateur || !bcrypt.compareSync(mot_de_passe, utilisateur.mot_de_passe)) {
      return res.status(401).json({ erreur: 'Email ou mot de passe incorrect' });
    }

    // Mot de passe CORRECT mais compte non activé (inscription en attente) :
    // on peut le dire sans risque, l'utilisateur connaît déjà le mot de passe.
    if (!utilisateur.actif) {
      return res.status(403).json({
        erreur:
          'Votre compte n’est pas encore activé — un administrateur doit l’activer avant la première connexion',
      });
    }

    // Création de la session + envoi du cookie
    const jeton = creerSession(utilisateur.id);
    res.cookie('session', jeton, OPTIONS_COOKIE);

    // On ne renvoie JAMAIS le mot de passe haché
    res.json(
      avecEtatMotDePasse(
        avecBoutiques({
          id: utilisateur.id,
          nom: utilisateur.nom,
          email: utilisateur.email,
          role: utilisateur.role,
          boutique_id: utilisateur.boutique_id ?? null,
          mot_de_passe_a_changer: utilisateur.mot_de_passe_a_changer === 1,
        })
      )
    );
  } catch (err) {
    console.error('Erreur connexion :', err.message);
    res.status(500).json({ erreur: 'Erreur interne de connexion' });
  }
});

// --- 1 bis. INSCRIPTION PUBLIQUE ---
// POST /api/auth/inscription
// { nom, email, mot_de_passe, confirmation }
//
// Le profil est VERROUILLÉ sur « admin » : c'est le serveur qui l'impose,
// jamais le client (aucun rôle n'est lu dans la requête, et un admin
// n'appartient à aucune boutique).
//
// Une inscription ne donne pas d'accès immédiat : le compte est créé
// inactif et doit être activé (écran « Comptes ») avant la première
// connexion.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const limiteurInscription = rateLimit({
  windowMs: 60 * 60 * 1000, // 5 inscriptions par IP et par heure
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erreur: 'Trop d’inscriptions depuis cette adresse — réessayez dans une heure' },
});

router.post('/inscription', limiteurInscription, (req, res) => {
  const { nom, email, mot_de_passe, confirmation } = req.body || {};

  // --- Validation ---
  if (!nom || nom.trim().length < 2 || nom.trim().length > 80) {
    return res.status(400).json({ erreur: 'Le nom doit contenir entre 2 et 80 caractères' });
  }
  if (!email || !EMAIL_REGEX.test(email.trim())) {
    return res.status(400).json({ erreur: 'Adresse email invalide' });
  }
  if (!mot_de_passe || String(mot_de_passe).length < 8) {
    return res.status(400).json({ erreur: 'Le mot de passe doit contenir au moins 8 caractères' });
  }
  if (mot_de_passe !== confirmation) {
    return res.status(400).json({ erreur: 'La confirmation ne correspond pas au mot de passe' });
  }
  const refusDemo = refusMotDePasseDemo(mot_de_passe);
  if (refusDemo) return res.status(400).json({ erreur: refusDemo });

  const emailPropre = email.trim().toLowerCase();

  try {
    const existe = db
      .prepare('SELECT id FROM utilisateurs WHERE lower(email) = ?')
      .get(emailPropre);
    if (existe) {
      return res.status(409).json({ erreur: 'Un compte existe déjà avec cet email' });
    }

    // Profil verrouillé : role = 'admin', et AUCUNE boutique.
    // Le compte est actif mais ne peut rien faire tant qu'il n'a pas
    // créé sa propre boutique (verifierConnexion renvoie 403 sinon).
    const hash = bcrypt.hashSync(mot_de_passe, 10);
    db.prepare(`
      INSERT INTO utilisateurs (nom, email, mot_de_passe, role, boutique_id, actif, mot_de_passe_a_changer)
      VALUES (?, ?, ?, 'admin', NULL, 1, 0)
    `).run(nom.trim(), emailPropre, hash);

    res.status(201).json({
      role: 'admin',
      boutique_a_creer: true,
      message:
        'Compte administrateur créé — connectez-vous puis créez votre boutique',
    });
  } catch (err) {
    console.error('Erreur inscription :', err.message);
    res.status(500).json({ erreur: 'Impossible de créer le compte' });
  }
});

// --- 2. DÉCONNEXION ---
// POST /api/auth/deconnexion
router.post('/deconnexion', (req, res) => {
  try {
    supprimerSession(req);
    // On vide le cookie côté navigateur
    res.clearCookie('session', { ...OPTIONS_COOKIE, maxAge: undefined });
    res.json({ message: 'Déconnecté' });
  } catch (err) {
    res.status(500).json({ erreur: 'Erreur lors de la déconnexion' });
  }
});

// --- 3. UTILISATEUR COURANT (appelé au chargement de l'app) ---
// GET /api/auth/moi
router.get('/moi', (req, res) => {
  const utilisateur = utilisateurConnecte(req);
  if (!utilisateur) {
    return res.status(401).json({ erreur: 'Non connecté' });
  }

  // On ajoute le nom + le code de SA boutique : l'en-tête de l'application
  // affiche ainsi « GÉRANT · Magasin principal » sans autre appel API.
  res.json(avecEtatMotDePasse(avecBoutiques(utilisateur)));
});

// --- 4. CHANGER SON PROPRE MOT DE PASSE ---
// PUT /api/auth/mot-de-passe
// { ancien_mot_de_passe, nouveau_mot_de_passe, confirmation }
// Après le changement, toutes les AUTRES sessions sont fermées :
// un vol de jeton devient inutilisable.
router.put('/mot-de-passe', verifierConnexion, limiteurMotDePasse, (req, res) => {
  const { ancien_mot_de_passe, nouveau_mot_de_passe, confirmation } = req.body;

  // --- Validation ---
  if (!ancien_mot_de_passe || !nouveau_mot_de_passe) {
    return res.status(400).json({ erreur: 'Ancien et nouveau mot de passe obligatoires' });
  }
  if (String(nouveau_mot_de_passe).length < 8) {
    return res.status(400).json({ erreur: 'Le nouveau mot de passe doit contenir au moins 8 caractères' });
  }
  if (nouveau_mot_de_passe !== confirmation) {
    return res.status(400).json({ erreur: 'La confirmation ne correspond pas au nouveau mot de passe' });
  }
  if (nouveau_mot_de_passe === ancien_mot_de_passe) {
    return res.status(400).json({ erreur: 'Le nouveau mot de passe doit être différent de l’ancien' });
  }
  const refusDemo = refusMotDePasseDemo(nouveau_mot_de_passe);
  if (refusDemo) {
    return res.status(400).json({ erreur: refusDemo });
  }

  try {
    const utilisateur = db
      .prepare('SELECT * FROM utilisateurs WHERE id = ? AND actif = 1')
      .get(req.utilisateur.id);

    if (!utilisateur || !bcrypt.compareSync(ancien_mot_de_passe, utilisateur.mot_de_passe)) {
      // 401 = l'ancien mot de passe est faux
      return res.status(401).json({ erreur: 'Ancien mot de passe incorrect' });
    }

    // Le mot de passe est choisi par l'utilisateur : plus de changement imposé
    const hache = bcrypt.hashSync(nouveau_mot_de_passe, 10);
    db.prepare('UPDATE utilisateurs SET mot_de_passe = ?, mot_de_passe_a_changer = 0 WHERE id = ?')
      .run(hache, utilisateur.id);

    // Jeton de la session courante (à conserver) — comparé sous forme d'empreinte
    const cookies = String(req.headers.cookie || '').split(';').map((c) => c.trim());
    const courant = cookies.find((c) => c.startsWith('session='));
    const jetonCourant = courant
      ? hacherJeton(decodeURIComponent(courant.slice('session='.length)))
      : null;

    // Fermeture des autres sessions
    const fermees = jetonCourant
      ? db.prepare('DELETE FROM sessions WHERE utilisateur_id = ? AND jeton <> ?')
          .run(utilisateur.id, jetonCourant).changes
      : db.prepare('DELETE FROM sessions WHERE utilisateur_id = ?')
          .run(utilisateur.id).changes;

    res.json({
      message: 'Mot de passe modifié',
      autres_sessions_fermees: fermees,
      changement_obligatoire: false,
    });
  } catch (err) {
    console.error('Erreur changement mot de passe :', err.message);
    res.status(500).json({ erreur: 'Impossible de modifier le mot de passe' });
  }
});

module.exports = router;
