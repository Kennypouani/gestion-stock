// ============================================================
// ROUTES PRODUITS — Toutes les opérations sur les produits
// Préfixe : /api/produits
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../database');
const { exigerRole, porteeBoutique, clauseBoutique, dansPortee, boutiqueCible } = require('../auth');
const { journaliser, journaliserModifications } = require('../journal');

// --- 1. Lire tous les produits (avec recherche et filtre) ---
// GET /api/produits?recherche=pain&categorie=Épicerie
router.get('/', (req, res) => {
  const { recherche, categorie, alerte, expiration } = req.query;

  let sql = 'SELECT * FROM produits WHERE 1=1';
  const params = [];

  // Recherche par nom ou code-barres
  if (recherche) {
    sql += ' AND (nom LIKE ? OR code_barre LIKE ?)';
    params.push(`%${recherche}%`, `%${recherche}%`);
  }

  // Filtre par catégorie
  if (categorie) {
    sql += ' AND categorie = ?';
    params.push(categorie);
  }

  // Filtre : seulement les produits en alerte de stock
  if (alerte === 'true') {
    sql += ' AND quantite <= seuil_alerte';
  }

  // Filtre d'expiration :
  //   ?expiration=0  → seulement les produits PÉRIMÉS (date déjà passée)
  //   ?expiration=N  → ceux qui expirent dans les N jours À VENIR
  // (les deux jeux sont disjoints : un périmé n'apparaît pas dans l'autre)
  if (expiration !== undefined && expiration !== '') {
    const jours = Math.max(0, parseInt(expiration, 10) || 0);
    if (jours === 0) {
      sql += ` AND date_expiration IS NOT NULL
               AND TRIM(date_expiration) <> ''
               AND date_expiration < date('now')`;
    } else {
      sql += ` AND date_expiration IS NOT NULL
               AND TRIM(date_expiration) <> ''
               AND date_expiration >= date('now')
               AND date_expiration <= date('now', ?)`;
      params.push(`+${jours} days`);
    }
  }

  // --- ISOLATION MULTI-BOUTIQUES ---
  // Le filtre vient TOUJOURS de la session, jamais du client :
  // admin → aucun filtre (tout le réseau), gérant/employé → sa boutique
  const portee = porteeBoutique(req);
  if (!portee.autorise) {
    return res.status(403).json({ erreur: 'Aucune boutique rattachée à ce compte' });
  }
  const porteeSql = clauseBoutique(req);
  sql += porteeSql.sql;
  params.push(...porteeSql.params);

  sql += ' ORDER BY nom ASC'; // Tri alphabétique

  try {
    const produits = db.prepare(sql).all(...params);
    res.json(produits);
  } catch (err) {
    res.status(500).json({ erreur: 'Impossible de lire les produits' });
  }
});

// --- 2. Lire un seul produit par son identifiant ---
// GET /api/produits/3
router.get('/:id', (req, res) => {
  try {
    const produit = db
      .prepare('SELECT * FROM produits WHERE id = ?')
      .get(req.params.id);

    // Un produit d'une autre boutique est présenté comme INEXISTANT
    // (404 et non 403 : on ne révèle même pas son existence)
    if (!produit || !dansPortee(req, produit)) {
      return res.status(404).json({ erreur: 'Produit introuvable' });
    }
    res.json(produit);
  } catch (err) {
    res.status(500).json({ erreur: 'Erreur de lecture' });
  }
});

// --- 3. Ajouter un nouveau produit (ADMIN ou GÉRANT uniquement) ---
// Le caissier consulte son stock mais ne crée pas de fiches.
// POST /api/produits  { nom, categorie, prix_achat, prix_vente, quantite, seuil_alerte }
router.post('/', exigerRole('admin', 'gerant'), (req, res) => {
  const { nom, categorie, prix_achat, prix_vente, quantite, seuil_alerte, code_barre, date_expiration } = req.body;

  // --- Validation : on vérifie que les données obligatoires sont là ---
  if (!nom || nom.trim() === '') {
    return res.status(400).json({ erreur: 'Le nom du produit est obligatoire' });
  }
  if (prix_achat == null || prix_vente == null || isNaN(prix_achat) || isNaN(prix_vente)) {
    return res.status(400).json({ erreur: 'Les prix doivent être des nombres valides' });
  }
  if (parseFloat(prix_vente) < parseFloat(prix_achat)) {
    return res.status(400).json({ erreur: 'Le prix de vente ne peut pas être inférieur au prix d’achat' });
  }

  // --- Boutique visée (gérant/employé : TOUJOURS la leur, champ ignoré) ---
  const boutiqueId = boutiqueCible(req, req.body);
  if (!boutiqueId) {
    return res.status(403).json({ erreur: 'Aucune boutique rattachée à ce compte' });
  }
  const boutiqueExistante = db.prepare('SELECT id FROM boutiques WHERE id = ? AND actif = 1').get(boutiqueId);
  if (!boutiqueExistante) {
    return res.status(400).json({ erreur: 'Boutique inconnue ou archivée' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO produits (nom, categorie, prix_achat, prix_vente, quantite, seuil_alerte, code_barre, date_expiration, boutique_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nom.trim(),
      categorie || 'Divers',
      parseFloat(prix_achat),
      parseFloat(prix_vente),
      parseInt(quantite) || 0,
      parseInt(seuil_alerte) || 5,
      code_barre || null,
      date_expiration || null,
      boutiqueId
    );

    // On renvoie le produit créé (avec son id)
    const nouveauProduit = db.prepare('SELECT * FROM produits WHERE id = ?').get(result.lastInsertRowid);

    // 📒 Traçabilité : QUI a créé ce produit
    journaliser({
      produit: nouveauProduit,
      utilisateur: req.utilisateur,
      action: 'creation',
      nouvelle: `Quantité initiale : ${nouveauProduit.quantite}`,
    });

    res.status(201).json(nouveauProduit);
  } catch (err) {
    // Code d'erreur SQLite pour clé unique = code-barres déjà utilisé
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ erreur: 'Ce code-barres existe déjà' });
    }
    res.status(500).json({ erreur: 'Impossible d’ajouter le produit' });
  }
});

