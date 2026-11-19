/* ============================================================
   赌徒模拟器 · 局域网大厅
   创建 / 加入房间，房主选游戏并开始；游戏本身由 liar.js / roulette.js 接管。
   ============================================================ */
(function (C) {
  'use strict';

  const util = C.util;
  const UI = C.UI;
  const LIAR = C.DATA.LIAR || {};
  const ROULETTE = C.DATA.ROULETTE || {};
  const MIN_LIAR = Math.max(2, Number(LIAR.minPlayers) || 2);
  const MAX_LIAR = Math.max(MIN_LIAR, Number(LIAR.maxPlayers) || 4);
  const MIN_ROULETTE = Math.max(2, Number(ROULETTE.minPlayers) || 2);
  const MAX_ROULETTE = Math.max(MIN_ROULETTE, Number(ROULETTE.maxPlayers) || 4);
  const AVATARS = (LIAR.avatars && LIAR.avatars.length) ? LIAR.avatars : ['🧑', '🎩', '💃', '🥃'];

  let S = null;
  let offPlayers = null;
  let offMessage = null;
  let offStatus = null;

  function clampLiar(value) {
    return util.clamp(Math.round(Number(value) || (LIAR.defaultPlayers || 4)), MIN_LIAR, MAX_LIAR);
  }

  function clampRoulette(value) {
    return util.clamp(Math.round(Number(value) || (ROULETTE.defaultPlayers || 2)), MIN_ROULETTE, MAX_ROULETTE);
  }

  function countOptions(min, max) {
    const out = [];
    for (let n = min; n <= max; n++) out.push(n);
    return out;
  }

  function liarCountOptions() {
    return countOptions(MIN_LIAR, MAX_LIAR);
  }

  function rouletteCountOptions() {
    return countOptions(MIN_ROULETTE, MAX_ROULETTE);
  }

  function open(game, options) {
    if (S) return;
    const opts = options || {};
    const initialGame = game === 'roulette' ? 'roulette' : 'liar';
    S = {
      tab: 'create',
      game: initialGame,
      liarMode: opts.liarMode === 'echo' ? 'echo' : 'classic',
      echoCount: Math.max(1, Math.min(3, Number(opts.echoCount) || 1)),
      liarPlayers: clampLiar(opts.liarPlayers || (initialGame === 'liar' ? opts.players : null) || C.storage.get('casino.lanPlayers', LIAR.defaultPlayers || 4)),
      roulettePlayers: clampRoulette(opts.roulettePlayers || (initialGame === 'roulette' ? opts.players : null) || C.storage.get('casino.lanRoulettePlayers', ROULETTE.defaultPlayers || 2)),
      name: C.storage.get('casino.lanName', '') || '',
      code: '',
      room: false,
      roomId: null,
      hostId: null,
      players: [],
      phase: 'form',
      error: null,
      status: null,
      starting: false,
      apiReady: null
    };

    const available = C.Net && C.Net.available();
    UI.openPanel({
      kicker: 'LOCAL PARTY · NO INTERNET',
      title: '本地 / 局域网联机',
      subtitle: available ? '同一台电脑双开，或同一 Wi-Fi 开房；不需要外网。联机为友谊赛，不计现金和行动。' : '需要先启动本地服务器（start-lan.bat）。',
      wide: true,
      body: `<div class="lan-lobby" id="lanLobby">${renderBody(available)}</div>`,
      onClosed: () => {
        cleanup();
        if (S && S.phase !== 'started' && C.Net && C.Net.roomId) C.Net.leave();
        S = null;
      }
    });

    if (available) {
      fetch('/api/health', { cache: 'no-store' })
        .then((res) => {
          if (!res.ok) throw new Error('no api');
          return res.json();
        })
        .then(() => {
          if (!S) return;
          S.apiReady = true;
          render();
        })
        .catch(() => {
          if (!S) return;
          S.apiReady = false;
          render();
        });
      bind();
      offPlayers = C.Net.on('players', (data) => {
        if (!S) return;
        S.players = data.players || [];
        S.hostId = data.hostId;
        S.roomId = data.roomId;
        S.room = !!data.roomId;
        const isHost = S.hostId === C.Net.playerId;
        if (S.room && !isHost) {
          if (data.game === 'liar' || data.game === 'roulette') S.game = data.game;
          if (Number(data.maxPlayers)) {
            if (S.game === 'roulette') S.roulettePlayers = clampRoulette(data.maxPlayers);
            else S.liarPlayers = clampLiar(data.maxPlayers);
          }
          if (data.liarMode) S.liarMode = data.liarMode === 'echo' ? 'echo' : 'classic';
          if (data.echoCount) S.echoCount = Math.max(1, Math.min(3, Number(data.echoCount) || 1));
        }
        if (S.room && S.phase !== 'started' && S.phase !== 'starting') S.phase = 'room';
        render();
      });
      offMessage = C.Net.on('message', (msg) => {
        if (!S || S.phase !== 'room' || msg.type !== 'start') return;
        const payload = msg.payload || {};
        S.phase = 'started';
        launch(payload, false);
      });
      offStatus = C.Net.on('status', (data) => {
        if (!S) return;
        S.status = data;
        render();
      });
    }
  }

  function renderBody(available) {
    if (!available || S.apiReady === false) {
      return `
        <div class="lan-offline">
          <span class="lan-offline__icon">💻</span>
          <h3>${available ? '当前服务器没有联机接口' : '本地联机需要先启动服务器'}</h3>
          <p>最简单的方式：双击项目根目录的 <code>start-lan.bat</code>。它会优先用 Python 启动本地服务器（不需要安装 Node，也不需要外网）。</p>
          <p>也可以手动运行：</p>
          <pre><code>py -3 server/lan-server.py</code></pre>
          <p>然后用 <code>http://localhost:8787</code> 在本机开两个浏览器窗口，或把终端打印的局域网地址发给同一 Wi-Fi 的朋友。</p>
          <p class="lan-offline__note">单人模式不需要服务器：直接双击 <code>index.html</code> 即可离线游玩。</p>
        </div>
      `;
    }
    if (S.apiReady === null) {
      return `<div class="lan-loading"><span class="thinking"><i></i><i></i><i></i></span><p>正在连接局域网服务……</p></div>`;
    }
    if (!S.room) {
      const isCreate = S.tab === 'create';
      return `
        <div class="lan-tabs">
          <button class="lan-tab${isCreate ? ' is-active' : ''}" type="button" data-lan-tab="create">创建房间</button>
          <button class="lan-tab${!isCreate ? ' is-active' : ''}" type="button" data-lan-tab="join">加入房间</button>
        </div>
        <div class="lan-form">
          <label class="input-label" for="lanName">你的名字</label>
          <input class="amount-input" id="lanName" maxlength="12" value="${util.escapeHtml(S.name)}" placeholder="例如：阿珍" autocomplete="off">
          ${isCreate ? `
            <div class="lan-games">
              <button class="lan-game${S.game === 'liar' ? ' is-active' : ''}" type="button" data-lan-game="liar">
                <span>🍻</span><strong>骗子酒馆</strong><small>${MIN_LIAR}-${MAX_LIAR} 人 · 吹牛、质疑与牌桌聊天</small>
              </button>
              <button class="lan-game${S.game === 'roulette' ? ' is-active' : ''}" type="button" data-lan-game="roulette">
                <span>🔫</span><strong>恶魔轮盘赌</strong><small>${MIN_ROULETTE}-${MAX_ROULETTE} 人 · 实弹、空包与道具</small>
              </button>
            </div>
            <button class="btn btn--primary btn--lg btn--block" type="button" data-lan-create>创建房间</button>
          ` : `
            <label class="input-label" for="lanCode">房间码</label>
            <input class="amount-input lan-code-input" id="lanCode" maxlength="4" value="${util.escapeHtml(S.code)}" placeholder="ABCD" autocomplete="off" style="text-transform:uppercase">
            <button class="btn btn--primary btn--lg btn--block" type="button" data-lan-join>加入房间</button>
          `}
          ${S.error ? `<p class="lan-error">${util.escapeHtml(S.error)}</p>` : ''}
          <p class="lan-hint">本机双开：先在两个浏览器窗口打开 <strong>${util.escapeHtml(location.origin)}</strong>；同一 Wi-Fi：把终端打印的局域网地址发给朋友。房主开始后所有人自动进入牌局。</p>
        </div>
      `;
    }

    const players = S.players || [];
    const isHost = S.hostId === C.Net.playerId;
    const need = S.game === 'roulette' ? S.roulettePlayers : S.liarPlayers;
    const max = need;
    const canStart = isHost && players.length === need && !S.starting;
    const startLabel = S.starting
      ? '正在开始……'
      : players.length < need
        ? `还差 ${need - players.length} 人（${players.length}/${need}）`
        : players.length > need
          ? `人数超出（${players.length}/${need}）`
          : `开始 ${need} 人局`;
    return `
      <div class="lan-room">
        <div class="lan-room__head">
          <div class="lan-room__code"><span>房间码</span><strong>${util.escapeHtml(S.roomId || '')}</strong><button class="text-btn" type="button" data-lan-copy>复制</button></div>
          <div class="lan-room__game">${S.game === 'liar' ? '🍻 骗子酒馆' : '🔫 恶魔轮盘赌'}<small>${players.length} / ${max} 人</small></div>
        </div>
        <div class="lan-players">
          ${players.map((p, i) => `<div class="lan-player${p.host ? ' is-host' : ''}${p.id === C.Net.playerId ? ' is-me' : ''}">
            <span class="lan-player__avatar">${AVATARS[i % AVATARS.length]}</span>
            <strong>${util.escapeHtml(p.name)}</strong>
            ${p.host ? '<em>房主</em>' : ''}
            ${p.id === C.Net.playerId ? '<small>你</small>' : ''}
          </div>`).join('')}
        </div>
        ${S.game === 'roulette' ? `
          <div class="lan-liar-options">
            <span class="lan-liar-options__label">入座人数</span>
            ${isHost
              ? rouletteCountOptions().map((n) => `<button class="liar-chip${S.roulettePlayers === n ? ' is-active' : ''}" type="button" data-lan-roulette-count="${n}" aria-pressed="${S.roulettePlayers === n}">${n} 人</button>`).join('')
              : `<strong>${S.roulettePlayers} 人局</strong>`}
            <small>${isHost ? '房间最多进这么多人，到齐后才能开局' : '由房主设定，到齐后自动可以开局'}</small>
          </div>
        ` : ''}
        ${S.game === 'liar' ? `
          <div class="lan-liar-options">
            <span class="lan-liar-options__label">入座人数</span>
            ${isHost
              ? liarCountOptions().map((n) => `<button class="liar-chip${S.liarPlayers === n ? ' is-active' : ''}" type="button" data-lan-liar-count="${n}" aria-pressed="${S.liarPlayers === n}">${n} 人</button>`).join('')
              : `<strong>${S.liarPlayers} 人局</strong>`}
            <small>${isHost ? '房间最多进这么多人，到齐后才能开局' : '由房主设定，到齐后自动可以开局'}</small>
          </div>
          <div class="lan-liar-options">
            <span class="lan-liar-options__label">酒馆模式</span>
            ${isHost ? `
              <button class="liar-chip${S.liarMode === 'classic' ? ' is-active' : ''}" type="button" data-lan-liar-mode="classic">经典</button>
              <button class="liar-chip${S.liarMode === 'echo' ? ' is-active' : ''}" type="button" data-lan-liar-mode="echo">回响</button>
              ${S.liarMode === 'echo' ? [1, 2, 3].map((n) => `<button class="liar-chip${S.echoCount === n ? ' is-active' : ''}" type="button" data-lan-echo="${n}">${n} 张</button>`).join('') : ''}
              <small>J-A + 2 张万能牌；回响为每轮公开的目标牌</small>
            ` : `<strong>${S.liarMode === 'echo' ? `回响 · ${S.echoCount} 张` : '经典'}</strong><small>开始后自动同步模式</small>`}
          </div>
        ` : ''}
        <div class="lan-room__foot">
          ${isHost
            ? `<button class="btn btn--primary btn--lg" type="button" data-lan-start ${canStart ? '' : 'disabled'}>${startLabel}</button>`
            : `<p class="lan-waiting"><span class="thinking"><i></i><i></i><i></i></span> ${players.length < need ? `等朋友入座（${players.length}/${need}）……` : '等房主开始……'}</p>`}
          <button class="btn btn--ghost" type="button" data-lan-leave>离开房间</button>
        </div>
        ${S.error ? `<p class="lan-error">${util.escapeHtml(S.error)}</p>` : ''}
        <p class="lan-hint">把房间码告诉同一 Wi-Fi 下的朋友，或在本机另一个浏览器窗口加入。房主开始后所有人自动进入牌局；骗子酒馆还支持 2-8 人和牌桌聊天。</p>
      </div>
    `;
  }

  function render() {
    const root = document.getElementById('lanLobby');
    if (!root || !S) return;
    root.innerHTML = renderBody(C.Net && C.Net.available());
    bind();
  }

  function bind() {
    const root = document.getElementById('lanLobby');
    if (!root) return;

    root.querySelectorAll('[data-lan-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        S.tab = btn.dataset.lanTab;
        S.error = null;
        render();
      });
    });

    const name = root.querySelector('#lanName');
    if (name) {
      name.addEventListener('input', () => {
        S.name = name.value;
        C.storage.set('casino.lanName', S.name);
      });
    }

    root.querySelectorAll('[data-lan-game]').forEach((btn) => {
      btn.addEventListener('click', () => {
        S.game = btn.dataset.lanGame;
        render();
      });
    });

    root.querySelectorAll('[data-lan-roulette-count]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = clampRoulette(btn.dataset.lanRouletteCount);
        if (next < (S.players || []).length) {
          S.error = `房间里已经有 ${S.players.length} 人，不能把人数改到 ${next}。`;
          render();
          return;
        }
        S.error = null;
        S.roulettePlayers = next;
        C.storage.set('casino.lanRoulettePlayers', S.roulettePlayers);
        pushRoomConfig();
        render();
      });
    });

    root.querySelectorAll('[data-lan-liar-count]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = clampLiar(btn.dataset.lanLiarCount);
        if (next < (S.players || []).length) {
          S.error = `房间里已经有 ${S.players.length} 人，不能把人数改到 ${next}。`;
          render();
          return;
        }
        S.error = null;
        S.liarPlayers = next;
        C.storage.set('casino.lanPlayers', S.liarPlayers);
        pushRoomConfig();
        render();
      });
    });

    root.querySelectorAll('[data-lan-liar-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        S.liarMode = btn.dataset.lanLiarMode === 'echo' ? 'echo' : 'classic';
        pushRoomConfig();
        render();
      });
    });
    root.querySelectorAll('[data-lan-echo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        S.echoCount = Math.max(1, Math.min(3, Number(btn.dataset.lanEcho) || 1));
        pushRoomConfig();
        render();
      });
    });

    const code = root.querySelector('#lanCode');
    if (code) {
      code.addEventListener('input', () => {
        S.code = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
        code.value = S.code;
      });
    }

    const create = root.querySelector('[data-lan-create]');
    if (create) create.addEventListener('click', doCreate);
    const join = root.querySelector('[data-lan-join]');
    if (join) join.addEventListener('click', doJoin);
    const start = root.querySelector('[data-lan-start]');
    if (start) start.addEventListener('click', doStart);
    const leave = root.querySelector('[data-lan-leave]');
    if (leave) leave.addEventListener('click', () => UI.requestClose());
    const copy = root.querySelector('[data-lan-copy]');
    if (copy) copy.addEventListener('click', copyCode);
  }

  function pushRoomConfig() {
    if (!S || !C.Net || !C.Net.isHost() || !C.Net.roomId) return;
    C.Net.send('config', null, {
      game: S.game,
      maxPlayers: S.game === 'roulette' ? S.roulettePlayers : S.liarPlayers,
      liarMode: S.liarMode,
      echoCount: S.echoCount
    }).catch(() => { /* 轮询会自动重试房主状态，这里失败不打断操作 */ });
  }

  async function doCreate() {
    if (!S) return;
    if (!S.name.trim()) {
      S.error = '先起一个名字。';
      render();
      return;
    }
    S.error = null;
    S.starting = true;
    render();
    try {
      await C.Net.create(S.name.trim(), {
        game: S.game,
        maxPlayers: S.game === 'roulette' ? S.roulettePlayers : S.liarPlayers,
        liarMode: S.liarMode,
        echoCount: S.echoCount
      });
      if (!S) {
        C.Net.leave();
        return;
      }
      S.starting = false;
      S.phase = 'room';
      pushRoomConfig();
      render();
    } catch (e) {
      if (!S) return;
      S.starting = false;
      S.error = e.message;
      render();
    }
  }

  async function doJoin() {
    if (!S) return;
    if (!S.name.trim()) {
      S.error = '先起一个名字。';
      render();
      return;
    }
    if (!S.code.trim()) {
      S.error = '输入房间码。';
      render();
      return;
    }
    S.error = null;
    S.starting = true;
    render();
    try {
      await C.Net.join(S.code.trim(), S.name.trim());
      if (!S) {
        C.Net.leave();
        return;
      }
      S.starting = false;
      S.phase = 'room';
      render();
    } catch (e) {
      if (!S) return;
      S.starting = false;
      S.error = e.message;
      render();
    }
  }

  function doStart() {
    if (!S || !C.Net.isHost() || S.starting) return;
    const players = C.Net.players.map((p) => ({ id: p.id, name: p.name }));
    const need = S.game === 'roulette' ? S.roulettePlayers : S.liarPlayers;
    if (players.length !== need) {
      S.error = S.game === 'roulette'
        ? `恶魔轮盘赌当前设置 ${need} 人，房间里有 ${players.length} 人。`
        : `骗子酒馆当前设置 ${need} 人，房间里有 ${players.length} 人。`;
      render();
      return;
    }
    S.starting = true;
    S.error = null;
    S.phase = 'starting';
    render();
    const payload = {
      game: S.game,
      players,
      hostId: C.Net.playerId,
      liarMode: S.liarMode,
      echoCount: S.echoCount,
      maxPlayers: need
    };
    C.Net.send('start', null, payload).then(() => {
      if (!S) return;
      S.phase = 'started';
      launch(payload, true);
    }).catch((e) => {
      if (!S) return;
      S.starting = false;
      S.phase = 'room';
      S.error = e.message;
      render();
    });
  }

  function launch(payload, isHost) {
    const game = payload.game === 'roulette' ? 'roulette' : 'liar';
    const ctx = {
      role: isHost ? 'host' : 'client',
      myId: C.Net.playerId,
      players: payload.players || [],
      hostId: payload.hostId,
      liarMode: payload.liarMode,
      echoCount: payload.echoCount,
      maxPlayers: payload.maxPlayers
    };
    cleanup();
    UI.closePanel();
    if (game === 'roulette') C.Roulette.startMultiplayer(ctx);
    else C.Liar.startMultiplayer(ctx);
  }

  function copyCode() {
    const code = S && S.roomId;
    if (!code) return;
    const done = () => UI.toast(`房间码 ${code} 已复制`, 'info', '📋');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done).catch(() => done());
    } else {
      done();
    }
  }

  function cleanup() {
    if (offPlayers) { C.Net.off('players', offPlayers); offPlayers = null; }
    if (offMessage) { C.Net.off('message', offMessage); offMessage = null; }
    if (offStatus) { C.Net.off('status', offStatus); offStatus = null; }
  }

  C.Lan = {
    open,
    isOpen: () => !!S
  };
})(window.Casino = window.Casino || {});
