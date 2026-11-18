// ============================================================
// ROUTES FOURNISSEURS — Répertoire des fournisseurs (ADMIN)
// Préfixe : /api/fournisseurs
// Sécurité : validation stricte, archivage plutôt que suppression
// quand des commandes sont liées (jamais de perte d'historique)
// Isolation : le répertoire est PROPRE À CHAQUE BOUTIQUE — un compte
// ne voit jamais les fournisseurs d'un magasin qui n'est pas le sien.
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../database');
const { exigerRole, clauseBoutique, dansPortee, boutiqueCible } = require('../auth');

const EMAIL_VALIDE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NETTOYER = (valeur, max) => String(valeur ?? '').trim().slice(0, max);

// Validation commune création / modification
function validerFournisseur(body, { creation = false } = {}) {
  const nom = NETTOYER(body.nom, 80);
  const contact_nom = NETTOYER(body.contact_nom, 80) || null;
  const email = NETTOYER(body.email, 120) || null;
  const telephone = NETTOYER(body.telephone, 30) || null;
  const adresse = NETTOYER(body.adresse, 200) || null;

  if (creation && nom.length < 2) {
    return { erreur: 'Le nom du fournisseur doit contenir au moins 2 caractères' };
  }
  if (nom && nom.length < 2) {
    return { erreur: 'Le nom du fournisseur doit contenir au moins 2 caractères' };
  }
  if (email && !EMAIL_VALIDE.test(email)) {
    return { erreur: 'Adresse email invalide' };
  }
  return { valeur: { nom, contact_nom, email, telephone, adresse } };
}

// --- 1. Lister les fournisseurs (avec le nombre de commandes) ---
// GET /api/fournisseurs
router.get('/', (req, res) => {
  try {
    // Uniquement le répertoire des boutiques du compte
    const porteeSql = clauseBoutique(req, 'f.boutique_id');
    const fournisseurs = db.prepare(`
      SELECT f.*,
             COUNT(c.id) AS nb_commandes,
             COALESCE(SUM(CASE WHEN c.statut = 'recue' THEN c.montant_total ELSE 0 END), 0) AS montant_recu
      FROM fournisseurs f
      LEFT JOIN commandes c ON c.fournisseur_id = f.id
      WHERE 1=1${porteeSql.sql}
      GROUP BY f.id
      ORDER BY f.nom COLLATE NOCASE ASC
    `).all(...porteeSql.params);
    res.json(fournisseurs);
  } catch (err) {
    res.status(500).json({ erreur: 'Impossible de lire les fournisseurs' });
  }
});

