// Moteur de règles de PLOUF ! — traduction fidèle de scripts/rules.gd (projet Godot)
// Utilisé à la fois par le serveur (Node : require) et par la page (navigateur : window.PloufRules).
// L'état est un objet simple (JSON), copié à chaque action : on peut prévisualiser un coup sans toucher à la vraie partie.
(function (root) {
  'use strict';

  const COLS = 'abcdefghi';
  const DIRS = { U: [0, 1], D: [0, -1], L: [-1, 0], R: [1, 0] };
  const DIR_ORDER = ['U', 'D', 'L', 'R'];
  const MAX_ROUNDS = { 7: 20, 9: 25 };
  const SPEED_MAX_BONUS = 2; // vitesse permanente max = 1 + 2
  const TURBO = 3;
  const FORCE_MAX_BONUS = 2; // force max = 1 + 2
  // Nombre de chaque bonus par partie
  const BONUS_COUNTS = {
    7: { bottes: 5, force: 4, turbo: 2, bouclier: 1, aimant: 1, vague: 1, bouee: 1 },
    9: { bottes: 6, force: 6, turbo: 2, bouclier: 2, aimant: 2, vague: 2, bouee: 1 },
  };
  const BONUS_ORDER = ['bottes', 'force', 'bouclier', 'turbo', 'aimant', 'vague', 'bouee'];
  const POCKET_ITEMS = ['aimant', 'vague']; // objets gardés en poche (un seul à la fois)

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const key = (x, y) => x + ',' + y;
  const sq = (s) => [COLS.indexOf(s[0]), parseInt(s.slice(1), 10) - 1];
  const inBoard = (s, x, y) => x >= 0 && y >= 0 && x < s.n && y < s.n;

  // Plateau : piliers en quinconce, coins libres, passages vides symétriques
  function makeLayout(n) {
    const last = COLS[n - 1];
    let corners, empty;
    if (n === 7) {
      corners = ['a1', 'b1', 'a2', 'f1', 'g1', 'g2', 'a6', 'a7', 'b7', 'f7', 'g7', 'g6'];
      empty = ['d3', 'd5', 'c4', 'e4'];
    } else {
      corners = ['a1', 'b1', 'a2', 'h1', 'i1', 'i2', 'a8', 'a9', 'b9', 'h9', 'i9', 'i8'];
      empty = ['e5', 'e3', 'e7', 'c5', 'g5', 'e1', 'e9', 'a5', 'i5', 'c3', 'g7', 'g3', 'c7', 'b5', 'd5', 'f5', 'h5'];
    }
    const pillars = [], rocks = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const nm = COLS[x] + (y + 1);
        if (x % 2 === 1 && y % 2 === 1) pillars.push(nm);
        else if (!corners.includes(nm) && !empty.includes(nm)) rocks.push(nm);
      }
    }
    return { R: ['a1', last + '1'], P: ['a' + n, last + n], rocks, pillars, bonus: BONUS_COUNTS[n], n };
  }

  function mk(id, team, s) {
    const [x, y] = sq(s);
    return { id, team, x, y, alive: true, boots: 0, force: 0, turbo_end: -1, shield_end: -1, buoy: false, pocket: '', acts: 0 };
  }

  // mode : "joueur" (3 actions à partager) ou "pion" (2 actions par animal)
  function newGame(startTeam, mode = 'joueur', size = 9, rand = Math.random) {
    const L = makeLayout(size);
    const n = L.n;
    const animals = [];
    L.R.forEach((s, i) => animals.push(mk('R' + i, 0, s)));
    L.P.forEach((s, i) => animals.push(mk('P' + i, 1, s)));
    const teams = 2;
    startTeam = ((startTeam % teams) + teams) % teams;
    const pillars = {};
    for (const s of L.pillars) { const [x, y] = sq(s); pillars[key(x, y)] = true; }
    const bag = [];
    for (const b of BONUS_ORDER) for (let k = 0; k < (L.bonus[b] || 0); k++) bag.push(b);
    while (bag.length < L.rocks.length) bag.push(null);
    for (let j = bag.length - 1; j > 0; j--) { // mélange de Fisher-Yates
      const r = Math.floor(rand() * (j + 1));
      [bag[j], bag[r]] = [bag[r], bag[j]];
    }
    const rocks = {};
    L.rocks.forEach((s, j) => { const [x, y] = sq(s); rocks[key(x, y)] = bag[j]; });
    const s = {
      n, animals, pillars, rocks, items: {},
      mode, turn: startTeam, start_team: startTeam, turns: 0, actions_left: 0,
      teams, ploufs: [0, 0], over: false, winner: -1, end_reason: '',
    };
    startTurn(s);
    return s;
  }

  const byId = (s, id) => s.animals.find((a) => a.id === id) || null;
  const animalAt = (s, x, y) => s.animals.find((a) => a.alive && a.x === x && a.y === y) || null;
  const hasRock = (s, x, y) => Object.prototype.hasOwnProperty.call(s.rocks, key(x, y));
  const solid = (s, x, y) => !!s.pillars[key(x, y)] || hasRock(s, x, y);
  const blocked = (s, x, y) => solid(s, x, y) || !!animalAt(s, x, y);
  const turboOn = (s, a) => s.turns <= a.turbo_end;
  const speed = (s, a) => 1 + a.boots + (turboOn(s, a) ? TURBO : 0);
  const force = (s, a) => 1 + (a.force || 0); // de combien de cases on pousse
  const shielded = (s, a) => s.turns < a.shield_end;

  function aliveCount(s, team) {
    return s.animals.filter((a) => a.alive && a.team === team).length;
  }

  // Joueur suivant encore en vie
  function nextTeam(s, t) {
    const n = s.teams || 2;
    for (let i = 1; i <= n; i++) {
      const c = (t + i) % n;
      if (aliveCount(s, c) > 0) return c;
    }
    return (t + 1) % n;
  }

  // nombre de tours avant que « team » rejoue (en sautant les joueurs éliminés)
  function nextOwnTurn(s, team) {
    let steps = 0, t = s.turn;
    while (true) {
      t = nextTeam(s, t);
      steps++;
      if (t === team || steps > 8) break;
    }
    return s.turns + steps;
  }

  // Actions restantes pour un animal
  function actsFor(s, a) {
    if (!a.alive || a.team !== s.turn) return 0;
    if (s.mode === 'pion') return Math.max(0, 2 - a.acts);
    return s.actions_left;
  }

  function totalActs(s, team) {
    return s.animals.filter((a) => a.alive && a.team === team).reduce((n, a) => n + actsFor(s, a), 0);
  }

  // Ramasser un bonus au sol
  function pickup(s, a, steps) {
    const k = key(a.x, a.y);
    if (!Object.prototype.hasOwnProperty.call(s.items, k)) return;
    const b = s.items[k];
    delete s.items[k];
    switch (b) {
      case 'bottes': a.boots = Math.min(SPEED_MAX_BONUS, a.boots + 1); break;
      case 'force': a.force = Math.min(FORCE_MAX_BONUS, (a.force || 0) + 1); break;
      case 'turbo': a.turbo_end = nextOwnTurn(s, a.team); break;
      case 'bouclier': a.shield_end = nextOwnTurn(s, a.team); break;
      case 'bouee': a.buoy = true; break;
      default: a.pocket = b; // aimant, vague : dans la poche
    }
    steps.push({ type: 'pickup', id: a.id, bonus: b, x: a.x, y: a.y });
  }

  // Glissade forcée (pichenette, aimant) : jusqu'à dist cases, s'arrête avant un obstacle, tombe hors de l'île
  function shove(s, t, d, dist, steps) {
    for (let i = 0; i < dist; i++) {
      const nx = t.x + d[0], ny = t.y + d[1];
      if (!inBoard(s, nx, ny)) {
        if (t.buoy) {
          t.buoy = false;
          steps.push({ type: 'buoy', id: t.id, x: t.x, y: t.y });
          return;
        }
        t.alive = false;
        steps.push({ type: 'fall', id: t.id, x: nx, y: ny });
        s.ploufs[t.team] += 1;
        return;
      }
      if (blocked(s, nx, ny)) break;
      t.x = nx; t.y = ny;
      steps.push({ type: 'slide', id: t.id, x: nx, y: ny });
      pickup(s, t, steps);
    }
  }

  // Cases atteignables en au plus sp pas (chemin le plus court, en ramassant le plus de bonus possible)
  function reachable(s, a, sp) {
    const best = {};
    const frontier0 = [{ p: [a.x, a.y], path: [], items: 0 }];
    const seen = { [key(a.x, a.y)]: 0 };
    let frontier = frontier0;
    for (let step = 0; step < sp; step++) {
      const nxt = [];
      for (const f of frontier) {
        for (const dn of DIR_ORDER) {
          const q = [f.p[0] + DIRS[dn][0], f.p[1] + DIRS[dn][1]];
          if (!inBoard(s, q[0], q[1]) || blocked(s, q[0], q[1])) continue;
          const k = key(q[0], q[1]);
          const it = f.items + (Object.prototype.hasOwnProperty.call(s.items, k) ? 1 : 0);
          const path = f.path.concat([dn]);
          if (k in seen && seen[k] < step + 1) continue;
          if (k in best && best[k].items >= it) continue;
          seen[k] = step + 1;
          best[k] = { path, items: it, p: q };
          nxt.push({ p: q, path, items: it });
        }
      }
      frontier = nxt;
    }
    const res = Object.values(best).map((b) => ({
      kind: 'move', id: a.id, dir: b.path[0], path: b.path, dist: b.path.length, x: b.p[0], y: b.p[1],
    }));
    res.sort((m1, m2) => (m1.dist !== m2.dist ? m1.dist - m2.dist : (m1.y * 20 + m1.x) - (m2.y * 20 + m2.x)));
    return res;
  }

  // Animaux touchés par une vague lancée dans la direction d (devant, jusqu'au bord, à travers tout)
  function waveTargets(s, a, d) {
    const res = [];
    let x = a.x + d[0], y = a.y + d[1];
    while (inBoard(s, x, y)) {
      const t = animalAt(s, x, y);
      if (t && !shielded(s, t)) res.push(t);
      x += d[0]; y += d[1];
    }
    return res;
  }

  // ---------- Liste des actions possibles ----------
  function actionsForAnimal(s, a, withMoves = true) {
    const res = [];
    if (actsFor(s, a) <= 0 || s.over) return res;
    const sp = speed(s, a);
    // se déplacer : jusqu'à sp pas, en tournant comme on veut
    if (withMoves) for (const m of reachable(s, a, sp)) res.push(m);
    // casser un caillou : on peut marcher (en tournant) jusqu'à côté, puis taper. portée = vitesse
    const spots = [{ x: a.x, y: a.y, path: [] }];
    if (sp > 1) for (const m of reachable(s, a, sp - 1)) spots.push({ x: m.x, y: m.y, path: m.path });
    const bestBreak = {};
    for (const sp_ of spots) {
      for (const dn of DIR_ORDER) {
        const d = DIRS[dn];
        const rx = sp_.x + d[0], ry = sp_.y + d[1];
        if (!inBoard(s, rx, ry) || !hasRock(s, rx, ry)) continue;
        const k = key(rx, ry);
        const reach = sp_.path.length + 1;
        if (k in bestBreak && bestBreak[k].reach <= reach) continue;
        bestBreak[k] = { kind: 'break', id: a.id, dir: dn, path: sp_.path, x: rx, y: ry, reach };
      }
    }
    for (const k in bestBreak) res.push(bestBreak[k]);
    for (const dn of DIR_ORDER) {
      const d = DIRS[dn];
      const ax = a.x + d[0], ay = a.y + d[1];
      if (!inBoard(s, ax, ay)) continue;
      // pichenette : animal aligné à portée, chemin libre
      for (let i = 1; i <= sp; i++) {
        const fx = a.x + d[0] * i, fy = a.y + d[1] * i;
        if (!inBoard(s, fx, fy) || solid(s, fx, fy)) break;
        const t = animalAt(s, fx, fy);
        if (t) {
          if (!shielded(s, t)) res.push({ kind: 'flick', id: a.id, dir: dn, target: t.id, x: fx, y: fy, reach: i });
          break;
        }
      }
      // vague : pousse d'une case tous les animaux devant, sur toute la ligne
      if (a.pocket === 'vague') {
        if (waveTargets(s, a, d).length) res.push({ kind: 'wave', id: a.id, dir: dn, x: ax, y: ay });
      }
      // aimant : premier animal aligné, au moins une case d'écart
      if (a.pocket === 'aimant') {
        let mx = ax, my = ay, gap = 0;
        while (inBoard(s, mx, my) && !solid(s, mx, my) && !animalAt(s, mx, my)) { mx += d[0]; my += d[1]; gap++; }
        if (inBoard(s, mx, my)) {
          const t2 = animalAt(s, mx, my);
          if (t2 && gap > 0 && !shielded(s, t2)) res.push({ kind: 'magnet', id: a.id, dir: dn, target: t2.id, x: mx, y: my, gap });
        }
      }
    }
    return res;
  }

  function legalActions(s, withMoves = true) {
    const res = [];
    if (s.over) return res;
    for (const a of s.animals) if (a.alive && a.team === s.turn) res.push(...actionsForAnimal(s, a, withMoves));
    return res;
  }

  // ---------- Appliquer une action ----------
  // Renvoie { state: nouvel état, steps: étapes à animer }
  function applyAction(s0, act) {
    const s = clone(s0);
    const steps = [];
    const a = byId(s, act.id);
    const d = DIRS[act.dir];
    const walk = (dn) => {
      const dd = DIRS[dn];
      a.x += dd[0]; a.y += dd[1];
      steps.push({ type: 'walk', id: a.id, x: a.x, y: a.y });
      pickup(s, a, steps);
    };
    switch (act.kind) {
      case 'move': {
        let path = act.path || [];
        if (!path.length) path = Array(act.dist).fill(act.dir);
        path.forEach(walk);
        break;
      }
      case 'break': {
        let bpath = act.path || [];
        if (!bpath.length) bpath = Array(Math.max(0, (act.reach || 1) - 1)).fill(act.dir);
        bpath.forEach(walk);
        const k = key(act.x, act.y);
        const b = s.rocks[k];
        delete s.rocks[k];
        if (b !== null && b !== undefined) s.items[k] = b;
        steps.push({ type: 'break', id: a.id, x: act.x, y: act.y, bonus: b || '' });
        break;
      }
      case 'flick': {
        const t = byId(s, act.target);
        const power = force(s, a);
        for (let i = 1; i < (act.reach || 1); i++) walk(act.dir);
        steps.push({ type: 'flick', id: a.id, target: t.id, x: t.x, y: t.y, power });
        shove(s, t, d, power, steps);
        break;
      }
      case 'wave': {
        a.pocket = '';
        const hit = waveTargets(s, a, d);
        steps.push({ type: 'wave', id: a.id, dir: act.dir, x: a.x, y: a.y });
        hit.reverse(); // on pousse d'abord le plus loin, pour faire de la place aux autres
        for (const t of hit) if (t.alive) shove(s, t, d, 1, steps);
        break;
      }
      case 'magnet': {
        const t = byId(s, act.target);
        a.pocket = '';
        steps.push({ type: 'magnet', id: a.id, target: t.id });
        shove(s, t, [-d[0], -d[1]], act.gap, steps);
        break;
      }
    }
    // compter l'action
    if (s.mode === 'pion') a.acts += 1;
    else s.actions_left -= 1;
    checkWin(s);
    if (!s.over) {
      if (totalActs(s, s.turn) <= 0 || legalActions(s).length === 0 || aliveCount(s, s.turn) === 0) endTurn(s, steps);
    }
    return { state: s, steps };
  }

  function passTurn(s0) {
    const s = clone(s0);
    const steps = [];
    endTurn(s, steps);
    return { state: s, steps };
  }

  function startTurn(s) {
    s.actions_left = 3;
    for (const a of s.animals) a.acts = 0;
    checkWin(s);
  }

  function endTurn(s, steps) {
    s.turns += 1;
    s.turn = nextTeam(s, s.turn);
    if (s.turns >= (MAX_ROUNDS[s.n] || 20) * (s.teams || 2)) {
      s.over = true; s.winner = -1; s.end_reason = 'limit';
      return;
    }
    steps.push({ type: 'turn', team: s.turn });
    startTurn(s);
  }

  function checkWin(s) {
    if (s.over) return;
    const left = [];
    for (let t = 0; t < (s.teams || 2); t++) if (aliveCount(s, t) > 0) left.push(t);
    if (left.length <= 1) {
      s.over = true; s.end_reason = 'plouf';
      s.winner = left.length === 1 ? left[0] : -1;
    }
  }

  const api = {
    COLS, DIRS, DIR_ORDER, MAX_ROUNDS, TURBO, BONUS_COUNTS, BONUS_ORDER, POCKET_ITEMS,
    key, inBoard, makeLayout, newGame, byId, animalAt, hasRock, solid, blocked,
    speed, force, shielded, turboOn, actsFor, totalActs, reachable, waveTargets,
    actionsForAnimal, legalActions, applyAction, passTurn, aliveCount, nextTeam, clone,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PloufRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
