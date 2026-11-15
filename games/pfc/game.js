// PIERRE-FEUILLE-CISEAUX — logique serveur
// Chaque joueur choisit en secret ; quand les deux ont choisi, le serveur révèle les deux mains en même temps.
// La pierre casse les ciseaux, les ciseaux coupent la feuille, la feuille enveloppe la pierre. Premier à 3 points.

const MOVES = ['pierre', 'feuille', 'ciseaux'];
const BEATS = { pierre: 'ciseaux', ciseaux: 'feuille', feuille: 'pierre' };
const TARGET = 3;
const rnd = (n) => Math.floor(Math.random() * n);

function newMatch(score = [0, 0], gameNo = 1) {
  return {
    choice: [null, null],   // secret jusqu'à la révélation
    points: [0, 0],
    round: 1,
    seq: 0,
    last: null,             // dernière révélation : { seq, moves: [a, b], winner: 0 | 1 | 'draw' }
    history: [],            // révélations passées (publiques)
    winner: null,
    rematch: [false, false],
    score,
    gameNo,
  };
}

module.exports = {
  name: 'Pierre-Feuille-Ciseaux',
  emoji: '✊',
  description: 'Le grand classique : choisis en secret, révélez en même temps. Premier à 3 points !',
  color: '#ff7a59',
  maxPlayers: 2,
  MOVES,

  init: () => newMatch(),

  onMessage(m, slot, msg, ctx) {
    if (msg.type === 'choose') {
      if (!ctx.full || m.winner !== null || !MOVES.includes(msg.move)) return false;
      m.choice[slot] = msg.move; // on peut changer d'avis tant que l'autre n'a pas choisi
      if (m.choice[0] && m.choice[1]) {
        const [a, b] = m.choice;
        const w = a === b ? 'draw' : BEATS[a] === b ? 0 : 1;
        if (w !== 'draw') m.points[w]++;
        m.seq++;
        m.last = { seq: m.seq, moves: [a, b], winner: w, round: m.round };
        m.history.push(m.last);
        if (m.history.length > 30) m.history.shift();
        m.choice = [null, null];
        m.round++;
        if (w !== 'draw' && m.points[w] >= TARGET) { m.winner = w; m.score[w]++; }
      }
      return true;
    }
    if (msg.type === 'rematch') {
      if (m.winner === null) return false;
      m.rematch[slot] = true;
      if (ctx.room.bot) m.rematch[1] = true;
      if (m.rematch[0] && m.rematch[1]) Object.assign(m, newMatch(m.score, m.gameNo + 1));
      return true;
    }
    return false;
  },

  // ---------- Contre l'ordi ----------
  // Il ne voit jamais ton choix secret : seulement l'historique des manches déjà révélées (comme toi).
  // facile : au hasard ; moyen : contre ta main préférée ; difficile : devine ta prochaine main d'après tes habitudes.
  botName: (level) => ({ facile: '🤖 Robot Rigolo', moyen: '🤖 Robot Malin', difficile: '🤖 Robot Génie' }[level] || '🤖 Ordi'),
  botWants: (v) => (v.winner !== null ? !v.rematch[v.you] : !v.chosen[v.you]),
  botDelay: (v) => (v.winner !== null ? 6000 : 3200 + Math.random() * 1500), // laisse le temps à l'animation
  botMove(v, level) {
    if (v.winner !== null) return { type: 'rematch' };
    const me = v.you, opp = 1 - me;
    const theirs = v.history.map((h) => h.moves[opp]);
    const counter = (mv) => MOVES.find((x) => BEATS[x] === mv);
    let guess = null;
    if (level === 'moyen' && theirs.length >= 2 && Math.random() < 0.6) {
      const n = {}; theirs.slice(-6).forEach((x) => (n[x] = (n[x] || 0) + 1));
      guess = Object.keys(n).sort((a, b) => n[b] - n[a])[0];
    }
    if (level === 'difficile' && theirs.length >= 2 && Math.random() < 0.75) {
      // après tel coup, qu'est-ce que tu joues le plus souvent ?
      const prev = theirs[theirs.length - 1], n = {};
      for (let i = 1; i < theirs.length; i++) if (theirs[i - 1] === prev) n[theirs[i]] = (n[theirs[i]] || 0) + 1;
      const keys = Object.keys(n);
      guess = keys.length ? keys.sort((a, b) => n[b] - n[a])[0] : null;
      if (!guess) { const c = {}; theirs.forEach((x) => (c[x] = (c[x] || 0) + 1)); guess = Object.keys(c).sort((a, b) => c[b] - c[a])[0]; }
    }
    return { type: 'choose', move: guess ? counter(guess) : MOVES[rnd(3)] };
  },

  view(m, slot) {
    return {
      mine: m.choice[slot],                         // mon choix (pas celui de l'autre !)
      chosen: [!!m.choice[0], !!m.choice[1]],       // qui a déjà choisi
      points: m.points, round: m.round, seq: m.seq, last: m.last, history: m.history,
      winner: m.winner, rematch: m.rematch, score: m.score, gameNo: m.gameNo, target: TARGET,
    };
  },
};
