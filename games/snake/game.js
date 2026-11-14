// THE SNAKE — logique serveur
// Deux serpents sur le même terrain, en temps réel. Le serveur fait avancer le jeu pas à pas (c'est lui l'arbitre),
// reçoit les changements de direction des téléphones et envoie l'état du terrain à chaque pas (message « tick »).
// Le dernier serpent en vie gagne ; si le temps est écoulé, le plus long gagne.

const COLS = 15, ROWS = 21;
const ROUND_MS = 120000; // 2 minutes par manche
const DIFFS = {
  facile: { ms: 150, minMs: 120, wrap: true,  rocks: 0, apples: 2 }, // lent, on traverse les murs
  normal: { ms: 115, minMs: 85,  wrap: false, rocks: 0, apples: 1 }, // les murs sont mortels
  expert: { ms: 95,  minMs: 62,  wrap: false, rocks: 8, apples: 1 }, // rapide, rochers, ça accélère
};
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
const rnd = (n) => Math.floor(Math.random() * n);
const key = (x, y) => x + ',' + y;

function fresh(score = [0, 0], gameNo = 0, diff = 'normal') {
  return {
    phase: 'lobby', diff, ready: [false, false],
    snakes: [], food: [], rocks: [], tick: 0, tickMs: DIFFS[diff].ms,
    startAt: 0, endAt: 0, winner: null, cause: [null, null], rematch: [false, false], score, gameNo,
  };
}

// ---------- Terrain ----------
function occupied(m) {
  const occ = new Set();
  m.rocks.forEach(([x, y]) => occ.add(key(x, y)));
  m.snakes.forEach((s) => s.body.forEach(([x, y]) => occ.add(key(x, y))));
  m.food.forEach((f) => occ.add(key(f.x, f.y)));
  return occ;
}
function freeCell(m) {
  const occ = occupied(m);
  for (let i = 0; i < 400; i++) {
    const x = rnd(COLS), y = rnd(ROWS);
    if (!occ.has(key(x, y))) return [x, y];
  }
  return null;
}
function addFood(m, gold) {
  const c = freeCell(m); if (!c) return;
  m.food.push({ x: c[0], y: c[1], gold: !!gold, exp: gold ? Date.now() + 7000 : 0 });
}

function newRound(m, ctx) {
  const D = DIFFS[m.diff];
  m.phase = 'play';
  m.gameNo++;
  m.tick = 0;
  m.tickMs = D.ms;
  m.winner = null; m.cause = [null, null]; m.rematch = [false, false];
  // départs symétriques : en bas à gauche vers le haut, en haut à droite vers le bas
  m.snakes = [
    { body: [[3, ROWS - 5], [3, ROWS - 4], [3, ROWS - 3], [3, ROWS - 2]], dir: 'up', queue: [], alive: true, grow: 0, eaten: 0 },
    { body: [[COLS - 4, 4], [COLS - 4, 3], [COLS - 4, 2], [COLS - 4, 1]], dir: 'down', queue: [], alive: true, grow: 0, eaten: 0 },
  ];
  // rochers posés en symétrie (même difficulté pour les deux), loin des départs
  m.rocks = [];
  const used = new Set(m.snakes.flatMap((s) => s.body.map(([x, y]) => key(x, y))));
  let guard = 0;
  while (m.rocks.length < D.rocks && guard++ < 500) {
    const x = 1 + rnd(COLS - 2), y = 2 + rnd(ROWS - 4), x2 = COLS - 1 - x, y2 = ROWS - 1 - y;
    if (x === 3 || x === COLS - 4 || x2 === 3 || x2 === COLS - 4) continue; // couloirs de départ libres
    if (Math.abs(x - 3) + Math.abs(y - (ROWS - 5)) < 5 || Math.abs(x2 - 3) + Math.abs(y2 - (ROWS - 5)) < 5) continue; // et de la place autour des têtes
    if (used.has(key(x, y)) || used.has(key(x2, y2)) || (x === x2 && y === y2)) continue;
    m.rocks.push([x, y], [x2, y2]); used.add(key(x, y)); used.add(key(x2, y2));
  }
  m.food = [];
  for (let i = 0; i < D.apples; i++) addFood(m, false);
  m.startAt = Date.now() + 3600; // compte à rebours
  m.endAt = m.startAt + ROUND_MS;
  m.nextGold = m.startAt + 9000 + rnd(6000);
  run(m, ctx);
}

