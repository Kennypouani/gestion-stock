// ============================================================
// ROUTES MOUVEMENTS — Entrées (réappro) et sorties (ventes) de stock
// Préfixe : /api/mouvements
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../database');
const { journaliser } = require('../journal');
const { porteeBoutique, clauseBoutique, dansPortee } = require('../auth');

// --- 1. Créer un mouvement de stock ---
// POST /api/mouvements  { produit_id, type: 'entree'|'sortie', quantite, motif }
// C'est LA route la plus importante du projet :
// elle met à jour la quantité du produit ET enregistre l'historique
router.post('/', (req, res) => {
  const { produit_id, type, quantite, motif } = req.body;
  const qte = parseInt(quantite);

  // --- Validation ---
  if (!produit_id) {
    return res.status(400).json({ erreur: 'Aucun produit sélectionné' });
  }
  if (!['entree', 'sortie'].includes(type)) {
    return res.status(400).json({ erreur: 'Le type doit être "entree" ou "sortie"' });
  }
  if (!qte || qte <= 0) {
    return res.status(400).json({ erreur: 'La quantité doit être un nombre supérieur à 0' });
  }

  try {
    const produit = db.prepare('SELECT * FROM produits WHERE id = ?').get(produit_id);
    // Produit d'une autre boutique → inexistence présumée
    if (!produit || !dansPortee(req, produit)) {
      return res.status(404).json({ erreur: 'Produit introuvable' });
    }

    // Vérification : ne jamais descendre sous zéro
    if (type === 'sortie' && qte > produit.quantite) {
      return res.status(400).json({
        erreur: `Stock insuffisant : il ne reste que ${produit.quantite} unité(s) de ${produit.nom}`
      });
    }

    // --- Transaction : les 2 opérations réussissent ou échouent ensemble ---
    // BEGIN démarre la transaction, COMMIT valide, ROLLBACK annule si erreur
    db.exec('BEGIN');
    try {
      // Mise à jour de la quantité (+ pour entrée, - pour sortie)
      const nouvelleQte = type === 'entree'
        ? produit.quantite + qte
        : produit.quantite - qte;

      db.prepare('UPDATE produits SET quantite = ? WHERE id = ?').run(nouvelleQte, produit_id);

      // Enregistrement de l'historique, AVEC le nom de l'employé
      // et la boutique du produit concerné (là où le stock bouge)
      db.prepare(`
        INSERT INTO mouvements (produit_id, type, quantite, motif, utilisateur_id, utilisateur_nom, utilisateur_role, boutique_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        produit_id,
        type,
        qte,
        motif || null,
        req.utilisateur.id,
        req.utilisateur.nom,
        req.utilisateur.role,
        produit.boutique_id
      );

      // 📒 Traçabilité : QUI a fait ce mouvement, avec quel motif
      journaliser({
        produit,
        utilisateur: req.utilisateur,
        action: type, // 'entree' ou 'sortie'
        champ: 'quantite',
        ancienne: produit.quantite,
        nouvelle: nouvelleQte,
        motif: motif || (type === 'entree' ? 'Réapprovisionnement' : 'Vente'),
      });

      db.exec('COMMIT'); // Tout est OK, on garde les changements
    } catch (e) {
      db.exec('ROLLBACK'); // Problème : on annule tout, le stock reste inchangé
      throw e;
    }

    const misAJour = db.prepare('SELECT * FROM produits WHERE id = ?').get(produit_id);
    res.status(201).json(misAJour);
  } catch (err) {
    res.status(500).json({ erreur: 'Impossible d’enregistrer le mouvement' });
  }
});

// --- 2. Lire l'historique des mouvements ---
// GET /api/mouvements?limite=50
router.get('/', (req, res) => {
  const limite = parseInt(req.query.limite) || 100;
  const portee = porteeBoutique(req);
  if (!portee.autorise) {
    return res.status(403).json({ erreur: 'Aucune boutique rattachée à ce compte' });
  }

  const clauses = [];
  const params = [];
  const porteeSql = clauseBoutique(req, 'm.boutique_id');
  if (porteeSql.sql) {
    clauses.push(porteeSql.sql.replace(/^ AND /, ''));
    params.push(...porteeSql.params);
  } else if (req.query.boutique_id) {
    // L'admin peut cibler une boutique précise
    const cible = parseInt(req.query.boutique_id, 10);
    if (!Number.isInteger(cible) || cible <= 0) {
      return res.status(400).json({ erreur: 'Identifiant de boutique invalide' });
    }
    clauses.push('m.boutique_id = ?');
    params.push(cible);
  }

  try {
    const mouvements = db.prepare(`
      SELECT m.*, p.nom AS nom_produit
      FROM mouvements m
      JOIN produits p ON p.id = m.produit_id   -- Jointure : on ajoute le nom du produit
      ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
      ORDER BY datetime(m.date_mouvement) DESC, m.id DESC
      LIMIT ?
    `).all(...params, limite);

    res.json(mouvements);
  } catch (err) {
    res.status(500).json({ erreur: 'Impossible de lire l’historique' });
  }
});

module.exports = router;
