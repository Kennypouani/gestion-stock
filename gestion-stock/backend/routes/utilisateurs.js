// ============================================================
// ROUTES UTILISATEURS — Gestion des comptes (ADMIN SEULEMENT)
// Préfixe : /api/utilisateurs
// Sécurité : validation stricte, bcrypt, jamais de mot de passe
// en réponse, protection contre l'auto-désactivation
// ============================================================

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const config = require('../config');
const { estMotDePasseDemo } = require('../motsDePasse');
const { porteeBoutique } = require('../auth');

const router = express.Router();

// Note : ces routes sont protégées dans server.js par
// verifierConnexion + exigerRole('admin') — inutile de les retester ici.

// --- Constantes de validation ---
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LONGUEUR_MIN_MDP = 8;
const ROLES_VALIDES = ['employe', 'gerant', 'admin'];

// --- Un compte cible est-il dans MA portée ? ---
// Vrai s'il partage au moins une boutique avec moi (jamais le compte
// d'un autre magasin, même pour le consulter).
function partageMaBoutique(req, cibleId) {
  const ids = porteeBoutique(req).ids;
  if (ids.length === 0) return false;
  const marques = ids.map(() => '?').join(', ');
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM acces_boutiques WHERE utilisateur_id = ? AND boutique_id IN (${marques})`
      )
      .get(cibleId, ...ids)
  );
}

// --- Rattachement à une boutique ---
// admin  → aucune boutique « principale » (il peut en avoir plusieurs)
// gerant / employe → OBLIGATOIREMENT une de MES boutiques
// C'est le serveur qui décide : le client ne peut pas choisir autre chose.
function resoudreBoutique(role, valeur, idsAutorises) {
  if (role === 'admin') return { valeur: null };

  const id = parseInt(valeur, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return { erreur: 'Ce rôle doit être rattaché à une boutique (boutique_id obligatoire)' };
  }
  if (!idsAutorises.includes(id)) {
    return { erreur: 'Boutique inconnue' };
  }
  const boutique = db.prepare('SELECT id, actif FROM boutiques WHERE id = ?').get(id);
  if (!boutique) return { erreur: 'Boutique inconnue' };
  if (!boutique.actif) return { erreur: 'Cette boutique est archivée — réactivez-la d’abord' };
  return { valeur: id };
}

// Refus d'un mot de passe de démonstration (public) en sécurité stricte
function refusMotDePasseDemo(motDePasse) {
  if (!config.securiteStricte) return null;
  if (!estMotDePasseDemo(motDePasse)) return null;
  return 'Ce mot de passe fait partie des mots de passe de démonstration publics — choisissez-en un autre';
}

// Retourne un utilisateur SENSIBLE (jamais le mot de passe haché)
function sansMotDePasse(utilisateur) {
  const { mot_de_passe, ...sans } = utilisateur;
  return sans;
}

// ============================================================
// 1. LISTER TOUS LES COMPTES
// GET /api/utilisateurs
// ============================================================
router.get('/', (req, res) => {
  try {
    // Seulement les comptes qui partagent une de MES boutiques (+ moi-même).
    const ids = porteeBoutique(req).ids;
    if (ids.length === 0) {
      const moi = db
        .prepare(`
          SELECT id, nom, email, role, boutique_id, actif, date_creation, mot_de_passe_a_changer
          FROM utilisateurs WHERE id = ?
        `)
        .get(req.utilisateur.id);
      return res.json(moi ? [moi] : []);
    }
    const marques = ids.map(() => '?').join(', ');
    const liste = db
      .prepare(`
        SELECT u.id, u.nom, u.email, u.role, u.boutique_id, u.actif, u.date_creation,
               u.mot_de_passe_a_changer,
               b.nom AS boutique_nom, b.code AS boutique_code
        FROM utilisateurs u
        LEFT JOIN boutiques b ON b.id = u.boutique_id
        WHERE u.id = ?
           OR u.id IN (SELECT utilisateur_id FROM acces_boutiques WHERE boutique_id IN (${marques}))
        ORDER BY u.nom
      `)
      .all(req.utilisateur.id, ...ids);
    res.json(liste);
  } catch (err) {
    console.error('Erreur liste utilisateurs :', err.message);
    res.status(500).json({ erreur: 'Impossible de lister les comptes' });
  }
});

// ============================================================
// 2. CRÉER UN COMPTE
// POST /api/utilisateurs  { nom, email, mot_de_passe, role }
// ============================================================
router.post('/', (req, res) => {
  const { nom, email, mot_de_passe, role, boutique_id } = req.body;

  // --- Validation stricte de chaque champ ---
  if (!nom || nom.trim().length < 2 || nom.trim().length > 80) {
    return res.status(400).json({ erreur: 'Le nom doit contenir entre 2 et 80 caractères' });
  }
  if (!email || !EMAIL_REGEX.test(email.trim())) {
    return res.status(400).json({ erreur: 'Adresse email invalide' });
  }
  if (!mot_de_passe || mot_de_passe.length < LONGUEUR_MIN_MDP) {
    return res
      .status(400)
      .json({ erreur: `Le mot de passe doit contenir au moins ${LONGUEUR_MIN_MDP} caractères` });
  }
  if (!ROLES_VALIDES.includes(role)) {
    return res.status(400).json({ erreur: 'Rôle invalide (attendu : employe, gerant ou admin)' });
  }
  const refusDemo = refusMotDePasseDemo(mot_de_passe);
  if (refusDemo) {
    return res.status(400).json({ erreur: refusDemo });
  }

  // --- Rattachement à la boutique (refusé si invalide ou pas à moi) ---
  const mesBoutiques = porteeBoutique(req).ids;
  const boutique = resoudreBoutique(role, boutique_id, mesBoutiques);
  if (boutique.erreur) return res.status(400).json({ erreur: boutique.erreur });

  const emailPropre = email.trim().toLowerCase();

  try {
    // Email déjà utilisé ? (comparaison insensible à la casse)
    const existe = db
      .prepare('SELECT id FROM utilisateurs WHERE lower(email) = ?')
      .get(emailPropre);
    if (existe) {
      return res.status(409).json({ erreur: 'Un compte existe déjà avec cet email' });
    }

    // Hachage bcrypt : le mot de passe n'est JAMAIS stocké en clair
    const hash = bcrypt.hashSync(mot_de_passe, 10);
    // Le mot de passe initial est choisi par l'administrateur :
    // la personne devra le remplacer à sa première connexion (sécurité stricte).
    const resultat = db
      .prepare(`
        INSERT INTO utilisateurs (nom, email, mot_de_passe, role, boutique_id, mot_de_passe_a_changer)
        VALUES (?, ?, ?, ?, ?, 1)
      `)
      .run(nom.trim(), emailPropre, hash, role, boutique.valeur);

    // Le nouveau compte est rattaché aux boutiques de son créateur :
    // une seule pour un gérant/employé, toutes pour un co-administrateur.
    const nouveauId = Number(resultat.lastInsertRowid);
    const lier = db.prepare(
      'INSERT OR IGNORE INTO acces_boutiques (utilisateur_id, boutique_id) VALUES (?, ?)'
    );
    if (role === 'admin') {
      for (const id of mesBoutiques) lier.run(nouveauId, id);
    } else {
      lier.run(nouveauId, boutique.valeur);
    }

    const cree = db
      .prepare(`
        SELECT id, nom, email, role, boutique_id, actif, date_creation, mot_de_passe_a_changer
        FROM utilisateurs WHERE id = ?
      `)
      .get(resultat.lastInsertRowid);

    res.status(201).json(cree);
  } catch (err) {
    console.error('Erreur création compte :', err.message);
    res.status(500).json({ erreur: 'Impossible de créer le compte' });
  }
});

// ============================================================
// 3. MODIFIER UN COMPTE (rôle ou statut actif/inactif)
// PUT /api/utilisateurs/3  { role?, actif? }
// ============================================================
router.put('/:id', (req, res) => {
  const cibleId = parseInt(req.params.id);
  const { role, actif, boutique_id } = req.body;

  try {
    const cible = db.prepare('SELECT * FROM utilisateurs WHERE id = ?').get(cibleId);
    // Compte d'une autre boutique → inexistence présumée (404)
    if (!cible || !partageMaBoutique(req, cibleId)) {
      return res.status(404).json({ erreur: 'Compte introuvable' });
    }

    // --- SÉCURITÉ : l'admin ne peut pas se modifier lui-même ---
    // Évite de se retirer ses propres droits ou de se désactiver
    if (cibleId === req.utilisateur.id) {
      return res.status(400).json({ erreur: 'Vous ne pouvez pas modifier votre propre compte' });
    }

    // Validation du rôle si fourni
    if (role !== undefined && !ROLES_VALIDES.includes(role)) {
      return res.status(400).json({ erreur: 'Rôle invalide' });
    }

    // --- Rattachement à une boutique (optionnel : sinon on garde l'existant) ---
    const roleFinal = role !== undefined ? role : cible.role;
    if (boutique_id !== undefined) {
      const boutique = resoudreBoutique(roleFinal, boutique_id, porteeBoutique(req).ids);
      if (boutique.erreur) return res.status(400).json({ erreur: boutique.erreur });
      // Un compte modifié ne garde PAS de session éventuellement obsolète
      if (boutique.valeur !== cible.boutique_id) {
        db.prepare('DELETE FROM sessions WHERE utilisateur_id = ?').run(cibleId);
      }
      db.prepare('UPDATE utilisateurs SET boutique_id = ? WHERE id = ?').run(
        boutique.valeur,
        cibleId
      );
      // Le lien d'accès suit le rattachement : une seule boutique
      if (boutique.valeur !== null) {
        db.prepare('DELETE FROM acces_boutiques WHERE utilisateur_id = ?').run(cibleId);
        db.prepare(
          'INSERT OR IGNORE INTO acces_boutiques (utilisateur_id, boutique_id) VALUES (?, ?)'
        ).run(cibleId, boutique.valeur);
      }
    } else if (roleFinal !== cible.role) {
      // Changement de rôle : le rattachement doit rester cohérent
      const boutique = resoudreBoutique(roleFinal, cible.boutique_id, porteeBoutique(req).ids);
      if (boutique.erreur) return res.status(400).json({ erreur: boutique.erreur });
      // Un admin n'appartient à AUCUNE boutique (boutique_id NULL) :
      // en promouvant un gérant, on détache donc le compte de son ancien magasin
      // (il ne doit plus appartenir au périmètre d'une boutique particulière)
      if (boutique.valeur === null && cible.boutique_id !== null) {
        db.prepare('UPDATE utilisateurs SET boutique_id = NULL WHERE id = ?').run(cibleId);
      }
    }

    // Normalisation du statut (booléen → 0/1)
    let actifFinal = cible.actif;
    if (actif !== undefined) {
      if (typeof actif !== 'boolean') {
        return res.status(400).json({ erreur: 'Le champ actif doit être true ou false' });
      }
      actifFinal = actif ? 1 : 0;
    }

    // --- SÉCURITÉ : ne jamais perdre le dernier admin actif ---
    const perteAdmin =
      cible.role === 'admin' &&
      cible.actif === 1 &&
      ((role !== undefined && role !== 'admin') || actifFinal === 0);
    if (perteAdmin) {
      const nbAdminsActifs = db
        .prepare("SELECT COUNT(*) AS n FROM utilisateurs WHERE role = 'admin' AND actif = 1")
        .get().n;
      if (nbAdminsActifs <= 1) {
        return res.status(400).json({
          erreur: 'Impossible : ceci retirerait le dernier administrateur actif',
        });
      }
    }

    db.prepare('UPDATE utilisateurs SET role = ?, actif = ? WHERE id = ?').run(
      roleFinal,
      actifFinal,
      cibleId
    );

    // Si le compte est désactivé, on détruit TOUTES ses sessions immédiatement
    if (actifFinal === 0) {
      db.prepare('DELETE FROM sessions WHERE utilisateur_id = ?').run(cibleId);
    }

    const misAJour = db
      .prepare(`
        SELECT id, nom, email, role, boutique_id, actif, date_creation, mot_de_passe_a_changer
        FROM utilisateurs WHERE id = ?
      `)
      .get(cibleId);
    res.json(misAJour);
  } catch (err) {
    console.error('Erreur modification compte :', err.message);
    res.status(500).json({ erreur: 'Impossible de modifier le compte' });
  }
});

// ============================================================
// 4. RÉINITIALISER UN MOT DE PASSE (admin)
// PUT /api/utilisateurs/3/mot-de-passe  { mot_de_passe }
// ============================================================
router.put('/:id/mot-de-passe', (req, res) => {
  const cibleId = parseInt(req.params.id);
  const { mot_de_passe } = req.body;

  if (!mot_de_passe || mot_de_passe.length < LONGUEUR_MIN_MDP) {
    return res
      .status(400)
      .json({ erreur: `Le mot de passe doit contenir au moins ${LONGUEUR_MIN_MDP} caractères` });
  }
  const refusDemo = refusMotDePasseDemo(mot_de_passe);
  if (refusDemo) {
    return res.status(400).json({ erreur: refusDemo });
  }

  try {
    const cible = db.prepare('SELECT id FROM utilisateurs WHERE id = ?').get(cibleId);
    if (!cible) {
      return res.status(404).json({ erreur: 'Compte introuvable' });
    }

    // Mot de passe provisoire fixé par l'administrateur :
    // la personne doit en choisir un autre à sa prochaine connexion.
    const hash = bcrypt.hashSync(mot_de_passe, 10);
    db.prepare('UPDATE utilisateurs SET mot_de_passe = ?, mot_de_passe_a_changer = 1 WHERE id = ?')
      .run(hash, cibleId);

    // Sécurité : on détruit les sessions existantes de ce compte,
    // pour que la personne soit obligée de se reconnecter avec le nouveau mot de passe
    db.prepare('DELETE FROM sessions WHERE utilisateur_id = ?').run(cibleId);

    res.json({ message: 'Mot de passe réinitialisé — les sessions ouvertes ont été fermées' });
  } catch (err) {
    console.error('Erreur réinitialisation :', err.message);
    res.status(500).json({ erreur: 'Impossible de réinitialiser le mot de passe' });
  }
});

// ============================================================
// 5. SUPPRIMER UN COMPTE (admin)
// DELETE /api/utilisateurs/3
// ============================================================
router.delete('/:id', (req, res) => {
  const cibleId = parseInt(req.params.id);

  try {
    const cible = db.prepare('SELECT * FROM utilisateurs WHERE id = ?').get(cibleId);
    if (!cible || !partageMaBoutique(req, cibleId)) {
      return res.status(404).json({ erreur: 'Compte introuvable' });
    }

    // Ne pas se supprimer soi-même
    if (cibleId === req.utilisateur.id) {
      return res.status(400).json({ erreur: 'Vous ne pouvez pas supprimer votre propre compte' });
    }

    // Ne jamais supprimer le dernier admin actif
    if (cible.role === 'admin' && cible.actif === 1) {
      const nbAdminsActifs = db
        .prepare("SELECT COUNT(*) AS n FROM utilisateurs WHERE role = 'admin' AND actif = 1")
        .get().n;
      if (nbAdminsActifs <= 1) {
        return res.status(400).json({ erreur: 'Impossible : ceci supprimerait le dernier administrateur' });
      }
    }

    // ON DELETE CASCADE : ses sessions sont supprimées automatiquement
    db.prepare('DELETE FROM utilisateurs WHERE id = ?').run(cibleId);
    res.status(204).send();
  } catch (err) {
    console.error('Erreur suppression compte :', err.message);
    res.status(500).json({ erreur: 'Impossible de supprimer le compte' });
  }
});

module.exports = router;
