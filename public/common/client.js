// WebGames — brique commune côté client
// Usage dans la page d'un jeu :
//   <script src="../common/client.js"></script>
//   WG.connect({ game: 'poulets', room: '4821', mode: 'create', onState, onJoined, onTaunt, onError });
//     mode : 'create' (je crée avec ce code) | 'join' (je rejoins) | absent (reconnexion)
//   WG.send({ type: 'choose', action: 'bec' });
//   WG.leave();   // quitter la partie et revenir au menu
(function () {
  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function rid(n) {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
  }

  // Identité persistante du téléphone (permet la reconnexion)
  let pid = store('wg_pid');
  if (!pid) { pid = rid(16); store('wg_pid', pid); }

  // Code de partie dans l'URL (?room=1234) : présent après une création / un "rejoindre", ou via un lien partagé
  function urlRoom() {
    const r = new URLSearchParams(location.search).get('room') || '';
    return /^\d{4}$/.test(r) ? r : null;
  }
  function setUrlRoom(code) {
    history.replaceState(null, '', location.pathname + (code ? '?room=' + code : ''));
  }

  let ws = null, opts = null, stopped = true, joinedOnce = false;

  function wsUrl() {
    const u = new URL('../ws', location.href); // /poulets/ → /ws (marche aussi dans un sous-dossier)
    u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    u.search = '';
    return u.toString();
  }

  function open() {
    ws = new WebSocket(wsUrl());
    const sock = ws;
    ws.onopen = () => {
      // Après la 1re connexion réussie, les reconnexions ne précisent plus le mode
      const mode = joinedOnce ? undefined : opts.mode;
      sock.send(JSON.stringify({ type: 'join', game: opts.game, room: opts.room, mode, pid, name: WG.name() }));
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'state') opts.onState && opts.onState(m);
      else if (m.type === 'joined') {
        joinedOnce = true;
        setUrlRoom(m.room);
        opts.onJoined && opts.onJoined(m);
      }
      else if (m.type === 'taunt') opts.onTaunt && opts.onTaunt(m.e, m.from);
      else if (m.type === 'error') {
        stopped = true; sock.close();
        setUrlRoom(null);
        opts.onError && opts.onError(m.message, m.code);
      }
      else opts.onMessage && opts.onMessage(m);
    };
    ws.onclose = () => { if (!stopped && ws === sock) setTimeout(() => { if (!stopped && ws === sock) open(); }, 1500); };
  }

  function connect(o) {
    if (ws) { stopped = true; try { ws.close(); } catch (e) {} }
    opts = o;
    stopped = false;
    joinedOnce = false;
    open();
  }

  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

  function leave() {
    send({ type: 'leave' });
    stopped = true;
    const sock = ws;
    setTimeout(() => { try { sock && sock.close(); } catch (e) {} }, 100);
    setUrlRoom(null);
  }

  async function share(btn, title) {
    const url = location.href;
    if (navigator.share) {
      try { await navigator.share({ title: title || 'On joue ?', text: 'Viens jouer contre moi !', url }); return; } catch (e) {}
    }
    try {
      await navigator.clipboard.writeText(url);
      if (btn) { const t = btn.textContent; btn.textContent = 'Lien copié ✅'; setTimeout(() => (btn.textContent = t), 2000); }
    } catch (e) { prompt('Copie ce lien :', url); }
  }

  window.WG = {
    pid, connect, send, leave, share, store, urlRoom,
    randomCode: () => String(Math.floor(Math.random() * 10000)).padStart(4, '0'),
    link: () => location.href,
    name: () => store('wg_name') || '',
    setName: (n) => store('wg_name', String(n).trim().slice(0, 14)),
    home: () => { location.href = new URL('../', location.href).pathname; },
    vibrate: (p) => { if (navigator.vibrate) navigator.vibrate(p); },
    esc: (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  };
})();
