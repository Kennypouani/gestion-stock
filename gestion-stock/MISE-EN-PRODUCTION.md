# Mise en production (HTTPS)

L'application est prévue pour tourner derrière un reverse proxy qui termine le TLS
(Nginx, Caddy, Traefik…). Le backend refuse ensuite toute requête en clair :
redirection `308` vers `https://` et en-tête HSTS d'un an, actifs par défaut dès que
`NODE_ENV=production`. Un visiteur ne peut donc jamais envoyer son mot de passe ni
recevoir son cookie de session sur un réseau non chiffré.

## 1. Variables du backend

Copier `backend/.env.example` en `backend/.env` (jamais versionné) et renseigner :

```bash
NODE_ENV=production
PORT=5000
ORIGINE_FRONTEND=https://stock-magasin.duckdns.org
TRUST_PROXY=1
FORCER_HTTPS=true
COOKIE_SECURE=true
SECURITE_STRICTE=true
COMPTES_DEMO=false
ADMIN_EMAIL=patron@monmagasin.ci
ADMIN_MOT_DE_PASSE=...      # 12 caractères minimum
```

| Variable | Rôle |
|---|---|
| `TRUST_PROXY` | Nombre de proxies de confiance devant l'application. **Obligatoire derrière un proxy** : sans lui, `req.secure` reste faux et `FORCER_HTTPS` redirige en boucle. `1` avec un seul proxy ; `2` avec Caddy sur l'hôte devant le Nginx du conteneur (chaîne de `deploiement/deploy.sh`). Ne le réglez que si un proxy est réellement présent, sinon un client peut usurper son IP via `X-Forwarded-For` et contourner la limitation des tentatives de connexion. |
| `FORCER_HTTPS` | Redirection `308` de tout HTTP vers HTTPS et HSTS. `true` par défaut en production ; `false` uniquement pour un test HTTP local. |
| `COOKIE_SECURE` | Cookie de session envoyé sur HTTPS seulement. `true` par défaut en production. |
| `ORIGINE_FRONTEND` | Origine exacte du frontend autorisée par CORS, sans slash final (`https://stock.monmagasin.ci`). |
| `SECURITE_STRICTE` / `COMPTES_DEMO` | Refus des mots de passe de démonstration et comptes de test désactivés (valeurs par défaut en production). |

Le serveur affiche un avertissement au démarrage si `FORCER_HTTPS` est actif sans
`TRUST_PROXY`, ou si un mot de passe de démonstration subsiste en production.

Le backend écoute sur toutes les interfaces : laissez le pare-feu bloquer le port `5000`
de l'extérieur et n'exposez que le `443` du proxy.

## 2. Compiler le frontend

Deux possibilités :

- **Même origine (recommandé)** : le proxy sert `frontend/dist` et route `/api` vers le
  backend. Aucune variable n'est nécessaire ; l'application appelle
  `${window.location.origin}/api`, donc en HTTPS comme la page.
- **API sur un autre domaine** : fournir l'URL au moment du build. Elle est figée dans les
  fichiers produits, un changement impose de reconstruire.

```bash
cd frontend
npm ci
VITE_API_URL=https://api.monmagasin.ci/api npm run build   # → frontend/dist
```

> Les variables `VITE_*` sont **publiques** : elles finissent dans le JavaScript envoyé au
> navigateur. Aucune clé (paiement, e-mail, IA…) ne doit y figurer — elles restent dans
> `backend/.env`, lu par le serveur, et `frontend/.gitignore` exclut les fichiers `.env`.

Le build de production ne contient aucune adresse `http://` : sans `VITE_API_URL`, il
appelle l'API sur la même origine que la page.

## 3. Exemple Nginx

```nginx
server {
    listen 80;
    server_name stock.monmagasin.ci;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name stock.monmagasin.ci;

    ssl_certificate     /etc/letsencrypt/live/stock.monmagasin.ci/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/stock.monmagasin.ci/privkey.pem;

    root  /var/www/gestion-stock/frontend/dist;
    index index.html;

    # Compression et cache long des fichiers compilés (noms hachés).
    # index.html reste non mis en cache : il référence les nouveaux noms.
    gzip on;
    gzip_types text/css application/javascript image/svg+xml application/xml text/plain;

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # proxy_pass sans chemin final : /api/... est transmis tel quel
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # SPA : /confidentialite et /conditions-generales renvoient index.html
    location / {
        try_files $uri /index.html;
    }
}
```

