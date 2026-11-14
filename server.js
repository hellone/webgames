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
  '.wav': 'audio/wav', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
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

function isHumanOnline(p) {
  return !!(p && p.ws && p.ws.readyState === 1);
}
// L'ordi est toujours « connecté »
function isConnected(p) {
  return !!(p && (p.bot || isHumanOnline(p)));
}

// Ce que voit le joueur « i » : exactement la même chose pour un humain et pour l'ordi
function viewFor(room, i) {
  const names = room.players.map((p) => (p ? p.name : null));
  const connected = room.players.map(isConnected);
  return { type: 'state', you: i, names, connected, ...room.game.view(room.state, i, room) };
}

function broadcastState(room) {
  room.players.forEach((p, i) => {
    if (p && p.ws) send(p.ws, viewFor(room, i));
  });
  maybeBot(room);
}

function makeCtx(room) {
  return {
    room,
    full: room.players.every((p) => p !== null),
    // envoyer un message ponctuel (ex. effet) à un joueur ou à tous
    emit: (msg2, to = null) => room.players.forEach((p, i) => { if (p && (to === null || to === i)) send(p.ws, msg2); }),
  };
}

// ---------- L'ordi (joueur fantôme) ----------
// Il ne reçoit que la vue d'un joueur (viewFor) : il ne voit jamais les secrets.
// Ses coups passent par game.onMessage, avec les mêmes vérifications que ceux d'un humain.
const BOT_LEVELS = ['facile', 'moyen', 'difficile'];

function maybeBot(room) {
  const b = room.bot;
  if (!b || b.timer || !rooms.has(room.key)) return;
  const g = room.game;
  const view = viewFor(room, b.slot);
  if (g.botSee) g.botSee(view, b.mem);              // l'ordi observe (comme un joueur qui regarde l'écran)
  if (!g.botWants(view)) return;
  b.timer = setTimeout(() => {
    b.timer = null;
    if (!rooms.has(room.key)) return;
    const v = viewFor(room, b.slot);
    if (!g.botWants(v)) return;
    let move = null;
    try { move = g.botMove(v, b.level, b.mem); } catch (e) { console.error('IA', g.id, e); }
    if (!move) return;
    const changed = g.onMessage(room.state, b.slot, move, makeCtx(room));
    if (changed !== false) broadcastState(room);
  }, Math.max(150, g.botDelay ? g.botDelay(view, b.level) : 1200));
}

function scheduleCleanup(room) {
  clearTimeout(room.cleanup);
  if (!room.players.some(isHumanOnline)) {
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
    if (!msg || typeof msg !== 'object') return; // « null », un nombre… : ignoré (sinon le serveur plantait)

    if (msg.type === 'join') {
      // mode : 'create' (je crée la partie), 'join' (je rejoins), absent = reconnexion (page rechargée)
      const game = games.get(String(msg.game || ''));
      let code = String(msg.room || '').replace(/\D/g, '').slice(0, 4);
      const pid = String(msg.pid || '').slice(0, 64);
      const name = String(msg.name || '').trim().slice(0, 14) || 'Joueur';
      const mode = msg.mode;
      const fail = (c, message) => send(ws, { type: 'error', code: c, message });
      if (!game || !pid) return fail('bad', 'Jeu introuvable');

      // Partie contre l'ordi : nouvelle salle avec un code libre, l'ordi prend la 2e place
      if (mode === 'bot') {
        if (!game.botMove) return fail('nobot', 'Ce jeu ne se joue pas contre l\'ordi');
        do { code = String(Math.floor(Math.random() * 10000)).padStart(4, '0'); } while (rooms.has(game.id + ':' + code));
        const level = BOT_LEVELS.includes(msg.level) ? msg.level : 'moyen';
        room = getRoom(game, code);
        room.bot = { slot: 1, level, mem: {}, timer: null };
        room.players[0] = { pid, name, ws };
        room.players[1] = { pid: 'bot', name: game.botName ? game.botName(level) : '🤖 Ordi', ws: null, bot: true };
        slot = 0;
        send(ws, { type: 'joined', room: code, slot, bot: true });
        broadcastState(room);
        return;
      }
      if (code.length !== 4) return fail('bad', 'Le code doit faire 4 chiffres');

      const key = game.id + ':' + code;
      const existing = rooms.get(key);
      const mine = !!(existing && existing.players.some((p) => p && p.pid === pid));
      if (!mine) {
        const others = existing ? existing.players.filter(Boolean) : [];
        if (mode === 'create') {
          if (others.some(isConnected)) return fail('taken', 'Ce code est déjà pris, choisis-en un autre 🙃');
          if (existing) { clearTimeout(existing.cleanup); rooms.delete(key); } // vieille partie abandonnée
        }
        if (mode === 'join' && others.length === 0) return fail('notfound', 'Aucune partie avec ce code 🤔');
      }

      room = getRoom(game, code);
      slot = room.players.findIndex((p) => p && p.pid === pid);
      if (slot === -1) slot = room.players.findIndex((p) => p === null);
      if (slot === -1) {
        room = null;
        return fail('full', 'Cette partie est déjà complète 🙅');
      }
      const old = room.players[slot];
      if (old && old.ws && old.ws !== ws) { try { old.ws.close(); } catch {} }
      room.players[slot] = { pid, name, ws };
      clearTimeout(room.cleanup);
      if (room.game.onJoin) room.game.onJoin(room.state, slot, room);
      send(ws, { type: 'joined', room: code, slot });
      broadcastState(room);
      return;
    }

    if (!room || slot < 0) return;

    // Quitter la partie (retour au menu) : libère la place
    if (msg.type === 'leave') {
      room.players[slot] = null;
      if (!room.players.some((p) => p && !p.bot)) {
        clearTimeout(room.cleanup);
        if (room.bot) clearTimeout(room.bot.timer);
        rooms.delete(room.key);
      } else { room.state = room.game.init(); broadcastState(room); }
      room = null; slot = -1;
      return;
    }

    // Provocations : communes à tous les jeux
    if (msg.type === 'taunt') {
      const e = String(msg.e || '').slice(0, 8);
      room.players.forEach((p, i) => { if (p && i !== slot) send(p.ws, { type: 'taunt', e, from: slot }); });
      return;
    }

    const changed = room.game.onMessage(room.state, slot, msg, makeCtx(room));
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
