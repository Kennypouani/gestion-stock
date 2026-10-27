// ============================================================
// ROUTES EXPORT — Fichiers CSV (ADMIN)
// Préfixe : /api/export
// Format pensé pour Excel francophone : séparateur « ; »,
// sauts de ligne Windows et BOM UTF-8 (sinon les accents cassent)
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../database');
const { porteeBoutique, clauseBoutique } = require('../auth');

// Échappement d'une cellule CSV (guillemets doublés si nécessaire)
function cellule(valeur) {
  if (valeur === null || valeur === undefined) return '';
  const texte = String(valeur);
  if (/[\";\r\n]/.test(texte)) return `"${texte.replace(/"/g, '""')}"`;
  return texte;
}

// Convertit un tableau d'objets en CSV (le premier objet fournit les colonnes)
function versCSV(lignes, colonnes) {
  const entetes = colonnes || Object.keys(lignes[0] || {});
  const lignesCsv = lignes.map((ligne) => entetes.map((c) => cellule(ligne[c])).join(';'));
  // \uFEFF = BOM UTF-8 → Excel ouvre les accents correctement
  return '\uFEFF' + [entetes.join(';'), ...lignesCsv].join('\r\n');
}

// Envoie le fichier au navigateur (déclenche le téléchargement)
function envoyerCSV(res, nomFichier, contenu) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nomFichier}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(contenu);
}

const dateDuJour = () => new Date().toISOString().slice(0, 10);

// --- 1. Export du STOCK (catalogue complet) ---
// GET /api/export/produits
router.get('/produits', (req, res) => {
  const portee = porteeBoutique(req);
  if (!portee.autorise) {
    return res.status(403).json({ erreur: 'Aucune boutique rattachée à ce compte' });
  }

  const porteeSql = clauseBoutique(req, 'p.boutique_id');

  try {
    const produits = db.prepare(`
      SELECT p.id, p.nom, p.categorie, p.prix_achat, p.prix_vente, p.quantite,
             p.seuil_alerte, p.code_barre, p.date_expiration, p.date_creation,
             p.boutique_id, b.nom AS boutique_nom
      FROM produits p
      JOIN boutiques b ON b.id = p.boutique_id
      WHERE 1=1${porteeSql.sql}
      ORDER BY p.nom COLLATE NOCASE ASC
    `).all(...porteeSql.params);

    // Marge calculée pour le fichier, arrondie à 2 décimales
    const lignes = produits.map((p) => ({
      ...p,
      marge_unite: Math.round((p.prix_vente - p.prix_achat) * 100) / 100,
      valeur_stock: Math.round(p.prix_achat * p.quantite * 100) / 100,
      en_alerte: p.quantite <= p.seuil_alerte ? 'oui' : 'non',
    }));

    envoyerCSV(res, `stock-${dateDuJour()}.csv`, versCSV(lignes));
  } catch (err) {
    console.error('Erreur export stock :', err.message);
    res.status(500).json({ erreur: 'Impossible d’exporter le stock' });
  }
});

// --- 2. Export du JOURNAL (traçabilité complète) ---
// GET /api/export/journal
router.get('/journal', (req, res) => {
  const portee = porteeBoutique(req);
  if (!portee.autorise) {
    return res.status(403).json({ erreur: 'Aucune boutique rattachée à ce compte' });
  }

  const porteeSql = clauseBoutique(req);

  try {
    const lignes = db.prepare(`
      SELECT date_action, utilisateur_nom, utilisateur_role, action,
             produit_nom, champ, ancienne_valeur, nouvelle_valeur, motif,
             boutique_id
      FROM journal
      WHERE 1=1${porteeSql.sql}
      ORDER BY datetime(date_action) DESC, id DESC
    `).all(...porteeSql.params);

    envoyerCSV(res, `journal-${dateDuJour()}.csv`, versCSV(lignes));
  } catch (err) {
    console.error('Erreur export journal :', err.message);
    res.status(500).json({ erreur: 'Impossible d’exporter le journal' });
  }
});

module.exports = router;