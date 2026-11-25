#!/usr/bin/env bash
# ============================================================
# DÉPLOIEMENT VPS — gestion-stock
#
#   sudo ./deploiement/deploy.sh install    Docker + Caddy + démarrage
#        ./deploiement/deploy.sh start      (re)démarre les conteneurs
#        ./deploiement/deploy.sh update     git pull + reconstruction
#        ./deploiement/deploy.sh backup     archive du volume des données
#        ./deploiement/deploy.sh status     état, santé, en-têtes HTTPS
#        ./deploiement/deploy.sh logs       journaux en direct
#
# À exécuter depuis le dépôt, sur le serveur. « install » a besoin de
# root (apt, systemctl) ; les autres commandes tournent avec l'accès à
# Docker (root ou membre du groupe docker).
#
# Sauvegarde quotidienne à 3 h (crontab de root) :
#   0 3 * * * /opt/gestion-stock/deploiement/deploy.sh backup >> /var/log/gestion-stock-backup.log 2>&1
#
# Variables surchargeables :
#   SITE_URL   origine publique si ORIGINE_FRONTEND n'est pas exploitable
#   CONSERVER  nombre d'archives gardées sur l'hôte (défaut 14)
# ============================================================
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RACINE"

ENV="$RACINE/backend/.env"
MODELE="$RACINE/backend/.env.production.example"
CADDYFILE="$RACINE/deploiement/Caddyfile"
SAUVEGARDES="$RACINE/sauvegardes-hote"
CONSERVER="${CONSERVER:-14}"
PORT_WEB=8080 # port publié par docker-compose (proxy TLS de l'hôte devant)

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok() { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
attention() { printf '\033[1;33m  ! %s\033[0m\n' "$*" >&2; }
erreur() {
  printf '\033[1;31m  ✗ %s\033[0m\n' "$*" >&2
  exit 1
}

besoin_root() {
  [ "$(id -u)" -eq 0 ] || erreur "Cette commande doit tourner avec sudo."
}

a() { command -v "$1" >/dev/null 2>&1; }

# --- Lecture de backend/.env (tolérante aux retours chariot Windows) ----
lire_env() {
  [ -f "$ENV" ] || return 0
  awk -v cle="$1" 'BEGIN { FS = "=" } $1 == cle { sub(/^[^=]*=/, ""); gsub(/\r/, ""); print; exit }' "$ENV"
}

# Origine publique complète, ex. https://stock.mondomaine.ci
origine_publique() {
  local origine
  origine="${SITE_URL:-$(lire_env ORIGINE_FRONTEND)}"
  origine="${origine%%,*}" # plusieurs origines séparées par des virgules
  [ -n "$origine" ] || erreur "ORIGINE_FRONTEND est vide dans backend/.env."
  printf '%s' "${origine%/}"
}

# Nom d'hôte seul, ex. stock.mondomaine.ci
domaine_public() {
  local site
  site="$(origine_publique)"
  site="${site#http://}"
  site="${site#https://}"
  printf '%s' "${site%%/*}"
}

# Caddyfile avec la ligne de site remplacée par le domaine public.
# La première ligne hors commentaires terminée par « { » est celle du site
# (« header { » et « reverse_proxy … { » viennent après).
caddyfile_avec_domaine() {
  awk -v domaine="$1" '
    !fait && $0 !~ /^[[:space:]]*#/ && $0 ~ /\{[[:space:]]*$/ {
      print domaine " {"
      fait = 1
      next
    }
    { print }
  ' "$CADDYFILE"
}

# --- Vérifications préalables -----------------------------------------
verifier_env() {
  if [ ! -f "$ENV" ]; then
    [ -f "$MODELE" ] || erreur "Modèle introuvable : $MODELE"
    cp "$MODELE" "$ENV"
    chmod 600 "$ENV"
    attention "backend/.env vient d'être créé depuis le modèle."
    attention "Complétez les valeurs <...> (domaine, e-mail, mot de passe) puis relancez :"
    attention "    sudo nano $ENV"
    exit 1
  fi

  # Les lignes de commentaire du modèle contiennent aussi « <...> » :
  # seules les affectations sont contrôlées.
  local a_completer
  a_completer="$(grep -vE '^[[:space:]]*#' "$ENV" | grep -E '<[^>]*>' || true)"
  if [ -n "$a_completer" ]; then
    erreur "backend/.env contient encore des valeurs à compléter : $(printf '%s' "$a_completer" | cut -d= -f1 | tr '\n' ' ')"
  fi

  [ "$(lire_env NODE_ENV)" = "production" ] ||
    attention "NODE_ENV n'est pas « production » dans backend/.env."
  [ -n "$(lire_env ADMIN_EMAIL)" ] ||
    attention "ADMIN_EMAIL est vide : aucun administrateur ne sera créé."
  [ -n "$(lire_env ADMIN_MOT_DE_PASSE)" ] ||
    attention "ADMIN_MOT_DE_PASSE est vide : aucun administrateur ne sera créé."

  chmod 600 "$ENV" 2>/dev/null || true
  ok "backend/.env présent (droits 600) — origine : $(origine_publique)"
}

