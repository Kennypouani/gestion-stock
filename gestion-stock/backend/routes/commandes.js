// ============================================================
// ROUTES COMMANDES — Bons de commande fournisseurs (ADMIN)
// Préfixe : /api/commandes
// Point clé : passer la commande en « reçue » ajoute les
// quantités au stock, crée les mouvements et le journal,
// le tout dans UNE transaction.
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../database');
const { journaliser } = require('../journal');
const { porteeBoutique, clauseBoutique, dansPortee, boutiqueCible } = require('../auth');

class ErreurHttp extends Error {
  constructor(statut, message) {
    super(message);
    this.statut = statut;
  }
}

const arrondi = (valeur) => Math.round((Number(valeur) || 0) * 100) / 100;

// Transitions de statut autorisées
const TRANSITIONS = {
  en_attente: ['envoyee', 'annulee'],
  envoyee: ['recue', 'annulee'],
  annulee: [],
  recue: [],
};

const LIBELLES_STATUT = {
  en_attente: 'En attente',
  envoyee: 'Envoyée',
  recue: 'Reçue',
  annulee: 'Annulée',
};

// --- 1. Lister les commandes ---
// GET /api/commandes?statut=envoyee
router.get('/', (req, res) => {
  const { statut } = req.query;

  const portee = porteeBoutique(req);
  if (!portee.autorise) {
    return res.status(403).json({ erreur: 'Aucune boutique rattachée à ce compte' });
  }

  const clauses = ['1=1'];
  const params = [];

  // Isolation : le gérant ne voit QUE les commandes de sa boutique
  const porteeSql = clauseBoutique(req, 'c.boutique_id');
  if (porteeSql.sql) {
    clauses.push(porteeSql.sql.replace(/^ AND /, ''));
    params.push(...porteeSql.params);
  } else if (req.query.boutique_id) {
    const cible = parseInt(req.query.boutique_id, 10);
    if (!Number.isInteger(cible) || cible <= 0) {
      return res.status(400).json({ erreur: 'Identifiant de boutique invalide' });
    }
    clauses.push('c.boutique_id = ?');
    params.push(cible);
  }

  if (statut && LIBELLES_STATUT[statut]) {
    clauses.push('c.statut = ?');
    params.push(statut);
  }

  try {
    const commandes = db.prepare(`
      SELECT c.*, f.nom AS fournisseur_nom,
             COUNT(l.id) AS nb_articles
      FROM commandes c
      JOIN fournisseurs f ON f.id = c.fournisseur_id
      LEFT JOIN commande_lignes l ON l.commande_id = c.id
      WHERE ${clauses.join(' AND ')}
      GROUP BY c.id
      ORDER BY datetime(c.date_commande) DESC, c.id DESC
      LIMIT 200
    `).all(...params);

    res.json(commandes);
  } catch (err) {
    res.status(500).json({ erreur: 'Impossible de lire les commandes' });
  }
});

// --- 2. Détail d'une commande (ses lignes) ---
// GET /api/commandes/4
router.get('/:id', (req, res) => {
  try {
    const commande = db.prepare(`
      SELECT c.*, f.nom AS fournisseur_nom, f.contact_nom, f.email, f.telephone
      FROM commandes c
      JOIN fournisseurs f ON f.id = c.fournisseur_id
      WHERE c.id = ?
    `).get(req.params.id);

    if (!commande || !dansPortee(req, commande)) {
      return res.status(404).json({ erreur: 'Commande introuvable' });
    }

    const lignes = db
      .prepare('SELECT * FROM commande_lignes WHERE commande_id = ? ORDER BY id')
      .all(commande.id);

    res.json({ ...commande, lignes });
  } catch (err) {
    res.status(500).json({ erreur: 'Impossible de lire la commande' });
  }
});

