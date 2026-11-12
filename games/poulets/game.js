// Duel de Poulets — logique serveur
//
// Interface d'un jeu (à reproduire pour les prochains) :
//   name, emoji, description, color, maxPlayers
//   init()                          → état initial d'une partie
//   onMessage(state, slot, msg, ctx) → applique une action ; return false si rien n'a changé
//   view(state, slot)               → ce que le joueur `slot` a le droit de voir (cacher les secrets !)

const MAX_HP = 5;
const MAX_SEEDS = 5;
const START_SEEDS = 1;
const COST = { picorer: 0, bec: 1, plumes: 0, oeuf: 2, mega: 3 };
const ACTIONS = Object.keys(COST);

function newGame(score = [0, 0], gameNo = 1) {
  return {
    gameNo, // change à chaque revanche : le téléphone repart de zéro
    hp: [MAX_HP, MAX_HP],
    seeds: [START_SEEDS, START_SEEDS],
    lastAction: [null, null],
    choices: [null, null],
    round: 1,
    winner: null, // null | 0 | 1 | 'draw'
    lastResult: null,
    rematch: [false, false],
    score,
  };
}

function canPlay(g, i, a) {
  if (g.winner !== null) return false;
  if (!ACTIONS.includes(a)) return false;
  if (COST[a] > g.seeds[i]) return false;
  if (a === 'plumes' && g.lastAction[i] === 'plumes') return false;
  return true;
}

function resolve(g) {
  const a = g.choices.slice();
  const dmg = [0, 0];
  const blocked = [false, false];
  const reflected = [false, false];

  for (let i = 0; i < 2; i++) g.seeds[i] -= COST[a[i]];
  for (let i = 0; i < 2; i++) {
    if (a[i] === 'picorer') g.seeds[i] = Math.min(MAX_SEEDS, g.seeds[i] + 1);
  }

  // j attaque i
  for (let j = 0; j < 2; j++) {
    const i = 1 - j;
    if (a[j] !== 'bec' && a[j] !== 'mega') continue;
    const power = a[j] === 'mega' ? 2 : 1;
    if (a[i] === 'oeuf') {
      dmg[j] += 2;
      reflected[i] = true;
    } else if (a[i] === 'plumes' && a[j] === 'bec') {
      blocked[i] = true;
    } else {
      dmg[i] += power;
    }
  }

  for (let i = 0; i < 2; i++) g.hp[i] = Math.max(0, g.hp[i] - dmg[i]);

  g.lastResult = { round: g.round, actions: a, dmg, blocked, reflected };
  g.lastAction = a;
  g.choices = [null, null];
  g.round++;

  if (g.hp[0] === 0 && g.hp[1] === 0) g.winner = 'draw';
  else if (g.hp[0] === 0) g.winner = 1;
  else if (g.hp[1] === 0) g.winner = 0;
  if (g.winner === 0 || g.winner === 1) g.score[g.winner]++;
}

