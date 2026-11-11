// WebGames — serveur unique pour tous les mini-jeux (HTTP + WebSocket)
//
// Chaque jeu vit dans games/<id>/ avec :
//   game.js     → la logique serveur (voir games/poulets/game.js pour le modèle)
//   index.html  → la page du jeu (peut utiliser /common/client.js)
// Ajouter un dossier = ajouter un jeu sur l'accueil.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

// ---------- Chargement des jeux ----------
const games = new Map();
for (const dir of fs.readdirSync(path.join(ROOT, 'games'))) {
  const file = path.join(ROOT, 'games', dir, 'game.js');
  if (!fs.existsSync(file)) continue;
  const g = require(file);
  g.id = g.id || dir;
  g.dir = path.join(ROOT, 'games', dir);
  g.maxPlayers = g.maxPlayers || 2;
  games.set(g.id, g);
  console.log(`  ${g.emoji || '🎮'} ${g.name} → /${g.id}/`);
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ico': 'image/x-icon',
};

function sendFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

// Empêche de sortir du dossier autorisé (../)
function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base) ? p : null;
}

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { url = '/'; }
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';

  if (url === '/' || url === '/index.html') return sendFile(res, path.join(ROOT, 'public', 'index.html'));

  if (url === '/api/games') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify([...games.values()].map((g) => ({
      id: g.id, name: g.name, emoji: g.emoji, description: g.description, players: g.maxPlayers, color: g.color,
    }))));
  }

  if (url.startsWith('/common/')) {
    const f = safeJoin(path.join(ROOT, 'public', 'common'), url.slice('/common/'.length));
    return f ? sendFile(res, f) : (res.writeHead(404), res.end());
  }

  const [, id, ...rest] = url.split('/');
  const game = games.get(id);
  if (game) {
    // redirection relative : marche aussi derrière un préfixe (ex. /jeux/poulets → /jeux/poulets/)
    if (url === '/' + id) { res.writeHead(302, { Location: id + '/' + query }); return res.end(); }
    const rel = rest.join('/') || 'index.html';
    if (rel === 'game.js') { res.writeHead(404); return res.end(); } // la logique serveur reste privée
    const f = safeJoin(game.dir, rel);
    return f ? sendFile(res, f) : (res.writeHead(404), res.end());
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// ---------- Salles ----------
// clé "jeu:CODE" → { game, players: [{pid,name,ws}|null...], state, cleanup }
const rooms = new Map();

function getRoom(game, code) {
  const key = game.id + ':' + code;
  let r = rooms.get(key);
  if (!r) {
    r = { key, game, players: Array(game.maxPlayers).fill(null), state: game.init(), cleanup: null };
    rooms.set(key, r);
  }
  return r;
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function isConnected(p) {
  return !!(p && p.ws && p.ws.readyState === 1);
}

function broadcastState(room) {
  const names = room.players.map((p) => (p ? p.name : null));
  const connected = room.players.map(isConnected);
  room.players.forEach((p, i) => {
    if (!p) return;
    send(p.ws, { type: 'state', you: i, names, connected, ...room.game.view(room.state, i, room) });
  });
}

function scheduleCleanup(room) {
  clearTimeout(room.cleanup);
  if (!room.players.some(isConnected)) {
    room.cleanup = setTimeout(() => rooms.delete(room.key), 6 * 60 * 60 * 1000);
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let room = null;
  let slot = -1;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      const game = games.get(String(msg.game || ''));
      const code = String(msg.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
      const pid = String(msg.pid || '').slice(0, 64);
      const name = String(msg.name || '').trim().slice(0, 14) || 'Joueur';
      if (!game || !code || !pid) return send(ws, { type: 'error', message: 'Lien invalide' });

      room = getRoom(game, code);
      slot = room.players.findIndex((p) => p && p.pid === pid);
      if (slot === -1) slot = room.players.findIndex((p) => p === null);
      if (slot === -1) {
        room = null;
        return send(ws, { type: 'error', message: 'Cette partie est déjà complète 🙅' });
      }
      const old = room.players[slot];
      if (old && old.ws && old.ws !== ws) { try { old.ws.close(); } catch {} }
      room.players[slot] = { pid, name, ws };
      clearTimeout(room.cleanup);
      if (room.game.onJoin) room.game.onJoin(room.state, slot, room);
      broadcastState(room);
      return;
    }

    if (!room || slot < 0) return;

    // Provocations : communes à tous les jeux
    if (msg.type === 'taunt') {
      const e = String(msg.e || '').slice(0, 8);
      room.players.forEach((p, i) => { if (p && i !== slot) send(p.ws, { type: 'taunt', e, from: slot }); });
      return;
    }

    const ctx = {
      room,
      full: room.players.every((p) => p !== null),
      // envoyer un message ponctuel (ex. effet) à un joueur ou à tous
      emit: (msg2, to = null) => room.players.forEach((p, i) => { if (p && (to === null || to === i)) send(p.ws, msg2); }),
    };
    const changed = room.game.onMessage(room.state, slot, msg, ctx);
    if (changed !== false) broadcastState(room);
  });

  ws.on('close', () => {
    if (!room) return;
    const p = room.players[slot];
    if (p && p.ws === ws) p.ws = null;
    broadcastState(room);
    scheduleCleanup(room);
  });
});

// Ping pour garder les connexions vivantes derrière un proxy
setInterval(() => wss.clients.forEach((c) => { try { c.ping(); } catch {} }), 25000);

server.listen(PORT, () => console.log(`🎮 WebGames sur http://localhost:${PORT}`));
