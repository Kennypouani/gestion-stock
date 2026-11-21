// ============================================================
// SUITE COMPLÈTE — une seule commande : npm test
//
// Enchaîne, dans l'ordre :
//   1. sécurité       (tests/integration-securite.js, serveur jetable)
//   2. migration      (tests/integration-migration-commandes.js, base jetable)
//   3. modules        (API sur localhost:5000)
//   4. isolation      (API sur localhost:5000)
//   5. E2E Playwright (lance ses propres serveurs sur des ports libres)
//
// Pour les étapes 3 et 4, le serveur est démarré ici s'il ne répond pas
// déjà : données dans un dossier temporaire (DOSSIER_DONNEES) avec les
// comptes de démonstration, puis arrêt et suppression à la fin. Si un
// serveur tourne déjà sur le port 5000, il est réutilisé tel quel et
// n'est pas arrêté.
//
// Le premier échec n'interrompt pas la suite : chaque étape s'exécute et
// le code de sortie final vaut 1 dès qu'une seule a échoué.
// ============================================================

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const BACKEND = path.join(RACINE, 'backend');
const FRONTEND = path.join(RACINE, 'frontend');
const SANTE = 'http://localhost:5000/api/sante';
// CLI Playwright appelé par node : lancer « npm.cmd » directement échoue
// sous Windows (EINVAL), et cette forme marche sur les deux systèmes.
const CLI_PLAYWRIGHT = path.join(FRONTEND, 'node_modules', '@playwright', 'test', 'cli.js');

const resultats = [];

// --- Lance une étape, mémorise son résultat, ne s'arrête jamais sur échec ---
function executer(nom, commande, args, options = {}) {
  console.log(`\n===== ${nom} =====`);
  const r = spawnSync(commande, args, { stdio: 'inherit', ...options });
  if (r.error) {
    console.log(`\n⛔ ${nom} : lancement impossible — ${r.error.message}`);
  }
  const reussi = r.status === 0;
  resultats.push({ nom, reussi, statut: r.status });
  if (!reussi) {
    console.log(`\n⛔ ${nom} : échec (code ${r.status === null ? 'inconnu' : r.status})`);
  }
  return reussi;
}

async function serveurRepond() {
  try {
    return (await fetch(SANTE)).ok;
  } catch {
    return false; // pas encore prêt, ou rien sur le port
  }
}

async function attendreServeur(processus, journal) {
  const fin = Date.now() + 30000;
  while (Date.now() < fin) {
    if (processus.exitCode !== null) {
      throw new Error(`Le serveur s'est arrêté (code ${processus.exitCode}).\n${journal()}`);
    }
    if (await serveurRepond()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Aucune réponse de ${SANTE} en 30 s.\n${journal()}`);
}

function arreter(enfant) {
  return new Promise((resolve) => {
    if (!enfant || enfant.exitCode !== null) return resolve();
    enfant.once('exit', resolve);
    enfant.kill();
    setTimeout(resolve, 5000); // Windows peut mettre un instant à libérer le port
  });
}

async function main() {
  // --- 1 et 2 : suites autonomes (elles gèrent leur propre base) ---
  executer('Sécurité', process.execPath, ['tests/integration-securite.js'], { cwd: BACKEND });
  executer('Migration des commandes', process.execPath, ['tests/integration-migration-commandes.js'], {
    cwd: BACKEND,
  });

  // --- 3 et 4 : suites d'intégration, API sur localhost:5000 ---
  const donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-test-'));
  let api = null;
  let journal = '';

  try {
    if (await serveurRepond()) {
      console.log('\nℹ️  Serveur déjà actif sur le port 5000 : réutilisation (les tests nettoient leurs données).');
    } else {
      console.log(`\n🚀 Démarrage du backend pour les tests (données : ${donnees})`);
      api = spawn(process.execPath, ['server.js'], {
        cwd: BACKEND,
        env: {
          ...process.env,
          PORT: '5000',
          NODE_ENV: 'development',
          DOSSIER_DONNEES: donnees, // base jetable, jamais backend/stock.db
          COMPTES_DEMO: 'true',
          SECURITE_STRICTE: 'false',
          COOKIE_SECURE: 'false',
          FORCER_HTTPS: 'false',
          TRUST_PROXY: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      api.stdout.on('data', (d) => { journal += d; });
      api.stderr.on('data', (d) => { journal += d; });
      await attendreServeur(api, () => journal);
      console.log('✅ Backend prêt');
    }

    executer('Modules (caisse, exports, fournisseurs, sauvegardes)', process.execPath, [
      'tests/integration-modules.js',
    ], { cwd: BACKEND });

    executer('Isolation multi-boutiques', process.execPath, ['tests/integration-isolation.js'], {
      cwd: BACKEND,
    });
  } catch (err) {
    console.log(`\n⛔ Backend de test indisponible : ${err.message}`);
    resultats.push({ nom: 'Backend de test', reussi: false, statut: null });
  } finally {
    if (api) {
      await arreter(api);
      console.log('🧹 Backend de test arrêté');
    }
    fs.rmSync(donnees, { recursive: true, force: true });
  }

  // --- 5 : parcours de bout en bout (serveurs jetables du harnais) ---
  executer('E2E Playwright', process.execPath, [CLI_PLAYWRIGHT, 'test'], { cwd: FRONTEND });

  // --- Bilan ---
  console.log('\n========== BILAN ==========');
  for (const { nom, reussi, statut } of resultats) {
    const code = statut === null ? '—' : statut;
    console.log(`  ${reussi ? '✅' : '❌'} ${nom} (code ${code})`);
  }
  const echecs = resultats.filter((r) => !r.reussi).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} étape(s) réussie(s)`);
  if (echecs > 0) {
    console.log('❌ Suite incomplète : voir les échecs ci-dessus.\n');
    process.exit(1);
  }
  console.log('✅ Tout est vert.\n');
}

main().catch((err) => {
  console.error('\n⛔ ', err.message);
  process.exit(1);
});
