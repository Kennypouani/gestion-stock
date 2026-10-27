// ============================================================
// JOURNAL D'AUDIT — Enregistre CHAQUE modification sensible
// Qui a fait quoi, quand, sur quel produit, avec quelles valeurs
// Les noms sont COPIÉS (et pas seulement les id) pour que
// l'historique reste lisible même si un compte est supprimé
// ============================================================

const db = require('./database');

// Champs du produit qu'on trace
const CHAMPS_TRACES = [
  'nom',
  'categorie',
  'prix_achat',
  'prix_vente',
  'quantite',
  'seuil_alerte',
  'code_barre',
  'date_expiration',
];

/**
 * Écrit une ligne dans le journal.
 * @param {object} entree
 * @param {object|null} entree.produit    — le produit concerné
 * @param {object}   entree.utilisateur   — req.utilisateur (id, nom, role)
 * @param {string}   entree.action        — creation | modification | suppression | entree | sortie
 * @param {string|null} entree.champ      — nom du champ modifié (ex: 'prix_vente')
 * @param {*}        entree.ancienne
 * @param {*}        entree.nouvelle
 * @param {string|null} entree.motif      — raison déclarée par l'employé
 * @param {number|null} entree.boutique_id — boutique concernée (défaut : celle du produit)
 */
function journaliser({
  produit,
  utilisateur,
  action,
  champ = null,
  ancienne = null,
  nouvelle = null,
  motif = null,
  boutique_id = null,
}) {
  try {
    // L'audit est rattaché à la boutique où l'action s'est produite :
    // explicite > produit > utilisateur du compte > boutique 1 (secours)
    const boutique =
      boutique_id ??
      (produit ? produit.boutique_id : null) ??
      (utilisateur ? utilisateur.boutique_id : null) ??
      1;

    db.prepare(`
      INSERT INTO journal
        (produit_id, produit_nom, utilisateur_id, utilisateur_nom, utilisateur_role,
         action, champ, ancienne_valeur, nouvelle_valeur, motif, boutique_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      produit ? produit.id : null,
      produit ? produit.nom : '(produit supprimé)',
      utilisateur ? utilisateur.id : null,
      utilisateur ? utilisateur.nom : 'Système',
      utilisateur ? utilisateur.role : null,
      action,
      champ,
      ancienne === null || ancienne === undefined ? null : String(ancienne),
      nouvelle === null || nouvelle === undefined ? null : String(nouvelle),
      motif ? String(motif).slice(0, 200) : null,
      boutique
    );
  } catch (err) {
    // Le journal ne doit JAMAIS faire échouer l'action principale,
    // mais on affiche l'erreur côté serveur pour ne rien perdre
    console.error('Erreur journal :', err.message);
  }
}

/**
 * Compare l'ancien et le nouveau produit, et journalise
 * UNA ENTRÉE PAR CHAMP RÉELLEMENT MODIFIÉ.
 */
function journaliserModifications(produitAvant, produitApres, utilisateur, motif = null) {
  for (const champ of CHAMPS_TRACES) {
    const avant = produitAvant[champ];
    const apres = produitApres[champ];
    // Comparaison normalisée (15 et "15" sont considérés identiques)
    if (String(avant ?? '') !== String(apres ?? '')) {
      journaliser({
        produit: produitApres,
        utilisateur,
        action: 'modification',
        champ,
        ancienne: avant,
        nouvelle: apres,
        motif,
      });
    }
  }
}

module.exports = { journaliser, journaliserModifications, CHAMPS_TRACES };
