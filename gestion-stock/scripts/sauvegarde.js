// ============================================================
// SAUVEGARDE COMPLÈTE — une seule commande : npm run sauvegarde
//
// Produit une archive .tar.gz datée contenant :
//   - le code du projet tel qu'il est sur le disque, modifications non
//     validées comprises, sans node_modules ni fichiers ignorés ;
//   - les données du backend : copie cohérente de la base SQLite, le
//     dossier sauvegardes/ et le .env local s'il existe ;
//   - un manifeste et la procédure de restauration, pour que l'archive
//     se suffise à elle-même sur une machine neuve.
//
// Usage :
//   npm run sauvegarde                        → ./sauvegardes-locales/
//   npm run sauvegarde -- --vers D:/Sauvegardes
//   DESTINATION_SAUVEGARDE=D:/Sauvegardes npm run sauvegarde
//
// Aucune dépendance : l'archive est écrite en TAR puis GZIP avec les
// modules natifs (node:zlib), et un fichier .sha256 l'accompagne.
// ============================================================

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { finished } = require('stream/promises');

const RACINE = path.join(__dirname, '..');
const BACKEND = path.join(RACINE, 'backend');
const BASE = path.join(BACKEND, 'stock.db');
const DOSSIER_SAUVEGARDES = path.join(BACKEND, 'sauvegardes');
const ENV = path.join(BACKEND, '.env');
const DESTINATION_DEFAUT = path.join(RACINE, 'sauvegardes-locales');

// Dossiers jamais inclus : dépendances, historique Git, build, sortie
const DOSSIERS_EXCLUS = ['node_modules', '.git', 'dist', 'sauvegardes-locales'];

