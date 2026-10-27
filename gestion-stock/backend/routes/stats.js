// ============================================================
// ROUTES STATISTIQUES — Données du tableau de bord
// Préfixe : /api/stats
// ISOLATION : chaque chiffre est ramené à la boutique de la
// session. admin → tout le réseau (ou ?boutique_id=),
// gérant → SA boutique uniquement. L'employé est refusé (403).
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../database');
const { porteeBoutique, clauseBoutique } = require('../auth');

// GET /api/stats — Chiffres clés affichés en haut du tableau de bord
router.get('/', (req, res) => {
  try {
    const portee = porteeBoutique(req);
    if (!portee.autorise) {
      return res.status(403).json({ erreur: 'Accès réservé aux administrateurs et gérants' });
    }

    // --- Portée de la requête ---
    // gérant/employé → sa boutique ; admin → tout le réseau,
    // sauf s'il cible une boutique précise avec ?boutique_id=
    let boutiqueCible = null;
    if (portee.toutes && req.query.boutique_id !== undefined) {
      boutiqueCible = parseInt(req.query.boutique_id, 10);
      if (!Number.isInteger(boutiqueCible) || boutiqueCible <= 0) {
        return res.status(400).json({ erreur: 'Identifiant de boutique invalide' });
      }
    }

    // Fragment SQL par table/alias : ' AND boutique_id = ?' ou vide
    const filtre = (colonne) => {
      if (boutiqueCible !== null) return { sql: ` AND ${colonne} = ?`, params: [boutiqueCible] };
      return clauseBoutique(req, colonne);
    };
    const P = filtre('boutique_id');      // table produits
    const M = filtre('m.boutique_id');    // table mouvements (alias m)
    const V = filtre('v.boutique_id');    // table ventes (alias v)

    const totalProduits = db
      .prepare(`SELECT COUNT(*) AS n FROM produits WHERE 1=1${P.sql}`)
      .get(...P.params).n;

    const valeurStock = db
      .prepare(`SELECT COALESCE(SUM(quantite * prix_achat), 0) AS total FROM produits WHERE 1=1${P.sql}`)
      .get(...P.params).total;

    const produitsEnAlerte = db
      .prepare(`SELECT COUNT(*) AS n FROM produits WHERE 1=1${P.sql} AND quantite <= seuil_alerte`)
      .get(...P.params).n;

    const ruptures = db
      .prepare(`SELECT COUNT(*) AS n FROM produits WHERE 1=1${P.sql} AND quantite = 0`)
      .get(...P.params).n;

    // Mouvements du jour (entrees - sorties)
    const mouvementsJour = db
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN type = 'entree' THEN quantite ELSE 0 END), 0) AS entrees,
          COALESCE(SUM(CASE WHEN type = 'sortie' THEN quantite ELSE 0 END), 0) AS sorties
        FROM mouvements m
        WHERE 1=1${M.sql} AND date(date_mouvement) = date('now')
      `)
      .get(...M.params);

    // Top 5 des produits les plus sortis (les plus vendus)
    const topVentes = db
      .prepare(`
        SELECT p.nom, SUM(m.quantite) AS total_vendu
        FROM mouvements m
        JOIN produits p ON p.id = m.produit_id
        WHERE 1=1${M.sql} AND m.type = 'sortie'
        GROUP BY m.produit_id
        ORDER BY total_vendu DESC
        LIMIT 5
      `)
      .all(...M.params);

    // ⏰ Expirations : produits périmes ou arrivant à expiration sous 7 jours
    const expirations = db
      .prepare(`
        SELECT
          SUM(CASE WHEN date_expiration < date('now') THEN 1 ELSE 0 END) AS perimes,
          SUM(CASE WHEN date_expiration >= date('now')
                    AND date_expiration <= date('now', '+7 days')
                   THEN 1 ELSE 0 END) AS bientot
        FROM produits
        WHERE 1=1${P.sql}
          AND date_expiration IS NOT NULL AND TRIM(date_expiration) <> ''
      `)
      .get(...P.params);

    // Liste des produits les plus urgents (périmés puis les premiers à expirer)
    const listeExpirations = db
      .prepare(`
        SELECT id, nom, categorie, date_expiration, quantite,
               CAST(julianday(date_expiration) - julianday('now') AS INTEGER) AS jours_restants
        FROM produits
        WHERE 1=1${P.sql}
          AND date_expiration IS NOT NULL
          AND TRIM(date_expiration) <> ''
          AND date_expiration <= date('now', '+7 days')
        ORDER BY date_expiration ASC
        LIMIT 20
      `)
      .all(...P.params);

    // 🧾 Caisse : tickets et chiffre d'affaires du jour
    const caJour = db
      .prepare(`
        SELECT COUNT(*) AS nb_tickets, COALESCE(SUM(total), 0) AS ca
        FROM ventes v
        WHERE 1=1${V.sql} AND date(date_vente) = date('now')
      `)
      .get(...V.params);

    res.json({
      total_produits: totalProduits,
      valeur_stock: Math.round(valeurStock * 100) / 100,
      produits_en_alerte: produitsEnAlerte,
      ruptures: ruptures,
      entrees_jour: mouvementsJour.entrees,
      sorties_jour: mouvementsJour.sorties,
      top_ventes: topVentes,
      expirations: {
        perimes: expirations.perimes || 0,
        bientot: expirations.bientot || 0,
        liste: listeExpirations,
      },
      ca_jour: {
        nb_tickets: caJour.nb_tickets,
        total: Math.round(caJour.ca * 100) / 100,
      },
    });
  } catch (err) {
    console.error('Erreur stats :', err.message);
    res.status(500).json({ erreur: 'Impossible de calculer les statistiques' });
  }
});

module.exports = router;