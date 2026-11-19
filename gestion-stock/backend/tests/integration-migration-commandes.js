// ============================================================
// TESTS D'INTÉGRATION — MIGRATION DES COMMANDES VERS LEUR BOUTIQUE
//
// Contexte : le répertoire fournisseurs est devenu propre à chaque
// boutique. Des commandes historiques pointaient encore vers le
// fournisseur d'un autre magasin → invisibles dans l'onglet Commandes.
// migrations.js les réattache à un fournisseur de LEUR boutique.
//
// Couverture :
//   1. homonyme existant dans la bonne boutique → réutilisé
//      (l'actif est préféré à l'homonyme archivé)
//   2. aucun homonyme mais un fournisseur dans la boutique → réutilisé
//   3. boutique sans aucun fournisseur → copie du fournisseur d'origine
//      (nom, contact, coordonnées) créée et activée dans la boutique
//   4. rejouable : une 2e exécution ne corrige plus rien et ne duplique
//      aucun fournisseur (comportement attendu à chaque démarrage)
//   5. commandes déjà correctes : ni déplacées, ni modifiées
//      (numéro, statut et montant conservés)
//
// Aucun serveur nécessaire : bases SQLite en mémoire (:memory:), donc
// la base réelle (stock.db) n'est jamais lue ni modifiée.
//
// Lancement :  node tests/integration-migration-commandes.js
// Sortie :     code 0 si tout passe, code 1 sinon
// ============================================================

const { DatabaseSync } = require('node:sqlite');
const { reparerFournisseursCommandes } = require('../migrations');

let ok = 0;
let ko = 0;

const verifie = (label, condition, detail = '') => {
  if (condition) { ok++; console.log(`  ✅ ${label}`); }
  else { ko++; console.log(`  ❌ ${label} ${detail}`); }
};

