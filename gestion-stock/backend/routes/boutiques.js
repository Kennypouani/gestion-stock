// ============================================================
// ROUTES BOUTIQUES — Le réseau de magasins (ADMIN)
// Préfixe : /api/boutiques
// Règles :
//   • Le « code » (suffixe des tickets, ex : TK-NORD-2026-0001)
//     est saisi à la création puis FIGÉ : le changer rendrait
//     ambigu l'historique des tickets déjà émis.
//   • Une boutique ne se supprime jamais, elle s'ARCHIVE (actif = 0),
//     comme les fournisseurs — jamais de perte d'historique.
//   • Un gérant ne voit que SA boutique.
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../database');
const { exigerRole, porteeBoutique } = require('../auth');

const CODE_REGEX = /^[A-Za-z0-9]{2,10}$/;
const NETTOYER = (valeur, max) => String(valeur ?? '').trim().slice(0, max);

// ============================================================
// 1. LISTER LES BOUTIQUES
// GET /api/boutiques  → admin : tout le réseau / gérant : la sienne
// ============================================================
router.get('/', (req, res) => {
  try {
    const portee = porteeBoutique(req);
    if (!portee.autorise) {
      return res.status(403).json({ erreur: 'Aucune boutique rattachée à ce compte' });
    }

    const boutiques = portee.toutes
      ? db.prepare('SELECT * FROM boutiques ORDER BY nom COLLATE NOCASE').all()
      : db.prepare('SELECT * FROM boutiques WHERE id = ?').all(portee.boutiqueId);

    res.json(boutiques);
  } catch (err) {
    console.error('Erreur liste boutiques :', err.message);
    res.status(500).json({ erreur: 'Impossible de lire les boutiques' });
  }
});

// ============================================================
// 2. CRÉER UNE BOUTIQUE (ADMIN)
// POST /api/boutiques  { nom, code, adresse?, telephone? }
// ============================================================
router.post('/', exigerRole('admin'), (req, res) => {
  const nom = NETTOYER(req.body.nom, 80);
  const code = NETTOYER(req.body.code, 10).toUpperCase();
  const adresse = NETTOYER(req.body.adresse, 200) || null;
  const telephone = NETTOYER(req.body.telephone, 30) || null;

  if (nom.length < 2) {
    return res.status(400).json({ erreur: 'Le nom de la boutique doit contenir au moins 2 caractères' });
  }
  if (!CODE_REGEX.test(code)) {
    return res.status(400).json({
      erreur: 'Le code (suffixe des tickets) doit contenir 2 à 10 lettres ou chiffres, sans accent ni espace',
    });
  }

  try {
    const doublonNom = db
      .prepare('SELECT id FROM boutiques WHERE LOWER(nom) = LOWER(?)')
      .get(nom);
    if (doublonNom) return res.status(409).json({ erreur: 'Une boutique porte déjà ce nom' });

    const doublonCode = db.prepare('SELECT id FROM boutiques WHERE code = ?').get(code);
    if (doublonCode) {
      return res.status(409).json({ erreur: 'Ce code est déjà utilisé par une autre boutique' });
    }

    const resultat = db
      .prepare('INSERT INTO boutiques (nom, code, adresse, telephone) VALUES (?, ?, ?, ?)')
      .run(nom, code, adresse, telephone);

    const cree = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(resultat.lastInsertRowid);
    res.status(201).json(cree);
  } catch (err) {
    console.error('Erreur création boutique :', err.message);
    res.status(500).json({ erreur: 'Impossible de créer la boutique' });
  }
});

