// ============================================================
// AUTHENTIFICATION — Middleware « gardien » des routes API
// Vérifie le cookie de session sur CHAQUE requête protégée
// ============================================================

const crypto = require('crypto');
const db = require('./database');
const config = require('./config');

// --- Empreinte d'un jeton de session ---
// La base ne contient QUE le SHA-256 du jeton : une copie de stock.db
// (sauvegarde, export, fuite) ne permet donc pas de rejouer une session.
// Le jeton en clair n'existe que dans le cookie du navigateur.
function hacherJeton(jeton) {
  return crypto.createHash('sha256').update(String(jeton)).digest('hex');
}

// --- Lecture d'un cookie dans les en-têtes HTTP ---
// Exemple d'en-tête : "Cookie: session=abc123; autre=valeur"
function lireCookie(requete, nom) {
  const entete = requete.headers.cookie || '';
  const cookies = entete.split(';').map((c) => c.trim());
  for (const cookie of cookies) {
    const [cle, ...reste] = cookie.split('=');
    if (cle === nom) return decodeURIComponent(reste.join('='));
  }
  return null;
}

// --- Vérifie la session et renvoie l'utilisateur connecté (ou null) ---
function utilisateurConnecte(requete) {
  const jeton = lireCookie(requete, 'session');
  if (!jeton) return null;

  // On cherche l'EMPREINTE de la session en base ET on vérifie qu'elle n'est pas expirée
  // Le rôle ET la boutique sont relus EN BASE à chaque requête :
  // un changement de rôle / une désactivation prend effet immédiatement,
  // et rien ne vient du corps de la requête ni du cookie
  const session = db
    .prepare(`
      SELECT s.utilisateur_id, s.date_expiration,
             u.nom, u.email, u.role, u.boutique_id, u.actif, u.mot_de_passe_a_changer
      FROM sessions s
      JOIN utilisateurs u ON u.id = s.utilisateur_id
      WHERE s.jeton = ?
        AND datetime(s.date_expiration) > datetime('now')
        AND u.actif = 1
    `)
    .get(hacherJeton(jeton));

  if (!session) return null;

  return {
    id: session.utilisateur_id,
    nom: session.nom,
    email: session.email,
    role: session.role,
    boutique_id: session.boutique_id ?? null,
    mot_de_passe_a_changer: session.mot_de_passe_a_changer === 1,
  };
}

// ============================================================
// PORTÉE DES DONNÉES (multi-boutiques)
// admin     → tout le réseau (boutique_id NULL)
// gerant    → SA boutique uniquement
// employe   → SA boutique uniquement (la caisse)
// ============================================================

// Portée calculée à partir de la session (jamais depuis le client)
function porteeBoutique(requete) {
  const u = requete.utilisateur;
  if (!u) return { autorise: false, toutes: false, boutiqueId: null };
  if (u.role === 'admin') {
    return { autorise: true, toutes: true, boutiqueId: u.boutique_id ?? null };
  }
  if (u.boutique_id === null || u.boutique_id === undefined) {
    return { autorise: false, toutes: false, boutiqueId: null };
  }
  return { autorise: true, toutes: false, boutiqueId: u.boutique_id };
}

// Fragment SQL à ajouter à une requête initialisée avec « WHERE 1=1 »
// Exemple : const c = clauseBoutique(req); sql += c.sql; params.push(...c.params);
function clauseBoutique(requete, colonne = 'boutique_id') {
  const portee = porteeBoutique(requete);
  if (portee.toutes) return { sql: '', params: [] };
  return { sql: ` AND ${colonne} = ?`, params: [portee.boutiqueId] };
}

// true si l'objet (portant boutique_id) appartient à la portée de l'utilisateur
function dansPortee(requete, objet) {
  const portee = porteeBoutique(requete);
  if (!portee.autorise || !objet) return false;
  if (portee.toutes) return true;
  return objet.boutique_id === portee.boutiqueId;
}