// --- 4. Modifier un produit existant (ADMIN ou GÉRANT de la boutique) ---
// PUT /api/produits/3  { nom, prix_vente, motif }
router.put('/:id', exigerRole('admin', 'gerant'), (req, res) => {
  const { nom, categorie, prix_achat, prix_vente, quantite, seuil_alerte, code_barre, date_expiration, motif } = req.body;

  // --- Traçabilité : TOUTE modification doit être justifiée ---
  if (!motif || String(motif).trim() === '') {
    return res.status(400).json({
      erreur: 'Le motif de la modification est obligatoire (traçabilité)',
    });
  }

  try {
    const existant = db.prepare('SELECT * FROM produits WHERE id = ?').get(req.params.id);
    if (!existant || !dansPortee(req, existant)) {
      return res.status(404).json({ erreur: 'Produit introuvable' });
    }

    // On garde l'ancienne valeur si le champ n'est pas envoyé
    db.prepare(`
      UPDATE produits
      SET nom = ?, categorie = ?, prix_achat = ?, prix_vente = ?,
          quantite = ?, seuil_alerte = ?, code_barre = ?, date_expiration = ?
      WHERE id = ?
    `).run(
      nom ?? existant.nom,
      categorie ?? existant.categorie,
      prix_achat ?? existant.prix_achat,
      prix_vente ?? existant.prix_vente,
      quantite ?? existant.quantite,
      seuil_alerte ?? existant.seuil_alerte,
      code_barre ?? existant.code_barre,
      date_expiration ?? existant.date_expiration,
      req.params.id
    );

    const misAJour = db.prepare('SELECT * FROM produits WHERE id = ?').get(req.params.id);

    // 📒 Traçabilité : un enregistrement PAR champ réellement modifié,
    // avec le motif déclaré et le nom de l'employé
    journaliserModifications(existant, misAJour, req.utilisateur, String(motif).trim().slice(0, 200));

    res.json(misAJour);
  } catch (err) {
    res.status(500).json({ erreur: 'Impossible de modifier le produit' });
  }
});

// --- 5. Supprimer un produit (admin ou gérant de la boutique) ---
// DELETE /api/produits/3
router.delete('/:id', exigerRole('admin', 'gerant'), (req, res) => {
  try {
    // On lit le produit AVANT de le supprimer (pour journaliser son nom et son stock)
    const existant = db.prepare('SELECT * FROM produits WHERE id = ?').get(req.params.id);

    if (!existant || !dansPortee(req, existant)) {
      return res.status(404).json({ erreur: 'Produit introuvable' });
    }

    db.prepare('DELETE FROM produits WHERE id = ?').run(req.params.id);

    // 📒 Traçabilité : suppression (le nom du produit est copié dans le journal)
    journaliser({
      produit: existant,
      utilisateur: req.utilisateur,
      action: 'suppression',
      ancienne: `Stock : ${existant.quantite}`,
      motif: 'Suppression du produit',
    });

    // 204 = succès sans contenu à renvoyer
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ erreur: 'Impossible de supprimer le produit' });
  }
});

// --- 6. HISTORIQUE D'UN PRODUIT (admin ou gérant de la boutique) ---
// GET /api/produits/3/historique
// Renvoie les dernières modifications avec le nom de l'employé
router.get('/:id/historique', exigerRole('admin', 'gerant'), (req, res) => {
  try {
    const produit = db.prepare('SELECT * FROM produits WHERE id = ?').get(req.params.id);
    if (!produit || !dansPortee(req, produit)) {
      return res.status(404).json({ erreur: 'Produit introuvable' });
    }

    // Les 50 dernières actions, de la plus récente à la plus ancienne
    const lignes = db
      .prepare(`
        SELECT id, utilisateur_nom, utilisateur_role, action, champ,
               ancienne_valeur, nouvelle_valeur, motif, date_action
        FROM journal
        WHERE produit_id = ?
        ORDER BY datetime(date_action) DESC, id DESC
        LIMIT 50
      `)
      .all(req.params.id);

    res.json(lignes);
  } catch (err) {
    console.error('Erreur historique :', err.message);
    res.status(500).json({ erreur: 'Impossible de lire l’historique' });
  }
});

module.exports = router;