module.exports = {
  name: 'Duel de Poulets',
  emoji: '🐔',
  description: 'Bluff, graines et coups de bec. Devine ce que l\'autre va jouer !',
  color: '#ff7a1a',
  maxPlayers: 2,

  init: () => newGame(),

  onMessage(g, slot, msg, ctx) {
    if (msg.type === 'choose') {
      if (!ctx.full || !canPlay(g, slot, msg.action)) return false;
      g.choices[slot] = msg.action;
      if (g.choices[0] && g.choices[1]) resolve(g);
      return true;
    }
    if (msg.type === 'rematch') {
      if (g.winner === null) return false;
      g.rematch[slot] = true;
      if (g.rematch[0] && g.rematch[1]) Object.assign(g, newGame(g.score, g.gameNo + 1));
      return true;
    }
    return false;
  },

  // ---------- Contre l'ordi ----------
  // L'ordi choisit SANS voir ton choix (la vue cache le choix adverse : seulement « a choisi »).
  // Il ne connaît que ce qui est public : cœurs, graines, actions révélées des rounds précédents.
  botName: (level) => `🤖 Poulet-Ordi (${level})`,

  // Il retient tes habitudes à partir des révélations (ce que tout le monde voit à l'écran)
  botSee(v, mem) {
    if (!mem.hist) mem.hist = [];
    const r = v.lastResult;
    if (r && r.round !== mem.lastRound && (mem.gameNo !== v.gameNo || r.round > (mem.lastRound || 0))) {
      // graines de l'adversaire AVANT ce round (pour savoir dans quelle situation il a joué)
      mem.hist.push({ seeds: mem.prevOppSeeds ?? 1, a: r.actions[1 - v.you] });
      if (mem.hist.length > 60) mem.hist.shift();
    }
    if (mem.gameNo !== v.gameNo && !r) mem.prevOppSeeds = START_SEEDS;
    mem.gameNo = v.gameNo; mem.lastRound = r ? r.round : 0;
    mem.prevOppSeeds = v.seeds[1 - v.you];
  },

  botWants: (v) => (v.winner !== null ? !v.rematch[v.you] : !v.myChoice),
  botDelay: (v) => (v.winner !== null ? 3500 : 900 + Math.random() * 2600),

  botMove(v, level, mem) {
    if (v.winner !== null) return { type: 'rematch' };
    const me = v.you, op = 1 - me;
    const g = { hp: v.hp.slice(), seeds: v.seeds.slice(), lastAction: v.lastAction.slice(), winner: null };
    const mine = ACTIONS.filter((a) => canPlay(g, me, a));
    const theirs = ACTIONS.filter((a) => canPlay(g, op, a));
    if (level === 'facile') return { type: 'choose', action: mine[Math.floor(Math.random() * mine.length)] };

    // Valeur d'un round simulé (mes actions × les siennes)
    const value = (ma, oa) => {
      const sim = { hp: g.hp.slice(), seeds: g.seeds.slice(), lastAction: g.lastAction.slice(), choices: [null, null],
        round: 0, winner: null, score: [0, 0], lastResult: null };
      sim.choices[me] = ma; sim.choices[op] = oa;
      resolve(sim);
      if (sim.winner === me) return 1000;
      if (sim.winner === op) return -1000;
      if (sim.winner === 'draw') return -150;
      return 10 * (sim.hp[me] - sim.hp[op]) + 2.4 * (sim.seeds[me] - sim.seeds[op]) - (sim.lastAction[me] === 'plumes' ? 1 : 0);
    };

    // Ce que l'adversaire risque de jouer
    let prob = Object.fromEntries(theirs.map((a) => [a, 1 / theirs.length]));
    if (level === 'difficile' && mem.hist && mem.hist.length >= 3) {
      // ses habitudes dans une situation proche (même niveau de graines), lissées
      const bucket = (n) => (n === 0 ? 0 : n <= 2 ? 1 : 2);
      const same = mem.hist.filter((h) => bucket(h.seeds) === bucket(g.seeds[op]));
      const pool = same.length >= 3 ? same : mem.hist;
      const counts = Object.fromEntries(theirs.map((a) => [a, 1]));
      for (const h of pool) if (h.a in counts) counts[h.a] += 2;
      const tot = Object.values(counts).reduce((x, y) => x + y, 0);
      prob = Object.fromEntries(theirs.map((a) => [a, counts[a] / tot]));
    }

    // Espérance de chaque action, puis choix « mixte » (pour ne pas être prévisible)
    const ev = mine.map((ma) => ({ a: ma, v: theirs.reduce((t, oa) => t + prob[oa] * value(ma, oa), 0) }));
    const temp = level === 'difficile' ? 2.5 : 7;
    const maxV = Math.max(...ev.map((e) => e.v));
    const w = ev.map((e) => Math.exp((e.v - maxV) / temp));
    let x = Math.random() * w.reduce((t, y) => t + y, 0);
    for (let i = 0; i < ev.length; i++) { x -= w[i]; if (x <= 0) return { type: 'choose', action: ev[i].a }; }
    return { type: 'choose', action: ev[ev.length - 1].a };
  },

  view(g, i) {
    return {
      gameNo: g.gameNo,
      hp: g.hp,
      seeds: g.seeds,
      round: g.round,
      myChoice: g.choices[i],
      oppReady: g.choices[1 - i] !== null, // on ne révèle PAS le choix adverse
      lastAction: g.lastAction,
      lastResult: g.lastResult,
      winner: g.winner,
      rematch: g.rematch,
      score: g.score,
    };
  },

  // exposé pour les tests
  _internals: { resolve, newGame, canPlay },
};
