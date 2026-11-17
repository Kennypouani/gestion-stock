// ============================================================
// MOTS DE PASSE DE DÉMONSTRATION — liste et détection
// Ces valeurs sont publiques (documentation, code source, README) :
// elles ne doivent JAMAIS servir sur une installation réelle.
// Un seul endroit les définit, pour que toutes les routes et le
// démarrage du serveur appliquent exactement la même règle.
// ============================================================

const bcrypt = require('bcryptjs');
const config = require('./config');

const MOTS_DE_PASSE_DEMO = [
  ...new Set(
    [
      'admin123',
      'gerant123',
      'employe123',
      // Valeurs éventuellement surchargées dans .env
      config.mdpDemo.admin,
      config.mdpDemo.gerant,
      config.mdpDemo.employe,
    ].filter(Boolean)
  ),
];

// true si la valeur soumise est un mot de passe de démonstration
function estMotDePasseDemo(valeur) {
  if (valeur === undefined || valeur === null) return false;
  return MOTS_DE_PASSE_DEMO.includes(String(valeur));
}

// Renvoie le mot de passe de démonstration correspondant au HACHAGE,
// ou null. Sert à repérer les comptes qui en utilisent encore un,
// sans jamais connaître le mot de passe en clair.
function estHashDemo(hachage) {
  if (!hachage) return null;
  for (const motDePasse of MOTS_DE_PASSE_DEMO) {
    try {
      if (bcrypt.compareSync(motDePasse, hachage)) return motDePasse;
    } catch {
      return null; // Hachage illisible : on ne conclut rien
    }
  }
  return null;
}

module.exports = { MOTS_DE_PASSE_DEMO, estMotDePasseDemo, estHashDemo };