Certificat : `certbot --nginx -d stock.monmagasin.ci` (renouvellement automatique).

## 4. Exemple Caddy

```caddyfile
stock.monmagasin.ci {
    encode gzip
    root * /var/www/gestion-stock/frontend/dist

    header /assets/* Cache-Control "public, max-age=31536000, immutable"

    handle /api/* {
        reverse_proxy 127.0.0.1:5000
    }
    try_files {path} /index.html
    file_server
}
```

Caddy obtient et renouvelle le certificat automatiquement et transmet
`X-Forwarded-Proto` ; `TRUST_PROXY=1` reste nécessaire.

## 5. Démarrer et vérifier

```bash
cd backend && node server.js      # ou un service systemd / pm2
```

Un service systemd d'exemple est fourni : `deploiement/gestion-stock.service`
(chemin de `node`, `User` et `WorkingDirectory` à adapter).

```bash
sudo cp deploiement/gestion-stock.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now gestion-stock
journalctl -u gestion-stock -f
```

```bash
curl -I http://stock.monmagasin.ci/api/sante            # 301 (proxy) ou 308 (application)
curl -sI https://stock.monmagasin.ci/api/sante | grep -i strict-transport-security
# → strict-transport-security: max-age=31536000
```

Une fois en ligne, contrôler :

- connexion en HTTPS, puis cookie `session` marqué `Secure` et `HttpOnly` ;
- redirection de `http://` vers `https://` (proxy et application) ;
- pages `/confidentialite` et `/conditions-generales` accessibles sans compte ;
- bloc « comptes de démonstration » absent de l'écran de connexion ;
- `GET /api/route-inconnue` renvoie un 404 JSON ;
- une requête `POST /api/auth/connexion` en clair est redirigée sans créer de session.

## 6. Référencement

`robots.txt` et `sitemap.xml` sont **générés au build** à partir d'une seule valeur :
`SITE_URL` dans `frontend/.env` (modèle : `frontend/.env.example`). C'est le seul endroit
où changer de domaine — inutile de modifier les fichiers SEO à la main.

```bash
cd frontend
cp .env.example .env      # puis SITE_URL=https://votre-domaine
npm run build             # → dist/robots.txt + dist/sitemap.xml
```

Sans `SITE_URL`, le build utilise `https://stock.monmagasin.ci` et affiche un
avertissement. Le sitemap liste uniquement les trois pages publiques ; `robots.txt`
exclut `/api/`. En développement, Vite sert ces deux fichiers avec la même valeur.

Avec Nginx, `try_files $uri /index.html` sert ces deux fichiers depuis le disque :
`/robots.txt` et `/sitemap.xml` ne doivent pas être renvoyés vers l'application. Après la
mise en ligne, vérifiez `https://votre-domaine/robots.txt` et déclarez le sitemap dans la
console de recherche (Google Search Console, Bing Webmaster Tools).

## 6 bis. Déploiement en conteneurs (Docker)

Alternative complète aux sections 3 à 5 : l'API et le site tournent dans deux
conteneurs, les données dans un volume.

```bash
cp backend/.env.example backend/.env    # puis valeurs de production (section 1)
docker compose up -d --build
docker compose ps                       # api healthy, web lancé
```

- `Dockerfile` : trois cibles — `frontend` (compilation Vite), `api` (Node 24,
  `node:sqlite`) et `web` (Nginx). Node est épinglé sur la version 24, tout comme
  le champ `engines` des deux `package.json`.
- `docker-compose.yml` : le volume `donnees` est monté sur `/app/donnees` et
  contient `stock.db` **et** `sauvegardes/` ; il survit à `docker compose down`
  puis `up` (mais pas à `down -v`). L'API le sait grâce à `DOSSIER_DONNEES`, à
  laisser à `/app/donnees`.
- `deploiement/nginx.conf` : sert `dist/`, relaie `/api` vers `api:5000` et
  propage `X-Forwarded-Proto`.
- Le site écoute sur le port `8080` de l'hôte ; le proxy TLS de l'hôte
  (Caddy/Nginx/Traefik) reste devant, et **`TRUST_PROXY=2`** doit être réglé
  dans `backend/.env` : deux proxys s'empilent (celui de l'hôte, puis le
  Nginx du conteneur). Avec un seul proxy, `1` suffit.

