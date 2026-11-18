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
    if (req.query.boutique_id !== undefined) {
      boutiqueCible = parseInt(req.query.boutique_id, 10);
      if (!Number.isInteger(boutiqueCible) || boutiqueCible <= 0) {
        return res.status(400).json({ erreur: 'Identifiant de boutique invalide' });
      }
      if (!portee.ids.includes(boutiqueCible)) {
        return res.status(403).json({ erreur: 'Cette boutique ne vous est pas rattachée' });
      }
    }

    // Fragment SQL par table/alias : ' AND boutique_id IN (...)'
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

// ============================================================
// VENTES PAR PÉRIODE ET ÉVOLUTION DANS LE TEMPS
// GET /api/stats/ventes
//   gérant → SA boutique : total du jour, de la semaine, du mois, de l'année
//   admin  → tout le réseau, plus le détail par boutique
// Les dates sont calculées en UTC, comme date('now') de SQLite :
// les bornes et les agrégats restent donc toujours cohérents.
// ============================================================

const JOUR_MS = 24 * 60 * 60 * 1000;
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MOIS_LONGS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

const dateIso = (d) => d.toISOString().slice(0, 10);

// Lundi de la semaine contenant d (semaine ISO, lundi = premier jour)
function lundiDe(d) {
  const copie = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  copie.setUTCDate(copie.getUTCDate() - ((copie.getUTCDay() + 6) % 7));
  return copie;
}

// Expression SQL qui ramène une date de vente au début de sa période
const CLES_SQL = {
  jour: 'date(v.date_vente)',
  semaine: "date(v.date_vente, '-' || ((strftime('%w', v.date_vente) + 6) % 7) || ' days')",
  mois: "strftime('%Y-%m', v.date_vente)",
  annee: "strftime('%Y', v.date_vente)",
};

const arrondi2 = (valeur) => Math.round((Number(valeur) || 0) * 100) / 100;

