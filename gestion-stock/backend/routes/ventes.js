// ============================================================
// ROUTES VENTES — Tickets de caisse
// Préfixe : /api/ventes
// Règle d'or : le TOTAL est toujours recalculé côté serveur à
// partir des prix en base — jamais à partir du prix envoyé par
// le navigateur (sinon on pourrait vendre à 0 €).
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../database');
const { journaliser } = require('../journal');
const { porteeBoutique, clauseBoutique, dansPortee, boutiqueCible } = require('../auth');

// Erreur métier → on renvoie son code HTTP exact (400, 404, 409…)
class ErreurHttp extends Error {
  constructor(statut, message) {
    super(message);
    this.statut = statut;
  }
}

const arrondi = (valeur) => Math.round((Number(valeur) || 0) * 100) / 100;

const MOYENS_PAIEMENT = ['especes', 'carte', 'mobile'];

// --- 1. ENCAISSER UN TICKET ---
// POST /api/ventes
// { lignes: [{ produit_id, quantite }], moyen_paiement, montant_verse?, remise? }
router.post('/', (req, res) => {
  const { lignes, moyen_paiement, montant_verse, remise } = req.body;

  try {
    // --- Validation de l'enveloppe ---
    if (!Array.isArray(lignes) || lignes.length === 0) {
      throw new ErreurHttp(400, 'Le panier est vide — ajoutez au moins un produit');
    }
    if (lignes.length > 100) {
      throw new ErreurHttp(400, 'Panier trop volumineux (100 lignes maximum)');
    }
    if (!MOYENS_PAIEMENT.includes(moyen_paiement)) {
      throw new ErreurHttp(400, 'Moyen de paiement invalide (espèces, carte ou mobile)');
    }

    db.exec('BEGIN');
    try {
      // --- 1. Lecture des produits ET calcul du total AVEC les prix en base ---
      const detail = [];
      for (const ligne of lignes) {
        const qte = parseInt(ligne.quantite, 10);
        const produitId = parseInt(ligne.produit_id, 10);

        if (!produitId) throw new ErreurHttp(400, 'Produit manquant dans le panier');
        if (!qte || qte <= 0) throw new ErreurHttp(400, 'Quantité invalide dans le panier');

        const produit = db.prepare('SELECT * FROM produits WHERE id = ?').get(produitId);
        // Un produit d'une autre boutique est introuvable ici :
        // un caissier ne peut JAMAIS encaisser l'article d'un autre magasin
        if (!produit || !dansPortee(req, produit)) {
          throw new ErreurHttp(404, `Produit introuvable (#${produitId})`);
        }
        if (qte > produit.quantite) {
          throw new ErreurHttp(
            409,
            `Stock insuffisant pour « ${produit.nom} » : il n'en reste que ${produit.quantite}`
          );
        }

        detail.push({
          produit,
          quantite: qte,
          sousTotal: arrondi(produit.prix_vente * qte),
        });
      }

      const sousTotal = arrondi(detail.reduce((somme, d) => somme + d.sousTotal, 0));

      // --- 2. Remise : bornée entre 0 et le sous-total ---
      const remiseAccordee = arrondi(remise);
      if (Number.isNaN(remiseAccordee) || remiseAccordee < 0) {
        throw new ErreurHttp(400, 'La remise ne peut pas être négative');
      }
      if (remiseAccordee > sousTotal) {
        throw new ErreurHttp(400, 'La remise dépasse le montant du panier');
      }
      const total = arrondi(sousTotal - remiseAccordee);

      // --- 3. Encaissement espèces : l'argent reçu doit couvrir la note ---
      let verse = null;
      let rendu = null;
      if (moyen_paiement === 'especes') {
        verse = arrondi(montant_verse);
        if (Number.isNaN(verse) || verse < total) {
          throw new ErreurHttp(400, `Montant versé insuffisant — il manque ${arrondi(total - verse)} FCFA`);
        }
        rendu = arrondi(verse - total);
      }

      // --- 4. Numéro de ticket unique (généré dans la transaction) ---
      const { prochain } = db
        .prepare('SELECT COALESCE(MAX(id), 0) + 1 AS prochain FROM ventes')
        .get();
      const numero = `TK-${new Date().getFullYear()}-${String(prochain).padStart(4, '0')}`;

      // --- 5. Enregistrement de l'en-tête du ticket ---
      // La boutique du ticket = celle de la session (gérant/employé)
      // ; l'admin peut préciser boutique_id dans le corps (défaut : 1)
      const boutiqueId = boutiqueCible(req, req.body);
      if (!boutiqueId) {
        throw new ErreurHttp(403, 'Aucune boutique rattachée à ce compte');
      }

      const insertion = db.prepare(`
        INSERT INTO ventes
          (numero, sous_total, remise, total, moyen_paiement, montant_verse,
           monnaie_rendue, utilisateur_id, utilisateur_nom, boutique_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        numero, sousTotal, remiseAccordee, total, moyen_paiement,
        verse, rendu, req.utilisateur.id, req.utilisateur.nom, boutiqueId
      );
      const venteId = insertion.lastInsertRowid;

      const insererLigne = db.prepare(`
        INSERT INTO vente_lignes (vente_id, produit_id, produit_nom, quantite, prix_unitaire, sous_total)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const decremente = db.prepare('UPDATE produits SET quantite = quantite - ? WHERE id = ?');
      const insererMouvement = db.prepare(`
        INSERT INTO mouvements (produit_id, type, quantite, motif, utilisateur_id, utilisateur_nom, utilisateur_role, boutique_id)
        VALUES (?, 'sortie', ?, ?, ?, ?, ?, ?)
      `);

      // --- 6. Pour CHAQUE ligne : stock --, mouvement + journal ---
      for (const d of detail) {
        const avant = d.produit.quantite;
        const apres = avant - d.quantite;

        insererLigne.run(
          venteId, d.produit.id, d.produit.nom,
          d.quantite, d.produit.prix_vente, d.sousTotal
        );
        decremente.run(d.quantite, d.produit.id);
        insererMouvement.run(
          d.produit.id, d.quantite, `Vente ticket ${numero}`,
          req.utilisateur.id, req.utilisateur.nom, req.utilisateur.role,
          d.produit.boutique_id
        );

        // 📒 Traçabilité : la sortie est reliée au ticket ET à l'employé
        journaliser({
          produit: d.produit,
          utilisateur: req.utilisateur,
          action: 'sortie',
          champ: 'quantite',
          ancienne: avant,
          nouvelle: apres,
          motif: `Vente ticket ${numero}`,
        });
      }

      db.exec('COMMIT');

      const vente = db.prepare('SELECT * FROM ventes WHERE id = ?').get(venteId);
      const lignesEnregistrees = db
        .prepare('SELECT * FROM vente_lignes WHERE vente_id = ?')
        .all(venteId);

      res.status(201).json({ ...vente, lignes: lignesEnregistrees });
    } catch (err) {
      db.exec('ROLLBACK'); // Rien n'est enregistré si une seule ligne échoue
      throw err;
    }
  } catch (err) {
    if (err instanceof ErreurHttp) {
      return res.status(err.statut).json({ erreur: err.message });
    }
    console.error('Erreur vente :', err.message);
    return res.status(500).json({ erreur: 'Impossible d’enregistrer la vente' });
  }
});

// --- 2. LISTE DES TICKETS ---
// GET /api/ventes?limite=20
// admin  → tous les tickets (du réseau, ou ?boutique_id=)
// gérant → TOUS les tickets de SA boutique
// employé→ SEULEMENT les siens
router.get('/', (req, res) => {
  const limite = Math.min(parseInt(req.query.limite, 10) || 20, 200);
  const portee = porteeBoutique(req);
  if (!portee.autorise) {
    return res.status(403).json({ erreur: 'Aucune boutique rattachée à ce compte' });
  }

  const clauses = [];
  const params = [];

  if (!portee.toutes && req.utilisateur.role === 'gerant') {
    clauses.push('v.boutique_id = ?');
    params.push(portee.boutiqueId);
  } else if (!portee.toutes) {
    clauses.push('v.utilisateur_id = ?');
    params.push(req.utilisateur.id);
  } else if (req.query.boutique_id) {
    // L'admin peut cibler une boutique précise
    const cible = parseInt(req.query.boutique_id, 10);
    if (!Number.isInteger(cible) || cible <= 0) {
      return res.status(400).json({ erreur: 'Identifiant de boutique invalide' });
    }
    clauses.push('v.boutique_id = ?');
    params.push(cible);
  }

  try {
    const ventes = db.prepare(`
      SELECT v.*, COUNT(l.id) AS nb_articles
      FROM ventes v
      LEFT JOIN vente_lignes l ON l.vente_id = v.id
      ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
      GROUP BY v.id
      ORDER BY datetime(v.date_vente) DESC, v.id DESC
      LIMIT ?
    `).all(...params, limite);

    res.json(ventes);
  } catch (err) {
    res.status(500).json({ erreur: 'Impossible de lire les tickets' });
  }
});

// --- 3. DÉTAIL D'UN TICKET (admin, ou le caissier qui l'a émis) ---
// GET /api/ventes/12
router.get('/:id', (req, res) => {
  try {
    const vente = db.prepare('SELECT * FROM ventes WHERE id = ?').get(req.params.id);
    // Ticket d'une autre boutique → inexistence présumée (404)
    if (!vente || !dansPortee(req, vente)) {
      return res.status(404).json({ erreur: 'Ticket introuvable' });
    }

    // Dans MA boutique : le gérant voit tous les tickets,
    // l'employé seulement ceux qu'il a émis
    const estAdmin = req.utilisateur.role === 'admin';
    const estGerant = req.utilisateur.role === 'gerant';
    if (!estAdmin && !estGerant && vente.utilisateur_id !== req.utilisateur.id) {
      return res.status(403).json({ erreur: 'Accès refusé — ce ticket ne vous appartient pas' });
    }

    const lignes = db
      .prepare('SELECT * FROM vente_lignes WHERE vente_id = ? ORDER BY id')
      .all(vente.id);

    res.json({ ...vente, lignes });
  } catch (err) {
    res.status(500).json({ erreur: 'Impossible de lire le ticket' });
  }
});

module.exports = router;