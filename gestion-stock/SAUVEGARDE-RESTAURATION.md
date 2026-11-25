# Sauvegarder et restaurer le projet

Le code vit sur GitHub, mais la base de données, les sauvegardes de l'application et
le fichier `.env` ne sont **pas** versionnés. Une seule commande réunit tout dans une
archive datée, restaurable sur une machine neuve.

## 1. Créer une sauvegarde

```bash
npm run sauvegarde
```

→ `sauvegardes-locales/gestion-stock-AAAA-MM-JJ_HHMMSS.tar.gz` + son `.sha256`.

Pour écrire directement sur un autre disque :

```bash
npm run sauvegarde -- --vers "D:/Sauvegardes/gestion-stock"
# ou
DESTINATION_SAUVEGARDE="D:/Sauvegardes/gestion-stock" npm run sauvegarde
```

Le dossier `sauvegardes-locales/` est ignoré par Git (l'archive contient la base et
les secrets). **Copiez chaque archive hors de l'ordinateur** : disque externe, cloud,
ou les deux.

## 2. Contenu de l'archive

```
code/                         code source tel qu'il est sur le disque
                              (modifications non validées comprises,
                              sans node_modules ni fichiers ignorés)
donnees/backend/stock.db      base SQLite (copie cohérente, même serveur allumé)
donnees/backend/sauvegardes/  sauvegardes produites par l'application
donnees/backend/.env          configuration locale, si elle existe
MANIFESTE.txt                 date, commit, intégrité de la base
LISEZMOI-RESTAURATION.md      procédure de restauration détaillée
```

La base est copiée avec l'API de sauvegarde de SQLite (`node:sqlite`) puis contrôlée
par `PRAGMA integrity_check` — la commande affiche `intégrité ok` en cas de succès.

## 3. Vérifier une archive

```bash
cd sauvegardes-locales
sha256sum -c gestion-stock-AAAA-MM-JJ_HHMMSS.tar.gz.sha256   # Linux / Git Bash
tar -tzf gestion-stock-AAAA-MM-JJ_HHMMSS.tar.gz | head -20   # contenu
```

## 4. Restaurer sur une machine neuve

1. **Installer** Node.js 24 (voir `engines` dans `package.json`) et Git.
2. **Récupérer le code** :

   ```bash
   git clone https://github.com/Kennypouani/gestion-stock.git
   cd gestion-stock/gestion-stock
   ```

   (le projet est dans le sous-dossier `gestion-stock/` du dépôt). Si l'archive est
   plus récente que le dernier `git push`, remplacer les fichiers par `code/` :

   ```bash
   tar -xzf /chemin/vers/gestion-stock-AAAA-MM-JJ_HHMMSS.tar.gz -C /tmp/restauration
   cp -a /tmp/restauration/code/. .
   ```

3. **Remettre les données** (serveur arrêté) :

   ```bash
   cp -a /tmp/restauration/donnees/backend/. backend/
   ```

   Cela replace `stock.db`, `sauvegardes/` et `.env`. Sans `.env`, repartir de
   `backend/.env.production.example`.
4. **Installer les dépendances** :

   ```bash
   npm install
   npm --prefix backend install
   npm --prefix frontend install
   ```
5. **Vérifier** :

   ```bash
   npm test
   npm --prefix backend start
   ```

### Variante : restaurer sans copier la base

Démarrer l'application avec une base vierge, se connecter en admin, puis restaurer un
fichier JSON de `donnees/backend/sauvegardes/compte-*/` depuis l'écran Sauvegardes
(`POST /api/sauvegardes/restaurer`). Les données des boutiques du compte sont
remplacées par celles du fichier.

## 5. Cas du serveur en production (VPS)

Les données de production sont sur le serveur, pas sur l'ordinateur : une panne de la
machine locale ne les touche pas. Sur le VPS, lancer la même commande depuis le clone
du projet, puis rapatrier l'archive :

```bash
npm run sauvegarde -- --vers /var/sauvegardes
scp user@vps:/var/sauvegardes/gestion-stock-*.tar.gz .
```

## 6. Ce qui n'est pas couvert

- `node_modules/` et `frontend/dist/` : réinstallables/regénérables (`npm install`, build).
- L'historique Git : il est sur GitHub (`git clone` le restaure).
- Les fichiers ignorés de Git autres que ceux listés plus haut (`*.log`, `*.pid`,
  `backend/server-test.log`…) : sans intérêt pour une restauration.
