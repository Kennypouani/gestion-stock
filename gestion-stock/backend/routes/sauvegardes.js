// ============================================================
// ROUTES SAUVEGARDES — Copies de la base (ADMIN)
// Préfixe : /api/sauvegardes
// Sécurité : le nom de fichier est vérifié par une expression
// régulière → impossible de remonter dans l'arborescence (« ../ »)
// ============================================================

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { creerSauvegarde, lister, DOSSIER } = require('../sauvegarde');

// Noms acceptés : stock-2026-10-25-104532.db uniquement
const NOM_VALIDE = /^stock-\d{4}-\d{2}-\d{2}-\d{6}\.db$/;

// --- 1. Lister les sauvegardes ---
// GET /api/sauvegardes
router.get('/', (req, res) => {
  try {
    res.json(lister());
  } catch (err) {
    res.status(500).json({ erreur: 'Impossible de lister les sauvegardes' });
  }
});

// --- 2. Créer une sauvegarde immédiatement ---
// POST /api/sauvegardes
router.post('/', (req, res) => {
  try {
    const sauvegarde = creerSauvegarde();
    res.status(201).json(sauvegarde);
  } catch (err) {
    console.error('Sauvegarde manuelle impossible :', err.message);
    res.status(500).json({ erreur: 'Impossible de créer la sauvegarde' });
  }
});

// --- 3. Télécharger une sauvegarde ---
// GET /api/sauvegardes/stock-2026-10-25-104532.db
router.get('/:nom', (req, res) => {
  try {
    const nom = req.params.nom;

    // Garde-fou anti « path traversal » : aucun autre format n'est accepté
    if (!NOM_VALIDE.test(nom)) {
      return res.status(400).json({ erreur: 'Nom de sauvegarde invalide' });
    }

    const chemin = path.join(DOSSIER, nom);
    if (!fs.existsSync(chemin)) {
      return res.status(404).json({ erreur: 'Sauvegarde introuvable' });
    }

    res.download(chemin, nom); // En-tête attachment → téléchargement
  } catch (err) {
    res.status(500).json({ erreur: 'Téléchargement impossible' });
  }
});

module.exports = router;