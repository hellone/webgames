# 🎲 Mini-Jeux à deux

Un site avec plusieurs mini-jeux à 2 joueurs, chacun sur son téléphone.
Un seul process Node sert tout : l'accueil, les pages des jeux et le temps réel (WebSocket).

## Lancer

    npm install
    npm start            # http://localhost:3000  (port : PORT=8080 npm start)

## Structure

    server.js              serveur unique (salles, reconnexion, provocations, routage des jeux)
    public/index.html      accueil : liste les jeux automatiquement
    public/common/client.js  brique commune côté téléphone (lien de partie, pseudo, connexion…)
    games/<id>/game.js     logique serveur d'un jeu
    games/<id>/index.html  page du jeu  →  accessible sur /<id>/

## Ajouter un jeu

1. Crée `games/monjeu/game.js` :

```js
module.exports = {
  name: 'Mon jeu', emoji: '🎯', description: 'Une phrase.', color: '#3bb273', maxPlayers: 2,
  init: () => ({ /* état de la partie */ }),
  onMessage(state, slot, msg, ctx) { /* applique l'action ; return false si rien n'a changé */ },
  view(state, slot) { return { /* ce que ce joueur a le droit de voir */ }; },
};
```

2. Crée `games/monjeu/index.html` qui charge `../common/client.js` et appelle
   `WG.connect({ game: 'monjeu', onState, onTaunt, onError })`, puis `WG.send({...})`.
3. Redémarre le serveur : le jeu apparaît sur l'accueil.

Le serveur ajoute toujours `you` (ton numéro de joueur), `names` et `connected` à l'état envoyé.
Modèle complet : `games/poulets/`.

## Déployer sur le VPS

Même installation que Courtside : Docker, derrière le Traefik de n8n (HTTPS automatique).
Adresse : **https://courtside-basket.fr/jeux/**

Première fois, sur le VPS :

    git clone https://github.com/hellone/webgames.git /opt/webgames
    cd /opt/webgames
    cp .env.example .env     # facultatif : reprendre les valeurs Traefik du .env de courtside
    bash deploy.sh

Ensuite, à chaque mise à jour : `git push` depuis le PC, puis sur le VPS `bash /opt/webgames/deploy.sh`.
