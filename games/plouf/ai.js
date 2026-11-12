// IA de PLOUF ! — traduction de scripts/ai.gd (projet Godot), trois niveaux.
// Elle ne triche pas : elle reçoit l'état tel qu'un joueur le voit (cailloux masqués).
// Différence avec la version Godot : pour estimer ce que vaut un caillou, elle ne lit pas son contenu réel.
// Elle part du nombre total de bonus de chaque sorte (connu de tous) moins ceux déjà sortis (vus à l'écran).
const R = require('./rules.js');

const LEVELS = { facile: 1, moyen: 2, difficile: 3 };
const BONUS_VALUE = { bottes: 40, force: 45, turbo: 25, bouclier: 20, aimant: 30, vague: 35, bouee: 55 };

const alive = (s, team) => R.aliveCount(s, team);

// Valeur moyenne d'un caillou cassé : bonus encore cachés (estimés) / cailloux restants
function rockValue(s, revealed) {
  const n = Object.keys(s.rocks).length;
  if (!n) return 0;
  const counts = R.BONUS_COUNTS[s.n] || {};
  let tot = 0;
  for (const b in counts) tot += Math.max(0, counts[b] - (revealed[b] || 0)) * (BONUS_VALUE[b] || 0);
  return tot / n;
}

const breakBonus = (a, ev) => (a.kind === 'break' ? ev * 0.8 : 0);

// Copie de l'état comme si c'était au tour de « team » (pour mesurer ses menaces)
function asTurn(s, team) {
  const c = R.clone(s);
  c.turn = team;
  c.actions_left = 3;
  for (const a of c.animals) a.acts = 0;
  return c;
}

// Nombre d'animaux adverses que « team » (qui a la main dans s) peut faire tomber.
// deep = aussi en deux actions (se placer puis pousser, ou pousser deux fois).
function threat(s, team, deep) {
  const base = alive(s, 1 - team);
  let best = 0;
  for (const a of R.legalActions(s, deep)) {
    if ((a.kind === 'move' || a.kind === 'break') && !deep) continue;
    const r = R.applyAction(s, a);
    const lost = base - alive(r.state, 1 - team);
    if (lost > best) best = lost;
    if (deep && !r.state.over && r.state.turn === team) {
      for (const a2 of R.legalActions(r.state, false)) {
        if (a2.kind === 'move' || a2.kind === 'break') continue;
        const r2 = R.applyAction(r.state, a2);
        const lost2 = base - alive(r2.state, 1 - team);
        if (lost2 > best) best = lost2;
      }
    }
  }
  return best;
}

// Note d'une position pour l'équipe « team »
function evaluate(s, team, deep) {
  const me = alive(s, team), op = alive(s, 1 - team);
  if (s.over) {
    if (s.winner === team) return 100000;
    if (s.winner === 1 - team) return -100000;
  }
  let v = (me - op) * 1000;
  const n = s.n;
  const itemKeys = Object.keys(s.items).map((k) => k.split(',').map(Number));
  for (const a of s.animals) {
    if (!a.alive) continue;
    const sign = a.team === team ? 1 : -1;
    let w = 0;
    w += a.boots * 40;
    w += (a.force || 0) * 45;
    if (R.turboOn(s, a)) w += 18;
    if (R.shielded(s, a)) w += 15;
    if (a.buoy) w += 55;
    if (a.pocket === 'aimant') w += 30;
    else if (a.pocket === 'vague') w += 35;
    // le bord, c'est dangereux
    const edge = Math.min(a.x, a.y, n - 1 - a.x, n - 1 - a.y);
    if (edge === 0) w -= 22;
    else if (edge === 1) w -= 6;
    // se rapprocher des bonus au sol
    let bestD = 99;
    for (const [ix, iy] of itemKeys) bestD = Math.min(bestD, Math.abs(ix - a.x) + Math.abs(iy - a.y));
    if (bestD < 99) w += Math.max(0, 14 - bestD * 3);
    v += sign * w;
  }
  // menaces : que peut faire l'équipe qui jouera ensuite ?
  if (!s.over) {
    if (s.turn === team) v += threat(s, team, false) * 120;
    else v -= threat(s, s.turn, deep) * 650;
    if (s.turn !== team) v += threat(asTurn(s, team), team, false) * 90;
  }
  return v;
}

// Choisit la prochaine action de l'équipe dont c'est le tour. Renvoie null pour terminer le tour (passer).
function choose(s, levelName, revealed = {}, rand = Math.random) {
  const level = LEVELS[levelName] || 2;
  const team = s.turn;
  const acts = R.legalActions(s);
  if (!acts.length) return null;
  const ev = rockValue(s, revealed);

  // --- Facile : surtout au hasard, mais saute sur un PLOUF évident une fois sur deux
  if (level <= 1) {
    let best = null, bestV = -Infinity;
    for (const a of acts) {
      const r = R.applyAction(s, a);
      let v = (alive(r.state, team) - alive(r.state, 1 - team)) * 100;
      if (a.kind !== 'move') v += 5;
      v += rand() * 30;
      if (v > bestV) { bestV = v; best = a; }
    }
    if (bestV >= 100 && rand() < 0.5) return best;
    let pool = acts.filter((a) => a.kind !== 'move');
    if (!pool.length || rand() < 0.5) pool = acts;
    return pool[Math.floor(rand() * pool.length)];
  }

  // --- Moyen : meilleure action tout de suite (regarde les dangers immédiats)
  if (level === 2) {
    let best = null, bestV = -Infinity;
    for (const a of acts) {
      const r = R.applyAction(s, a);
      const v = evaluate(r.state, team, false) + breakBonus(a, ev) + rand() * 25;
      if (v > bestV) { bestV = v; best = a; }
    }
    return best;
  }

  // --- Difficile : prévoit toute la fin du tour, et les ripostes en deux coups
  let beam = acts.map((a) => ({ state: R.applyAction(s, a).state, first: a, bonus: breakBonus(a, ev), score: 0 }));
  const finals = [];
  let depth = 0;
  while (beam.length && depth < 6) {
    depth++;
    for (const b of beam) b.score = evaluate(b.state, team, false) + b.bonus;
    beam.sort((x, y) => y.score - x.score);
    beam = beam.slice(0, 5);
    const next = [];
    for (const b of beam) {
      const st = b.state;
      finals.push(b); // on peut aussi s'arrêter là
      if (st.over || st.turn !== team) continue;
      for (const a of R.legalActions(st)) {
        next.push({ state: R.applyAction(st, a).state, first: b.first, bonus: b.bonus + breakBonus(a, ev), score: 0 });
      }
    }
    beam = next;
  }
  // note finale avec les ripostes adverses en deux coups
  for (const f of finals) f.score = evaluate(f.state, team, true) + f.bonus + rand() * 3;
  finals.sort((x, y) => y.score - x.score);
  return finals[0].first;
}

module.exports = { choose, evaluate, LEVELS };
