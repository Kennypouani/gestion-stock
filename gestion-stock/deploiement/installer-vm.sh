#!/usr/bin/env bash
# ============================================================
# INSTALLATION D'UNE VM — gestion-stock
#
#   sudo ./deploiement/installer-vm.sh
#
# Réunit, en une seule commande, les étapes manuelles de
# MISE-EN-PRODUCTION.md (§ 6 quater) sur une VM Ubuntu vierge :
#   1. met à jour le sous-domaine DuckDNS et vérifie la résolution ;
#   2. ouvre les ports 80 et 443 dans iptables (images Oracle) ;
#   3. installe git, récupère le dépôt dans /opt/gestion-stock ;
#   4. crée backend/.env depuis le modèle et demande les deux
#      seules valeurs à saisir : ADMIN_EMAIL, ADMIN_MOT_DE_PASSE ;
#   5. lance « deploy.sh install » (Docker, Caddy, certificat) ;
#   6. planifie la sauvegarde quotidienne à 3 h (crontab de root).
#
# Le script est rejouable : un dépôt déjà cloné est mis à jour
# (git pull --ff-only), un backend/.env existant n'est jamais
# écrasé, et les règles iptables déjà présentes sont conservées.
#
# Prérequis restant à la main dans la console Oracle :
#   - Security List : TCP 22, 80 et 443 depuis 0.0.0.0/0 ;
#   - champ « current ip » du sous-domaine sur duckdns.org
#     (ou renseigner JETON_DUCKDNS ci-dessous).
#
# Variables surchargeables :
#   JETON_DUCKDNS  jeton DuckDNS : met l'IP publique à jour seul
#   DOMAINE        nom public (défaut stock-magasin.duckdns.org)
# ============================================================
set -euo pipefail

SITE_PAR_DEFAUT="stock-magasin.duckdns.org"
DOMAINE="${DOMAINE:-$SITE_PAR_DEFAUT}"
SOUS_DOMAINE="${DOMAINE%%.*}" # stock-magasin
JETON_DUCKDNS="${JETON_DUCKDNS:-}" # facultatif
DEPOT="https://github.com/Kennypouani/gestion-stock.git"
CIBLE="/opt/gestion-stock"
ENV="$CIBLE/backend/.env"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok() { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
attention() { printf '\033[1;33m  ! %s\033[0m\n' "$*" >&2; }
erreur() {
  printf '\033[1;31m  ✗ %s\033[0m\n' "$*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || erreur "Lance ce script avec sudo."

a() { command -v "$1" >/dev/null 2>&1; }

# Remplace « CLE=valeur » sans réinterpréter la valeur (mot de passe).
remplacer_env() { # cle valeur fichier
  CLE="$1" VAL="$2" awk '
    BEGIN { FS = OFS = "=" }
    $1 == ENVIRON["CLE"] { print ENVIRON["CLE"] "=" ENVIRON["VAL"]; next }
    { print }
  ' "$3" >"$3.tmp"
  mv "$3.tmp" "$3"
}

# --- 1. DNS DuckDNS ----------------------------------------------------
IP_VM="$(curl -fsS https://api.ipify.org || true)"
[ -n "$IP_VM" ] || erreur "Impossible de déterminer l'IP publique de la VM."

if [ -n "$JETON_DUCKDNS" ]; then
  log "Mise à jour DuckDNS ($DOMAINE → $IP_VM)"
  reponse="$(curl -fsS "https://www.duckdns.org/update?domains=$SOUS_DOMAINE&token=$JETON_DUCKDNS&ip=$IP_VM" || true)"
  [ "$reponse" = "OK" ] || attention "Réponse DuckDNS inattendue : « ${reponse:-vide} »."
fi

log "Attente de la résolution DNS (jusqu'à 3 min)"
resolu=""
for _ in $(seq 1 36); do
  resolu="$(getent hosts "$DOMAINE" | awk '{ print $1; exit }' || true)"
  [ "$resolu" = "$IP_VM" ] && break
  sleep 5
done
if [ "$resolu" != "$IP_VM" ]; then
  erreur "$DOMAINE pointe sur « ${resolu:-rien} » au lieu de $IP_VM :
    corrigez l'IP sur duckdns.org (ou renseignez JETON_DUCKDNS) puis relancez."
fi
ok "$DOMAINE → $IP_VM"

# --- 2. Ports 80 et 443 dans la VM (iptables d'Oracle) -----------------
log "Ouverture des ports 80 et 443"
if a iptables; then
  for port in 80 443; do
    iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null ||
      iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
  done
  if ! a netfilter-persistent; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent >/dev/null
  fi
  netfilter-persistent save >/dev/null
  ok "Règles enregistrées (elles survivent au redémarrage)"
else
  attention "iptables absent : vérifiez que 80 et 443 sont joignables (ufw ?)."
fi

# --- 3. Code -----------------------------------------------------------
log "Récupération du code"
apt-get update -qq
apt-get install -y -qq git curl >/dev/null
if [ -d "$CIBLE/.git" ]; then
  git -C "$CIBLE" pull --ff-only
  ok "Dépôt mis à jour dans $CIBLE"
else
  git clone --depth 1 "$DEPOT" "$CIBLE"
  ok "Dépôt cloné dans $CIBLE"
fi

# --- 4. backend/.env ---------------------------------------------------
if [ ! -f "$ENV" ]; then
  log "Création de backend/.env (deux valeurs à saisir)"
  cp "$CIBLE/backend/.env.production.example" "$ENV"
  chmod 600 "$ENV"

  admin_email=""
  while [ -z "$admin_email" ]; do
    read -rp "  E-mail administrateur : " admin_email
  done
  while :; do
    read -rsp "  Mot de passe administrateur (12 caractères minimum) : " admin_mdp
    printf '\n'
    [ "${#admin_mdp}" -ge 12 ] && break
    attention "Trop court : 12 caractères minimum."
  done

  remplacer_env ADMIN_EMAIL "$admin_email" "$ENV"
  remplacer_env ADMIN_MOT_DE_PASSE "$admin_mdp" "$ENV"
  ok "backend/.env créé (droits 600)"
else
  ok "backend/.env déjà présent : conservé tel quel"
fi

# --- 5. Installation (Docker + Caddy + certificat) ---------------------
log "Installation de l'application (plusieurs minutes)"
"$CIBLE/deploiement/deploy.sh" install

# --- 6. Sauvegarde quotidienne à 3 h -----------------------------------
LIGNE="0 3 * * * $CIBLE/deploiement/deploy.sh backup >> /var/log/gestion-stock-backup.log 2>&1"
if crontab -l 2>/dev/null | grep -qF "$CIBLE/deploiement/deploy.sh backup"; then
  ok "Sauvegarde quotidienne déjà planifiée"
else
  (crontab -l 2>/dev/null | grep -vF "$CIBLE/deploiement/deploy.sh backup"; echo "$LIGNE") | crontab -
  ok "Sauvegarde quotidienne planifiée (3 h)"
fi

log "Terminé"
echo "  Site  : https://$DOMAINE"
echo "  État  : sudo $CIBLE/deploiement/deploy.sh status"