// ---------- La boucle de jeu ----------
function run(m, ctx) {
  clearTimeout(m._timer);
  const room = ctx.room, emit = ctx.emit;
  // ces deux propriétés ne partent jamais vers les téléphones (voir view)
  Object.defineProperty(m, '_room', { value: room, writable: true, configurable: true });
  Object.defineProperty(m, '_emit', { value: emit, writable: true, configurable: true });
  const loop = () => {
    if (room.state !== m || m.phase !== 'play') return;          // partie abandonnée ou terminée
    const now = Date.now();
    const humansOnline = room.players.some((p) => p && !p.bot && p.ws && p.ws.readyState === 1);
    if (!humansOnline) { m.startAt += 500; m.endAt += 500; m._timer = setTimeout(loop, 500); return; } // personne : pause
    if (now < m.startAt) { m._timer = setTimeout(loop, Math.min(100, m.startAt - now)); return; }
    step(m);
    emit({ type: 'tick', ...publicView(m) });
    if (m.phase === 'play') m._timer = setTimeout(loop, m.tickMs);
  };
  Object.defineProperty(m, '_timer', { value: setTimeout(loop, 50), writable: true, configurable: true });
}

function step(m) {
  const D = DIFFS[m.diff], now = Date.now();
  m.tick++;
  // l'ordi choisit sa direction (il voit le terrain comme un joueur : rien n'est caché dans ce jeu)
  if (m._room && m._room.bot) {
    const s = m.snakes[1];
    if (s.alive) { const d = botDir(m, 1, m._room.bot.level); if (d) s.queue = [d]; }
  }
  // 1. nouvelles têtes
  const heads = m.snakes.map((s) => {
    if (!s.alive) return null;
    while (s.queue.length) { const d = s.queue.shift(); if (d !== OPP[s.dir] && d !== s.dir) { s.dir = d; break; } }
    let [x, y] = s.body[0]; const [dx, dy] = DIRS[s.dir];
    x += dx; y += dy;
    if (D.wrap) { x = (x + COLS) % COLS; y = (y + ROWS) % ROWS; }
    return [x, y];
  });
  // 2. on mange ?
  const ate = heads.map((h) => (h ? m.food.findIndex((f) => f.x === h[0] && f.y === h[1]) : -1));
  // 3. les queues avancent (sauf si le serpent grandit)
  m.snakes.forEach((s, i) => {
    if (!heads[i]) return;
    if (ate[i] >= 0) s.grow += m.food[ate[i]].gold ? 3 : 1;
    s.body.unshift(heads[i]);
    if (s.grow > 0) s.grow--; else s.body.pop();
  });
  // 4. collisions
  const rocks = new Set(m.rocks.map(([x, y]) => key(x, y)));
  const dead = [false, false];
  heads.forEach((h, i) => {
    if (!h) return;
    const [x, y] = h;
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) { dead[i] = true; m.cause[i] = 'wall'; return; }
    if (rocks.has(key(x, y))) { dead[i] = true; m.cause[i] = 'rock'; return; }
    const j = 1 - i, o = heads[j];
    if (o && o[0] === x && o[1] === y) { dead[i] = true; m.cause[i] = 'head'; return; }
    if (m.snakes[i].body.slice(1).some(([a, b]) => a === x && b === y)) { dead[i] = true; m.cause[i] = 'self'; return; }
    if (m.snakes[j].body.slice(o ? 1 : 0).some(([a, b]) => a === x && b === y)) { dead[i] = true; m.cause[i] = 'other'; }
  });
  dead.forEach((d, i) => { if (d) { m.snakes[i].alive = false; m.snakes[i].body.shift(); } }); // la tête reste contre l'obstacle
  // 5. pommes mangées → nouvelles pommes, et ça accélère un peu
  const eatenIdx = [...new Set(ate.filter((a, i) => a >= 0 && !dead[i]))].sort((a, b) => b - a);
  eatenIdx.forEach((a) => {
    const gold = m.food[a].gold;
    m.food.splice(a, 1);
    if (!gold) addFood(m, false);
  });
  ate.forEach((a, i) => { if (a >= 0 && !dead[i]) m.snakes[i].eaten++; });
  if (eatenIdx.length && m.diff === 'expert') m.tickMs = Math.max(D.minMs, m.tickMs - 2);
  if (eatenIdx.length && m.diff !== 'expert') m.tickMs = Math.max(D.minMs, m.tickMs - 1);
  // pomme d'or de temps en temps (vaut 3), elle disparaît au bout de 7 s
  m.food = m.food.filter((f) => !f.gold || f.exp > now);
  if (now > m.nextGold) { if (!m.food.some((f) => f.gold)) addFood(m, true); m.nextGold = now + 12000 + rnd(8000); }
  // 6. fin de manche ?
  const alive = m.snakes.map((s) => s.alive);
  if (!alive[0] || !alive[1]) {
    m.winner = alive[0] ? 0 : alive[1] ? 1 : 'draw';
  } else if (now >= m.endAt) {
    const l0 = m.snakes[0].body.length, l1 = m.snakes[1].body.length;
    m.winner = l0 > l1 ? 0 : l1 > l0 ? 1 : 'draw';
    m.cause = ['time', 'time'];
  }
  if (m.winner !== null) {
    m.phase = 'over';
    if (m.winner !== 'draw') m.score[m.winner]++;
  }
}

