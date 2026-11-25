// ============================================================
// TESTS D'INTÉGRATION — SÉCURITÉ (mode strict)
//
// Couvre les comportements ajoutés pour la mise en production :
//   • 404 JSON sur une route /api inconnue
//   • mots de passe de DÉMONSTRATION refusés (création,
//     réinitialisation, changement)
//   • changement de mot de passe OBLIGATOIRE à la première connexion
//   • session EXPIRÉE → 401 (déclencheur de la redirection frontend)
//
// Aucun serveur n'est nécessaire : ce script démarre SA PROPRE instance
// sur une COPIE TEMPORAIRE du backend, avec une base VIERGE. La base
// réelle (stock.db) et les sauvegardes ne sont jamais touchées, et le
// dossier temporaire est supprimé à la fin.
//
// Lancement :  node tests/integration-securite.js
// Sortie :     code 0 si tout passe, code 1 sinon
// ============================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

let BASE = '';
let ok = 0;
let ko = 0;

const verifie = (label, condition, detail = '') => {
  if (condition) { ok++; console.log(`  ✅ ${label}`); }
  else { ko++; console.log(`  ❌ ${label} ${detail}`); }
};

async function requete(url, options = {}) {
  const r = await fetch(`${BASE}${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...options.headers },
  });
  const corps = await r.json().catch(() => null);
  if (r.status === 429) {
    throw new Error(`Limiteur de débit atteint sur ${options.method || 'GET'} ${url}`);
  }
  return {
    statut: r.status,
    corps,
    cookie: r.headers.get('set-cookie') || '',
    typeContenu: r.headers.get('content-type') || '',
    cacheControl: r.headers.get('cache-control') || '',
  };
}

const J = (cookie) => ({ Cookie: String(cookie).split(';')[0] });

// --- Un port libre, choisi par le système (jamais 5000) ---
function portLibre() {
  return new Promise((resolve, reject) => {
    const serveur = net.createServer();
    serveur.once('error', reject);
    serveur.listen(0, '127.0.0.1', () => {
      const { port } = serveur.address();
      serveur.close(() => resolve(port));
    });
  });
}

// --- Prépare une copie jetable du backend (sans données réelles) ---
function copierBackend() {
  const racine = path.join(__dirname, '..');
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-securite-'));
  // On ne copie ni les dépendances (résolues par NODE_PATH), ni la base
  // réelle, ni les sauvegardes, ni le .env de la machine.
  const exclus = new Set(['node_modules', 'stock.db', 'sauvegardes', 'tests', '.env']);

  fs.cpSync(racine, dossier, {
    recursive: true,
    filter: (source) => {
      const relatif = path.relative(racine, source);
      if (!relatif) return true;
      if (exclus.has(relatif.split(path.sep)[0])) return false;
      return !/\.(log|pid)$/i.test(relatif);
    },
  });

  return { racine, dossier };
}

// --- Démarre le serveur strict et attend qu'il réponde vraiment ---
async function demarrerServeur(envSupplementaire = {}) {
  const { racine, dossier } = copierBackend();
  const port = await portLibre();

  const enfant = spawn(process.execPath, [path.join(dossier, 'server.js')], {
    cwd: dossier, // stock.db et sauvegardes/ resteront dans le dossier jetable
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      COMPTES_DEMO: 'true',     // comptes de démonstration présents…
      SECURITE_STRICTE: 'true', // …mais soumis aux règles de production
      COOKIE_SECURE: 'false',   // test en HTTP local
      NODE_PATH: path.join(racine, 'node_modules'),
      ...envSupplementaire,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let journal = '';
  enfant.stdout.on('data', (d) => { journal += d; });
  enfant.stderr.on('data', (d) => { journal += d; });

  const origine = `http://127.0.0.1:${port}`;
  const limite = Date.now() + 20000;

  while (Date.now() < limite) {
    if (enfant.exitCode !== null) {
      throw new Error(`Le serveur de test s'est arrêté (code ${enfant.exitCode}).\n${journal}`);
    }
    try {
      // On annonce une requête HTTPS : sur une instance qui force HTTPS
      // derrière un proxy de confiance, la sonde serait sinon redirigée.
      // Sur une instance normale (sans TRUST_PROXY), l'en-tête est ignoré.
      const r = await fetch(`${origine}/api/sante`, {
        headers: { 'X-Forwarded-Proto': 'https' },
      });
      if (r.ok) {
        return {
          origine,
          dossier,
          arreter: async () => {
            if (enfant.exitCode === null) {
              const fin = new Promise((resolve) => enfant.once('exit', resolve));
              enfant.kill();
              await Promise.race([fin, new Promise((r) => setTimeout(r, 3000))]);
            }
            try { fs.rmSync(dossier, { recursive: true, force: true }); }
            catch { /* fichier encore verrouillé : le système nettoiera */ }
          },
        };
      }
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 150));
  }

  enfant.kill();
  throw new Error(`Le serveur de test n'a pas répondu en 20 s.\n${journal}`);
}

