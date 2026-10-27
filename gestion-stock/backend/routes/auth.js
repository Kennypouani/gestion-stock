// ============================================================
// ROUTES AUTH — Connexion / Déconnexion / Qui suis-je ?
// Préfixe : /api/auth
// ============================================================

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit'); // Anti force brute
const db = require('../database');
const { creerSession, supprimerSession, utilisateurConnecte, verifierConnexion } = require('../auth');

const router = express.Router();

// --- Le nom + le code de SA boutique, ajoutés aux réponses de session ---
// L'en-tête de l'application affiche « GÉRANT · Magasin principal » :
// on le fournit DÈS la connexion et sur /moi, sans appel supplémentaire.
// Un admin n'a aucune boutique (boutique_id NULL) → rien n'est ajouté.
function avecBoutique(utilisateur) {
  if (utilisateur && utilisateur.boutique_id) {
    const boutique = db
      .prepare('SELECT id, nom, code FROM boutiques WHERE id = ?')
      .get(utilisateur.boutique_id);
    if (boutique) utilisateur.boutique = boutique;
  }
  return utilisateur;
}

// Options du cookie de sécurité
const OPTIONS_COOKIE = {
  httpOnly: true,                              // JS dans le navigateur ne peut PAS le lire
  sameSite: 'lax',                            // Bloque les requêtes forgées depuis d'autres sites
  path: '/',                                   // Disponible sur toute l'application
  maxAge: 24 * 60 * 60 * 1000,                // 24 heures en millisecondes
  // secure: true,                           // → à activer en production avec HTTPS
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
    const utilisateur = db
      .prepare('SELECT * FROM utilisateurs WHERE email = ? AND actif = 1')
      .get(email.trim().toLowerCase());

    // Message IDENTIQUE que l'email n'existe pas ou que le mot de passe est faux :
    // sinon on révélerait quels comptes existent (énumération d'utilisateurs)
    if (!utilisateur || !bcrypt.compareSync(mot_de_passe, utilisateur.mot_de_passe)) {
      return res.status(401).json({ erreur: 'Email ou mot de passe incorrect' });
    }

    // Création de la session + envoi du cookie
    const jeton = creerSession(utilisateur.id);
    res.cookie('session', jeton, OPTIONS_COOKIE);

    // On ne renvoie JAMAIS le mot de passe haché
    res.json(
      avecBoutique({
        id: utilisateur.id,
        nom: utilisateur.nom,
        email: utilisateur.email,
        role: utilisateur.role,
        boutique_id: utilisateur.boutique_id ?? null,
      })
    );
  } catch (err) {
    console.error('Erreur connexion :', err.message);
    res.status(500).json({ erreur: 'Erreur interne de connexion' });
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
  res.json(avecBoutique(utilisateur));
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

  try {
    const utilisateur = db
      .prepare('SELECT * FROM utilisateurs WHERE id = ? AND actif = 1')
      .get(req.utilisateur.id);

    if (!utilisateur || !bcrypt.compareSync(ancien_mot_de_passe, utilisateur.mot_de_passe)) {
      // 401 = l'ancien mot de passe est faux
      return res.status(401).json({ erreur: 'Ancien mot de passe incorrect' });
    }

    const hache = bcrypt.hashSync(nouveau_mot_de_passe, 10);
    db.prepare('UPDATE utilisateurs SET mot_de_passe = ? WHERE id = ?')
      .run(hache, utilisateur.id);

    // Jeton de la session courante (à conserver)
    const cookies = String(req.headers.cookie || '').split(';').map((c) => c.trim());
    const courant = cookies.find((c) => c.startsWith('session='));
    const jetonCourant = courant ? courant.slice('session='.length) : null;

    // Fermeture des autres sessions
    const fermees = jetonCourant
      ? db.prepare('DELETE FROM sessions WHERE utilisateur_id = ? AND jeton <> ?')
          .run(utilisateur.id, jetonCourant).changes
      : db.prepare('DELETE FROM sessions WHERE utilisateur_id = ?')
          .run(utilisateur.id).changes;

    res.json({
      message: 'Mot de passe modifié',
      autres_sessions_fermees: fermees,
    });
  } catch (err) {
    console.error('Erreur changement mot de passe :', err.message);
    res.status(500).json({ erreur: 'Impossible de modifier le mot de passe' });
  }
});

module.exports = router;