// --- 2. Créer un fournisseur (ADMIN uniquement) ---
// Le gérant peut CONSULTER le répertoire (il doit passer commande),
// mais le réseau partagé ne se modifie que par l'administration.
// POST /api/fournisseurs  { nom, contact_nom?, email?, telephone?, adresse? }
router.post('/', exigerRole('admin'), (req, res) => {
  const controle = validerFournisseur(req.body, { creation: true });
  if (controle.erreur) return res.status(400).json({ erreur: controle.erreur });

  try {
    const { nom, contact_nom, email, telephone, adresse } = controle.valeur;

    // Boutique du fournisseur : celle de la session (l'admin peut cibler
    // une de SES boutiques avec boutique_id)
    const boutiqueId = boutiqueCible(req, req.body);
    if (!boutiqueId) {
      return res.status(403).json({ erreur: 'Aucune boutique rattachée à ce compte' });
    }

    const existant = db
      .prepare('SELECT id FROM fournisseurs WHERE LOWER(nom) = LOWER(?) AND boutique_id = ?')
      .get(nom, boutiqueId);
    if (existant) return res.status(409).json({ erreur: 'Ce fournisseur existe déjà dans cette boutique' });

    const result = db.prepare(`
      INSERT INTO fournisseurs (nom, contact_nom, email, telephone, adresse, boutique_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(nom, contact_nom, email, telephone, adresse, boutiqueId);

    const nouveau = db
      .prepare('SELECT * FROM fournisseurs WHERE id = ?')
      .get(result.lastInsertRowid);
    res.status(201).json(nouveau);
  } catch (err) {
    res.status(500).json({ erreur: 'Impossible de créer le fournisseur' });
  }
});

// --- 3. Modifier un fournisseur (ou le réactiver) ---
// PUT /api/fournisseurs/3   { ..., actif: 1 | 0 }
// Un fournisseur archivé reste consultable (historique des achats)
// mais il faut pouvoir le RÉACTIVER — sinon l'archivage serait définitif.
router.put('/:id', exigerRole('admin'), (req, res) => {
  const controle = validerFournisseur(req.body);
  if (controle.erreur) return res.status(400).json({ erreur: controle.erreur });

  try {
    const existant = db.prepare('SELECT * FROM fournisseurs WHERE id = ?').get(req.params.id);
    // Fournisseur d'une autre boutique → inexistence présumée (404)
    if (!existant || !dansPortee(req, existant)) {
      return res.status(404).json({ erreur: 'Fournisseur introuvable' });
    }

    // Activation / désactivation explicite (0 ou 1 uniquement)
    if (req.body.actif !== undefined) {
      const actif = Number(req.body.actif);
      if (actif !== 0 && actif !== 1) {
        return res.status(400).json({ erreur: 'La valeur « actif » doit être 0 ou 1' });
      }
      db.prepare('UPDATE fournisseurs SET actif = ? WHERE id = ?').run(actif, req.params.id);
    }

    // Mise à jour partielle : si aucun nom n'est envoyé dans la requête,
    // on s'arrête ici (sinon on écraserait le nom avec une chaîne vide)
    if (!controle.valeur.nom) {
      return res.json(db.prepare('SELECT * FROM fournisseurs WHERE id = ?').get(req.params.id));
    }

    const doublon = db
      .prepare(
        'SELECT id FROM fournisseurs WHERE LOWER(nom) = LOWER(?) AND id <> ? AND boutique_id = ?'
      )
      .get(controle.valeur.nom, req.params.id, existant.boutique_id);
    if (doublon) return res.status(409).json({ erreur: 'Ce nom est déjà utilisé' });

    db.prepare(`
      UPDATE fournisseurs
      SET nom = ?, contact_nom = ?, email = ?, telephone = ?, adresse = ?
      WHERE id = ?
    `).run(
      controle.valeur.nom, controle.valeur.contact_nom, controle.valeur.email,
      controle.valeur.telephone, controle.valeur.adresse, req.params.id
    );

    res.json(db.prepare('SELECT * FROM fournisseurs WHERE id = ?').get(req.params.id));
  } catch (err) {
    res.status(500).json({ erreur: 'Impossible de modifier le fournisseur' });
  }
});

// --- 4. Archiver / supprimer un fournisseur ---
// DELETE /api/fournisseurs/3
// Règle pro : si des commandes existent, on ARCHIVE (actif = 0)
// pour ne jamais perdre l'historique des achats.
router.delete('/:id', exigerRole('admin'), (req, res) => {
  try {
    const existant = db.prepare('SELECT * FROM fournisseurs WHERE id = ?').get(req.params.id);
    if (!existant || !dansPortee(req, existant)) {
      return res.status(404).json({ erreur: 'Fournisseur introuvable' });
    }

    const nbCommandes = db
      .prepare('SELECT COUNT(*) AS n FROM commandes WHERE fournisseur_id = ?')
      .get(req.params.id).n;

    if (nbCommandes > 0) {
      // Archive au lieu de supprimer : les commandes restent liées
      db.prepare('UPDATE fournisseurs SET actif = 0 WHERE id = ?').run(req.params.id);
      return res.json({
        message: `Fournisseur archivé (${nbCommandes} commande(s) liée(s) conservées)`,
        archive: true,
      });
    }

    db.prepare('DELETE FROM fournisseurs WHERE id = ?').run(req.params.id);
    res.json({ message: 'Fournisseur supprimé', archive: false });
  } catch (err) {
    res.status(500).json({ erreur: 'Impossible de supprimer le fournisseur' });
  }
});

module.exports = router;