// ---------- L'ordi ----------
// facile : regarde juste devant lui et se trompe parfois ; moyen : va vers la pomme sans s'enfermer ;
// difficile : plus court chemin, garde de l'espace et évite la tête de l'adversaire.
function botDir(m, i, level) {
  const D = DIFFS[m.diff], s = m.snakes[i], o = m.snakes[1 - i];
  const block = new Set(m.rocks.map(([x, y]) => key(x, y)));
  m.snakes.forEach((sn) => sn.body.slice(0, sn.grow > 0 ? sn.body.length : sn.body.length - 1).forEach(([x, y]) => block.add(key(x, y))));
  const nextOf = ([x, y], d) => {
    x += DIRS[d][0]; y += DIRS[d][1];
    if (D.wrap) { x = (x + COLS) % COLS; y = (y + ROWS) % ROWS; }
    return [x, y];
  };
  const inside = ([x, y]) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
  const safe = (c) => inside(c) && !block.has(key(c[0], c[1]));
  const danger = new Set();
  if (o.alive) Object.keys(DIRS).forEach((d) => { const c = nextOf(o.body[0], d); danger.add(key(c[0], c[1])); });
  const space = (start, cap) => { // nombre de cases libres atteignables
    const seen = new Set([key(start[0], start[1])]), q = [start];
    while (q.length && seen.size < cap) {
      const c = q.shift();
      for (const d of Object.keys(DIRS)) { const n = nextOf(c, d), k = key(n[0], n[1]); if (!seen.has(k) && safe(n)) { seen.add(k); q.push(n); } }
    }
    return seen.size;
  };
  const distFood = (start) => { // plus court chemin vers une pomme
    const goals = new Set(m.food.map((f) => key(f.x, f.y)));
    const seen = new Set([key(start[0], start[1])]); let q = [start], dist = 0;
    while (q.length && dist < 60) {
      const nq = [];
      for (const c of q) {
        if (goals.has(key(c[0], c[1]))) return dist;
        for (const d of Object.keys(DIRS)) { const n = nextOf(c, d), k = key(n[0], n[1]); if (!seen.has(k) && safe(n)) { seen.add(k); nq.push(n); } }
      }
      q = nq; dist++;
    }
    return 99;
  };
  const opts = Object.keys(DIRS).filter((d) => d !== OPP[s.dir]).map((d) => ({ d, c: nextOf(s.body[0], d) })).filter((x) => safe(x.c));
  if (!opts.length) return s.dir;
  if (level === 'facile') {
    if (Math.random() < 0.12) return opts[rnd(opts.length)].d;              // distrait
    const f = m.food[0];
    if (!f) return opts[0].d;
    opts.sort((a, b) => (Math.abs(a.c[0] - f.x) + Math.abs(a.c[1] - f.y)) - (Math.abs(b.c[0] - f.x) + Math.abs(b.c[1] - f.y)));
    return opts[0].d;
  }
  const need = s.body.length + 2;
  for (const x of opts) {
    x.space = space(x.c, need + 10);
    x.dist = level === 'moyen' && Math.random() < 0.15 ? 50 : distFood(x.c);
    x.risk = level === 'difficile' && danger.has(key(x.c[0], x.c[1])) && o.body.length >= s.body.length ? 1 : 0;
  }
  opts.sort((a, b) => (a.risk - b.risk) || ((b.space >= need) - (a.space >= need)) || (a.dist - b.dist) || (b.space - a.space));
  return opts[0].d;
}