// --- 1. Horodatage local lisible : 2026-11-25_143000 ---
function horodatage(date = new Date()) {
  const deux = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}` +
    `_${deux(date.getHours())}${deux(date.getMinutes())}${deux(date.getSeconds())}`
  );
}

// --- 2. Destination : --vers <dossier>, sinon variable, sinon défaut ---
function destinationDemandee(argv) {
  const i = argv.indexOf('--vers');
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  const parVariable = argv.find((a) => a.startsWith('--vers='));
  if (parVariable) return parVariable.slice('--vers='.length);
  return process.env.DESTINATION_SAUVEGARDE || DESTINATION_DEFAUT;
}

// --- 3. Liste du code : fichiers suivis + nouveaux, .gitignore respecté ---
// Renvoie des chemins relatifs à la racine du projet.
function fichiersDuCode() {
  // git -C <projet> renvoie des chemins déjà relatifs au projet
  const liste = spawnSync('git', ['-C', RACINE, 'ls-files', '-z', '-co', '--exclude-standard'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (liste.error || liste.status !== 0) return null;
  return liste.stdout.split('\0').filter(Boolean);
}

// Repli sans Git : parcours du disque, mêmes exclusions que .gitignore.
function parcourirDisque(dossier = RACINE, base = '') {
  const trouves = [];
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const relatif = base ? `${base}/${entree.name}` : entree.name;
    if (entree.isDirectory()) {
      if (DOSSIERS_EXCLUS.includes(entree.name)) continue;
      if (relatif === 'backend/sauvegardes') continue;
      trouves.push(...parcourirDisque(path.join(dossier, entree.name), relatif));
    } else if (entree.isFile()) {
      if (entree.name.endsWith('.log') || entree.name.endsWith('.pid')) continue;
      trouves.push(relatif);
    }
  }
  return trouves;
}

// Tous les fichiers d'un dossier, en chemins relatifs, triés.
function fichiersDe(dossier, base = '') {
  if (!fs.existsSync(dossier)) return [];
  const trouves = [];
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const relatif = base ? `${base}/${entree.name}` : entree.name;
    if (entree.isDirectory()) trouves.push(...fichiersDe(path.join(dossier, entree.name), relatif));
    else if (entree.isFile()) trouves.push(relatif);
  }
  return trouves.sort();
}

// --- 4. Copie cohérente de la base (fonctionne même serveur allumé) ---
async function instantaneBase(dossierTemporaire) {
  if (!fs.existsSync(BASE)) return null;
  const cible = path.join(dossierTemporaire, 'stock.db');
  const { DatabaseSync, backup } = require('node:sqlite');

  try {
    const source = new DatabaseSync(BASE, { readOnly: true });
    await backup(source, cible);
    source.close();
  } catch (err) {
    console.log(`⚠️  Copie directe de la base (${err.message})`);
    fs.copyFileSync(BASE, cible);
  }

  const copie = new DatabaseSync(cible, { readOnly: true });
  const etat = Object.values(copie.prepare('PRAGMA integrity_check').get())[0];
  copie.close();
  return { chemin: cible, integrite: etat, octets: fs.statSync(cible).size };
}

// --- 5. Écriture TAR (format ustar) puis GZIP ---
function enteteTar(nom, taille, mtimeMs) {
  const octets = Buffer.byteLength(nom);
  let court = nom;
  let prefixe = '';

  if (octets > 100) {
    // ustar : chemin coupé en préfixe (≤ 155) + nom (≤ 100), à un « / »
    let coupe = false;
    for (let i = nom.length - 1; i > 0; i--) {
      if (nom[i] !== '/') continue;
      const debut = nom.slice(0, i);
      const fin = nom.slice(i + 1);
      if (Buffer.byteLength(fin) <= 100 && Buffer.byteLength(debut) <= 155) {
        prefixe = debut;
        court = fin;
        coupe = true;
        break;
      }
    }
    if (!coupe) throw new Error(`Chemin trop long pour l'archive : ${nom}`);
  }

  const h = Buffer.alloc(512);
  h.write(court, 0, 100, 'utf8');
  h.write('0000644\0', 100, 8, 'utf8'); // droits
  h.write('0000000\0', 108, 8, 'utf8'); // uid
  h.write('0000000\0', 116, 8, 'utf8'); // gid
  h.write(`${taille.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
  h.write(`${Math.floor(mtimeMs / 1000).toString(8).padStart(11, '0')}\0`, 136, 12, 'utf8');
  h.write('        ', 148, 8, 'utf8'); // somme provisoire : espaces
  h.write('0', 156, 1, 'utf8'); // fichier normal
  h.write('ustar\0', 257, 6, 'utf8');
  h.write('00', 263, 2, 'utf8');
  h.write('root', 265, 32, 'utf8');
  h.write('root', 297, 32, 'utf8');
  if (prefixe) h.write(prefixe, 345, 155, 'utf8');

  let somme = 0;
  for (const o of h) somme += o;
  h.write(`${somme.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
  return h;
}

async function ecrireArchive(destination, entrees) {
  const sortie = fs.createWriteStream(destination);
  const gzip = zlib.createGzip({ level: 6 });
  let erreur = null;
  for (const flux of [sortie, gzip]) flux.on('error', (e) => { erreur = e; });
  gzip.pipe(sortie);

  const ecrire = (bloc) =>
    new Promise((resolve, reject) => {
      if (erreur) return reject(erreur);
      gzip.write(bloc, (e) => (e ? reject(e) : resolve()));
    });

  for (const entree of entrees) {
    const contenu = entree.contenu || null;
    const taille = contenu ? contenu.length : fs.statSync(entree.chemin).size;
    const mtime = contenu ? Date.now() : fs.statSync(entree.chemin).mtimeMs;

    await ecrire(enteteTar(entree.nom, taille, mtime));
    if (contenu) {
      await ecrire(contenu);
    } else {
      for await (const morceau of fs.createReadStream(entree.chemin)) await ecrire(morceau);
    }
    if (taille % 512) await ecrire(Buffer.alloc(512 - (taille % 512)));
  }

  await ecrire(Buffer.alloc(1024)); // fin d'archive
  gzip.end();
  await finished(sortie);
  if (erreur) throw erreur;
}

function sha256(chemin) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(chemin)
      .on('data', (bloc) => hash.update(bloc))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

// --- 6. Manifeste et mode d'emploi embarqués dans l'archive ---
function textesArchive(infos) {
  const manifeste = [
    'SAUVEGARDE GESTION-STOCK',
    `Créée le      : ${infos.date}`,
    `Machine       : ${os.hostname()} (${process.platform})`,
    `Commit Git    : ${infos.commit}`,
    `Base SQLite   : ${infos.base ? `intégrité ${infos.base.integrite}` : 'absente'}`,
    `Fichier .env  : ${infos.env ? 'inclus (donnees/backend/.env)' : 'absent sur cette machine'}`,
    `Fichiers      : ${infos.nombre} (+ manifeste et mode d'emploi)`,
    '',
    "L'arborescence reprend celle du projet :",
    '  code/                     → code source (backend, frontend, scripts, docs…)',
    '  donnees/backend/stock.db  → base SQLite',
    '  donnees/backend/sauvegardes/ → sauvegardes produites par l’application',
    '  donnees/backend/.env      → configuration locale (secrets), si présente',
    '',
    'Procédure de restauration : LISEZMOI-RESTAURATION.md, ou',
    'SAUVEGARDE-RESTAURATION.md dans le dépôt.',
    '',
  ].join('\n');

  const modeEmploi = [
    '# Restaurer cette sauvegarde sur une machine neuve',
    '',
    `Archive créée le ${infos.date} (commit ${infos.commit}).`,
    '',
    '## 1. Prérequis',
    '',
    '- Node.js 24 (voir `engines` dans package.json) et Git.',
    '',
    '## 2. Récupérer le code',
    '',
    '```bash',
    'git clone https://github.com/Kennypouani/gestion-stock.git',
    'cd gestion-stock/gestion-stock',
    '```',
    '',
    "Extrait de l'archive : la partie `code/` contient aussi les modifications",
    'non validées au moment de la sauvegarde.',
    '',
    '## 3. Remettre les données',
    '',
    "Arrêter le serveur, puis copier `donnees/backend/` par-dessus `backend/` :",
    '',
    '```bash',
    'cp -a donnees/backend/. backend/     # stock.db, sauvegardes/, .env',
    '```',
    '',
    'Sans `.env`, repartir de `backend/.env.production.example`.',
    '',
    '## 4. Installer et vérifier',
    '',
    '```bash',
    'npm install && npm --prefix backend install && npm --prefix frontend install',
    'npm test',
    'npm --prefix backend start',
    '```',
    '',
    "Alternative sans copier la base : démarrer l'application avec une base vide,",
    "puis restaurer un fichier JSON de `donnees/backend/sauvegardes/compte-*/`",
    "via l'écran Sauvegardes (POST /api/sauvegardes/restaurer).",
    '',
  ].join('\n');

  return { manifeste, modeEmploi };
}

// --- 7. Programme principal ---
async function main() {
  const destination = path.resolve(destinationDemandee(process.argv.slice(2)));
  fs.mkdirSync(destination, { recursive: true });

  const date = new Date();
  const nom = `gestion-stock-${horodatage(date)}`;
  let archive = path.join(destination, `${nom}.tar.gz`);
  for (let n = 2; fs.existsSync(archive); n++) {
    archive = path.join(destination, `${nom}-${n}.tar.gz`);
  }

  const temporaire = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-sauvegarde-'));
  try {
    // Code : fichiers suivis et nouveaux (jamais node_modules ni la sortie)
    let liste = fichiersDuCode();
    if (!liste) {
      console.log('ℹ️  Dépôt Git introuvable : parcours direct du dossier.');
      liste = parcourirDisque();
    }
    // Sortie de la commande, base et sauvegardes : présentes via donnees/
    const aExclure = [
      path.relative(RACINE, destination).split(path.sep).join('/'),
      'backend/stock.db',
      'backend/sauvegardes',
    ]
      .filter(Boolean)
      .map((p) => p.replace(/\/$/, ''));
    liste = liste.filter(
      (p) =>
        fs.existsSync(path.join(RACINE, p)) &&
        !DOSSIERS_EXCLUS.some((d) => p.split('/').includes(d)) &&
        !aExclure.some((exclu) => p === exclu || p.startsWith(`${exclu}/`))
    );

    const base = await instantaneBase(temporaire);

    const entrees = liste.map((p) => ({ nom: `code/${p}`, chemin: path.join(RACINE, p) }));
    if (base) entrees.push({ nom: 'donnees/backend/stock.db', chemin: base.chemin });
    for (const relatif of fichiersDe(DOSSIER_SAUVEGARDES)) {
      entrees.push({
        nom: `donnees/backend/sauvegardes/${relatif}`,
        chemin: path.join(DOSSIER_SAUVEGARDES, relatif),
      });
    }
    if (fs.existsSync(ENV)) entrees.push({ nom: 'donnees/backend/.env', chemin: ENV });

    const commit = spawnSync('git', ['-C', RACINE, 'log', '-1', '--format=%h (%s)'], {
      encoding: 'utf8',
    });
    const textes = textesArchive({
      date: date.toLocaleString('fr-FR'),
      commit: commit.status === 0 ? commit.stdout.trim() : 'inconnu',
      base,
      env: fs.existsSync(ENV),
      nombre: entrees.length,
    });
    entrees.push(
      { nom: 'MANIFESTE.txt', contenu: Buffer.from(textes.manifeste, 'utf8') },
      { nom: 'LISEZMOI-RESTAURATION.md', contenu: Buffer.from(textes.modeEmploi, 'utf8') }
    );

    await ecrireArchive(archive, entrees);

    const empreinte = await sha256(archive);
    fs.writeFileSync(`${archive}.sha256`, `${empreinte}  ${path.basename(archive)}\n`);

    const octets = fs.statSync(archive).size;
    const mo = (octets / (1024 * 1024)).toFixed(1).replace('.', ',');
    console.log('\n✅ Sauvegarde créée');
    console.log(`   Archive : ${archive} (${mo} Mo, ${entrees.length} fichiers)`);
    console.log(`   SHA-256 : ${empreinte}`);
    console.log(`   Contrôle : ${archive}.sha256`);
    console.log(
      `   Base    : ${base ? `intégrité ${base.integrite}` : 'aucune base trouvée'} — commit ${
        commit.status === 0 ? commit.stdout.trim() : 'inconnu'
      }`
    );
    console.log('\n👉 Copiez cette archive hors de l’ordinateur (disque externe, cloud).\n');
  } finally {
    fs.rmSync(temporaire, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\n⛔ Sauvegarde impossible : ${err.message}\n`);
  process.exit(1);
});