// --- Schéma minimal, calqué sur database.js ---
function baseVierge() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE boutiques (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      actif INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE fournisseurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      contact_nom TEXT,
      email TEXT,
      telephone TEXT,
      adresse TEXT,
      actif INTEGER NOT NULL DEFAULT 1,
      boutique_id INTEGER NOT NULL REFERENCES boutiques(id)
    );

    CREATE TABLE commandes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT UNIQUE NOT NULL,
      fournisseur_id INTEGER NOT NULL REFERENCES fournisseurs(id),
      statut TEXT NOT NULL DEFAULT 'en_attente'
        CHECK(statut IN ('en_attente', 'envoyee', 'recue', 'annulee')),
      montant_total REAL NOT NULL DEFAULT 0,
      boutique_id INTEGER NOT NULL REFERENCES boutiques(id)
    );
  `);
  return db;
}

const ajouterBoutique = (db, nom, code) =>
  db.prepare('INSERT INTO boutiques (nom, code) VALUES (?, ?)').run(nom, code).lastInsertRowid;

const ajouterFournisseur = (db, { nom, boutiqueId, actif = 1, contact = null, email = null, telephone = null, adresse = null }) =>
  db.prepare(`
    INSERT INTO fournisseurs (nom, contact_nom, email, telephone, adresse, actif, boutique_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(nom, contact, email, telephone, adresse, actif, boutiqueId).lastInsertRowid;

const ajouterCommande = (db, { numero, fournisseurId, boutiqueId, statut = 'recue', montant = 0 }) =>
  db.prepare(`
    INSERT INTO commandes (numero, fournisseur_id, statut, montant_total, boutique_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(numero, fournisseurId, statut, montant, boutiqueId).lastInsertRowid;

const commande = (db, id) => db.prepare('SELECT * FROM commandes WHERE id = ?').get(id);
const fournisseur = (db, id) => db.prepare('SELECT * FROM fournisseurs WHERE id = ?').get(id);
const nbFournisseurs = (db) => db.prepare('SELECT COUNT(*) AS n FROM fournisseurs').get().n;
const nbMalRattachees = (db) => db.prepare(`
  SELECT COUNT(*) AS n FROM commandes c
  JOIN fournisseurs f ON f.id = c.fournisseur_id
  WHERE f.boutique_id <> c.boutique_id
`).get().n;

// ============================================================
console.log('\n===== 1. HOMONYME DANS LA BONNE BOUTIQUE =====');
{
  const db = baseVierge();
  const mp = ajouterBoutique(db, 'Magasin principal', 'MP');
  const nord = ajouterBoutique(db, 'Boutique Nord', 'NORD');

  // Fournisseur d'origine : boutique MP, archivé (cas réel de « Laiterie du Nord »)
  const source = ajouterFournisseur(db, { nom: 'Laiterie du Nord', boutiqueId: mp, actif: 0 });
  // Homonyme archivé PUIS homonyme actif dans NORD : l'actif doit gagner
  ajouterFournisseur(db, { nom: 'Laiterie du Nord', boutiqueId: nord, actif: 0 });
  const homonymeActif = ajouterFournisseur(db, { nom: 'Laiterie du Nord', boutiqueId: nord, actif: 1 });

  const avant = ajouterCommande(db, {
    numero: 'CMD-2026-0021', fournisseurId: source, boutiqueId: nord, statut: 'recue', montant: 2,
  });

  const bilan = reparerFournisseursCommandes(db);

  verifie('1 commande corrigée', bilan.corrigees === 1, `→ ${bilan.corrigees}`);
  verifie('aucun fournisseur créé (homonyme réutilisé)', bilan.creees === 0, `→ ${bilan.creees}`);
  verifie('commande rattachée à l’homonyme actif', commande(db, avant).fournisseur_id === homonymeActif,
    `→ ${commande(db, avant).fournisseur_id} (attendu ${homonymeActif})`);
  verifie('répertoire inchangé (3 fournisseurs)', nbFournisseurs(db) === 3, `→ ${nbFournisseurs(db)}`);
  verifie('plus aucune commande hors boutique', nbMalRattachees(db) === 0);
  verifie('numéro / statut / montant conservés',
    commande(db, avant).numero === 'CMD-2026-0021' &&
    commande(db, avant).statut === 'recue' &&
    commande(db, avant).montant_total === 2,
    JSON.stringify(commande(db, avant)));
  db.close();
}

// ============================================================
console.log('\n===== 2. AUCUN HOMONYME : FOURNISSEUR DE LA BOUTIQUE =====');
{
  const db = baseVierge();
  const mp = ajouterBoutique(db, 'Magasin principal', 'MP');
  const nord = ajouterBoutique(db, 'Boutique Nord', 'NORD');

  const source = ajouterFournisseur(db, { nom: 'Grossiste Sud', boutiqueId: mp });
  const local = ajouterFournisseur(db, { nom: 'Fournisseur local', boutiqueId: nord });
  const avant = ajouterCommande(db, {
    numero: 'CMD-2026-0030', fournisseurId: source, boutiqueId: nord, statut: 'en_attente',
  });

  const bilan = reparerFournisseursCommandes(db);

  verifie('1 commande corrigée', bilan.corrigees === 1, `→ ${bilan.corrigees}`);
  verifie('aucun fournisseur créé', bilan.creees === 0, `→ ${bilan.creees}`);
  verifie('commande rattachée au fournisseur de sa boutique', commande(db, avant).fournisseur_id === local,
    `→ ${commande(db, avant).fournisseur_id} (attendu ${local})`);
  verifie('fournisseur d’origine inchangé',
    fournisseur(db, source).nom === 'Grossiste Sud' && fournisseur(db, source).boutique_id === mp);
  verifie('statut conservé', commande(db, avant).statut === 'en_attente');
  db.close();
}

// ============================================================
console.log('\n===== 3. BOUTIQUE SANS FOURNISSEUR : COPIE CRÉÉE =====');
{
  const db = baseVierge();
  const mp = ajouterBoutique(db, 'Magasin principal', 'MP');
  const m1 = ajouterBoutique(db, 'M1', 'RZ9W7S');

  const source = ajouterFournisseur(db, {
    nom: 'Laiterie du Nord', boutiqueId: mp, actif: 0,
    contact: 'Ali Traoré', email: 'ali@laiterie.fr', telephone: '+225 07 00 00 00', adresse: 'Zone 4',
  });
  const avant = ajouterCommande(db, {
    numero: 'CMD-2026-0023', fournisseurId: source, boutiqueId: m1, statut: 'recue', montant: 2,
  });

  const bilan = reparerFournisseursCommandes(db);

  const copie = db.prepare('SELECT * FROM fournisseurs WHERE boutique_id = ?').get(m1);
  verifie('1 commande corrigée', bilan.corrigees === 1, `→ ${bilan.corrigees}`);
  verifie('1 fournisseur créé', bilan.creees === 1, `→ ${bilan.creees}`);
  verifie('copie bien dans la boutique de la commande', copie && copie.boutique_id === m1);
  verifie('copie active', copie && copie.actif === 1);
  verifie('nom repris à l’identique', copie && copie.nom === 'Laiterie du Nord');
  verifie('coordonnées reprises',
    copie && copie.contact_nom === 'Ali Traoré' && copie.email === 'ali@laiterie.fr' &&
    copie.telephone === '+225 07 00 00 00' && copie.adresse === 'Zone 4',
    copie ? JSON.stringify(copie) : 'aucune copie');
  verifie('commande rattachée à la copie', commande(db, avant).fournisseur_id === (copie && copie.id));
  verifie('fournisseur d’origine conservé en boutique 1',
    fournisseur(db, source).boutique_id === mp && fournisseur(db, source).actif === 0);
  db.close();
}

// ============================================================
console.log('\n===== 4. REJOUABLE : 2e EXÉCUTION SANS EFFET =====');
{
  const db = baseVierge();
  const mp = ajouterBoutique(db, 'Magasin principal', 'MP');
  const m1 = ajouterBoutique(db, 'M1', 'RZ9W7S');
  const source = ajouterFournisseur(db, { nom: 'Grossiste Sud', boutiqueId: mp });
  const avant = ajouterCommande(db, { numero: 'CMD-2026-0040', fournisseurId: source, boutiqueId: m1 });

  const premier = reparerFournisseursCommandes(db);
  const deuxieme = reparerFournisseursCommandes(db);

  verifie('1re exécution corrige 1 commande', premier.corrigees === 1, `→ ${premier.corrigees}`);
  verifie('2e exécution : aucune correction', deuxieme.corrigees === 0, `→ ${deuxieme.corrigees}`);
  verifie('2e exécution : aucune création', deuxieme.creees === 0, `→ ${deuxieme.creees}`);
  verifie('un seul fournisseur dans M1 (pas de doublon)',
    db.prepare('SELECT COUNT(*) AS n FROM fournisseurs WHERE boutique_id = ?').get(m1).n === 1);
  verifie('rattachement stable', nbMalRattachees(db) === 0 &&
    commande(db, avant).fournisseur_id === db.prepare('SELECT id FROM fournisseurs WHERE boutique_id = ?').get(m1).id);
  db.close();
}

// ============================================================
console.log('\n===== 5. COMMANDES DÉJÀ CORRECTES INTACTES =====');
{
  const db = baseVierge();
  const mp = ajouterBoutique(db, 'Magasin principal', 'MP');
  const nord = ajouterBoutique(db, 'Boutique Nord', 'NORD');
  const fMp = ajouterFournisseur(db, { nom: 'Grossiste Sud', boutiqueId: mp });
  const fNord = ajouterFournisseur(db, { nom: 'Laiterie du Nord', boutiqueId: nord });

  const cMp = ajouterCommande(db, { numero: 'CMD-2026-0001', fournisseurId: fMp, boutiqueId: mp, statut: 'envoyee' });
  const cNord = ajouterCommande(db, { numero: 'CMD-2026-0021', fournisseurId: fNord, boutiqueId: nord });

  const bilan = reparerFournisseursCommandes(db);

  verifie('aucune correction', bilan.corrigees === 0, `→ ${bilan.corrigees}`);
  verifie('aucune création', bilan.creees === 0, `→ ${bilan.creees}`);
  verifie('commande MP inchangée', commande(db, cMp).fournisseur_id === fMp && commande(db, cMp).statut === 'envoyee');
  verifie('commande NORD inchangée', commande(db, cNord).fournisseur_id === fNord);
  verifie('répertoire intact (2 fournisseurs)', nbFournisseurs(db) === 2, `→ ${nbFournisseurs(db)}`);
  db.close();
}

console.log(`\n========== ${ok} réussis / ${ko} échoués (total ${ok + ko}) ==========\n`);
process.exit(ko === 0 ? 0 : 1);
