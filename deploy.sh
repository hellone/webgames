#!/usr/bin/env bash
# Mise à jour de WebGames sur le serveur : récupère une branche (main par défaut) et reconstruit.
# Usage : bash deploy.sh            -> branche main
#         bash deploy.sh ma-branche -> autre branche (test)
#
# Première installation sur le VPS :
#   git clone https://github.com/hellone/webgames.git /opt/webgames
#   cd /opt/webgames
#   cp .env.example .env     # facultatif : reprendre les valeurs Traefik du .env de courtside
#   bash deploy.sh
#
# Tout est dans une fonction : bash lit le script en entier avant que git ne le remplace.
set -euo pipefail

deployer() {
  cd "$(dirname "$0")"
  local BRANCHE="${1:-main}"
  if [ -f .env ]; then set -a; . ./.env; set +a; fi
  git fetch origin "+refs/heads/$BRANCHE:refs/remotes/origin/$BRANCHE"
  git checkout -B "$BRANCHE" "origin/$BRANCHE"
  git reset --hard "origin/$BRANCHE"
  echo "Déploiement de la branche $BRANCHE ($(git log -1 --format='%h %s'))"

  if ! docker network inspect n8n_default >/dev/null 2>&1; then
    echo "Réseau docker n8n_default introuvable : Traefik (n8n) tourne-t-il sur ce serveur ?" >&2
    exit 1
  fi

  docker compose up -d --build
  docker image prune -f >/dev/null

  # Vérifie que l'appli répond dans le conteneur
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if docker exec webgames wget -qO- http://127.0.0.1:3000/api/games >/dev/null 2>&1; then
      docker compose ps
      echo "OK : https://${WEBGAMES_DOMAIN:-courtside-basket.fr}/jeux/"
      return 0
    fi
    sleep 1
  done
  echo "L'appli ne répond pas, derniers logs :" >&2
  docker compose logs --tail 30 web >&2
  exit 1
}

deployer "$@"
exit
