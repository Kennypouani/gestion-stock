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
const rateLimit = require('express-rate-limit');
const {
  creerSauvegardeCompte,
  listerCompte,
  cheminCompte,
  restaurerCompte,
  NOM_COMPTE,
} = require('../sauvegarde');
const { porteeBoutique } = require('../auth');

// Une restauration remplace des données : 5 tentatives par quart d'heure
const limiteurRestauration = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erreur: 'Trop de restaurations — réessayez dans 15 minutes' },
});

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

// --- 2 bis. Restaurer une sauvegarde JSON dans SES boutiques ---
// POST /api/sauvegardes/restaurer  { contenu: {...} }
// Le fichier doit avoir été produit par l'application et ne peut
// contenir que des boutiques rattachées au compte (sinon 403, sans
// aucune écriture). Les données actuelles de ces boutiques sont
// REMPLACÉES par celles du fichier.
router.post('/restaurer', limiteurRestauration, (req, res) => {
  const portee = porteeBoutique(req);
  if (!portee.autorise) {
    return res.status(403).json({ erreur: 'Aucune boutique rattachée à ce compte' });
  }

  try {
    const compte = restaurerCompte(portee.ids, req.body?.contenu);
    res.json({
      message: 'Sauvegarde restaurée',
      ...compte,
    });
  } catch (err) {
    if (err.statut) return res.status(err.statut).json({ erreur: err.message });
    console.error('Restauration impossible :', err.message);
    res.status(500).json({ erreur: 'Impossible de restaurer cette sauvegarde' });
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
