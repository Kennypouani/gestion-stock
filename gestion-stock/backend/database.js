// ============================================================
// BASE DE DONNÉES — SQLite intégré à Node.js (node:sqlite)
// Pas de librairie externe à compiler : tout est dans Node !
// Ce fichier crée les tables au premier démarrage.
//
// ARCHITECTURE MULTI-BOUTIQUES :
//   • Une boutique = un magasin (suffixe de ticket = son code)
//   • Chaque donnée métier porte boutique_id → isolation par magasin
//   • Comptes : admin (réseau entier, boutique_id NULL) /
//               gerant (UNE boutique) / employe (UNE boutique, la caisse)
//   • Les règles d'accès se vérifient EN BASE à chaque requête
// ============================================================

const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('stock.db'); // Crée le fichier stock.db s'il n'existe pas

// Active les clés étrangères (relations entre tables)
db.exec('PRAGMA foreign_keys = ON');

// --- Création des tables (si elles n'existent pas déjà) ---

// Table BOUTIQUES — un magasin du réseau
//   code = suffixe des tickets de caisse (ex : TK-MP-2026-0001)
//   Il est saisi par l'admin à la création ; le gérant peut le proposer
//   pour SA boutique, mais il doit rester stable (traçabilité des tickets).
db.exec(`
  CREATE TABLE IF NOT EXISTS boutiques (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,                       -- Ex : 'Magasin central'
    code TEXT UNIQUE NOT NULL,               -- Ex : 'MP' → tickets TK-MP-2026-0001
    adresse TEXT,
    telephone TEXT,
    actif INTEGER NOT NULL DEFAULT 1,        -- 0 = boutique archivée (jamais supprimée)
    date_creation TEXT DEFAULT (datetime('now'))
  );
`);

// Table UTILISATEURS — comptes de connexion (3 rôles)
//   boutique_id NULL  → admin : accès à TOUT le réseau
//   boutique_id rempli → gérant ou employé : UNIQUEMENT cette boutique
db.exec(`
  CREATE TABLE IF NOT EXISTS utilisateurs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,              -- Identifiant de connexion
    mot_de_passe TEXT NOT NULL,              -- Haché avec bcrypt (jamais en clair !)
    role TEXT NOT NULL CHECK(role IN ('admin', 'gerant', 'employe')),
    boutique_id INTEGER REFERENCES boutiques(id),
    actif INTEGER NOT NULL DEFAULT 1,        -- 1 = compte actif, 0 = désactivé
    date_creation TEXT DEFAULT (datetime('now'))
  );
`);

// Table PRODUITS — une FICHE PAR BOUTIQUE (choix d'architecture validé) :
//   le même article existe dans 5 magasins = 5 fiches, chacune avec
//   son stock ET ses prix. Le code-barres n'est unique que DANS une boutique.
db.exec(`
  CREATE TABLE IF NOT EXISTS produits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    categorie TEXT DEFAULT 'Divers',
    prix_achat REAL NOT NULL,
    prix_vente REAL NOT NULL,
    quantite INTEGER NOT NULL DEFAULT 0,
    seuil_alerte INTEGER NOT NULL DEFAULT 5,
    code_barre TEXT,
    date_expiration TEXT,
    date_creation TEXT DEFAULT (datetime('now')),
    boutique_id INTEGER NOT NULL DEFAULT 1 REFERENCES boutiques(id),
    UNIQUE (code_barre, boutique_id)         -- même code-barres possible dans 2 boutiques
  );
`);

// Table MOUVEMENTS : historique des entrées et sorties de stock
//   DEFAULT 1 = boutique par défaut au tout premier appel ;
//   les routes préciseront la boutique de la session (étape 5)
db.exec(`
  CREATE TABLE IF NOT EXISTS mouvements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produit_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('entree', 'sortie')),
    quantite INTEGER NOT NULL,
    motif TEXT,
    date_mouvement TEXT DEFAULT (datetime('now')),
    utilisateur_id INTEGER,
    utilisateur_nom TEXT,
    utilisateur_role TEXT,
    boutique_id INTEGER NOT NULL DEFAULT 1 REFERENCES boutiques(id),
    FOREIGN KEY (produit_id) REFERENCES produits(id) ON DELETE CASCADE
  );
`);

// Table SESSIONS — jetons de connexion stockés côté serveur
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    jeton TEXT PRIMARY KEY,
    utilisateur_id INTEGER NOT NULL,
    date_expiration TEXT NOT NULL,
    date_creation TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
  );
