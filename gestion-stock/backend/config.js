// ============================================================
// CONFIGURATION — tout ce qui dépend de l'environnement
// Les valeurs par défaut correspondent au développement local ;
// en production, chaque réglage est fourni par l'environnement.
//
// Aucune dépendance externe : Node sait lire un fichier .env
// (process.loadEnvFile, Node ≥ 21).
// ============================================================

const fs = require('fs');
const path = require('path');

// --- Lecture de backend/.env s'il existe (jamais versionné) ---
const CHEMIN_ENV = path.join(__dirname, '.env');
try {
  if (fs.existsSync(CHEMIN_ENV)) process.loadEnvFile(CHEMIN_ENV);
} catch (err) {
  console.warn('⚠️  Lecture de .env impossible :', err.message);
}

// --- Aides de lecture ---
const texte = (valeur) => (valeur === undefined ? '' : String(valeur).trim());

// Booléen tolérant : "1", "true", "oui", "yes" = vrai
function booleen(valeur, defaut) {
  const v = texte(valeur).toLowerCase();
  if (v === '') return defaut;
  if (['1', 'true', 'oui', 'yes'].includes(v)) return true;
  if (['0', 'false', 'non', 'no'].includes(v)) return false;
  return defaut;
}

// NODE_ENV : "production" active les réglages stricts
const environnement = texte(process.env.NODE_ENV).toLowerCase() || 'development';
const estProduction = environnement === 'production';

// Port d'écoute (5000 par défaut)
const portDemande = parseInt(process.env.PORT, 10);
const port = portDemande > 0 ? portDemande : 5000;

// Origine(s) autorisée(s) à appeler l'API (séparées par des virgules)
const originesFrontend = texte(process.env.ORIGINE_FRONTEND || 'http://localhost:3000')
  .split(',')
  .map((origine) => origine.trim())
  .filter(Boolean);

// Derrière un reverse proxy (Nginx, Caddy…), TRUST_PROXY = 1
// pour que le rate-limit voie la vraie IP du visiteur.
// Sans proxy, on laisse désactivé : sinon un client pourrait
// usurper son IP avec un en-tête X-Forwarded-For.
function lireTrustProxy(valeur) {
  const v = texte(valeur).toLowerCase();
  if (v === '' || v === '0' || v === 'false' || v === 'non') return false;
  if (v === 'true' || v === 'oui') return 1; // 1 saut = le proxy local
  const nombre = parseInt(v, 10);
  return Number.isInteger(nombre) && nombre > 0 ? nombre : false;
}
const trustProxy = lireTrustProxy(process.env.TRUST_PROXY);

// Cookie de session : Secure obligatoire en production (donc HTTPS).
// Peut être forcé à false le temps d'un test HTTP en local.
const cookieSecure = booleen(process.env.COOKIE_SECURE, estProduction);

// Comptes de démonstration (admin123 / gerant123 / employe123).
// Créés UNIQUEMENT hors production, sauf demande explicite.
const comptesDemo = booleen(process.env.COMPTES_DEMO, !estProduction);

// Sécurité stricte des mots de passe :
//   • refuse un mot de passe de démonstration à la création,
//     à la réinitialisation et au changement volontaire ;
//   • oblige les comptes qui en utilisent encore un à le changer
//     dès leur prochaine connexion.
// Active par défaut en production ; à forcer à la main (SECURITE_STRICTE=true)
// pour reproduire ce comportement en local.
const securiteStricte = booleen(process.env.SECURITE_STRICTE, estProduction);

// Mots de passe des comptes de démonstration (surchargables)
const mdpDemo = {
  admin: texte(process.env.MDP_DEMO_ADMIN) || 'admin123',
  gerant: texte(process.env.MDP_DEMO_GERANT) || 'gerant123',
  employe: texte(process.env.MDP_DEMO_EMPLOYE) || 'employe123',
};

// Premier administrateur, quand les comptes de démonstration sont désactivés
const adminInitial = {
  email: texte(process.env.ADMIN_EMAIL).toLowerCase(),
  motDePasse: texte(process.env.ADMIN_MOT_DE_PASSE),
};

// Garde-fous : signale les combinaisons incohérentes sans bloquer le démarrage
if (estProduction && !cookieSecure) {
  console.warn(
    '⚠️  COOKIE_SECURE=false en production : le cookie de session circulera en clair. ' +
      'À réserver à un test HTTP local.'
  );
}
if (estProduction && comptesDemo) {
  console.warn(
    '⚠️  COMPTES_DEMO=true en production : des mots de passe connus (admin123…) sont actifs. ' +
      'À désactiver dès que les vrais comptes existent.'
  );
}
if (estProduction && !securiteStricte) {
  console.warn(
    '⚠️  SECURITE_STRICTE=false en production : les mots de passe de démonstration restent autorisés.'
  );
}

module.exports = {
  environnement,
  estProduction,
  port,
  originesFrontend,
  trustProxy,
  cookieSecure,
  securiteStricte,
  comptesDemo,
  mdpDemo,
  adminInitial,
};