// Squelette de la courbe : une entrée par point, même sans vente
// (les jours creux doivent apparaître à zéro, pas disparaître).
function squelette(granularite, aujourdhui, lundi) {
  const points = [];

  if (granularite === 'jour') {
    for (let i = 29; i >= 0; i--) {
      const d = new Date(aujourdhui.getTime() - i * JOUR_MS);
      const jour = String(d.getUTCDate()).padStart(2, '0');
      const mois = String(d.getUTCMonth() + 1).padStart(2, '0');
      points.push({
        cle: dateIso(d),
        libelle: `${jour}/${mois}`,
        libelleLong: `${jour}/${mois}/${d.getUTCFullYear()}`,
      });
    }
  } else if (granularite === 'semaine') {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(lundi.getTime() - i * 7 * JOUR_MS);
      const jour = String(d.getUTCDate()).padStart(2, '0');
      const mois = String(d.getUTCMonth() + 1).padStart(2, '0');
      points.push({
        cle: dateIso(d),
        libelle: `${jour}/${mois}`,
        libelleLong: `Semaine du ${jour}/${mois}/${d.getUTCFullYear()}`,
      });
    }
  } else if (granularite === 'mois') {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(aujourdhui.getUTCFullYear(), aujourdhui.getUTCMonth() - i, 1));
      points.push({
        cle: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
        libelle: MOIS_COURTS[d.getUTCMonth()],
        libelleLong: `${MOIS_LONGS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
      });
    }
  } else {
    for (let i = 4; i >= 0; i--) {
      const annee = aujourdhui.getUTCFullYear() - i;
      points.push({ cle: String(annee), libelle: String(annee), libelleLong: String(annee) });
    }
  }

  return points;
}

router.get('/ventes', (req, res) => {
  try {
    const portee = porteeBoutique(req);
    if (!portee.autorise) {
      return res.status(403).json({ erreur: 'Accès réservé aux administrateurs et gérants' });
    }

    // admin → SES boutiques, sauf ?boutique_id= explicite (parmi les siennes)
    let boutiqueCible = null;
    if (req.query.boutique_id !== undefined) {
      boutiqueCible = parseInt(req.query.boutique_id, 10);
      if (!Number.isInteger(boutiqueCible) || boutiqueCible <= 0) {
        return res.status(400).json({ erreur: 'Identifiant de boutique invalide' });
      }
      if (!portee.ids.includes(boutiqueCible)) {
        return res.status(403).json({ erreur: 'Cette boutique ne vous est pas rattachée' });
      }
    }

    const V = boutiqueCible !== null
      ? { sql: ' AND v.boutique_id = ?', params: [boutiqueCible] }
      : clauseBoutique(req, 'v.boutique_id');

    const now = new Date();
    const aujourdhui = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const lundi = lundiDe(aujourdhui);
    const debutMois = new Date(Date.UTC(aujourdhui.getUTCFullYear(), aujourdhui.getUTCMonth(), 1));
    const debutAnnee = new Date(Date.UTC(aujourdhui.getUTCFullYear(), 0, 1));

    // --- 1. Totaux des quatre périodes demandées ---
    const totalPeriode = (debut) => db.prepare(`
      SELECT COUNT(*) AS nb_tickets, COALESCE(SUM(v.total), 0) AS total
      FROM ventes v
      WHERE 1=1${V.sql} AND date(v.date_vente) >= ?
    `).get(...V.params, dateIso(debut));

    const periodes = {
      jour: totalPeriode(aujourdhui),
      semaine: totalPeriode(lundi),
      mois: totalPeriode(debutMois),
      annee: totalPeriode(debutAnnee),
    };
    for (const cle of Object.keys(periodes)) {
      periodes[cle] = {
        nb_tickets: periodes[cle].nb_tickets,
        total: arrondi2(periodes[cle].total),
      };
    }

    // --- 2. Séries temporelles (courbe d'évolution) ---
    const debuts = {
      jour: dateIso(new Date(aujourdhui.getTime() - 29 * JOUR_MS)),
      semaine: dateIso(new Date(lundi.getTime() - 11 * 7 * JOUR_MS)),
      mois: `${new Date(Date.UTC(aujourdhui.getUTCFullYear(), aujourdhui.getUTCMonth() - 11, 1)).getUTCFullYear()}-${String(
        new Date(Date.UTC(aujourdhui.getUTCFullYear(), aujourdhui.getUTCMonth() - 11, 1)).getUTCMonth() + 1
      ).padStart(2, '0')}`,
      annee: String(aujourdhui.getUTCFullYear() - 4),
    };

    const evolution = {};
    for (const granularite of Object.keys(CLES_SQL)) {
      const lignes = db.prepare(`
        SELECT ${CLES_SQL[granularite]} AS cle,
               COUNT(*) AS nb_tickets,
               COALESCE(SUM(v.total), 0) AS total
        FROM ventes v
        WHERE 1=1${V.sql} AND date(v.date_vente) >= ?
        GROUP BY cle
      `).all(...V.params, debuts[granularite]);

      const parCle = new Map(lignes.map((l) => [String(l.cle), l]));
      const points = squelette(granularite, aujourdhui, lundi).map((p) => {
        const ligne = parCle.get(p.cle);
        return {
          ...p,
          total: arrondi2(ligne ? ligne.total : 0),
          nb_tickets: ligne ? ligne.nb_tickets : 0,
        };
      });

      evolution[granularite] = {
        points,
        total: arrondi2(points.reduce((somme, p) => somme + p.total, 0)),
        nb_tickets: points.reduce((somme, p) => somme + p.nb_tickets, 0),
      };
    }

    // --- 3. Détail par boutique (admin seulement, réseau entier) ---
    let parBoutique = null;
    if (portee.toutes && boutiqueCible === null) {
      const marquesBoutiques = portee.ids.map(() => '?').join(', ');
      parBoutique = db.prepare(`
        SELECT b.id, b.nom, b.code,
               COUNT(v.id) AS nb_tickets,
               COALESCE(SUM(CASE WHEN date(v.date_vente) >= ? THEN v.total ELSE 0 END), 0) AS jour,
               COALESCE(SUM(CASE WHEN date(v.date_vente) >= ? THEN v.total ELSE 0 END), 0) AS semaine,
               COALESCE(SUM(CASE WHEN date(v.date_vente) >= ? THEN v.total ELSE 0 END), 0) AS mois,
               COALESCE(SUM(CASE WHEN date(v.date_vente) >= ? THEN v.total ELSE 0 END), 0) AS annee
        FROM boutiques b
        LEFT JOIN ventes v ON v.boutique_id = b.id
        WHERE b.id IN (${marquesBoutiques})
        GROUP BY b.id
        ORDER BY mois DESC, b.nom ASC
      `).all(dateIso(aujourdhui), dateIso(lundi), dateIso(debutMois), dateIso(debutAnnee), ...portee.ids);

      parBoutique = parBoutique.map((b) => ({
        ...b,
        jour: arrondi2(b.jour),
        semaine: arrondi2(b.semaine),
        mois: arrondi2(b.mois),
        annee: arrondi2(b.annee),
      }));
    }

    // --- 4. Boutique concernée (pour l'affichage du gérant) ---
    const boutiqueId = boutiqueCible !== null ? boutiqueCible : portee.boutiqueId;
    const boutique = boutiqueId
      ? db.prepare('SELECT id, nom, code FROM boutiques WHERE id = ?').get(boutiqueId) || null
      : null;

    res.json({
      portee: { toutes: portee.toutes && boutiqueCible === null, boutique },
      periodes,
      evolution,
      par_boutique: parBoutique,
    });
  } catch (err) {
    console.error('Erreur stats ventes :', err.message);
    res.status(500).json({ erreur: 'Impossible de calculer les ventes par période' });
  }
});

module.exports = router;