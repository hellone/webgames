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
