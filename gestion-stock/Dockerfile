# ============================================================
# IMAGE DE PRODUCTION — Gestion de stock
#
# Trois cibles dans un seul fichier :
#   • frontend : compile le site React/Vite (dist/)
#   • api      : exécute l'API Express sur Node 24 (node:sqlite)
#   • web      : Nginx qui sert dist/ et relaie /api vers l'API
#
# Node est épinglé sur la version 24 : node:sqlite existe depuis 22.13
# et son API (DatabaseSync) reste celle utilisée par backend/database.js
# jusqu'à Node 26.0, qui la renomme.
#
# Build : docker compose build
# ============================================================

ARG NODE_VERSION=24

# --- 1. Compilation du frontend -------------------------------------------
FROM node:${NODE_VERSION}-alpine AS frontend
WORKDIR /app/frontend

# npm ci exige le lockfile : installation reproductible
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# Domaine public utilisé pour robots.txt et sitemap.xml (SITE_URL du build Vite)
ARG SITE_URL=http://localhost:8080
ENV SITE_URL=${SITE_URL}
RUN npm run build

# --- 2. Dépendances du backend (sans les devDependencies) ------------------
FROM node:${NODE_VERSION}-alpine AS dependances
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# --- 3. Image d'exécution de l'API ----------------------------------------
FROM node:${NODE_VERSION}-alpine AS api
ENV NODE_ENV=production
WORKDIR /app/backend

COPY --from=dependances /app/backend/node_modules ./node_modules
COPY backend/ ./

# Données persistantes : base + sauvegardes, montées en volume par
# docker-compose. Le processus tourne avec l'utilisateur non privilégié
# « node » fourni par l'image.
ENV DOSSIER_DONNEES=/app/donnees
RUN mkdir -p /app/donnees && chown -R node:node /app/donnees
VOLUME ["/app/donnees"]

USER node
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/sante').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]

# --- 4. Serveur web (fichiers statiques + proxy /api) ---------------------
FROM nginx:1.27-alpine AS web
COPY deploiement/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
