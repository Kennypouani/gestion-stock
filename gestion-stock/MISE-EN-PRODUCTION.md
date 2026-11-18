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
ORIGINE_FRONTEND=https://stock.monmagasin.ci
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
| `TRUST_PROXY` | Nombre de proxies de confiance devant l'application. **Obligatoire (`1`) derrière un proxy** : sans lui, `req.secure` reste faux et `FORCER_HTTPS` redirige en boucle. Ne le réglez que si un proxy est réellement présent, sinon un client peut usurper son IP via `X-Forwarded-For` et contourner la limitation des tentatives de connexion. |
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

## 6. Données et sauvegardes

`backend/stock.db` et `backend/sauvegardes/` ne sont pas versionnés. Prévoyez une copie de
ces fichiers hors du serveur, des droits restreints (`backend/.env` en `600`) et la
rotation déjà assurée par l'application (7 sauvegardes). Les sessions expirées sont purgées
automatiquement, au démarrage puis toutes les heures.