`);

// Table JOURNAL — traçabilité de TOUTES les modifications (réseau entier,
// l'admin doit pouvoir auditier chaque boutique)
const tableJournal = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='journal'").get();
if (!tableJournal) {
  db.exec(`
    CREATE TABLE journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produit_id INTEGER,
      produit_nom TEXT NOT NULL,
      utilisateur_id INTEGER,
      utilisateur_nom TEXT NOT NULL,
      utilisateur_role TEXT,
      action TEXT NOT NULL CHECK(action IN ('creation', 'modification', 'suppression', 'entree', 'sortie')),
      champ TEXT,
      ancienne_valeur TEXT,
      nouvelle_valeur TEXT,
      date_action TEXT DEFAULT (datetime('now')),
      motif TEXT,
      boutique_id INTEGER NOT NULL DEFAULT 1 REFERENCES boutiques(id)
    );
    CREATE INDEX IF NOT EXISTS idx_journal_produit ON journal(produit_id);
    CREATE INDEX IF NOT EXISTS idx_journal_date ON journal(date_action DESC);
    CREATE INDEX IF NOT EXISTS idx_journal_boutique ON journal(boutique_id);
  `);
  console.log('📒 Table journal créée');
}

// --- Tables caisse / achats ---
db.exec(`
  CREATE TABLE IF NOT EXISTS ventes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT UNIQUE NOT NULL,                       -- Ex : TK-2026-0001 (suffixé en étape 6)
    sous_total REAL NOT NULL,
    remise REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL,
    moyen_paiement TEXT NOT NULL CHECK(moyen_paiement IN ('especes', 'carte', 'mobile')),
    montant_verse REAL,
    monnaie_rendue REAL,
    utilisateur_id INTEGER,
    utilisateur_nom TEXT,
    date_vente TEXT DEFAULT (datetime('now')),
    boutique_id INTEGER NOT NULL DEFAULT 1 REFERENCES boutiques(id),
    FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id)
  );

  CREATE TABLE IF NOT EXISTS vente_lignes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vente_id INTEGER NOT NULL,
    produit_id INTEGER NOT NULL,
    produit_nom TEXT NOT NULL,
    quantite INTEGER NOT NULL CHECK(quantite > 0),
    prix_unitaire REAL NOT NULL,
    sous_total REAL NOT NULL,
    FOREIGN KEY (vente_id) REFERENCES ventes(id) ON DELETE CASCADE,
    FOREIGN KEY (produit_id) REFERENCES produits(id)
  );

  -- FOURNISSEURS : répertoire PARTAGÉ par tout le réseau
  -- (chaque gérant commande au même catalogue de fournisseurs)
  CREATE TABLE IF NOT EXISTS fournisseurs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    contact_nom TEXT,
    email TEXT,
    telephone TEXT,
    adresse TEXT,
    actif INTEGER NOT NULL DEFAULT 1,
    date_creation TEXT DEFAULT (datetime('now'))
  );

  -- BONS DE COMMANDE : passés par l'admin OU par le gérant de la boutique
  CREATE TABLE IF NOT EXISTS commandes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT UNIQUE NOT NULL,                       -- Ex : CMD-2026-0001
    fournisseur_id INTEGER NOT NULL,
    statut TEXT NOT NULL DEFAULT 'en_attente'
      CHECK(statut IN ('en_attente', 'envoyee', 'recue', 'annulee')),
    montant_total REAL NOT NULL DEFAULT 0,
    notes TEXT,
    utilisateur_id INTEGER,
    utilisateur_nom TEXT,
    recu_par TEXT,
    date_commande TEXT DEFAULT (datetime('now')),
    date_reception TEXT,
    boutique_id INTEGER NOT NULL DEFAULT 1 REFERENCES boutiques(id),
    FOREIGN KEY (fournisseur_id) REFERENCES fournisseurs(id)
  );

  CREATE TABLE IF NOT EXISTS commande_lignes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    commande_id INTEGER NOT NULL,
    produit_id INTEGER NOT NULL,
    produit_nom TEXT NOT NULL,
    quantite INTEGER NOT NULL CHECK(quantite > 0),
    prix_unitaire REAL NOT NULL,
    sous_total REAL NOT NULL,
    FOREIGN KEY (commande_id) REFERENCES commandes(id) ON DELETE CASCADE,
    FOREIGN KEY (produit_id) REFERENCES produits(id)
  );
`);

// --- Index de performance (obligatoires avec le multi-boutiques) ---
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_produits_boutique ON produits(boutique_id);
  CREATE INDEX IF NOT EXISTS idx_produits_alerte ON produits(boutique_id, quantite);
  CREATE INDEX IF NOT EXISTS idx_ventes_date ON ventes(date_vente DESC);
  CREATE INDEX IF NOT EXISTS idx_ventes_boutique ON ventes(boutique_id, date_vente DESC);
  CREATE INDEX IF NOT EXISTS idx_vente_lignes ON vente_lignes(vente_id);
  CREATE INDEX IF NOT EXISTS idx_mouvements_boutique ON mouvements(boutique_id, date_mouvement DESC);
  CREATE INDEX IF NOT EXISTS idx_commandes_fournisseur ON commandes(fournisseur_id);
  CREATE INDEX IF NOT EXISTS idx_commandes_boutique ON commandes(boutique_id, statut);
  CREATE INDEX IF NOT EXISTS idx_commande_lignes ON commande_lignes(commande_id);
  CREATE INDEX IF NOT EXISTS idx_utilisateurs_boutique ON utilisateurs(boutique_id);
`);

