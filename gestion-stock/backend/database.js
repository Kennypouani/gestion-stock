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
const config = require('./config'); // Réglages lus dans l'environnement (.env)
const { estHashDemo } = require('./motsDePasse'); // Détection des mots de passe publics
const { reparerFournisseursCommandes } = require('./migrations'); // Corrections de données rejouables
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
    ville TEXT,
    quartier TEXT,
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

// Table ACCES_BOUTIQUES — quelles boutiques un compte peut ouvrir.
//   • Un compte « gérant » ou « employé » : UNE boutique.
//   • Un compte « admin » : UNE OU PLUSIEURS boutiques (jamais celles
//     des autres comptes). Un compte tout neuf n'a AUCUNE ligne :
//     il doit d'abord créer sa boutique.
db.exec(`
  CREATE TABLE IF NOT EXISTS acces_boutiques (
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    boutique_id INTEGER NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
    date_creation TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (utilisateur_id, boutique_id)
  );
  CREATE INDEX IF NOT EXISTS idx_acces_boutique ON acces_boutiques(boutique_id);
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

// Table META — marqueurs de migration interne (ex : jetons hachés)
db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    cle TEXT PRIMARY KEY,
    valeur TEXT NOT NULL
  );
`);

// Les jetons de session sont désormais stockés HACHÉS (SHA-256).
// Les sessions créées avant ce changement contiennent le jeton en clair :
// on les invalide une seule fois, chacun se reconnecte.
const marqueurJetons = db.prepare("SELECT valeur FROM meta WHERE cle = 'jetons_haches'").get();
if (!marqueurJetons) {
  const supprimees = db.prepare('DELETE FROM sessions').run().changes;
  db.prepare("INSERT INTO meta (cle, valeur) VALUES ('jetons_haches', '1')").run();
  if (supprimees > 0) {
    console.log(`🔐 ${supprimees} session(s) invalidée(s) — les jetons sont maintenant hachés en base`);
  }
}

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

  -- FOURNISSEURS : répertoire PROPRE À CHAQUE BOUTIQUE
  -- (un compte ne voit et ne modifie que les fournisseurs de ses boutiques)
  CREATE TABLE IF NOT EXISTS fournisseurs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    contact_nom TEXT,
    email TEXT,
    telephone TEXT,
    adresse TEXT,
    actif INTEGER NOT NULL DEFAULT 1,
    date_creation TEXT DEFAULT (datetime('now')),
    boutique_id INTEGER NOT NULL DEFAULT 1 REFERENCES boutiques(id)
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

// Répertoire fournisseurs rattaché à une boutique (les lignes existantes
// restent sur la boutique 1, celle qui les utilisait jusqu'ici)
ajouterColonneSiAbsente('fournisseurs', 'boutique_id', 'INTEGER NOT NULL DEFAULT 1');
if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_fournisseurs_boutique'").get()) {
  db.exec('CREATE INDEX idx_fournisseurs_boutique ON fournisseurs(boutique_id)');
}

ajouterColonneSiAbsente('boutiques', 'ville', 'TEXT');
ajouterColonneSiAbsente('boutiques', 'quartier', 'TEXT');