// ============================================================
// 3. MODIFIER UNE BOUTIQUE (ADMIN) — le code reste immuable
// PUT /api/boutiques/2  { nom?, adresse?, telephone?, actif? }
// ============================================================
router.put('/:id', exigerRole('admin'), (req, res) => {
  const cibleId = parseInt(req.params.id, 10);

  try {
    const existant = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(cibleId);
    if (!existant) return res.status(404).json({ erreur: 'Boutique introuvable' });

    // --- Le code ne change JAMAIS (traçabilité des tickets émis) ---
    if (req.body.code !== undefined) {
      const codeDemande = NETTOYER(req.body.code, 10).toUpperCase();
      if (codeDemande !== existant.code) {
        return res.status(400).json({
          erreur: "Le code d'une boutique ne peut plus être modifié (il identifie ses tickets)",
        });
      }
    }

    // Activation / archivage explicite (0 ou 1)
    if (req.body.actif !== undefined) {
      const actif = Number(req.body.actif);
      if (actif !== 0 && actif !== 1) {
        return res.status(400).json({ erreur: 'La valeur « actif » doit être 0 ou 1' });
      }
      // On ne peut pas archiver la dernière boutique active du réseau
      if (actif === 0) {
        const actives = db.prepare('SELECT COUNT(*) AS n FROM boutiques WHERE actif = 1').get().n;
        if (actives <= 1) {
          return res.status(409).json({ erreur: 'Impossible : ceci laisserait le réseau sans boutique active' });
        }
      }
      db.prepare('UPDATE boutiques SET actif = ? WHERE id = ?').run(actif, cibleId);
    }

    const nom = NETTOYER(req.body.nom, 80);
    if (nom) {
      if (nom.length < 2) {
        return res.status(400).json({ erreur: 'Le nom de la boutique doit contenir au moins 2 caractères' });
      }
      const doublon = db
        .prepare('SELECT id FROM boutiques WHERE LOWER(nom) = LOWER(?) AND id <> ?')
        .get(nom, cibleId);
      if (doublon) return res.status(409).json({ erreur: 'Une boutique porte déjà ce nom' });
      db.prepare('UPDATE boutiques SET nom = ? WHERE id = ?').run(nom, cibleId);
    }

    if (req.body.adresse !== undefined) {
      db.prepare('UPDATE boutiques SET adresse = ? WHERE id = ?').run(
        NETTOYER(req.body.adresse, 200) || null,
        cibleId
      );
    }
    if (req.body.telephone !== undefined) {
      db.prepare('UPDATE boutiques SET telephone = ? WHERE id = ?').run(
        NETTOYER(req.body.telephone, 30) || null,
        cibleId
      );
    }

    res.json(db.prepare('SELECT * FROM boutiques WHERE id = ?').get(cibleId));
  } catch (err) {
    console.error('Erreur modification boutique :', err.message);
    res.status(500).json({ erreur: 'Impossible de modifier la boutique' });
  }
});

// ============================================================
// 4. ARCHIVER UNE BOUTIQUE (ADMIN) — jamais de suppression
// DELETE /api/boutiques/2
// ============================================================
router.delete('/:id', exigerRole('admin'), (req, res) => {
  const cibleId = parseInt(req.params.id, 10);

  try {
    const existant = db.prepare('SELECT * FROM boutiques WHERE id = ?').get(cibleId);
    if (!existant) return res.status(404).json({ erreur: 'Boutique introuvable' });
    if (!existant.actif) {
      return res.json({ message: 'Boutique déjà archivée', archive: true });
    }

    const actives = db.prepare('SELECT COUNT(*) AS n FROM boutiques WHERE actif = 1').get().n;
    if (actives <= 1) {
      return res.status(409).json({ erreur: 'Impossible : ceci laisserait le réseau sans boutique active' });
    }

    db.prepare('UPDATE boutiques SET actif = 0 WHERE id = ?').run(cibleId);

    // Les comptes rattachés sont désactivés ET déconnectés immédiatement
    db.prepare('UPDATE utilisateurs SET actif = 0 WHERE boutique_id = ? AND role <> ?').run(
      cibleId,
      'admin'
    );
    db.prepare(`
      DELETE FROM sessions
      WHERE utilisateur_id IN (SELECT id FROM utilisateurs WHERE boutique_id = ?)
    `).run(cibleId);

    const nbLies = db
      .prepare('SELECT COUNT(*) AS n FROM produits WHERE boutique_id = ?')
      .get(cibleId).n;

    res.json({
      message: `Boutique archivée — ${nbLies} produit(s) conservé(s) pour l'historique`,
      archive: true,
    });
  } catch (err) {
    console.error('Erreur archivage boutique :', err.message);
    res.status(500).json({ erreur: 'Impossible d’archiver la boutique' });
  }
});

module.exports = router;