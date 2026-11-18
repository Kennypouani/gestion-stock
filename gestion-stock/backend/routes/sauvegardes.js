// ============================================================
// ROUTES SAUVEGARDES — Sauvegardes des boutiques du compte (ADMIN)
// Préfixe : /api/sauvegardes
//
// Chaque compte ne voit et ne télécharge QUE ses propres fichiers,
// et chaque fichier ne contient que les données des boutiques qui lui
// sont rattachées : aucun autre magasin n'y figure.
// Le nom est filtré par une expression régulière (pas de « ../ »).
// ============================================================

const express = require('express');
const router = express.Router();
const { creerSauvegardeCompte, listerCompte, cheminCompte, NOM_COMPTE } = require('../sauvegarde');
const { porteeBoutique } = require('../auth');

// --- 1. Lister les sauvegardes DU COMPTE ---
// GET /api/sauvegardes
router.get('/', (req, res) => {
  try {
    res.json(listerCompte(req.utilisateur.id));
  } catch (err) {
    res.status(500).json({ erreur: 'Impossible de lister les sauvegardes' });
  }
});

// --- 2. Créer une sauvegarde de SES boutiques ---
// POST /api/sauvegardes
router.post('/', (req, res) => {
  try {
    const portee = porteeBoutique(req);
    if (!portee.autorise) {
      return res.status(403).json({ erreur: 'Aucune boutique rattachée à ce compte' });
    }
    const sauvegarde = creerSauvegardeCompte(req.utilisateur.id, portee.ids);
    res.status(201).json(sauvegarde);
  } catch (err) {
    console.error('Sauvegarde manuelle impossible :', err.message);
    res.status(err.statut || 500).json({ erreur: 'Impossible de créer la sauvegarde' });
  }
});

// --- 3. Télécharger une sauvegarde de SON compte ---
// GET /api/sauvegardes/boutiques-2026-11-18-130000.json
router.get('/:nom', (req, res) => {
  try {
    // Nom hors format → refus explicite (400), jamais de remontée de dossier
    if (!NOM_COMPTE.test(req.params.nom)) {
      return res.status(400).json({ erreur: 'Nom de sauvegarde invalide' });
    }

    // Le dossier du compte fait partie du chemin : même en connaissant
    // le nom d'un fichier d'un autre compte, il est introuvable ici.
    const chemin = cheminCompte(req.utilisateur.id, req.params.nom);
    if (!chemin) {
      return res.status(404).json({ erreur: 'Sauvegarde introuvable' });
    }
    res.download(chemin, req.params.nom); // En-tête attachment → téléchargement
  } catch (err) {
    res.status(500).json({ erreur: 'Téléchargement impossible' });
  }
});

module.exports = router;
