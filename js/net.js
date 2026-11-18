/* ============================================================
   赌徒模拟器 · 局域网联机客户端
   通过 server/lan-server.js 的 HTTP 房间接口做轮询与消息中继。
   ============================================================ */
(function (C) {
  'use strict';

  const listeners = { message: [], players: [], status: [] };

  const state = {
    roomId: null,
    playerId: null,
    token: null,
    hostId: null,
    seq: 0,
    players: [],
    started: false,
    game: null,
    connected: false,
    timer: null,
    polling: false,
    lastError: null
  };

  function available() {
    return typeof fetch === 'function' && /^https?:$/.test(window.location.protocol);
  }

  function emit(type, payload) {
    for (const fn of listeners[type].slice()) {
      try { fn(payload); } catch (e) { /* ignore listener errors */ }
    }
  }

  function on(type, fn) {
    if (!listeners[type]) return function () {};
    listeners[type].push(fn);
    return function off() { off(type, fn); };
  }

  function off(type, fn) {
    const list = listeners[type];
    if (!list) return;
    const index = list.indexOf(fn);
    if (index >= 0) list.splice(index, 1);
  }

  async function request(path, options) {
    const opts = options || {};
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store'
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const message = data && data.error ? data.error : `请求失败（${res.status}）`;
      const error = new Error(message);
      error.status = res.status;
      throw error;
    }
    return data;
  }

  function applyIdentity(data) {
    state.roomId = data.roomId;
    state.playerId = data.playerId || state.playerId;
    state.token = data.token || state.token;
    state.hostId = data.hostId;
    state.seq = Number(data.seq) || 0;
    state.players = data.players || [];
    state.connected = true;
  }

  async function create(name) {
    stopPolling();
    const data = await request('/api/create', { method: 'POST', body: { name } });
    applyIdentity(data);
    emit('players', { players: state.players, hostId: state.hostId, roomId: state.roomId });
    startPolling();
    return data;
  }

  async function join(roomId, name) {
    stopPolling();
    const data = await request('/api/join', { method: 'POST', body: { roomId: roomId, name: name } });
    applyIdentity(data);
    emit('players', { players: state.players, hostId: state.hostId, roomId: state.roomId });
    startPolling();
    return data;
  }

  function stopPolling() {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    state.polling = false;
  }

  function startPolling() {
    stopPolling();
    poll();
  }

  async function poll() {
    if (!state.token || state.polling) return;
    state.polling = true;
    const roomId = state.roomId;
    const token = state.token;
    try {
      const data = await request(
        `/api/room?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}&after=${state.seq}`,
        { method: 'GET' }
      );
      if (state.roomId !== roomId || state.token !== token) return;
      const wasConnected = state.connected;
      const previousHost = state.hostId;
      const before = JSON.stringify(state.players);
      state.connected = true;
      state.hostId = data.hostId;
      state.started = !!data.started;
      state.game = data.game || state.game;
      state.players = data.players || [];
      if (JSON.stringify(state.players) !== before || data.hostId !== previousHost) {
        emit('players', { players: state.players, hostId: state.hostId, roomId: roomId });
      }
      const messages = data.messages || [];
      for (const msg of messages) {
        state.seq = Math.max(state.seq, msg.seq || 0);
        if (!msg.to || msg.to === state.playerId) emit('message', msg);
      }
      if (typeof data.seq === 'number') state.seq = Math.max(state.seq, data.seq);
      if (!wasConnected) emit('status', { connected: true });
    } catch (error) {
      state.lastError = error;
      if (state.connected) {
        state.connected = false;
        emit('status', { connected: false, error: error.message });
      }
    } finally {
      state.polling = false;
      if (state.token) {
        const delay = (C.DATA.LAN && C.DATA.LAN.pollMs) || 700;
        state.timer = setTimeout(poll, delay);
      }
    }
  }

  async function send(type, to, payload) {
    if (!state.token) return null;
    return request('/api/send', {
      method: 'POST',
      body: { roomId: state.roomId, token: state.token, type, to, payload }
    });
  }

  async function leave() {
    const roomId = state.roomId;
    const token = state.token;
    stopPolling();
    state.roomId = null;
    state.playerId = null;
    state.token = null;
    state.hostId = null;
    state.seq = 0;
    state.players = [];
    state.started = false;
    state.game = null;
    state.connected = false;
    if (roomId && token) {
      try {
        await request('/api/leave', { method: 'POST', body: { roomId, token } });
      } catch (e) { /* ignore */ }
    }
    emit('players', { players: [], hostId: null, roomId: null });
  }

  function player() {
    return state.players.find((p) => p.id === state.playerId) || null;
  }

  function isHost() {
    return !!state.hostId && state.hostId === state.playerId;
  }

  C.Net = {
    available,
    create,
    join,
    send,
    leave,
    on,
    off,
    player,
    isHost,
    get roomId() { return state.roomId; },
    get playerId() { return state.playerId; },
    get hostId() { return state.hostId; },
    get players() { return state.players.slice(); },
    get connected() { return state.connected; },
    get serverUrl() { return state.roomId ? window.location.origin : ''; }
  };
})(window.Casino = window.Casino || {});
