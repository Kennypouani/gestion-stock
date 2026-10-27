// ============================================================
// SAUVEGARDES — Copie cohérente de la base de données
// Technique : « VACUUM INTO » produit un fichier SQLite propre
// et complet, même si le serveur est en train d'écrire.
// On garde les 7 sauvegardes les plus récentes.
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

module.exports = { creerSauvegarde, lister, demarrerAutomatique, arreter, DOSSIER };