// Boutique visée lors d'une ÉCRITURE :
//   gérant / employé → TOUJOURS leur boutique (le champ envoyé est ignoré)
//   admin             → boutique_id du corps, sinon 1
// Renvoie null si la portée est invalide ou la boutique inexistante
function boutiqueCible(requete, corps = {}) {
  const portee = porteeBoutique(requete);
  if (!portee.autorise) return null;
  if (!portee.toutes) return portee.boutiqueId;
  if (corps.boutique_id === undefined || corps.boutique_id === null) return 1;
  const id = parseInt(corps.boutique_id, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// --- Routes encore accessibles quand un changement de mot de passe est imposé ---
// Sinon l'utilisateur serait enfermé : impossible de changer son mot de passe,
// de se déconnecter ou de connaître son état.
const ROUTES_AUTORISEES_MDP = [
  '/api/auth/mot-de-passe',
  '/api/auth/deconnexion',
  '/api/auth/moi',
];

// --- Middleware 1 : impose d'être connecté (sinon 401) ---
function verifierConnexion(requete, reponse, suite) {
  const utilisateur = utilisateurConnecte(requete);
  if (!utilisateur) {
    return reponse.status(401).json({
      erreur: 'Authentification requise — connectez-vous pour continuer',
    });
  }
  requete.utilisateur = utilisateur; // Rend l'utilisateur dispo dans la route

  // En sécurité stricte, un compte qui utilise encore un mot de passe public
  // (démonstration ou imposé par un administrateur) ne peut RIEN faire
  // d'autre que le changer. Le contrôle est côté serveur : masquer l'écran
  // dans l'interface ne suffirait pas.
  if (
    config.securiteStricte &&
    utilisateur.mot_de_passe_a_changer &&
    !ROUTES_AUTORISEES_MDP.includes(requete.originalUrl.split('?')[0])
  ) {
    return reponse.status(403).json({
      erreur: 'Changement de mot de passe requis avant de continuer',
      code: 'CHANGEMENT_MOT_DE_PASSE_REQUIS',
    });
  }

  suite();
}

// --- Middleware 2 : impose un rôle précis (sinon 403) ---
// Usage : exigerRole('admin') → refuse si le rôle n'est pas admin
function exigerRole(...rolesAutorises) {
  return (requete, reponse, suite) => {
    if (!requete.utilisateur) {
      return reponse.status(401).json({ erreur: 'Authentification requise' });
    }
    if (!rolesAutorises.includes(requete.utilisateur.role)) {
      // 403 = compris mais refusé (à ne pas confondre avec 401)
      return reponse.status(403).json({
        erreur: 'Accès refusé — ce rôle n’est pas autorisé à cette action',
      });
    }
    suite();
  };
}

// --- Création d'une session (appelée après un login réussi) ---
function creerSession(utilisateurId) {
  // Jeton impossible à deviner : 64 caractères aléatoires hexadécimaux
  const jeton = crypto.randomBytes(32).toString('hex');
  // Expiration : maintenant + 24 heures
  // Seule l'empreinte du jeton est enregistrée en base
  db.prepare(`
    INSERT INTO sessions (jeton, utilisateur_id, date_expiration)
    VALUES (?, ?, datetime('now', '+24 hours'))
  `).run(hacherJeton(jeton), utilisateurId);
  return jeton;
}

// --- Suppression de la session (déconnexion) ---
function supprimerSession(requete) {
  const jeton = lireCookie(requete, 'session');
  if (jeton) {
    db.prepare('DELETE FROM sessions WHERE jeton = ?').run(hacherJeton(jeton));
  }
}

// --- Nettoyage des sessions expirées ---
// Appelé au démarrage puis périodiquement : la table ne grossit pas
// indéfiniment et les jetons morts disparaissent réellement.
function purgerSessionsExpirees() {
  const { changes } = db
    .prepare("DELETE FROM sessions WHERE datetime(date_expiration) <= datetime('now')")
    .run();
  return changes;
}

module.exports = {
  verifierConnexion,
  exigerRole,
  creerSession,
  supprimerSession,
  hacherJeton,
  purgerSessionsExpirees,
  utilisateurConnecte,
  porteeBoutique,
  clauseBoutique,
  dansPortee,
  boutiqueCible,
};
