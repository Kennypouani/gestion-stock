// ============================================================
// HARNAIS E2E — backend jetable + serveur Vite, sur des ports libres
//
// Les tests Playwright ne doivent JAMAIS toucher la base réelle :
//  • le backend est COPIÉ dans un dossier temporaire (sans stock.db,
//    sans sauvegardes/, sans .env) et démarré là-bas, avec les comptes
//    de démonstration et les 4 produits de départ ;
//  • Vite sert le frontend avec VITE_API_URL pointant sur cette copie ;
//  • tout est arrêté et supprimé à la fin de la suite.
//
// Aucun serveur déjà lancé par le développeur n'est utilisé ni arrêté :
// les ports sont choisis par le système au moment du test.
// ============================================================

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(ICI, '..');
const BACKEND = path.join(FRONTEND, '..', 'backend');

// --- Un port libre, choisi par le système ---
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

// --- Attend qu'une URL réponde vraiment (et, si demandé, contienne un texte) ---
async function attendre(url, { texte = null, limite = 30000, processus = null, journal = () => '' } = {}) {
  const fin = Date.now() + limite;
  while (Date.now() < fin) {
    if (processus && processus.exitCode !== null) {
      throw new Error(`Le processus s'est arrêté (code ${processus.exitCode}).\n${journal()}`);
    }
    try {
      const r = await fetch(url);
      if (r.ok) {
        const corps = await r.text();
        if (!texte || corps.includes(texte)) return;
      }
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Aucune réponse utilisable de ${url} en ${limite / 1000} s.\n${journal()}`);
}

// --- Copie jetable du backend (aucune donnée réelle) ---
function copierBackend() {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-e2e-'));
  const exclus = new Set(['node_modules', 'stock.db', 'sauvegardes', 'tests', '.env']);

  fs.cpSync(BACKEND, dossier, {
    recursive: true,
    filter: (source) => {
      const relatif = path.relative(BACKEND, source);
      if (!relatif) return true;
      if (exclus.has(relatif.split(path.sep)[0])) return false;
      return !/\.(log|pid)$/i.test(relatif);
    },
  });

  return dossier;
}

// --- Démarre l'API sur la copie temporaire ---
async function demarrerBackend(port, origineFrontend) {
  const dossier = copierBackend();

  const enfant = spawn(process.execPath, [path.join(dossier, 'server.js')], {
    cwd: dossier, // stock.db et sauvegardes/ restent dans le dossier jetable
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      ORIGINE_FRONTEND: origineFrontend, // CORS : seule cette origine est acceptée
      COMPTES_DEMO: 'true',              // admin@magasin.fr / admin123
      SECURITE_STRICTE: 'false',         // mot de passe de démo utilisable tel quel
      COOKIE_SECURE: 'false',            // test en HTTP local
      TRUST_PROXY: '',                   // pas de proxy devant le serveur de test
      FORCER_HTTPS: 'false',
      NODE_PATH: path.join(BACKEND, 'node_modules'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let journal = '';
  enfant.stdout.on('data', (d) => { journal += d; });
  enfant.stderr.on('data', (d) => { journal += d; });

  await attendre(`http://127.0.0.1:${port}/api/sante`, {
    processus: enfant,
    journal: () => journal,
  });

  return { enfant, dossier, journal: () => journal };
}

// --- Démarre Vite sur son propre port, API pointée sur la copie ---
async function demarrerFrontend(port, apiUrl) {
  const enfant = spawn(
    process.execPath,
    [path.join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host', '127.0.0.1',
      '--port', String(port),
      '--strictPort'],
    {
      cwd: FRONTEND,
      env: { ...process.env, VITE_API_URL: apiUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let journal = '';
  enfant.stdout.on('data', (d) => { journal += d; });
  enfant.stderr.on('data', (d) => { journal += d; });

  await attendre(`http://127.0.0.1:${port}/`, {
    texte: 'id="root"',
    processus: enfant,
    journal: () => journal,
  });

  return enfant;
}

// --- Arrêt propre puis nettoyage (Windows peut garder stock.db un instant) ---
async function arreter(en) {
  if (en.exitCode !== null) return;
  const fin = new Promise((resolve) => en.once('exit', resolve));
  en.kill();
  await Promise.race([fin, new Promise((r) => setTimeout(r, 5000))]);
}

function supprimer(dossier) {
  for (let essai = 0; essai < 3; essai++) {
    try {
      fs.rmSync(dossier, { recursive: true, force: true });
      return;
    } catch {
      // Un fichier peut être encore verrouillé : on retente brièvement.
      const fin = Date.now() + 300;
      while (Date.now() < fin) { /* attente bloquante courte */ }
    }
  }
}

// --- Point d'entrée utilisé par la suite Playwright ---
export async function demarrer() {
  const portApi = await portLibre();
  const portFront = await portLibre();
  const baseUrl = `http://127.0.0.1:${portFront}`;

  let api = null;
  let front = null;
  try {
    api = await demarrerBackend(portApi, baseUrl);
    front = await demarrerFrontend(portFront, `http://127.0.0.1:${portApi}/api`);
  } catch (err) {
    if (front) await arreter(front);
    if (api) { await arreter(api.enfant); supprimer(api.dossier); }
    throw err;
  }

  return {
    baseUrl,
    apiUrl: `http://127.0.0.1:${portApi}/api`,
    async arreter() {
      await arreter(front);
      await arreter(api.enfant);
      supprimer(api.dossier);
    },
  };
}