# --- Installation de Docker -------------------------------------------
installer_docker() {
  besoin_root
  if a docker; then
    ok "Docker déjà installé ($(docker --version | cut -d, -f1))"
  else
    log "Installation de Docker (dépôt officiel get.docker.com)"
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl
    curl -fsSL https://get.docker.com | sh
  fi
  docker compose version >/dev/null 2>&1 ||
    erreur "Le plugin « docker compose » est absent (apt install docker-compose-plugin)."
  systemctl enable --now docker >/dev/null 2>&1 || true
}

# --- Installation et configuration de Caddy (TLS automatique) ---------
installer_caddy() {
  besoin_root
  if ! a caddy; then
    log "Installation de Caddy (dépôt officiel)"
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
      gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      >/etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy
  else
    ok "Caddy déjà installé ($(caddy version | cut -d' ' -f1))"
  fi
}

configurer_caddy() {
  besoin_root
  local domaine destination="/etc/caddy/Caddyfile"

  [ -f "$CADDYFILE" ] || erreur "Caddyfile introuvable : $CADDYFILE"
  domaine="$(domaine_public)"

  # Tout autre fichier existant est conservé de côté, jamais écrasé.
  if [ -f "$destination" ] && ! grep -qF "$domaine" "$destination"; then
    cp "$destination" "$destination.$(date +%Y%m%d-%H%M%S).bak"
    attention "Ancien Caddyfile conservé en $destination.<date>.bak"
  fi

  caddyfile_avec_domaine "$domaine" >"$destination"
  caddy validate --config "$destination" --adapter caddyfile >/dev/null ||
    erreur "Caddyfile invalide : vérifiez $destination."

  systemctl enable --now caddy >/dev/null 2>&1 || true
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
  ok "Caddy sert https://$domaine (certificat Let's Encrypt automatique)"
}

# --- Conteneurs --------------------------------------------------------
attendre_api() {
  log "Attente de l'API (jusqu'à 90 s)"
  local conteneur etat
  for _ in $(seq 1 45); do
    conteneur="$(docker compose ps -q api 2>/dev/null || true)"
    if [ -n "$conteneur" ]; then
      etat="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$conteneur" 2>/dev/null || true)"
      case "$etat" in
        healthy)
          ok "API prête (conteneur sain)"
          return 0
          ;;
        exited | dead | restarting)
          docker compose logs --tail 40 api || true
          erreur "L'API s'est arrêtée au démarrage (voir les journaux ci-dessus)."
          ;;
      esac
    fi
    sleep 2
  done
  docker compose logs --tail 60 api || true
  erreur "L'API n'est pas devenue saine en 90 s. Vérifiez backend/.env et les journaux."
}

demarrer() {
  verifier_env
  log "Construction de l'image et démarrage"
  SITE_URL="$(origine_publique)" docker compose up -d --build
  attendre_api
  docker compose ps
  ok "Site disponible sur http://127.0.0.1:$PORT_WEB (proxy TLS devant)"
}

arreter() {
  docker compose down
  ok "Conteneurs arrêtés (volume des données conservé)"
}