// --- 3. Créer un bon de commande ---
// POST /api/commandes
// { fournisseur_id, notes?, lignes: [{ produit_id, quantite, prix_unitaire }] }
router.post('/', (req, res) => {
  const { fournisseur_id, notes, lignes } = req.body;

  try {
    if (!Array.isArray(lignes) || lignes.length === 0) {
      throw new ErreurHttp(400, 'La commande doit contenir au moins une ligne');
    }
    if (lignes.length > 200) {
      throw new ErreurHttp(400, 'Commande trop volumineuse (200 lignes maximum)');
    }

    const fournisseur = db
      .prepare('SELECT * FROM fournisseurs WHERE id = ?')
      .get(parseInt(fournisseur_id, 10));
    if (!fournisseur) throw new ErreurHttp(404, 'Fournisseur introuvable');
    if (!fournisseur.actif) {
      throw new ErreurHttp(409, 'Ce fournisseur est archivé — réactivez-le avant de commander');
    }

    // Validation et calcul du total CÔTÉ SERVEUR
    const detail = [];
    for (const ligne of lignes) {
      const produitId = parseInt(ligne.produit_id, 10);
      const qte = parseInt(ligne.quantite, 10);
      const pu = arrondi(ligne.prix_unitaire);

      if (!produitId) throw new ErreurHttp(400, 'Produit manquant dans la commande');
      if (!qte || qte <= 0) throw new ErreurHttp(400, 'Quantité invalide dans la commande');
      if (!(pu >= 0)) throw new ErreurHttp(400, 'Prix d’achat invalide');

      const produit = db.prepare('SELECT * FROM produits WHERE id = ?').get(produitId);
      // Un produit d'une autre boutique ne peut pas entrer dans MA commande
      if (!produit || !dansPortee(req, produit)) {
        throw new ErreurHttp(404, `Produit introuvable (#${produitId})`);
      }

      detail.push({
        produit,
        quantite: qte,
        prixUnitaire: pu,
        sousTotal: arrondi(pu * qte),
      });
    }

    const montantTotal = arrondi(detail.reduce((somme, d) => somme + d.sousTotal, 0));

    let commandeId; // déclaré ICI pour être accessible après la transaction
    db.exec('BEGIN');
    try {
      const { prochain } = db
        .prepare('SELECT COALESCE(MAX(id), 0) + 1 AS prochain FROM commandes')
        .get();
      const numero = `CMD-${new Date().getFullYear()}-${String(prochain).padStart(4, '0')}`;

      // Boutique de la commande : celle du gérant/employé qui la passe
      // ; l'admin peut préciser boutique_id (défaut : 1)
      const boutiqueId = boutiqueCible(req, req.body);
      if (!boutiqueId) throw new ErreurHttp(403, 'Aucune boutique rattachée à ce compte');
      const boutiqueExistante = db
        .prepare('SELECT id FROM boutiques WHERE id = ? AND actif = 1')
        .get(boutiqueId);
      if (!boutiqueExistante) throw new ErreurHttp(400, 'Boutique inconnue ou archivée');

      const insertion = db.prepare(`
        INSERT INTO commandes (numero, fournisseur_id, statut, montant_total, notes,
                               utilisateur_id, utilisateur_nom, boutique_id)
        VALUES (?, ?, 'en_attente', ?, ?, ?, ?, ?)
      `).run(
        numero, fournisseur.id, montantTotal,
        String(notes ?? '').trim().slice(0, 300) || null,
        req.utilisateur.id, req.utilisateur.nom,
        boutiqueId
      );
      commandeId = insertion.lastInsertRowid;

      const insererLigne = db.prepare(`
        INSERT INTO commande_lignes (commande_id, produit_id, produit_nom, quantite, prix_unitaire, sous_total)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const d of detail) {
        insererLigne.run(
          commandeId, d.produit.id, d.produit.nom,
          d.quantite, d.prixUnitaire, d.sousTotal
        );
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const commande = db.prepare('SELECT * FROM commandes WHERE id = ?').get(commandeId);
    res.status(201).json(commande);
  } catch (err) {
    if (err instanceof ErreurHttp) return res.status(err.statut).json({ erreur: err.message });
    console.error('Erreur commande :', err.message);
    res.status(500).json({ erreur: 'Impossible de créer la commande' });
  }
});

// --- 4. Changer le statut d'une commande ---
// PUT /api/commandes/4/statut  { statut: 'envoyee' | 'recue' | 'annulee' }
// 'recue' = RÉCEPTION : le stock augmente, les mouvements et le
// journal sont écrits dans la même transaction.
router.put('/:id/statut', (req, res) => {
  const { statut } = req.body;

  try {
    if (!LIBELLES_STATUT[statut]) {
      throw new ErreurHttp(400, `Statut inconnu : ${statut}`);
    }

    const commande = db.prepare('SELECT * FROM commandes WHERE id = ?').get(req.params.id);
    if (!commande || !dansPortee(req, commande)) throw new ErreurHttp(404, 'Commande introuvable');

    const autorisees = TRANSITIONS[commande.statut] || [];
    if (!autorisees.includes(statut)) {
      throw new ErreurHttp(
        409,
        `Transition interdite : ${LIBELLES_STATUT[commande.statut]} → ${LIBELLES_STATUT[statut]}`
      );
    }

    // --- Réception : mise à jour du stock ---
    if (statut === 'recue') {
      const lignes = db
        .prepare('SELECT * FROM commande_lignes WHERE commande_id = ?')
        .all(commande.id);

      db.exec('BEGIN');
      try {
        const ajouterStock = db.prepare('UPDATE produits SET quantite = quantite + ? WHERE id = ?');
        const majPrixAchat = db.prepare('UPDATE produits SET prix_achat = ? WHERE id = ?');
        const insererMouvement = db.prepare(`
          INSERT INTO mouvements (produit_id, type, quantite, motif, utilisateur_id, utilisateur_nom, utilisateur_role, boutique_id)
          VALUES (?, 'entree', ?, ?, ?, ?, ?, ?)
        `);

        for (const ligne of lignes) {
          const produit = db.prepare('SELECT * FROM produits WHERE id = ?').get(ligne.produit_id);
          if (!produit || !dansPortee(req, produit)) {
            throw new ErreurHttp(404, `Produit « ${ligne.produit_nom} » introuvable — réception annulée`);
          }

          const avant = produit.quantite;
          ajouterStock.run(ligne.quantite, ligne.produit_id);

          // Le prix d'achat courant devient le dernier prix payé
          if (ligne.prix_unitaire > 0 && ligne.prix_unitaire !== produit.prix_achat) {
            majPrixAchat.run(ligne.prix_unitaire, ligne.produit_id);
            journaliser({
              produit,
              utilisateur: req.utilisateur,
              action: 'modification',
              champ: 'prix_achat',
              ancienne: produit.prix_achat,
              nouvelle: ligne.prix_unitaire,
              motif: `Réception commande ${commande.numero}`,
            });
          }

          insererMouvement.run(
            ligne.produit_id, ligne.quantite,
            `Réception commande ${commande.numero}`,
            req.utilisateur.id, req.utilisateur.nom, req.utilisateur.role,
            produit.boutique_id
          );

          journaliser({
            produit,
            utilisateur: req.utilisateur,
            action: 'entree',
            champ: 'quantite',
            ancienne: avant,
            nouvelle: avant + ligne.quantite,
            motif: `Réception commande ${commande.numero}`,
          });
        }

        db.prepare(`
          UPDATE commandes
          SET statut = 'recue', recu_par = ?, date_reception = datetime('now')
          WHERE id = ?
        `).run(req.utilisateur.nom, commande.id);

        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    } else {
      // Changement de statut simple (envoyée / annulée)
      db.prepare('UPDATE commandes SET statut = ? WHERE id = ?').run(statut, commande.id);
    }

    res.json(db.prepare('SELECT * FROM commandes WHERE id = ?').get(commande.id));
  } catch (err) {
    if (err instanceof ErreurHttp) return res.status(err.statut).json({ erreur: err.message });
    console.error('Erreur statut commande :', err.message);
    res.status(500).json({ erreur: 'Impossible de modifier la commande' });
  }
});

// --- 5. Supprimer une commande ---
// Seulement tant qu'elle n'est ni reçue ni déjà envoyée
router.delete('/:id', (req, res) => {
  try {
    const commande = db.prepare('SELECT * FROM commandes WHERE id = ?').get(req.params.id);
    if (!commande || !dansPortee(req, commande)) {
      return res.status(404).json({ erreur: 'Commande introuvable' });
    }

    if (commande.statut === 'recue' || commande.statut === 'envoyee') {
      return res.status(409).json({
        erreur: 'Seules les commandes en attente ou annulées peuvent être supprimées',
      });
    }

    db.prepare('DELETE FROM commandes WHERE id = ?').run(req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ erreur: 'Impossible de supprimer la commande' });
  }
});

module.exports = router;
module.exports.LIBELLES_STATUT = LIBELLES_STATUT;