function publicView(m) {
  return {
    phase: m.phase, diff: m.diff, ready: m.ready, cols: COLS, rows: ROWS,
    snakes: m.snakes.map((s) => ({ body: s.body, dir: s.dir, alive: s.alive, eaten: s.eaten })),
    food: m.food, rocks: m.rocks, tick: m.tick, tickMs: m.tickMs,
    startAt: m.startAt, endAt: m.endAt, serverNow: Date.now(),
    winner: m.winner, cause: m.cause, rematch: m.rematch, score: m.score, gameNo: m.gameNo,
  };
}

module.exports = {
  name: 'The Snake',
  emoji: '🐍',
  description: 'Deux serpents, un seul terrain : mange les pommes, grandis et fais cogner l\'autre. 3 difficultés !',
  color: '#2fbf5b',
  maxPlayers: 2,

  init: () => fresh(),

  onMessage(m, slot, msg, ctx) {
    const bot = !!ctx.room.bot;
    // Le créateur de la partie (ou le joueur contre l'ordi) choisit la difficulté
    if (msg.type === 'config') {
      if (slot !== 0 || m.phase === 'play' || !DIFFS[msg.diff]) return false;
      m.diff = msg.diff; m.tickMs = DIFFS[m.diff].ms;
      return true;
    }
    if (msg.type === 'ready') {
      if (m.phase !== 'lobby') return false;
      m.ready[slot] = true;
      if (bot) m.ready[1] = true;
      if (ctx.full && m.ready[0] && m.ready[1]) newRound(m, ctx);
      return true;
    }
    if (msg.type === 'dir') {
      const s = m.snakes[slot];
      if (m.phase !== 'play' || !s || !s.alive || !DIRS[msg.d]) return false;
      const lastDir = s.queue.length ? s.queue[s.queue.length - 1] : s.dir;
      if (msg.d === lastDir || msg.d === OPP[lastDir] || s.queue.length >= 3) return false;
      s.queue.push(msg.d);
      return false; // pas de diffusion : le prochain « tick » montrera le virage
    }
    if (msg.type === 'rematch') {
      if (m.phase !== 'over') return false;
      m.rematch[slot] = true;
      if (bot) m.rematch[1] = true;
      if (m.rematch[0] && m.rematch[1]) newRound(m, ctx);
      return true;
    }
    return false;
  },

  // Contre l'ordi : il joue dans la boucle du serveur (voir botDir), pas via les tours du serveur commun
  botName: (level) => ({ facile: '🐛 Ordi Ver de terre', moyen: '🐍 Ordi Couleuvre', difficile: '🐉 Ordi Cobra' }[level] || '🐍 Ordi'),
  botWants: () => false,
  botMove: () => null,

  view: (m) => publicView(m),
};
