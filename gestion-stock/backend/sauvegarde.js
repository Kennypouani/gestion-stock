// ============================================================
// SAUVEGARDES
// 1. Copie SERVEUR de toute la base (VACUUM INTO), jamais exposée
//    par l'API : elle sert à l'exploitant du serveur, pas aux comptes.
// 2. Sauvegarde PAR COMPTE : un fichier JSON contenant UNIQUEMENT les
//    données des boutiques rattachées au compte demandeur (produits,
//    ventes, stock, commandes…). Aucun autre magasin n'y figure, et un
//    compte ne peut ni lister ni télécharger le fichier d'un autre.
// On garde les 7 sauvegardes les plus récentes par compte.
// ============================================================

const fs = require('fs');
const path = require('path');
const db = require('./database');

const DOSSIER = path.join(__dirname, 'sauvegardes');
const GARDEES = 7; // Nombre de copies conservées
let minuterie = null;

// Échappe les quotes simples pour une requête SQL littérale
const SQL = (chemin) => `'${chemin.replace(/'/g, "''")}'`;

// --- Crée une sauvegarde et renvoie sa description ---
function creerSauvegarde() {
  fs.mkdirSync(DOSSIER, { recursive: true });

  const horodatage = new Date()
    .toISOString()
    .replace('T', '-')
    .replace(/\..*$/, '')
    .replace(/:/g, '');
  const nom = `stock-${horodatage}.db`;
  const chemin = path.join(DOSSIER, nom);

  // VACUUM INTO = instantané complet et cohérent (jamais de fichier à moitié écrit)
  db.exec(`VACUUM INTO ${SQL(chemin)}`);

  nettoyer();
  return renvoyer(nom);
}

// --- Description d'un fichier de sauvegarde ---
function renvoyer(nom) {
  const chemin = path.join(DOSSIER, nom);
  const stats = fs.statSync(chemin);
  return {
    nom,
    taille: stats.size,                            // en octets
    taille_lisible: formatTaille(stats.size),
    date: stats.mtime.toISOString().slice(0, 19).replace('T', ' '),
  };
}

const formatTaille = (octets) => {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(1)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
};

// --- Liste les sauvegardes, de la plus récente à la plus ancienne ---
function lister() {
  if (!fs.existsSync(DOSSIER)) return [];
  return fs.readdirSync(DOSSIER)
    .filter((f) => /^stock-[\d\-]+\.db$/.test(f))
    .map(renvoyer)
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // tri descendant
}

// --- Ne garde que les N plus récentes ---
function nettoyer() {
  const anciennes = lister().slice(GARDEES);
  for (const sauvegarde of anciennes) {
    try {
      fs.unlinkSync(path.join(DOSSIER, sauvegarde.nom));
    } catch (err) {
      console.error('Nettoyage sauvegarde impossible :', err.message);
    }
  }
}

// --- Lancement de la sauvegarde automatique ---
// Une copie au démarrage, puis une par période de 24 heures
function demarrerAutomatique() {
  try {
    creerSauvegarde();
    console.log('💾 Sauvegarde automatique créée au démarrage');
  } catch (err) {
    console.error('Sauvegarde au démarrage impossible :', err.message);
  }

  minuterie = setInterval(() => {
    try {
      creerSauvegarde();
      console.log('💾 Sauvegarde automatique quotidienne créée');
    } catch (err) {
      console.error('Sauvegarde automatique impossible :', err.message);
    }
  }, 24 * 60 * 60 * 1000);

  minuterie.unref?.(); // Ne bloque pas l'arrêt du serveur
  return minuterie;
}

function arreter() {
  if (minuterie) clearInterval(minuterie);
}

// ============================================================
// SAUVEGARDES PAR COMPTE (limitées à SES boutiques)
// ============================================================

const NOM_COMPTE = /^boutiques-\d{4}-\d{2}-\d{2}-\d{6}\.json$/;

// Dossier privé du compte : c'est cette séparation qui empêche
// un administrateur de voir les fichiers d'un autre.
function dossierCompte(utilisateurId) {
  const id = parseInt(utilisateurId, 10);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Compte invalide');
  return path.join(DOSSIER, `compte-${id}`);
}