Sauvegarde du volume :

```bash
docker run --rm -v gestion-stock_donnees:/donnees -v "$PWD":/sauvegarde alpine \
  tar czf /sauvegarde/donnees-$(date +%F).tar.gz -C /donnees .
```

## 6 ter. VPS : installation en une commande

Trois fichiers couvrent un serveur vierge :

- `deploiement/deploy.sh` — installe Docker et Caddy, démarre, met à jour et
  sauvegarde le volume ;
- `deploiement/Caddyfile` — TLS Let's Encrypt devant le port `8080`, le
  domaine de `ORIGINE_FRONTEND` étant substitué à l'installation ;
- `backend/.env.production.example` — modèle de `backend/.env` de production.

```bash
sudo git clone https://github.com/Kennypouani/gestion-stock.git /opt/gestion-stock
cd /opt/gestion-stock
sudo ./deploiement/deploy.sh install   # crée backend/.env, puis s'arrête
sudo nano backend/.env                 # domaine, ADMIN_EMAIL, ADMIN_MOT_DE_PASSE
sudo ./deploiement/deploy.sh install   # Docker + Caddy + démarrage
docker compose ps                      # api healthy, web Up
```

Commandes suivantes : `start`, `stop`, `restart`, `update` (sauvegarde, puis
`git pull --ff-only` et reconstruction), `backup` (archive horodatée dans
`sauvegardes-hote/`, rotation de 14), `status` (santé, HSTS, robots.txt),
`logs`.

Prérequis : le DNS du domaine pointe vers le serveur, les ports `22`, `80` et
`443` sont ouverts, et **`TRUST_PROXY=2`** est réglé dans `backend/.env`
(Caddy puis Nginx du conteneur).

## 6 quater. Mise en ligne gratuite : VM Oracle Cloud Always Free + DuckDNS

Chaîne retenue pour un hébergement à 0 € : sous-domaine gratuit
`stock-magasin.duckdns.org`, VM Oracle Cloud Always Free, pile Docker + Caddy du dépôt.
Oracle demande une carte bancaire à l'inscription (vérification d'identité ; les ressources
Always Free ne sont pas facturées).

### a. Réserver le sous-domaine (5 min)

1. duckdns.org → connexion GitHub ou Google.
2. `add domain` → `stock-magasin` ; le nom complet devient `stock-magasin.duckdns.org`.
3. La page affiche un `token` : il permet de mettre l'IP à jour en ligne de commande.

### b. Créer la VM Oracle

1. Compte Oracle Cloud (la région d'accueil choisie est définitive).
2. Compute → Instances → Create instance : image Ubuntu 24.04, shape `VM.Standard.A1.Flex`
   avec 1 OCPU et 6 Go (quota gratuit total : 2 OCPU / 12 Go), IP publique, clé SSH
   enregistrée.
3. « Out of host capacity » : réessayer plus tard, changer de zone de disponibilité, ou se
   rabattre sur `VM.Standard.E2.1.Micro` (1 Go de RAM, suffisant pour cette application).
4. Networking → Security List → Add Ingress Rules : TCP **22, 80 et 443** depuis
   `0.0.0.0/0`. Le port 80 est indispensable au certificat Let's Encrypt.

### c. Pointer le nom vers la VM

Sur duckdns.org : champ `current ip` = IP publique de la VM, puis `update ip`. Vérifier :

```bash
nslookup stock-magasin.duckdns.org   # doit renvoyer l'IP de la VM
```

En ligne de commande, avec le jeton affiché par DuckDNS :

```bash
curl "https://www.duckdns.org/update?domains=stock-magasin&token=<token>&ip=<ip-vm>"
```

### d. Ouvrir les ports dans la VM aussi

Les images Ubuntu d'Oracle filtrent en plus avec iptables (sinon Caddy ne peut pas
obtenir le certificat) :

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

(ou `sudo ufw allow 80,443/tcp` si ufw est actif)

### e. Installer l'application

