// WebGames — brique commune côté client
// Usage dans la page d'un jeu :
//   <script src="../common/client.js"></script>
//   WG.connect({ game: 'poulets', onState, onTaunt, onError });
//   WG.send({ type: 'choose', action: 'bec' });
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

  // Code de partie dans l'URL (?room=XXXXXX), créé s'il manque
  const params = new URLSearchParams(location.search);
  let room = (params.get('room') || '').toUpperCase();
  if (!room) { room = rid(6); history.replaceState(null, '', location.pathname + '?room=' + room); }

  // Identité persistante du téléphone (permet la reconnexion)
  let pid = store('wg_pid');
  if (!pid) { pid = rid(16); store('wg_pid', pid); }

  let ws = null, opts = null, stopped = false;

  function wsUrl() {
    const u = new URL('../ws', location.href); // /poulets/ → /ws (marche aussi dans un sous-dossier)
    u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    u.search = '';
    return u.toString();
  }

  function connect(o) {
    opts = o;
    stopped = false;
    ws = new WebSocket(wsUrl());
    ws.onopen = () => send({ type: 'join', game: o.game, room, pid, name: WG.name() });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'state') o.onState && o.onState(m);
      else if (m.type === 'taunt') o.onTaunt && o.onTaunt(m.e, m.from);
      else if (m.type === 'error') { stopped = true; ws.close(); o.onError && o.onError(m.message); }
      else o.onMessage && o.onMessage(m);
    };
    ws.onclose = () => { if (!stopped) setTimeout(() => connect(opts), 1500); };
  }

  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

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
    room, pid, connect, send, share, store,
    link: () => location.href,
    name: () => store('wg_name') || '',
    setName: (n) => store('wg_name', String(n).trim().slice(0, 14)),
    newRoom: () => { location.href = location.pathname + '?room=' + rid(6); },
    home: () => { location.href = new URL('../', location.href).pathname; },
    vibrate: (p) => { if (navigator.vibrate) navigator.vibrate(p); },
    esc: (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  };
})();
