// WebGames — brique son commune
// Aucun fichier audio : tous les bruitages sont fabriqués par le navigateur (Web Audio), façon jeu rétro.
// Usage dans la page d'un jeu :
//   <script src="../common/sound.js"></script>
//   SFX.play('jump');            // voir la liste SOUNDS plus bas
//   SFX.play('tick', {v: .5});   // v = volume relatif
// Un bouton 🔊 / 🔇 est ajouté tout seul à côté du bouton 🏠 (choix retenu sur le téléphone).
(function () {
  let ac = null, master = null, noiseBuf = null;
  const last = {};
  let muted = false;
  try { muted = localStorage.getItem('wg_mute') === '1'; } catch (e) {}

  function ctx() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain(); master.gain.value = 0.55;
      const comp = ac.createDynamicsCompressor(); // évite que ça sature quand plusieurs sons se superposent
      master.connect(comp); comp.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  // Les navigateurs (surtout iPhone) n'autorisent le son qu'après un premier toucher
  function unlock() {
    const c = ctx(); if (!c) return;
    const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource();
    s.buffer = b; s.connect(c.destination); s.start(0);
  }
  ['pointerdown', 'touchend', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { capture: true, passive: true }));

  // ---------- Briques de base ----------
  // Note : fréquence f → f2 sur d secondes
  function tone({ f = 440, f2 = null, d = 0.15, type = 'sine', v = 0.3, at = 0, attack = 0.005, curve = 'exp', vib = 0 }) {
    const t0 = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (f2 !== null) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + d);
      else o.frequency.linearRampToValueAtTime(f2, t0 + d);
    }
    if (vib) { // vibrato
      const l = ac.createOscillator(), lg = ac.createGain();
      l.frequency.value = 7; lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency); l.start(t0); l.stop(t0 + d + 0.05);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + d + 0.05);
  }
  // Bruit filtré (souffle, choc, éclaboussure…)
  function noise({ d = 0.2, v = 0.3, at = 0, filter = 'lowpass', f = 1000, f2 = null, q = 1, attack = 0.003 }) {
    const t0 = ac.currentTime + at, s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; s.loop = true;
    fl.type = filter; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t0);
    if (f2 !== null) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + d);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    s.connect(fl); fl.connect(g); g.connect(master);
    s.start(t0, Math.random() * 0.5); s.stop(t0 + d + 0.05);
  }
  const notes = (list, type, v, len, gap) => list.forEach((f, i) => tone({ f, type, v, d: len, at: i * gap }));

  // ---------- La bibliothèque de sons ----------
  const SOUNDS = {
    // interface
    tap:     (k) => tone({ f: 900, f2: 600, d: 0.04, type: 'square', v: 0.08 * k }),
    select:  (k) => tone({ f: 660, f2: 990, d: 0.08, type: 'triangle', v: 0.25 * k }),
    nope:    (k) => tone({ f: 160, f2: 120, d: 0.12, type: 'square', v: 0.12 * k }),
    pop:     (k) => tone({ f: 380, f2: 950, d: 0.09, type: 'sine', v: 0.35 * k }),
    turn:    (k) => { tone({ f: 784, d: 0.1, type: 'triangle', v: 0.25 * k }); tone({ f: 1047, d: 0.18, type: 'triangle', v: 0.25 * k, at: 0.09 }); },
    // compte à rebours
    beep:    (k) => tone({ f: 620, d: 0.14, type: 'square', v: 0.16 * k }),
    go:      (k) => { tone({ f: 1240, d: 0.35, type: 'square', v: 0.16 * k }); tone({ f: 1860, d: 0.35, type: 'triangle', v: 0.12 * k }); },
    // mouvement
    jump:    (k) => tone({ f: 280, f2: 760, d: 0.18, type: 'square', v: 0.13 * k }),
    swish:   (k) => noise({ d: 0.09, v: 0.18 * k, filter: 'bandpass', f: 1400, f2: 3500, q: 2 }),
    step:    (k) => tone({ f: 220, f2: 160, d: 0.05, type: 'triangle', v: 0.18 * k }),
    slide:   (k) => noise({ d: 0.1, v: 0.08 * k, filter: 'highpass', f: 3000 }),
    whoosh:  (k) => noise({ d: 0.45, v: 0.3 * k, filter: 'bandpass', f: 300, f2: 2400, q: 1.5, attack: 0.15 }),
    // chocs
    bonk:    (k) => { tone({ f: 190, f2: 55, d: 0.2, type: 'sine', v: 0.55 * k }); noise({ d: 0.1, v: 0.25 * k, f: 900 }); },
    punch:   (k) => { tone({ f: 120, f2: 40, d: 0.3, type: 'sine', v: 0.7 * k }); noise({ d: 0.18, v: 0.45 * k, f: 2500, f2: 300 }); },
    explode: (k) => { noise({ d: 0.9, v: 0.55 * k, f: 1800, f2: 80, attack: 0.01 }); tone({ f: 90, f2: 30, d: 0.6, type: 'sine', v: 0.5 * k }); },
    crack:   (k) => { noise({ d: 0.08, v: 0.4 * k, filter: 'highpass', f: 1500 }); tone({ f: 140, f2: 70, d: 0.12, type: 'triangle', v: 0.3 * k }); },
    splash:  (k) => { noise({ d: 0.6, v: 0.45 * k, f: 3500, f2: 250, attack: 0.02 }); tone({ f: 500, f2: 120, d: 0.25, type: 'sine', v: 0.25 * k }); },
    puff:    (k) => noise({ d: 0.3, v: 0.22 * k, filter: 'highpass', f: 1200, f2: 4000, attack: 0.05 }),
    // gains / pertes
    coin:    (k) => { tone({ f: 988, d: 0.08, type: 'square', v: 0.13 * k }); tone({ f: 1319, d: 0.25, type: 'square', v: 0.13 * k, at: 0.07 }); },
    ding:    (k) => { tone({ f: 1319, d: 0.35, type: 'sine', v: 0.3 * k }); tone({ f: 1976, d: 0.3, type: 'sine', v: 0.15 * k, at: 0.03 }); },
    miss:    (k) => tone({ f: 420, f2: 190, d: 0.28, type: 'square', v: 0.12 * k }),
    tick:    (k) => tone({ f: 1500 + Math.random() * 600, d: 0.025, type: 'square', v: 0.06 * k }),
    magnet:  (k) => tone({ f: 260, f2: 520, d: 0.35, type: 'sawtooth', v: 0.12 * k, vib: 40, curve: 'lin' }),
    alert:   (k) => notes([880, 660, 880, 660], 'square', 0.12 * k, 0.08, 0.09),
    // poulets
    peck:    (k) => { tone({ f: 1300, f2: 800, d: 0.04, type: 'square', v: 0.15 * k }); tone({ f: 1300, f2: 800, d: 0.04, type: 'square', v: 0.15 * k, at: 0.08 }); },
    cluck:   (k) => { tone({ f: 520, f2: 760, d: 0.07, type: 'sawtooth', v: 0.16 * k }); tone({ f: 760, f2: 430, d: 0.16, type: 'sawtooth', v: 0.16 * k, at: 0.07, vib: 30 }); },
    // fins de partie
    finish:  (k) => notes([784, 988, 1175, 1568], 'square', 0.13 * k, 0.12, 0.09),
    win:     (k) => { notes([523, 659, 784, 1047], 'triangle', 0.3 * k, 0.16, 0.13); [1047, 1319, 1568].forEach((f) => tone({ f, d: 0.7, type: 'triangle', v: 0.18 * k, at: 0.55 })); },
    lose:    (k) => { tone({ f: 392, f2: 370, d: 0.35, type: 'sawtooth', v: 0.12 * k, vib: 6, curve: 'lin' });
                      tone({ f: 370, f2: 349, d: 0.35, type: 'sawtooth', v: 0.12 * k, at: 0.38, vib: 6, curve: 'lin' });
                      tone({ f: 349, f2: 262, d: 0.8, type: 'sawtooth', v: 0.12 * k, at: 0.76, vib: 8, curve: 'lin' }); },
  };

  function play(name, opts) {
    if (muted || document.hidden) return;
    const fn = SOUNDS[name]; if (!fn) return;
    const now = performance.now();
    if (last[name] && now - last[name] < 35) return; // pas deux fois le même son au même instant
    last[name] = now;
    if (!ctx() || ac.state !== 'running') return;
    try { fn((opts && opts.v) || 1); } catch (e) {}
  }

  // ---------- Bouton 🔊 / 🔇 ----------
  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('wg_mute', m ? '1' : '0'); } catch (e) {}
    document.querySelectorAll('.wg-mute').forEach((b) => { b.textContent = m ? '🔇' : '🔊'; b.setAttribute('aria-label', m ? 'Activer le son' : 'Couper le son'); });
  }
  function addButtons() {
    document.querySelectorAll('header').forEach((h) => {
      if (h.querySelector('.wg-mute')) return;
      const b = document.createElement('button');
      b.className = 'wg-mute';
      b.onclick = () => { setMuted(!muted); if (!muted) play('select'); };
      const q = h.querySelector('#quit');
      if (q) { // 🏠 et 🔊 regroupés à gauche
        const w = document.createElement('span'); w.style.cssText = 'display:flex;gap:6px';
        q.replaceWith(w); w.append(q, b);
      } else h.prepend(b);
    });
    setMuted(muted);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButtons); else addButtons();

  window.SFX = { play, isMuted: () => muted, setMuted, list: () => Object.keys(SOUNDS) };
})();
