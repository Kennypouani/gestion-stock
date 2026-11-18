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

module.exports = {
  creerSauvegarde,
  lister,
  demarrerAutomatique,
  arreter,
  DOSSIER,
  creerSauvegardeCompte,
  listerCompte,
  cheminCompte,
  NOM_COMPTE,
};