// --- Modifie directement la base jetable (expiration / purge) ---
function avecBase(dossier, action) {
  const base = new DatabaseSync(path.join(dossier, 'stock.db'));
  try { action(base); } finally { base.close(); }
}

(async () => {
  const serveur = await demarrerServeur();
  BASE = `${serveur.origine}/api`;
  console.log(`\n🧪 Serveur de test strict démarré sur ${serveur.origine} (base jetable)`);

  try {
    // ============================================================
    console.log('\n===== 1. CONFIGURATION PUBLIQUE =====');
    // ============================================================
    const configPublique = await requete('/config');
    verifie('GET /api/config accessible sans connexion (200)', configPublique.statut === 200,
      `→ ${configPublique.statut}`);
    verifie('Sécurité stricte annoncée au frontend', configPublique.corps?.securite_stricte === true,
      JSON.stringify(configPublique.corps));
    verifie('Réglage non mis en cache (no-store)', configPublique.cacheControl.includes('no-store'),
      configPublique.cacheControl);

    // ============================================================
    console.log('\n===== 2. ROUTE /api INCONNUE → 404 JSON =====');
    // ============================================================
    const inconnue = await requete('/route-qui-nexiste-pas');
    verifie('Route inconnue : statut 404', inconnue.statut === 404, `→ ${inconnue.statut}`);
    verifie('Route inconnue : réponse JSON (pas de HTML Express)',
      inconnue.typeContenu.includes('application/json'), inconnue.typeContenu);
    verifie('Route inconnue : message français', typeof inconnue.corps?.erreur === 'string',
      JSON.stringify(inconnue.corps));
    verifie('Route inconnue : chemin renvoyé', inconnue.corps?.chemin === '/api/route-qui-nexiste-pas',
      inconnue.corps?.chemin);

    const racineApi = await requete('');
    verifie('GET /api (sans chemin) : 404 JSON', racineApi.statut === 404 &&
      racineApi.typeContenu.includes('application/json'), `→ ${racineApi.statut}`);

    // ============================================================
    console.log('\n===== 3. CHANGEMENT OBLIGATOIRE (compte de démo) =====');
    // ============================================================
    const adminDemo = await requete('/auth/connexion', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@magasin.fr', mot_de_passe: 'admin123' }),
    });
    verifie('Connexion admin de démonstration acceptée (200)', adminDemo.statut === 200,
      `→ ${adminDemo.statut} ${JSON.stringify(adminDemo.corps)}`);
    verifie('Changement obligatoire annoncé dès la connexion',
      adminDemo.corps?.changement_obligatoire === true, JSON.stringify(adminDemo.corps));
    const AD = J(adminDemo.cookie);

    const bloque = await requete('/produits', { headers: AD });
    verifie('Route métier bloquée (403)', bloque.statut === 403, `→ ${bloque.statut}`);
    verifie('Code CHANGEMENT_MOT_DE_PASSE_REQUIS renvoyé',
      bloque.corps?.code === 'CHANGEMENT_MOT_DE_PASSE_REQUIS', JSON.stringify(bloque.corps));

    const moiBloque = await requete('/auth/moi', { headers: AD });
    verifie('/auth/moi reste accessible (non enfermé)', moiBloque.statut === 200 &&
      moiBloque.corps?.changement_obligatoire === true,
      `→ ${moiBloque.statut} ${JSON.stringify(moiBloque.corps)}`);

    const deconnexionAutorisee = await requete('/auth/deconnexion', { method: 'POST', headers: AD });
    verifie('/auth/deconnexion reste accessible', deconnexionAutorisee.statut === 200,
      `→ ${deconnexionAutorisee.statut}`);

    const adminReconnecte = await requete('/auth/connexion', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@magasin.fr', mot_de_passe: 'admin123' }),
    });
    const AD2 = J(adminReconnecte.cookie);

    // ============================================================
    console.log('\n===== 4. MOTS DE PASSE DE DÉMONSTRATION REFUSÉS =====');
    // ============================================================
    const changeEnDemo = await requete('/auth/mot-de-passe', {
      method: 'PUT', headers: AD2,
      body: JSON.stringify({
        ancien_mot_de_passe: 'admin123',
        nouveau_mot_de_passe: 'gerant123',
        confirmation: 'gerant123',
      }),
    });
    verifie('Changement vers un mot de passe de démo refusé (400)', changeEnDemo.statut === 400,
      `→ ${changeEnDemo.statut} ${JSON.stringify(changeEnDemo.corps)}`);
    verifie('Le refus explique le caractère public du mot de passe',
      /démonstration/i.test(changeEnDemo.corps?.erreur || ''), changeEnDemo.corps?.erreur);

    const changeValide = await requete('/auth/mot-de-passe', {
      method: 'PUT', headers: AD2,
      body: JSON.stringify({
        ancien_mot_de_passe: 'admin123',
        nouveau_mot_de_passe: 'AdminFort2026!',
        confirmation: 'AdminFort2026!',
      }),
    });
    verifie('Changement vers un mot de passe robuste accepté (200)', changeValide.statut === 200,
      `→ ${changeValide.statut} ${JSON.stringify(changeValide.corps)}`);
    verifie('Changement obligatoire levé', changeValide.corps?.changement_obligatoire === false,
      JSON.stringify(changeValide.corps));

    const produitsDebloques = await requete('/produits', { headers: AD2 });
    verifie('Routes métier de nouveau accessibles (200)', produitsDebloques.statut === 200,
      `→ ${produitsDebloques.statut}`);

    // Un sous-chemin inconnu d'un routeur protégé exige d'abord la connexion
    // (le middleware du routeur passe avant le garde-fou 404 JSON global).
    const sousCheminAnonyme = await requete('/produits/1/sous-chemin-inexistant');
    verifie('Sous-chemin protégé sans session : 401 avant tout traitement',
      sousCheminAnonyme.statut === 401, `→ ${sousCheminAnonyme.statut}`);
    const sousCheminConnecte = await requete('/produits/1/sous-chemin-inexistant', { headers: AD2 });
    verifie('Sous-chemin inconnu (connecté) : 404 JSON', sousCheminConnecte.statut === 404 &&
      sousCheminConnecte.typeContenu.includes('application/json'),
      `→ ${sousCheminConnecte.statut} ${sousCheminConnecte.typeContenu}`);

    const ancienDemoRefuse = await requete('/auth/connexion', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@magasin.fr', mot_de_passe: 'admin123' }),
    });
    verifie('Ancien mot de passe de démo plus valide (401)', ancienDemoRefuse.statut === 401,
      `→ ${ancienDemoRefuse.statut}`);

    // --- Création d'un compte avec un mot de passe public ---
    const creationDemo = await requete('/utilisateurs', {
      method: 'POST', headers: AD2,
      body: JSON.stringify({
        nom: 'Employé Sécurité',
        email: 'employe-securite@test.fr',
        mot_de_passe: 'employe123',
        role: 'employe',
        boutique_id: 1,
      }),
    });
    verifie('Création avec un mot de passe de démo refusée (400)', creationDemo.statut === 400,
      `→ ${creationDemo.statut} ${JSON.stringify(creationDemo.corps)}`);

    const creationValide = await requete('/utilisateurs', {
      method: 'POST', headers: AD2,
      body: JSON.stringify({
        nom: 'Employé Sécurité',
        email: 'employe-securite@test.fr',
        mot_de_passe: 'EmployeFort2026',
        role: 'employe',
        boutique_id: 1,
      }),
    });
    verifie('Création avec un mot de passe robuste acceptée (201)', creationValide.statut === 201,
      `→ ${creationValide.statut} ${JSON.stringify(creationValide.corps)}`);
    const compteId = creationValide.corps?.id;
    verifie('Compte créé marqué « à changer »', creationValide.corps?.mot_de_passe_a_changer === 1,
      `${creationValide.corps?.mot_de_passe_a_changer}`);

    // --- Réinitialisation par l'admin avec un mot de passe public ---
    const resetDemo = await requete(`/utilisateurs/${compteId}/mot-de-passe`, {
      method: 'PUT', headers: AD2,
      body: JSON.stringify({ mot_de_passe: 'admin123' }),
    });
    verifie('Réinitialisation vers un mot de passe de démo refusée (400)', resetDemo.statut === 400,
      `→ ${resetDemo.statut} ${JSON.stringify(resetDemo.corps)}`);

    const resetValide = await requete(`/utilisateurs/${compteId}/mot-de-passe`, {
      method: 'PUT', headers: AD2,
      body: JSON.stringify({ mot_de_passe: 'Provisoire2026' }),
    });
    verifie('Réinitialisation avec un mot de passe robuste acceptée (200)', resetValide.statut === 200,
      `→ ${resetValide.statut} ${JSON.stringify(resetValide.corps)}`);

    // ============================================================
    console.log('\n===== 4 bis. RÉINITIALISATION HORS PÉRIMÈTRE =====');
    // ============================================================
    // RÉGRESSION : un admin ne peut réinitialiser que le mot de passe
    // des comptes qui partagent AU MOINS une de ses boutiques. Sans ce
    // contrôle, il pouvait prendre la main sur un compte d'un autre
    // magasin (réinitialiser, puis se connecter à sa place).
    // Fixture : un admin rattaché à une seule boutique « Hors Portée »,
    // qui ne partage donc rien avec l'employé créé ci-dessus (boutique 1).
    const EMAIL_ADMIN_HORS_PORTEE = 'admin-hors-portee@test.fr';
    const MDP_ADMIN_HORS_PORTEE = 'HorsPortee2026!';
    avecBase(serveur.dossier, (base) => {
      const boutique = base
        .prepare(
          `INSERT INTO boutiques (nom, code, ville, quartier)
           VALUES ('Boutique Hors Portée (test)', 'HORS', 'Abidjan', 'Zone industrielle')`
        )
        .run();
      const admin = base
        .prepare(
          `INSERT INTO utilisateurs (nom, email, mot_de_passe, role, boutique_id, actif, mot_de_passe_a_changer)
           VALUES ('Admin Hors Portée', ?, ?, 'admin', NULL, 1, 0)`
        )
        .run(EMAIL_ADMIN_HORS_PORTEE, bcrypt.hashSync(MDP_ADMIN_HORS_PORTEE, 10));
      base
        .prepare('INSERT INTO acces_boutiques (utilisateur_id, boutique_id) VALUES (?, ?)')
        .run(Number(admin.lastInsertRowid), Number(boutique.lastInsertRowid));
    });

    const connexionHorsPortee = await requete('/auth/connexion', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL_ADMIN_HORS_PORTEE, mot_de_passe: MDP_ADMIN_HORS_PORTEE }),
    });
    verifie('Connexion de l’admin hors périmètre (200)', connexionHorsPortee.statut === 200,
      `→ ${connexionHorsPortee.statut} ${JSON.stringify(connexionHorsPortee.corps)}`);
    const HP = J(connexionHorsPortee.cookie);

    const resetHorsPortee = await requete(`/utilisateurs/${compteId}/mot-de-passe`, {
      method: 'PUT', headers: HP,
      body: JSON.stringify({ mot_de_passe: 'PirateHorsPortee2026' }),
    });
    verifie('Admin hors périmètre : réinitialisation REFUSÉE (404)',
      resetHorsPortee.statut === 404,
      `→ ${resetHorsPortee.statut} ${JSON.stringify(resetHorsPortee.corps)}`);

    const victimeIntacte = await requete('/auth/connexion', {
      method: 'POST',
      body: JSON.stringify({ email: 'employe-securite@test.fr', mot_de_passe: 'Provisoire2026' }),
    });
    verifie('Mot de passe de la victime INCHANGÉ (connexion initiale toujours valide)',
      victimeIntacte.statut === 200, `→ ${victimeIntacte.statut}`);

    const pirateRefuse = await requete('/auth/connexion', {
      method: 'POST',
      body: JSON.stringify({ email: 'employe-securite@test.fr', mot_de_passe: 'PirateHorsPortee2026' }),
    });
    verifie('Mot de passe imposé hors périmètre JAMAIS appliqué (401)',
      pirateRefuse.statut === 401, `→ ${pirateRefuse.statut}`);

    // ============================================================
    console.log('\n===== 5. PREMIÈRE CONNEXION DU COMPTE CRÉÉ =====');
    // ============================================================
    const premierLogin = await requete('/auth/connexion', {
      method: 'POST',
      body: JSON.stringify({ email: 'employe-securite@test.fr', mot_de_passe: 'Provisoire2026' }),
    });
    verifie('Connexion au mot de passe provisoire (200)', premierLogin.statut === 200,
      `→ ${premierLogin.statut} ${JSON.stringify(premierLogin.corps)}`);
    verifie('Changement obligatoire à la première connexion',
      premierLogin.corps?.changement_obligatoire === true, JSON.stringify(premierLogin.corps));
    const EMP = J(premierLogin.cookie);

    const empBloque = await requete('/produits', { headers: EMP });
    verifie('Compte provisoire bloqué sur le stock (403)', empBloque.statut === 403,
      `→ ${empBloque.statut}`);

    const empChangeEnDemo = await requete('/auth/mot-de-passe', {
      method: 'PUT', headers: EMP,
      body: JSON.stringify({
        ancien_mot_de_passe: 'Provisoire2026',
        nouveau_mot_de_passe: 'admin123',
        confirmation: 'admin123',
      }),
    });
    verifie('Changement volontaire vers un mot de passe de démo refusé (400)',
      empChangeEnDemo.statut === 400, `→ ${empChangeEnDemo.statut}`);

    const empChangeValide = await requete('/auth/mot-de-passe', {
      method: 'PUT', headers: EMP,
      body: JSON.stringify({
        ancien_mot_de_passe: 'Provisoire2026',
        nouveau_mot_de_passe: 'Definitif2026!',
        confirmation: 'Definitif2026!',
      }),
    });
    verifie('Changement volontaire accepté (200)', empChangeValide.statut === 200,
      `→ ${empChangeValide.statut} ${JSON.stringify(empChangeValide.corps)}`);

    const empDebloque = await requete('/produits', { headers: EMP });
    verifie('Session courante conservée et débloquée (200)', empDebloque.statut === 200,
      `→ ${empDebloque.statut}`);

    const provisoireRefuse = await requete('/auth/connexion', {
      method: 'POST',
      body: JSON.stringify({ email: 'employe-securite@test.fr', mot_de_passe: 'Provisoire2026' }),
    });
    verifie('Mot de passe provisoire plus valide (401)', provisoireRefuse.statut === 401,
      `→ ${provisoireRefuse.statut}`);

    // ============================================================
    console.log('\n===== 6. SESSION EXPIRÉE =====');
    // ============================================================
    const adminFinal = await requete('/auth/connexion', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@magasin.fr', mot_de_passe: 'AdminFort2026!' }),
    });
    verifie('Connexion admin avec le nouveau mot de passe (200)', adminFinal.statut === 200,
      `→ ${adminFinal.statut}`);
    const AF = J(adminFinal.cookie);

    const avantExpiration = await requete('/produits', { headers: AF });
    verifie('Session valide : stock accessible (200)', avantExpiration.statut === 200,
      `→ ${avantExpiration.statut}`);

    // La session existe toujours en base, mais sa date est dépassée :
    // c'est exactement ce qui se passe 24 h après la connexion.
    avecBase(serveur.dossier, (base) => {
      base.prepare("UPDATE sessions SET date_expiration = datetime('now', '-1 hour')").run();
    });

    const apresExpiration = await requete('/produits', { headers: AF });
    verifie('Session expirée : 401 (déclencheur de la redirection frontend)',
      apresExpiration.statut === 401, `→ ${apresExpiration.statut}`);
    verifie('Session expirée : message français', /authentification requise/i.test(apresExpiration.corps?.erreur || ''),
      apresExpiration.corps?.erreur);

    const moiExpire = await requete('/auth/moi', { headers: AF });
    verifie('Session expirée : /auth/moi renvoie 401', moiExpire.statut === 401,
      `→ ${moiExpire.statut}`);

    const reconnexion = await requete('/auth/connexion', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@magasin.fr', mot_de_passe: 'AdminFort2026!' }),
    });
    verifie('Reconnexion immédiate possible (200)', reconnexion.statut === 200,
      `→ ${reconnexion.statut}`);
    const AR = J(reconnexion.cookie);

    // Purge : la session retirée de la table (nettoyage horaire) → 401 aussi
    avecBase(serveur.dossier, (base) => {
      base.prepare('DELETE FROM sessions').run();
    });

    const apresPurge = await requete('/produits', { headers: AR });
    verifie('Session purgée : 401', apresPurge.statut === 401, `→ ${apresPurge.statut}`);

    const derniere = await requete('/auth/connexion', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@magasin.fr', mot_de_passe: 'AdminFort2026!' }),
    });
    verifie('Connexion possible après purge (200)', derniere.statut === 200, `→ ${derniere.statut}`);

    const stockFinal = await requete('/produits', { headers: J(derniere.cookie) });
    verifie('Nouvelle session opérationnelle (200)', stockFinal.statut === 200,
      `→ ${stockFinal.statut}`);

    // ============================================================
    console.log('\n===== 7. HTTPS OBLIGATOIRE =====');
    // ============================================================
    // Deuxième instance : HTTPS imposé, derrière un proxy de confiance
    // (TRUST_PROXY=1), comme en production derrière Nginx/Caddy.
    const instanceHttps = await demarrerServeur({ FORCER_HTTPS: 'true', TRUST_PROXY: '1' });
    try {
      const sansSuivreRedirection = (url, entetes = {}, options = {}) =>
        fetch(`${instanceHttps.origine}${url}`, {
          ...options,
          redirect: 'manual',
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...entetes },
        });
      const port = instanceHttps.origine.split(':').pop();

      const redirection = await sansSuivreRedirection('/api/sante', { 'X-Forwarded-Proto': 'http' });
      verifie('Requête en clair : redirection 308', redirection.status === 308,
        `→ ${redirection.status}`);
      verifie('Redirection vers https:// (même hôte, même chemin)',
        redirection.headers.get('location') === `https://127.0.0.1:${port}/api/sante`,
        redirection.headers.get('location') || '');

      // 308 (et non 301/302) : un POST de connexion reste un POST
      const loginClair = await sansSuivreRedirection(
        '/api/auth/connexion',
        { 'X-Forwarded-Proto': 'http' },
        { method: 'POST', body: JSON.stringify({ email: 'admin@magasin.fr', mot_de_passe: 'admin123' }) }
      );
      verifie('Connexion en clair redirigée (308)', loginClair.status === 308, `→ ${loginClair.status}`);
      verifie('Aucune session créée avant le passage en HTTPS',
        !loginClair.headers.get('set-cookie'), loginClair.headers.get('set-cookie') || '');

      const direct = await sansSuivreRedirection('/api/sante');
      verifie('Connexion directe en clair : redirigée aussi', direct.status === 308,
        `→ ${direct.status}`);

      const securisee = await sansSuivreRedirection('/api/sante', { 'X-Forwarded-Proto': 'https' });
      verifie('Requête HTTPS (vue par le proxy) : servie (200)', securisee.status === 200,
        `→ ${securisee.status}`);
      verifie('En-tête HSTS envoyé (1 an)',
        /max-age=31536000/.test(securisee.headers.get('strict-transport-security') || ''),
        securisee.headers.get('strict-transport-security') || '');
    } finally {
      await instanceHttps.arreter();
    }
  } finally {
    await serveur.arreter();
    console.log('  🧹 serveur de test arrêté, base jetable supprimée');
  }

  console.log(`\n========== ${ok} réussis / ${ko} échoués (total ${ok + ko}) ==========`);
  process.exit(ko === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\n💥 Interruption des tests :', err.message);
  process.exit(1);
});