// --- Migrations douces : ajoute une colonne seulement si elle manque ---
function ajouterColonneSiAbsente(table, colonne, definition) {
  const colonnes = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!colonnes.some((c) => c.name === colonne)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definition}`);
    console.log(`🧩 Migration : ${table}.${colonne} ajouté`);
  }
}

ajouterColonneSiAbsente('journal', 'motif', 'TEXT');
ajouterColonneSiAbsente('mouvements', 'utilisateur_id', 'INTEGER');
ajouterColonneSiAbsente('mouvements', 'utilisateur_nom', 'TEXT');
ajouterColonneSiAbsente('mouvements', 'utilisateur_role', 'TEXT');

ajouterColonneSiAbsente('ventes', 'boutique_id', 'INTEGER NOT NULL DEFAULT 1');
ajouterColonneSiAbsente('commandes', 'boutique_id', 'INTEGER NOT NULL DEFAULT 1');
ajouterColonneSiAbsente('mouvements', 'boutique_id', 'INTEGER NOT NULL DEFAULT 1');
ajouterColonneSiAbsente('journal', 'boutique_id', 'INTEGER NOT NULL DEFAULT 1');

// GARDE-FOU : la contrainte UNIQUE(code_barre, boutique_id) ne peut pas
// s'ajouter par ALTER. Une base héritée (restaurée d'une ancienne sauvegarde)
// serait refusée explicitement plutôt que de tourner sans isolation fiable.
const colonnesProduits = db.prepare('PRAGMA table_info(produits)').all();
if (!colonnesProduits.some((c) => c.name === 'boutique_id')) {
  console.error(
    '\n⛔ BASE HÉRITÉE DÉTECTÉE (stock.db sans boutique_id).\n' +
      '   La contrainte UNIQUE(code_barre, boutique_id) ne peut pas s’ajouter en place.\n' +
      '   → Supprimez stock.db pour repartir d’une base vierge (les sauvegardes sont\n' +
      '     conservées dans backend/sauvegardes/), ou migrez la table produits manuellement.\n'
  );
  process.exit(1);
}

// Rattrapage : les mouvements enregistrés AVANT l'ajout du rôle
db.prepare(`
  UPDATE mouvements
  SET utilisateur_role = (
    SELECT u.role FROM utilisateurs u WHERE u.id = mouvements.utilisateur_id
  )
  WHERE utilisateur_role IS NULL AND utilisateur_id IS NOT NULL
`).run();

// --- Données initiales (base vierge uniquement) ---
const bcrypt = require('bcryptjs');

// 1) La boutique de démarrage (son code sert de suffixe aux tickets)
if (db.prepare('SELECT COUNT(*) AS n FROM boutiques').get().n === 0) {
  db.prepare('INSERT INTO boutiques (nom, code, adresse, telephone) VALUES (?, ?, ?, ?)')
    .run('Magasin principal', 'MP', 'Quartier central', '');
  console.log('🏪 Boutique de démarrage créée (code ticket : MP)');
}

// 2) Les comptes : admin du réseau, gérant et caissier de la boutique
if (db.prepare('SELECT COUNT(*) AS n FROM utilisateurs').get().n === 0) {
  const inserer = db.prepare(
    'INSERT INTO utilisateurs (nom, email, mot_de_passe, role, boutique_id) VALUES (?, ?, ?, ?, ?)'
  );
  // hashSync = chiffrement du mot de passe (coût 10 = standard de sécurité)
  // admin → boutique_id NULL = accès à tout le réseau
  inserer.run('Administrateur', 'admin@magasin.fr', bcrypt.hashSync('admin123', 10), 'admin', null);
  inserer.run('Karim Kouassi', 'gerant@magasin.fr', bcrypt.hashSync('gerant123', 10), 'gerant', 1);
  inserer.run('Awa Diallo', 'awa@magasin.fr', bcrypt.hashSync('employe123', 10), 'employe', 1);
  console.log('👤 Comptes créés : admin@magasin.fr / gerant@magasin.fr / awa@magasin.fr');
}

// 3) Produits de démonstration (fiche propre à la boutique 1)
if (db.prepare('SELECT COUNT(*) AS n FROM produits').get().n === 0) {
  const produit = db.prepare(`
    INSERT INTO produits (nom, categorie, prix_achat, prix_vente, quantite, seuil_alerte, code_barre, boutique_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);
  produit.run('Eau minérale 1L', 'Boissons', 0.30, 0.55, 102, 10, '6001240100011');
  produit.run('Pain de mie', 'Boulangerie', 0.60, 1.00, 40, 8, '6001240100028');
  produit.run('Yaourt nature', 'Frais', 0.40, 0.75, 60, 10, '6001240100035');
  produit.run('Riz blanc 1kg', 'Épicerie', 0.70, 1.20, 80, 10, '6001240100042');
  console.log('🛒 4 produits de démonstration créés (boutique : Magasin principal)');
}

module.exports = db;