```bash
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/Kennypouani/gestion-stock.git /opt/gestion-stock
cd /opt/gestion-stock
sudo ./deploiement/deploy.sh install   # Docker + Caddy, crée backend/.env puis s'arrête
sudo nano backend/.env                 # ADMIN_EMAIL et ADMIN_MOT_DE_PASSE uniquement
sudo ./deploiement/deploy.sh install   # démarre et obtient le certificat
sudo ./deploiement/deploy.sh status
```

`backend/.env.production.example` contient déjà
`ORIGINE_FRONTEND=https://stock-magasin.duckdns.org`, `TRUST_PROXY=2`, `FORCER_HTTPS=true`,
`COOKIE_SECURE=true`, `SECURITE_STRICTE=true` et `COMPTES_DEMO=false` : seuls l'e-mail et
le mot de passe administrateur restent à saisir.

`deploy.sh` remplace la ligne de domaine du `Caddyfile` par celle de `ORIGINE_FRONTEND`
(les autres blocs sont conservés) ; Caddy obtient ensuite le certificat via le port 80.

### f. Vérifier

```bash
curl -sI https://stock-magasin.duckdns.org/api/sante | head -3
curl -s  https://stock-magasin.duckdns.org/robots.txt
```

Attendu : `200`, en-tête `strict-transport-security`, `robots.txt` contenant le domaine.
Se connecter avec `ADMIN_EMAIL` ; un changement de mot de passe est imposé à la première
connexion.

### g. Entretien

- Sauvegarde quotidienne du volume (crontab de root), puis rapatriement hors du serveur :
  `0 3 * * * /opt/gestion-stock/deploiement/deploy.sh backup >> /var/log/gestion-stock-backup.log 2>&1`
  (une VM gratuite peut être récupérée par Oracle si elle reste inactive : CPU, réseau et
  mémoire sous 20 % pendant 7 jours).
- Mise à jour : `sudo /opt/gestion-stock/deploiement/deploy.sh update`.
- Changer de domaine : modifier `ORIGINE_FRONTEND` dans `backend/.env`, relancer
  `deploy.sh install` (Caddyfile régénéré) puis `update` (le build régénère
  `robots.txt` et `sitemap.xml`).

### h. Variante : installation automatique

`deploiement/installer-vm.sh` regroupe les étapes **d** à **g** en une seule
commande :

```bash
sudo git clone https://github.com/Kennypouani/gestion-stock.git /opt/gestion-stock
sudo /opt/gestion-stock/deploiement/installer-vm.sh
```

Ce que fait le script :

- met à jour le sous-domaine DuckDNS et attend que le nom pointe bien sur l'IP
  publique de la VM (sinon il s'arrête avec l'IP attendue) ;
- ouvre les ports `80` et `443` dans `iptables` et enregistre les règles ;
- installe `git`, clone le dépôt dans `/opt/gestion-stock` (ou le met à jour) ;
- crée `backend/.env` depuis `backend/.env.production.example` et demande
  **uniquement** `ADMIN_EMAIL` et `ADMIN_MOT_DE_PASSE` (12 caractères minimum,
  saisie masquée, fichiers en `600`) ;
- lance `deploiement/deploy.sh install` (Docker, Caddy, certificat) ;
- planifie la sauvegarde quotidienne de 3 h dans le crontab de root.

Il est rejouable : un dépôt existant est mis à jour (`git pull --ff-only`), un
`backend/.env` déjà présent n'est jamais écrasé et la ligne de crontab n'est pas
dupliquée.

Variables surchargeables : `DOMAINE` (défaut `stock-magasin.duckdns.org`) et
`JETON_DUCKDNS` (jeton de duckdns.org : le script met l'IP à jour lui-même) :

```bash
sudo JETON_DUCKDNS=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
  /opt/gestion-stock/deploiement/installer-vm.sh
```

Deux actions restent manuelles dans la console Oracle : la **Security List**
(TCP `22`, `80`, `443` depuis `0.0.0.0/0`) et le champ **current ip** du
sous-domaine sur duckdns.org, sauf si `JETON_DUCKDNS` est fourni.

## 7. Données et sauvegardes

`backend/stock.db` et `backend/sauvegardes/` (ou le volume `donnees` en
conteneurs) ne sont pas versionnés. Prévoyez une copie de
ces fichiers hors du serveur, des droits restreints (`backend/.env` en `600`) et la
rotation déjà assurée par l'application (7 sauvegardes). Les sessions expirées sont purgées
automatiquement, au démarrage puis toutes les heures.