// Toutes les lignes d'une table pour les boutiques autorisées
function lignesDe(table, ids, colonne = 'boutique_id') {
  if (ids.length === 0) return [];
  const marques = ids.map(() => '?').join(', ');
  return db.prepare(`SELECT * FROM ${table} WHERE ${colonne} IN (${marques})`).all(...ids);
}

// Lignes filles rattachées à un ensemble d'identifiants parents
function lignesLiees(table, colonne, ids) {
  if (ids.length === 0) return [];
  const marques = ids.map(() => '?').join(', ');
  return db.prepare(`SELECT * FROM ${table} WHERE ${colonne} IN (${marques})`).all(...ids);
}

// Contenu complet, mais UNIQUEMENT pour ces boutiques
function contenuBoutiques(ids) {
  const boutiques = lignesDe('boutiques', ids, 'id');
  const produits = lignesDe('produits', ids);
  const mouvements = lignesDe('mouvements', ids);
  const ventes = lignesDe('ventes', ids);
  const commandes = lignesDe('commandes', ids);
  const journal = lignesDe('journal', ids);
  const fournisseurs = lignesDe('fournisseurs', ids);

  const venteLignes = lignesLiees('vente_lignes', 'vente_id', ventes.map((v) => v.id));
  const commandeLignes = lignesLiees(
    'commande_lignes',
    'commande_id',
    commandes.map((c) => c.id)
  );

  // Comptes rattachés à ces boutiques — SANS le mot de passe (même haché)
  const utilisateurs = ids.length === 0
    ? []
    : db
        .prepare(`
          SELECT u.id, u.nom, u.email, u.role, u.boutique_id, u.actif, u.date_creation
          FROM utilisateurs u
          WHERE u.id IN (SELECT utilisateur_id FROM acces_boutiques WHERE boutique_id IN (
            ${ids.map(() => '?').join(', ')}
          ))
          ORDER BY u.nom
        `)
        .all(...ids);

  return {
    version: 1,
    generee_le: new Date().toISOString(),
    boutiques,
    fournisseurs,
    produits,
    mouvements,
    ventes,
    vente_lignes: venteLignes,
    commandes,
    commande_lignes: commandeLignes,
    journal,
    utilisateurs,
  };
}

// --- Crée une sauvegarde JSON pour un compte et renvoie sa description ---
function creerSauvegardeCompte(utilisateurId, idsBoutiques) {
  const ids = (idsBoutiques || []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) {
    const err = new Error('Aucune boutique rattachée à ce compte');
    err.statut = 403;
    throw err;
  }

  const dossier = dossierCompte(utilisateurId);
  fs.mkdirSync(dossier, { recursive: true });

  const horodatage = new Date()
    .toISOString()
    .replace('T', '-')
    .replace(/\..*$/, '')
    .replace(/:/g, '');
  const nom = `boutiques-${horodatage}.json`;
  const chemin = path.join(dossier, nom);

  fs.writeFileSync(chemin, JSON.stringify(contenuBoutiques(ids), null, 2), 'utf8');

  nettoyerCompte(utilisateurId);
  return renvoyerCompte(utilisateurId, nom);
}

function renvoyerCompte(utilisateurId, nom) {
  const chemin = path.join(dossierCompte(utilisateurId), nom);
  const stats = fs.statSync(chemin);
  return {
    nom,
    taille: stats.size,
    taille_lisible: formatTaille(stats.size),
    date: stats.mtime.toISOString().slice(0, 19).replace('T', ' '),
    perimetre: 'boutiques du compte',
  };
}