# --- Sauvegarde du volume des données ---------------------------------
sauvegarder() {
  local conteneur volume nom archive

  conteneur="$(docker compose ps -q api 2>/dev/null || true)"
  [ -n "$conteneur" ] ||
    erreur "L'API ne tourne pas : lancez d'abord « deploy.sh start »."

  # Nom réel du volume, quel que soit le nom du dossier du projet
  volume="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/donnees"}}{{.Name}}{{end}}{{end}}' "$conteneur")"
  [ -n "$volume" ] || erreur "Volume monté sur /app/donnees introuvable."

  mkdir -p "$SAUVEGARDES"
  nom="donnees-$(date +%Y-%m-%d-%H%M).tar.gz"
  archive="$SAUVEGARDES/$nom"

  log "Sauvegarde du volume « $volume »"
  # Copie sans arrêt du service : stock.db peut être en cours d'écriture,
  # mais sauvegardes/ contient les instantanés cohérents (VACUUM INTO)
  # dont se sert la restauration. :ro = aucune écriture possible.
  docker run --rm \
    -v "$volume":/donnees:ro \
    -v "$SAUVEGARDES":/sauvegarde \
    alpine sh -c "tar czf /sauvegarde/$nom -C /donnees ."
  [ -s "$archive" ] || erreur "Archive vide : $archive"

  # Rotation des archives de l'hôte (les plus anciennes d'abord)
  find "$SAUVEGARDES" -maxdepth 1 -name 'donnees-*.tar.gz' -printf '%T@ %p\n' 2>/dev/null |
    sort -rn | tail -n +$((CONSERVER + 1)) | cut -d' ' -f2- | xargs -r rm -f || true

  ok "Archive : $archive ($(du -h "$archive" | cut -f1))"
  attention "Elle reste sur le serveur : copiez-la ailleurs (scp/rsync) régulièrement."
  attention "Restauration : extraire stock.db ou sauvegardes/stock-*.db dans le volume."
}

# --- Mise à jour -------------------------------------------------------
mettre_a_jour() {
  verifier_env

  # « sauvegarder » s'arrête si l'API ne tourne pas : on ne l'appelle que
  # lorsque les conteneurs sont là, pour ne pas bloquer un premier update.
  if [ -n "$(docker compose ps -q api 2>/dev/null || true)" ]; then
    sauvegarder || attention "Sauvegarde ignorée : la mise à jour continue."
  else
    attention "API arrêtée : sauvegarde ignorée, la mise à jour continue."
  fi

  log "Récupération du code (git pull --ff-only)"
  git -C "$RACINE" pull --ff-only

  log "Reconstruction et redémarrage"
  SITE_URL="$(origine_publique)" docker compose up -d --build
  attendre_api

  # Anciennes images plus référencées uniquement
  docker image prune -f >/dev/null 2>&1 || true
  ok "Mise à jour terminée (les données du volume sont conservées)"
}

# --- Diagnostic --------------------------------------------------------
etat() {
  log "Conteneurs"
  docker compose ps

  log "Santé de l'API"
  curl -fsS -o /dev/null -w '  direct  : HTTP %{http_code}\n' \
    "http://127.0.0.1:$PORT_WEB/api/sante" ||
    attention "L'API ne répond pas sur 127.0.0.1:$PORT_WEB."

  local domaine
  domaine="$(domaine_public)"
  log "Contrôles publics ($domaine)"
  curl -fsSI "https://$domaine/api/sante" | grep -i 'strict-transport-security\|^HTTP/' ||
    attention "HTTPS injoignable : DNS, ports 80/443 ou certificat Caddy."
  printf '  http  → '
  curl -fsS -o /dev/null -w 'HTTP %{http_code}\n' "http://$domaine/api/sante" ||
    attention "Pas de redirection HTTP attendue ?"
  printf '  robots.txt → '
  curl -fsS -o /dev/null -w 'HTTP %{http_code}\n' "https://$domaine/robots.txt" || attention "absent"
}

journaux() {
  docker compose logs -f --tail 60
}

# --- Point d'entrée ----------------------------------------------------
installer() {
  besoin_root
  installer_docker
  verifier_env # crée backend/.env puis s'arrête s'il est absent
  installer_caddy
  configurer_caddy
  demarrer
  etat || true
  log "Terminé"
  echo "  • Compte administrateur : $(lire_env ADMIN_EMAIL)"
  echo "  • Sauvegarde quotidienne (crontab -e) :"
  echo "      0 3 * * * $RACINE/deploiement/deploy.sh backup >> /var/log/gestion-stock-backup.log 2>&1"
}

usage() {
  sed -n '3,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

case "${1:-}" in
  install) installer ;;
  start) demarrer ;;
  stop) arreter ;;
  restart) arreter && demarrer ;;
  update) mettre_a_jour ;;
  backup) sauvegarder ;;
  status) etat ;;
  logs) journaux ;;
  *) usage ;;
esac