// La colonne « adresse » a été remplacée par ville + quartier :
// on recopie l'ancienne valeur dans le quartier (si vide), puis on
// supprime la colonne devenue inutile. Les bases neuves n'en ont plus.
{
  const colonnesBoutiques = db.prepare('PRAGMA table_info(boutiques)').all();
  const aAdresse = colonnesBoutiques.some((c) => c.name === 'adresse');
  if (aAdresse) {
    db.prepare(`
      UPDATE boutiques
      SET quartier = adresse
      WHERE (quartier IS NULL OR TRIM(quartier) = '')
        AND adresse IS NOT NULL AND TRIM(adresse) <> ''
    `).run();
    try {
      db.exec('ALTER TABLE boutiques DROP COLUMN adresse');
      console.log('🧩 Migration : boutiques.adresse remplacé par ville / quartier');
    } catch (err) {
      console.warn('⚠️  Colonne boutiques.adresse conservée :', err.message);
    }
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
// Drapeau « doit changer son mot de passe » (1 = changement imposé)
ajouterColonneSiAbsente('utilisateurs', 'mot_de_passe_a_changer', 'INTEGER NOT NULL DEFAULT 0');

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

// --- Migration : fournisseur de commande rattaché à la BONNE boutique ---
// Le répertoire fournisseurs est devenu propre à chaque boutique après coup :
// d'anciennes commandes pointent donc encore vers le fournisseur d'un autre
// magasin (leur onglet Commandes ne pouvait plus les lire).
// Voir migrations.js → reparerFournisseursCommandes (couvert par
// tests/integration-migration-commandes.js).
try {
  const { corrigees, creees } = reparerFournisseursCommandes(db);
  if (corrigees > 0) {
    console.log(
      `🧩 Migration : ${corrigees} commande(s) rattachée(s) à un fournisseur de leur boutique` +
        (creees > 0 ? ` (${creees} fournisseur(s) créé(s))` : '')
    );
  }
} catch (err) {
  console.warn('⚠️  Rattachement des commandes à leur boutique ignoré :', err.message);
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
  db.prepare('INSERT INTO boutiques (nom, code, ville, quartier, telephone) VALUES (?, ?, ?, ?, ?)')
    .run('Magasin principal', 'MP', 'Abidjan', 'Quartier central', '');
  console.log('🏪 Boutique de démarrage créée (code ticket : MP)');
}

// 2) Les comptes initiaux
//    • hors production : admin + gérant + caissier de démonstration
//    • en production    : AUCUN mot de passe connu, uniquement le compte
//      administrateur fourni par ADMIN_EMAIL / ADMIN_MOT_DE_PASSE
if (db.prepare('SELECT COUNT(*) AS n FROM utilisateurs').get().n === 0) {
  const inserer = db.prepare(
    'INSERT INTO utilisateurs (nom, email, mot_de_passe, role, boutique_id) VALUES (?, ?, ?, ?, ?)'
  );
  // hashSync = hachage du mot de passe (coût 10 = standard de sécurité)
  // admin → boutique_id NULL = accès à tout le réseau

  if (config.comptesDemo) {
    inserer.run('Administrateur', 'admin@magasin.fr', bcrypt.hashSync(config.mdpDemo.admin, 10), 'admin', null);
    inserer.run('Karim Kouassi', 'gerant@magasin.fr', bcrypt.hashSync(config.mdpDemo.gerant, 10), 'gerant', 1);
    inserer.run('Awa Diallo', 'awa@magasin.fr', bcrypt.hashSync(config.mdpDemo.employe, 10), 'employe', 1);
    console.log('👤 Comptes de DÉMONSTRATION créés : admin@magasin.fr / gerant@magasin.fr / awa@magasin.fr');
  } else if (config.adminInitial.email && config.adminInitial.motDePasse) {
    if (config.adminInitial.motDePasse.length < 12) {
      console.error('\n⛔ ADMIN_MOT_DE_PASSE doit contenir au moins 12 caractères.\n');
      process.exit(1);
    }
    // Coût 12 pour le compte le plus puissant du réseau
    inserer.run(
      'Administrateur',
      config.adminInitial.email,
      bcrypt.hashSync(config.adminInitial.motDePasse, 12),
      'admin',
      null
    );
    console.log(`👤 Compte administrateur créé : ${config.adminInitial.email}`);
  } else {
    console.error(
      '\n⛔ AUCUN COMPTE EN BASE et les comptes de démonstration sont désactivés.\n' +
        '   Définissez ADMIN_EMAIL et ADMIN_MOT_DE_PASSE (12 caractères minimum)\n' +
        '   dans backend/.env, ou lancez avec COMPTES_DEMO=true pour un essai local.\n'
    );
    process.exit(1);
  }
}

// 2 bis) Reprise des rattachements EXISTANTS vers acces_boutiques
//   • gérant / employé → leur boutique
//   • admin historique (boutique_id NULL = tout le réseau) → toutes les
//     boutiques connues à cet instant, pour ne rien lui retirer.
//   Une seule exécution : les comptes créés ensuite par inscription
//   n'ont volontairement aucune boutique.
const marqueurAcces = db.prepare("SELECT valeur FROM meta WHERE cle = 'acces_boutiques_v1'").get();
if (!marqueurAcces) {
  db.prepare(`
    INSERT OR IGNORE INTO acces_boutiques (utilisateur_id, boutique_id)
    SELECT id, boutique_id FROM utilisateurs WHERE boutique_id IS NOT NULL
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO acces_boutiques (utilisateur_id, boutique_id)
    SELECT u.id, b.id FROM utilisateurs u CROSS JOIN boutiques b
    WHERE u.role = 'admin' AND u.boutique_id IS NULL
  `).run();
  db.prepare("INSERT INTO meta (cle, valeur) VALUES ('acces_boutiques_v1', '1')").run();
  console.log('🔗 Rattachements comptes ↔ boutiques migrés vers acces_boutiques');
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

// --- Garde-fou PRODUCTION : aucun mot de passe de démonstration ---
// Ces mots de passe sont publics (documentation, code source) : les laisser
// actifs sur un site accessible revient à publier un accès administrateur.
// En production, le serveur REFUSE de démarrer tant qu'ils n'ont pas été
// changés — même si la base a été créée il y a longtemps.
//
// Le drapeau mot_de_passe_a_changer est posé à CHAQUE démarrage, sur la base
// du hachage réellement enregistré : impossible de le contourner depuis le
// client. En sécurité stricte, la connexion suivante impose le changement.
function marquerMotsDePasseDemo() {
  const comptes = db
    .prepare('SELECT id, email, mot_de_passe, mot_de_passe_a_changer FROM utilisateurs')
    .all();
  const marques = [];

  for (const compte of comptes) {
    if (compte.mot_de_passe_a_changer === 1) continue; // Déjà signalé : inutile de refaire le calcul
    if (!estHashDemo(compte.mot_de_passe)) continue;
    db.prepare('UPDATE utilisateurs SET mot_de_passe_a_changer = 1 WHERE id = ?').run(compte.id);
    marques.push(compte.email);
  }

  if (marques.length > 0) {
    console.log(`🔒 Changement de mot de passe imposé au prochain login : ${marques.join(', ')}`);
  }
}

function verifierMotsDePasseDemo() {
  if (!config.estProduction) return; // En développement, ces comptes sont voulus

  const comptes = db.prepare('SELECT nom, email, mot_de_passe FROM utilisateurs').all();
  const fautifs = [];

  for (const compte of comptes) {
    const motDePasse = estHashDemo(compte.mot_de_passe);
    if (motDePasse) fautifs.push({ email: compte.email, nom: compte.nom, motDePasse });
  }

  if (fautifs.length === 0) return;

  console.error('\n⛔ ARRÊT : mots de passe de DÉMONSTRATION encore actifs en production.\n');
  for (const f of fautifs) {
    console.error(`   • ${f.email} (${f.nom}) → mot de passe « ${f.motDePasse} »`);
  }
  console.error(
    '\n   Ces mots de passe sont publics. Changez-les (écran Administration →\n' +
      '   Comptes, ou en développement), puis relancez le serveur.\n'
  );
  process.exit(1);
}

verifierMotsDePasseDemo();
marquerMotsDePasseDemo();

module.exports = db;