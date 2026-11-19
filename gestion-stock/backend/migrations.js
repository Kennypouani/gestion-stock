// ============================================================
// MIGRATIONS DE DONNÉES — corrections rejouables au démarrage
// Chaque fonction reçoit la base ouverte (stock.db ou une base de
// test) pour rester vérifiable sans toucher aux données réelles.
// ============================================================

// --- Fournisseur de commande rattaché à la BONNE boutique ---
// Le répertoire fournisseurs est devenu propre à chaque boutique après coup :
// d'anciennes commandes pointent donc encore vers le fournisseur d'un autre
// magasin (leur onglet Commandes ne pouvait plus les lire). On les réattache
// à un fournisseur de LEUR boutique : l'homonyme s'il existe, sinon n'importe
// quel fournisseur de la boutique, sinon une copie du fournisseur d'origine
// créée dans la bonne boutique. Rejouable sans risque à chaque démarrage.
function reparerFournisseursCommandes(db) {
  const malRattachees = db.prepare(`
    SELECT c.id AS commande_id, c.boutique_id AS boutique_id,
           f.nom, f.contact_nom, f.email, f.telephone, f.adresse
    FROM commandes c
    JOIN fournisseurs f ON f.id = c.fournisseur_id
    WHERE f.boutique_id <> c.boutique_id
    ORDER BY c.id
  `).all();

  const bilan = { corrigees: 0, creees: 0 };
  if (malRattachees.length === 0) return bilan;

  const parNom = db.prepare(`
    SELECT id FROM fournisseurs
    WHERE boutique_id = ? AND LOWER(nom) = LOWER(?)
    ORDER BY actif DESC, id LIMIT 1
  `);
  const nImporte = db.prepare(
    'SELECT id FROM fournisseurs WHERE boutique_id = ? ORDER BY actif DESC, id LIMIT 1'
  );
  const creer = db.prepare(`
    INSERT INTO fournisseurs (nom, contact_nom, email, telephone, adresse, boutique_id, actif)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  const reattacher = db.prepare('UPDATE commandes SET fournisseur_id = ? WHERE id = ?');

  db.exec('BEGIN');
  try {
    for (const commande of malRattachees) {
      const homonyme = parNom.get(commande.boutique_id, commande.nom);
      const secours = homonyme || nImporte.get(commande.boutique_id);
      let fournisseurId = secours ? secours.id : null;
      if (!fournisseurId) {
        fournisseurId = creer.run(
          commande.nom, commande.contact_nom, commande.email,
          commande.telephone, commande.adresse, commande.boutique_id
        ).lastInsertRowid;
        bilan.creees += 1;
      }
      reattacher.run(fournisseurId, commande.commande_id);
      bilan.corrigees += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return bilan;
}

module.exports = { reparerFournisseursCommandes };
