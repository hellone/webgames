// COURSE FOLLE — logique serveur
// Le serveur ne simule pas la course : il donne à chaque manche une graine (la piste et les obstacles sont
// recalculés à l'identique sur les 2 téléphones), fixe l'heure du départ, relaie les positions et arbitre l'arrivée.
// Le premier « finish » reçu gagne la manche.

const CHARS = 3; // nombre de personnages au choix
const rnd = (n) => Math.floor(Math.random() * n);
const emptyPos = () => [{ d: 0, l: null }, { d: 0, l: null }];

function fresh(score = [0, 0], gameNo = 0, picks = [null, null]) {
  return {
    phase: 'lobby',          // lobby (on attend les 2 joueurs + leurs persos) → race → over
    picks,                   // personnage choisi par chaque joueur (0..2)
    seed: 0,
    startAt: 0,              // heure serveur du « GO »
    finish: [null, null],    // temps d'arrivée (s)
    hits: [0, 0],            // chocs pendant la course
    winner: null,
    rematch: [false, false],
    score,
    gameNo,
    pos: emptyPos(),         // dernière position connue (pour reprendre après un rechargement)
  };
}

function startRace(m) {
  m.phase = 'race';
  m.seed = 1 + rnd(2147483646);
  m.startAt = Date.now() + 4200; // laisse le temps au compte à rebours 3, 2, 1
  m.finish = [null, null];
  m.hits = [0, 0];
  m.winner = null;
  m.rematch = [false, false];
  m.pos = emptyPos();
  m.gameNo++;
}

module.exports = {
  name: 'Course Folle',
  emoji: '🏃',
  description: 'Course à 2 : esquive voitures, motos et rochers, saute par-dessus les animaux. Premier à la ligne !',
  color: '#22b573',
  maxPlayers: 2,

  init: () => fresh(),

  onMessage(m, slot, msg, ctx) {
    const bot = !!ctx.room.bot;

    if (msg.type === 'pick') {
      const c = msg.c | 0;
      if (c < 0 || c >= CHARS) return false;
      if (m.phase === 'race') return false; // pas de changement en pleine course
      m.picks[slot] = c;
      if (bot && m.picks[1] === null) m.picks[1] = (c + 1 + rnd(CHARS - 1)) % CHARS; // l'ordi prend un autre perso
      if (m.phase === 'lobby' && ctx.full && m.picks.every((p) => p !== null)) startRace(m);
      return true;
    }

    // Position en direct (~10 fois/s) : relayée à l'adversaire sans renvoyer tout l'état
    if (msg.type === 'pos') {
      if (m.phase !== 'race') return false;
      const d = Math.max(0, Math.min(1e6, +msg.d || 0));
      const l = Math.max(0, Math.min(3, msg.l | 0));
      if (msg.bot) { if (bot && slot === 0) m.pos[1] = { d, l }; return false; }
      m.pos[slot] = { d, l };
      const j = Number.isFinite(+msg.j) ? +msg.j : -1;
      ctx.emit({ type: 'opp', d, l, j, h: msg.h ? 1 : 0 }, 1 - slot);
      return false;
    }

    if (msg.type === 'finish') {
      if (m.phase !== 'race') return false;
      const who = msg.bot ? (bot && slot === 0 ? 1 : -1) : slot;
      if (who < 0 || m.finish[who] !== null) return false;
      const time = +msg.time;
      if (!(time > 20 && time < 3600)) return false; // un temps impossible est ignoré
      m.finish[who] = Math.round(time * 100) / 100;
      m.hits[who] = Math.max(0, Math.min(999, msg.hits | 0));
      if (m.winner === null) {
        m.winner = who;
        m.score[who]++;
        m.phase = 'over';
      }
      return true;
    }

    if (msg.type === 'rematch') {
      if (m.phase !== 'over') return false;
      m.rematch[slot] = true;
      if (bot) m.rematch[1] = true;
      if (m.rematch[0] && m.rematch[1]) startRace(m);
      return true;
    }
    return false;
  },

  // ---------- Contre l'ordi ----------
  // C'est un vrai temps réel : l'ordi court dans le téléphone du joueur, avec la même piste et les mêmes règles,
  // et ne réagit qu'aux obstacles qu'il « voit » arriver devant lui (temps de réaction et erreurs selon le niveau).
  botName: (level) => ({ facile: '🐢 Ordi Tortue', moyen: '🤖 Ordi Sprint', difficile: '🚀 Ordi Fusée' }[level] || '🤖 Ordi'),
  botWants: () => false,
  botMove: () => null,

  view(m, slot, room) {
    return {
      phase: m.phase, picks: m.picks, seed: m.seed, startAt: m.startAt, serverNow: Date.now(),
      finish: m.finish, hits: m.hits, winner: m.winner, rematch: m.rematch, score: m.score, gameNo: m.gameNo,
      pos: m.pos, bot: room && room.bot ? room.bot.level : null,
    };
  },
};