function listerCompte(utilisateurId) {
  const dossier = dossierCompte(utilisateurId);
  if (!fs.existsSync(dossier)) return [];
  return fs
    .readdirSync(dossier)
    .filter((f) => NOM_COMPTE.test(f))
    .map((nom) => renvoyerCompte(utilisateurId, nom))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

// Chemin ABSOLU d'un fichier du compte, ou null si le nom est refusé
function cheminCompte(utilisateurId, nom) {
  if (!NOM_COMPTE.test(nom)) return null;
  const chemin = path.join(dossierCompte(utilisateurId), nom);
  return fs.existsSync(chemin) ? chemin : null;
}

function nettoyerCompte(utilisateurId) {
  const anciennes = listerCompte(utilisateurId).slice(GARDEES);
  for (const sauvegarde of anciennes) {
    try {
      fs.unlinkSync(path.join(dossierCompte(utilisateurId), sauvegarde.nom));
    } catch (err) {
      console.error('Nettoyage sauvegarde compte impossible :', err.message);
    }
  }
}

// ============================================================
// RESTAURATION D'UNE SAUVEGARDE JSON
// Le fichier ne peut toucher QUE les boutiques du compte : toute
// boutique étrangère présente dans le fichier fait échouer l'opération
// AVANT la moindre écriture. Les données actuelles de ces boutiques
// sont ensuite remplacées par celles du fichier.
// ============================================================
function restaurerCompte(idsBoutiques, contenu) {
  const ids = (idsBoutiques || []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  const erreur = (statut, message) => {
    const e = new Error(message);
    e.statut = statut;
    return e;
  };

  if (!contenu || typeof contenu !== 'object' || Array.isArray(contenu)) {
    throw erreur(400, 'Fichier de sauvegarde illisible');
  }

  const boutiques = Array.isArray(contenu.boutiques) ? contenu.boutiques : [];
  if (boutiques.length === 0) {
    throw erreur(400, 'Cette sauvegarde ne contient aucune boutique');
  }

  const idsFichier = boutiques.map((b) => Number(b.id)).filter((id) => Number.isInteger(id));
  const etrangeres = idsFichier.filter((id) => !ids.includes(id));
  if (etrangeres.length > 0) {
    throw erreur(
      403,
      `Cette sauvegarde contient une boutique qui n’est pas rattachée à votre compte (#${etrangeres.join(', #')})`
    );
  }

  const liste = (cle) => (Array.isArray(contenu[cle]) ? contenu[cle] : []);
  const fournisseurs = liste('fournisseurs');
  const produits = liste('produits');
  const mouvements = liste('mouvements');
  const ventes = liste('ventes');
  const venteLignes = liste('vente_lignes');
  const commandes = liste('commandes');
  const commandeLignes = liste('commande_lignes');
  const journal = liste('journal');

  const utilisateurExiste = (id) =>
    Number.isInteger(Number(id)) && !!db.prepare('SELECT 1 FROM utilisateurs WHERE id = ?').get(id);

  // Numéro unique : on suffixe en cas de collision avec une autre boutique
  const numeroLibre = (table, numero) => {
    let candidat = String(numero || '').trim() || 'SANS-NUMERO';
    let n = 1;
    while (db.prepare(`SELECT 1 FROM ${table} WHERE numero = ?`).get(candidat)) {
      candidat = `${numero}-R${n}`;
      n += 1;
    }
    return candidat;
  };

  const compte = {
    fournisseurs: 0,
    produits: 0,
    mouvements: 0,
    ventes: 0,
    commandes: 0,
    journal: 0,
    ignores: 0,
  };

  db.exec('BEGIN');
  try {
    // --- 1. On vide les boutiques concernées (remplacement, pas fusion) ---
    // DEUX PASSES : d'abord TOUTES les lignes dépendantes de toutes les
    // boutiques du fichier, ensuite les produits et fournisseurs.
    // Sinon une vieille commande d'une boutique du fichier encore liée à
    // un produit d'une AUTRE boutique du fichier bloque la suppression
    // (contrainte de clé étrangère).
    for (const id of idsFichier) {
      db.prepare('DELETE FROM journal WHERE boutique_id = ?').run(id);
      db.prepare('DELETE FROM mouvements WHERE boutique_id = ?').run(id);
      db.prepare(
        'DELETE FROM vente_lignes WHERE vente_id IN (SELECT id FROM ventes WHERE boutique_id = ?)'
      ).run(id);
      db.prepare('DELETE FROM ventes WHERE boutique_id = ?').run(id);
      db.prepare(
        'DELETE FROM commande_lignes WHERE commande_id IN (SELECT id FROM commandes WHERE boutique_id = ?)'
      ).run(id);
      db.prepare('DELETE FROM commandes WHERE boutique_id = ?').run(id);
    }
    for (const id of idsFichier) {
      db.prepare('DELETE FROM produits WHERE boutique_id = ?').run(id);
      db.prepare('DELETE FROM fournisseurs WHERE boutique_id = ?').run(id);
    }

    // --- 2. Fournisseurs (ids d'origine → nouveaux ids) ---
    const mapFournisseurs = new Map();
    const insererFournisseur = db.prepare(`
      INSERT INTO fournisseurs (nom, contact_nom, email, telephone, adresse, actif, date_creation, boutique_id)
      VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)
    `);
    for (const f of fournisseurs) {
      if (!idsFichier.includes(Number(f.boutique_id))) continue;
      const r = insererFournisseur.run(
        String(f.nom || 'Fournisseur').slice(0, 80),
        f.contact_nom ?? null,
        f.email ?? null,
        f.telephone ?? null,
        f.adresse ?? null,
        Number(f.actif) === 0 ? 0 : 1,
        f.date_creation ?? null,
        Number(f.boutique_id)
      );
      mapFournisseurs.set(Number(f.id), Number(r.lastInsertRowid));
      compte.fournisseurs += 1;
    }

    // --- 3. Produits ---
    const mapProduits = new Map();
    const insererProduit = db.prepare(`
      INSERT INTO produits (nom, categorie, prix_achat, prix_vente, quantite, seuil_alerte,
                             code_barre, date_expiration, date_creation, boutique_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)
    `);
    for (const p of produits) {
      if (!idsFichier.includes(Number(p.boutique_id))) continue;
      try {
        const r = insererProduit.run(
          String(p.nom || 'Produit').slice(0, 120),
          p.categorie ?? 'Divers',
          Number(p.prix_achat) || 0,
          Number(p.prix_vente) || 0,
          Number.isInteger(Number(p.quantite)) ? Number(p.quantite) : 0,
          Number.isInteger(Number(p.seuil_alerte)) ? Number(p.seuil_alerte) : 5,
          p.code_barre ?? null,
          p.date_expiration ?? null,
          p.date_creation ?? null,
          Number(p.boutique_id)
        );
        mapProduits.set(Number(p.id), Number(r.lastInsertRowid));
        compte.produits += 1;
      } catch {
        compte.ignores += 1; // code-barres déjà pris dans cette boutique
      }
    }

    // --- 4. Mouvements ---
    const insererMouvement = db.prepare(`
      INSERT INTO mouvements (produit_id, type, quantite, motif, date_mouvement,
                              utilisateur_id, utilisateur_nom, utilisateur_role, boutique_id)
      VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?)
    `);
    for (const m of mouvements) {
      if (!idsFichier.includes(Number(m.boutique_id))) continue;
      const produitId = mapProduits.get(Number(m.produit_id));
      if (!produitId) {
        compte.ignores += 1;
        continue;
      }
      insererMouvement.run(
        produitId,
        m.type === 'sortie' ? 'sortie' : 'entree',
        Number(m.quantite) || 0,
        m.motif ?? null,
        m.date_mouvement ?? null,
        utilisateurExiste(m.utilisateur_id) ? Number(m.utilisateur_id) : null,
        m.utilisateur_nom ?? null,
        m.utilisateur_role ?? null,
        Number(m.boutique_id)
      );
      compte.mouvements += 1;
    }

    // --- 5. Ventes et leurs lignes ---
    const mapVentes = new Map();
    const insererVente = db.prepare(`
      INSERT INTO ventes (numero, sous_total, remise, total, moyen_paiement, montant_verse,
                          monnaie_rendue, utilisateur_id, utilisateur_nom, date_vente, boutique_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)
    `);
    for (const v of ventes) {
      if (!idsFichier.includes(Number(v.boutique_id))) continue;
      const moyen = ['especes', 'carte', 'mobile'].includes(v.moyen_paiement)
        ? v.moyen_paiement
        : 'especes';
      const r = insererVente.run(
        numeroLibre('ventes', v.numero),
        Number(v.sous_total) || 0,
        Number(v.remise) || 0,
        Number(v.total) || 0,
        moyen,
        v.montant_verse ?? null,
        v.monnaie_rendue ?? null,
        utilisateurExiste(v.utilisateur_id) ? Number(v.utilisateur_id) : null,
        v.utilisateur_nom ?? null,
        v.date_vente ?? null,
        Number(v.boutique_id)
      );
      mapVentes.set(Number(v.id), Number(r.lastInsertRowid));
      compte.ventes += 1;
    }

    const insererVenteLigne = db.prepare(`
      INSERT INTO vente_lignes (vente_id, produit_id, produit_nom, quantite, prix_unitaire, sous_total)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const l of venteLignes) {
      const venteId = mapVentes.get(Number(l.vente_id));
      const produitId = mapProduits.get(Number(l.produit_id));
      if (!venteId || !produitId) {
        compte.ignores += 1;
        continue;
      }
      insererVenteLigne.run(
        venteId,
        produitId,
        String(l.produit_nom || 'Article').slice(0, 120),
        Number(l.quantite) || 1,
        Number(l.prix_unitaire) || 0,
        Number(l.sous_total) || 0
      );
    }

    // --- 6. Commandes et leurs lignes ---
    const mapCommandes = new Map();
    const insererCommande = db.prepare(`
      INSERT INTO commandes (numero, fournisseur_id, statut, montant_total, notes,
                             utilisateur_id, utilisateur_nom, recu_par,
                             date_commande, date_reception, boutique_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?)
    `);
    for (const c of commandes) {
      if (!idsFichier.includes(Number(c.boutique_id))) continue;
      const fournisseurId = mapFournisseurs.get(Number(c.fournisseur_id));
      if (!fournisseurId) {
        compte.ignores += 1; // commande sans fournisseur restauré
        continue;
      }
      const statut = ['en_attente', 'envoyee', 'recue', 'annulee'].includes(c.statut)
        ? c.statut
        : 'en_attente';
      const r = insererCommande.run(
        numeroLibre('commandes', c.numero),
        fournisseurId,
        statut,
        Number(c.montant_total) || 0,
        c.notes ?? null,
        utilisateurExiste(c.utilisateur_id) ? Number(c.utilisateur_id) : null,
        c.utilisateur_nom ?? null,
        c.recu_par ?? null,
        c.date_commande ?? null,
        c.date_reception ?? null,
        Number(c.boutique_id)
      );
      mapCommandes.set(Number(c.id), Number(r.lastInsertRowid));
      compte.commandes += 1;
    }

    const insererCommandeLigne = db.prepare(`
      INSERT INTO commande_lignes (commande_id, produit_id, produit_nom, quantite, prix_unitaire, sous_total)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const l of commandeLignes) {
      const commandeId = mapCommandes.get(Number(l.commande_id));
      const produitId = mapProduits.get(Number(l.produit_id));
      if (!commandeId || !produitId) {
        compte.ignores += 1;
        continue;
      }
      insererCommandeLigne.run(
        commandeId,
        produitId,
        String(l.produit_nom || 'Article').slice(0, 120),
        Number(l.quantite) || 1,
        Number(l.prix_unitaire) || 0,
        Number(l.sous_total) || 0
      );
    }

    // --- 7. Journal d'audit (traçabilité restaurée avec les données) ---
    const ACTIONS_JOURNAL = ['creation', 'modification', 'suppression', 'entree', 'sortie'];
    const insererJournal = db.prepare(`
      INSERT INTO journal (produit_id, produit_nom, utilisateur_id, utilisateur_nom,
                           utilisateur_role, action, champ, ancienne_valeur,
                           nouvelle_valeur, date_action, motif, boutique_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?)
    `);
    for (const j of journal) {
      if (!idsFichier.includes(Number(j.boutique_id))) continue;
      insererJournal.run(
        // Un produit restauré garde son lien ; sinon la ligne reste lisible
        mapProduits.get(Number(j.produit_id)) ?? null,
        String(j.produit_nom || '—').slice(0, 120),
        utilisateurExiste(j.utilisateur_id) ? Number(j.utilisateur_id) : null,
        String(j.utilisateur_nom || 'Restauration').slice(0, 80),
        j.utilisateur_role ?? null,
        ACTIONS_JOURNAL.includes(j.action) ? j.action : 'modification',
        j.champ ?? null,
        j.ancienne_valeur ?? null,
        j.nouvelle_valeur ?? null,
        j.date_action ?? null,
        j.motif ?? null,
        Number(j.boutique_id)
      );
      compte.journal += 1;
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return compte;
}

module.exports = {
  creerSauvegarde,
  lister,
  demarrerAutomatique,
  arreter,
  DOSSIER,
  creerSauvegardeCompte,
  listerCompte,
  cheminCompte,
  restaurerCompte,
  NOM_COMPTE,
};