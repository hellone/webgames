// PLOUF ! — logique serveur (Ours polaires contre pingouins)
// Joueur 0 = les Ours, joueur 1 = les Pingouins. Les règles viennent de rules.js (partagé avec la page).
const R = require('./rules.js');
const AI = require('./ai.js');

const SIZE = 9;
const MODE = 'joueur'; // 3 actions par tour à partager entre ses deux animaux (comme dans le jeu Godot)

function newMatch(score = [0, 0], gameNo = 1, startTeam = Math.random() < 0.5 ? 0 : 1) {
  return {
    g: R.newGame(startTeam, MODE, SIZE),
    gameNo,
    startTeam,
    seq: 0,          // numéro de la dernière action, pour que les téléphones animent chaque coup une seule fois
    steps: [],       // étapes à animer pour la dernière action
    lastAct: null,
    rematch: [false, false],
    score,
  };
}

// Même action ? (le téléphone envoie l'action telle que les règles la lui ont proposée)
const same = (a, b) => a.kind === b.kind && a.id === b.id && a.x === b.x && a.y === b.y && (a.kind !== 'wave' || a.dir === b.dir);

function finish(m) {
  if (m.g.over && m.g.winner >= 0) m.score[m.g.winner]++;
}

module.exports = {
  name: 'PLOUF !',
  emoji: '🐻‍❄️',
  description: 'Ours polaires contre pingouins : casse les cailloux, ramasse les bonus et pousse l\'autre à l\'eau !',
  color: '#2f7fd8',
  maxPlayers: 2,

  init: () => newMatch(),

  onMessage(m, slot, msg, ctx) {
    const g = m.g;
    if (msg.type === 'act') {
      if (!ctx.full || g.over || g.turn !== slot || !msg.act) return false;
      const act = R.legalActions(g).find((a) => same(a, msg.act));
      if (!act) return false;
      const res = R.applyAction(g, act);
      m.g = res.state; m.steps = res.steps; m.lastAct = act; m.seq++;
      finish(m);
      return true;
    }
    if (msg.type === 'pass') {
      if (!ctx.full || g.over || g.turn !== slot) return false;
      const res = R.passTurn(g);
      m.g = res.state; m.steps = res.steps; m.lastAct = { kind: 'pass', team: slot }; m.seq++;
      finish(m);
      return true;
    }
    if (msg.type === 'rematch') {
      if (!g.over) return false;
      m.rematch[slot] = true;
      if (m.rematch[0] && m.rematch[1]) Object.assign(m, newMatch(m.score, m.gameNo + 1, 1 - m.startTeam));
      return true;
    }
    return false;
  },

  // ---------- Contre l'ordi (il joue les pingouins, comme dans le jeu Godot) ----------
  botName: (level) => `🤖 Ordi (${level})`,

  // L'ordi regarde l'écran : il note les bonus qui sortent des cailloux (pour estimer ce qui reste caché)
  botSee(v, mem) {
    if (mem.gameNo !== v.gameNo) { mem.gameNo = v.gameNo; mem.revealed = {}; mem.seq = v.seq; }
    if (v.seq > mem.seq) {
      mem.seq = v.seq;
      for (const st of v.steps || []) if (st.type === 'break' && st.bonus) mem.revealed[st.bonus] = (mem.revealed[st.bonus] || 0) + 1;
    }
  },

  botWants: (v) => (v.g.over ? !v.rematch[v.you] : v.g.turn === v.you),

  // Laisser le temps à l'animation du coup précédent, puis « réfléchir » un peu
  botDelay(v, level) {
    if (v.g.over) return 2500;
    const T = { walk: 160, slide: 105, pickup: 260, break: 460, flick: 330, fall: 880, buoy: 500, wave: 380, magnet: 300 };
    const anim = (v.steps || []).reduce((t, st) => t + (T[st.type] || 0), 0);
    return anim + 450 + Math.random() * 500 + (level === 'facile' ? 0 : 200);
  },

  botMove(v, level, mem) {
    if (v.g.over) return { type: 'rematch' };
    const act = AI.choose(v.g, level, mem.revealed || {});
    return act ? { type: 'act', act } : { type: 'pass' };
  },

  view(m) {
    // Les bonus cachés sous les cailloux restent secrets : on envoie seulement l'emplacement des cailloux
    const g = R.clone(m.g);
    for (const k in g.rocks) g.rocks[k] = null;
    return { g, gameNo: m.gameNo, seq: m.seq, steps: m.steps, lastAct: m.lastAct, rematch: m.rematch, score: m.score };
  },
};
