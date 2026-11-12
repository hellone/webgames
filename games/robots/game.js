// ROBO-DÉS — logique serveur
// Chaque joueur a un robot de 10 pièces. Chaque pièce attend une couleur tirée au hasard parmi les 6 faces du dé.
// À son tour, on lance le dé : une pièce (une seule) de cette couleur se colore. Le premier robot entièrement colorié gagne.

const PARTS = ['tete', 'epauleG', 'epauleD', 'brasG', 'brasD', 'ventre', 'jambeG', 'jambeD', 'piedG', 'piedD'];
const FACES = 6;

const rnd = (n) => Math.floor(Math.random() * n);
const randomRobot = () => PARTS.map(() => rnd(FACES)); // peut donner un robot 100 % d'une même couleur

function newMatch(score = [0, 0], gameNo = 1, start = rnd(2)) {
  return {
    robots: [randomRobot(), randomRobot()],          // couleur attendue par chaque pièce (0..5)
    done: [PARTS.map(() => false), PARTS.map(() => false)], // pièces déjà coloriées
    turn: start,
    start,
    rolls: [0, 0],
    seq: 0,
    last: null,      // dernier lancer : { seq, player, face, part (-1 si rien à colorier) }
    winner: null,
    rematch: [false, false],
    score,
    gameNo,
  };
}

module.exports = {
  name: 'Robo-Dés',
  emoji: '🤖',
  description: 'Lance le dé, colorie ton robot pièce par pièce. Le premier robot complet met l\'autre K.O. !',
  color: '#8e5cf7',
  maxPlayers: 2,
  PARTS,

  init: () => newMatch(),

  onMessage(m, slot, msg, ctx) {
    if (msg.type === 'roll') {
      if (!ctx.full || m.winner !== null || m.turn !== slot) return false;
      const face = rnd(FACES);
      const candidates = PARTS.map((_, i) => i).filter((i) => m.robots[slot][i] === face && !m.done[slot][i]);
      const part = candidates.length ? candidates[rnd(candidates.length)] : -1;
      if (part >= 0) m.done[slot][part] = true;
      m.rolls[slot]++;
      m.seq++;
      m.last = { seq: m.seq, player: slot, face, part };
      if (m.done[slot].every(Boolean)) {
        m.winner = slot;
        m.score[slot]++;
      } else {
        m.turn = 1 - slot;
      }
      return true;
    }
    if (msg.type === 'rematch') {
      if (m.winner === null) return false;
      m.rematch[slot] = true;
      if (m.rematch[0] && m.rematch[1]) Object.assign(m, newMatch(m.score, m.gameNo + 1, 1 - m.start));
      return true;
    }
    return false;
  },

  view(m) {
    return {
      robots: m.robots, done: m.done, turn: m.turn, rolls: m.rolls, seq: m.seq, last: m.last,
      winner: m.winner, rematch: m.rematch, score: m.score, gameNo: m.gameNo,
    };
  },
};
