/* ============================================================
   赌徒模拟器 · 恶魔轮盘赌（Buckshot Roulette）
   单人 1v1 与局域网双人。实弹 / 空包 / 道具 / 手铐 / 锯子。
   ============================================================ */
(function (C) {
  'use strict';

  const util = C.util;
  const State = C.State;
  const UI = C.UI;
  const DATA = C.DATA;
  const CONF = DATA.ROULETTE;
  const ITEMS = CONF.items;

  let S = null;
  let lobbyOpen = false;

  function itemDef(id) {
    return ITEMS.find((item) => item.id === id) || { id, name: id, icon: '❓', desc: '' };
  }

  /* ============================================================
     入口
     ============================================================ */

  function open() {
    if (S || lobbyOpen) return;
    lobbyOpen = true;
    const state = C.state;
    const ante = CONF.ante;
    const canPlay = state.money >= ante && state.actions > 0 && !state.gameOver;
    const lanAvailable = C.Net && C.Net.available();
    const reason = state.actions <= 0 ? '今日行动已用完' : state.money < ante ? `现金不足 ${util.fmt(ante)}` : '';

    UI.openPanel({
      kicker: 'BUCKSHOT ROULETTE',
      title: '恶魔轮盘赌',
      subtitle: '一把霰弹枪，若干实弹与空包。对自己开枪空包可保留回合，对恶魔开枪则看命。',
      wide: true,
      body: `
        <div class="roulette-lobby" id="rouletteLobby">
          <div class="roulette-lobby__banner">
            <span class="roulette-lobby__icon">🔫</span>
            <p>双方各 <strong>${CONF.startHp} 点生命</strong>。每轮装填数量公开、顺序保密。香烟回血、放大镜看弹、啤酒退弹、手铐锁回合、锯子让下一枪伤害翻倍。</p>
          </div>
          <div class="roulette-lobby__modes">
            <button class="roulette-mode" type="button" data-roulette-solo ${canPlay ? '' : 'disabled'}>
              <span class="roulette-mode__icon">😈</span>
              <span><strong>单人 · 对恶魔</strong><small>你 vs AI · 底注 ${util.fmt(ante)}</small></span>
              <em>1 行动</em>
            </button>
            <button class="roulette-mode" type="button" data-roulette-lan ${lanAvailable ? '' : 'disabled'}>
              <span class="roulette-mode__icon">📡</span>
              <span><strong>局域网双人</strong><small>${lanAvailable ? '2 人 · 友谊赛不计现金' : '需先用 node server/lan-server.js 启动'}</small></span>
              <em>${lanAvailable ? '联机' : '不可用'}</em>
            </button>
          </div>
          ${canPlay ? '' : `<p class="roulette-lobby__warn">${reason}，暂时不能入座。</p>`}
          <p class="roulette-lobby__hint">单人局消耗 1 次行动和 ${util.fmt(ante)} 底注；赢家拿走底池的 90%。</p>
        </div>
      `,
      onClosed: () => { lobbyOpen = false; }
    });

    const root = document.getElementById('rouletteLobby') || document.querySelector('.game-panel__body');
    if (root) {
      const solo = root.querySelector('[data-roulette-solo]');
      if (solo) solo.addEventListener('click', startSolo);
      const lan = root.querySelector('[data-roulette-lan]');
      if (lan) lan.addEventListener('click', () => C.Lan.open('roulette'));
    }
  }

  function start() {
    open();
  }

  /* ============================================================
     状态
     ============================================================ */

  function makePlayer(id, name, avatar, isAI) {
    return {
      id, name, avatar, isAI: !!isAI,
      hp: CONF.startHp,
      maxHp: CONF.maxHp,
      alive: true,
      items: randomItems(2),
      skipNext: false
    };
  }

  function randomItemId() {
    return ITEMS[util.randomInt(ITEMS.length)].id;
  }

  function randomItems(count) {
    const out = [];
    for (let i = 0; i < count; i++) out.push(randomItemId());
    return out;
  }

  function createState(players, opts) {
    const state = {
      mode: opts.mode,
      players,
      turn: 0,
      shells: [],
      index: 0,
      liveTotal: 0,
      blankTotal: 0,
      sawed: false,
      phase: 'playing',
      shellRound: 0,
      winnerId: null,
      pot: opts.pot,
      ante: opts.ante,
      houseCut: opts.houseCut == null ? CONF.houseCut : opts.houseCut,
      log: [],
      lastShot: null
    };
    reload(state);
    state.turn = util.randomInt(state.players.length);
    state.log.push(`${state.players[state.turn].name} 先手。`);
    return state;
  }

  function reload(state) {
    state.shellRound += 1;
    const round = state.shellRound;
    const live = Math.min(4, 1 + round);
    const blank = Math.min(4, 2 + Math.floor(round / 2));
    const shells = [];
    for (let i = 0; i < live; i++) shells.push({ live: true, knownTo: [] });
    for (let i = 0; i < blank; i++) shells.push({ live: false, knownTo: [] });
    state.shells = util.shuffle(shells);
    state.index = 0;
    state.liveTotal = live;
    state.blankTotal = blank;
    state.sawed = false;

    for (const p of state.players) {
      if (!p.alive) continue;
      if (p.items.length < 6) p.items.push(randomItemId());
    }
    state.log.push(`装填：${live} 发实弹 / ${blank} 发空包。每人获得 1 个道具。`);
    if (state.log.length > 80) state.log.shift();
  }

  function currentShell(state) {
    return state.shells[state.index] || null;
  }

  function remaining(state) {
    let live = 0;
    let blank = 0;
    for (let i = state.index; i < state.shells.length; i++) {
      if (state.shells[i].live) live++;
      else blank++;
    }
    return { live, blank, total: state.shells.length - state.index };
  }

  function nextAlive(state, fromIndex) {
    const n = state.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (fromIndex + i) % n;
      if (state.players[idx].alive) return idx;
    }
    return fromIndex;
  }

  function advanceTurn(state, fromIndex) {
    let next = nextAlive(state, fromIndex);
    if (state.players[next].skipNext) {
      state.players[next].skipNext = false;
      state.log.push(`手铐生效：${state.players[next].name} 跳过这一回合。`);
      next = nextAlive(state, next);
    }
    state.turn = next;
  }

  function useItem(state, playerId, itemId) {
    if (!state || state.phase !== 'playing') return { ok: false, error: '牌局已经结束。' };
    const idx = state.players.findIndex((p) => p.id === playerId);
    if (idx < 0) return { ok: false, error: '找不到玩家。' };
    const p = state.players[idx];
    if (!p.alive) return { ok: false, error: '你已经出局。' };
    if (state.turn !== idx) return { ok: false, error: '还没轮到你。' };
    const itemIndex = p.items.indexOf(itemId);
    if (itemIndex < 0) return { ok: false, error: '你没有这个道具。' };
    const def = itemDef(itemId);
    const shell = currentShell(state);

    if (itemId === 'cig') {
      if (p.hp >= p.maxHp) return { ok: false, error: '生命已满。' };
      p.hp = Math.min(p.maxHp, p.hp + 1);
      p.items.splice(itemIndex, 1);
      state.log.push(`${p.name} 抽了一根烟，恢复 1 点生命（${p.hp}/${p.maxHp}）。`);
      return { ok: true };
    }

    if (itemId === 'glass') {
      if (!shell) return { ok: false, error: '弹仓空了。' };
      p.items.splice(itemIndex, 1);
      if (!shell.knownTo.includes(p.id)) shell.knownTo.push(p.id);
      state.log.push(`${p.name} 用放大镜看了看当前弹壳。`);
      return { ok: true, private: true };
    }

    if (itemId === 'beer') {
      if (!shell) return { ok: false, error: '弹仓空了。' };
      p.items.splice(itemIndex, 1);
      state.log.push(`${p.name} 拉开啤酒，退出一发${shell.live ? '实弹' : '空包'}。`);
      state.index += 1;
      if (state.index >= state.shells.length) {
        reload(state);
      }
      return { ok: true };
    }

    if (itemId === 'cuffs') {
      const opp = state.players[nextAlive(state, idx)];
      if (!opp || opp.id === p.id) return { ok: false, error: '没有可以铐住的对手。' };
      opp.skipNext = true;
      p.items.splice(itemIndex, 1);
      state.log.push(`${p.name} 铐住了 ${opp.name}，对方将跳过下一回合。`);
      return { ok: true };
    }

    if (itemId === 'saw') {
      state.sawed = true;
      p.items.splice(itemIndex, 1);
      state.log.push(`${p.name} 锯短了枪管，下一枪伤害翻倍。`);
      return { ok: true };
    }

    return { ok: false, error: '这个道具暂时不能用。' };
  }

  function shoot(state, playerId, targetId) {
    if (!state || state.phase !== 'playing') return { ok: false, error: '牌局已经结束。' };
    const shooterIndex = state.players.findIndex((p) => p.id === playerId);
    if (shooterIndex < 0) return { ok: false, error: '找不到玩家。' };
    const shooter = state.players[shooterIndex];
    if (!shooter.alive) return { ok: false, error: '你已经出局。' };
    if (state.turn !== shooterIndex) return { ok: false, error: '还没轮到你。' };
    const targetIndex = state.players.findIndex((p) => p.id === targetId);
    if (targetIndex < 0) return { ok: false, error: '找不到目标。' };
    const target = state.players[targetIndex];
    if (!target.alive) return { ok: false, error: '目标已经出局。' };

    const shell = currentShell(state);
    if (!shell) return { ok: false, error: '弹仓空了。' };
    const damage = shell.live ? (state.sawed ? 2 : 1) : 0;
    const wasSawed = state.sawed;
    state.index += 1;
    state.sawed = false;
    state.lastShot = { shooterId: shooter.id, targetId: target.id, live: shell.live, damage, sawed: wasSawed };
    state.log.push(`${shooter.name} 朝 ${shooter.id === target.id ? '自己' : target.name} 开枪：${shell.live ? '实弹' : '空包'}${damage ? `，造成 ${damage} 点伤害` : ''}。`);

    if (damage > 0) {
      target.hp = Math.max(0, target.hp - damage);
      if (target.hp <= 0) {
        target.alive = false;
        const winner = state.players.find((p) => p.alive);
        if (winner) finish(state, winner.id);
        return { ok: true, result: true };
      }
    }

    if (shooter.id === target.id && !shell.live) {
      // 空包打自己，保留回合
    } else {
      advanceTurn(state, shooterIndex);
    }

    if (state.index >= state.shells.length) {
      reload(state);
    }

    if (state.log.length > 80) state.log.shift();
    return { ok: true };
  }

  function finish(state, winnerId) {
    state.phase = 'result';
    state.winnerId = winnerId;
    state.turn = -1;
    state.log.push(`${state.players.find((p) => p.id === winnerId)?.name || '某人'} 赢下了这局。`);
  }

  function viewFor(state, viewerId) {
    const viewer = state.players.find((p) => p.id === viewerId);
    const shell = currentShell(state);
    const known = shell && viewer && shell.knownTo.includes(viewer.id);
    const rem = remaining(state);
    return {
      myId: viewerId,
      mode: state.mode,
      phase: state.phase,
      turnId: state.phase === 'playing' && state.players[state.turn] ? state.players[state.turn].id : null,
      players: state.players.map((p) => ({
        id: p.id, name: p.name, avatar: p.avatar, hp: p.hp, maxHp: p.maxHp,
        alive: p.alive, itemCount: p.items.length, isAI: p.isAI, skipNext: p.skipNext
      })),
      myHp: viewer ? viewer.hp : 0,
      myMaxHp: viewer ? viewer.maxHp : CONF.maxHp,
      myItems: viewer ? viewer.items.slice() : [],
      shell: known ? { live: shell.live } : null,
      remaining: rem,
      shellIndex: state.index,
      shellCount: state.shells.length,
      sawed: state.sawed,
      winnerId: state.winnerId,
      pot: state.pot,
      ante: state.ante,
      houseCut: state.houseCut,
      log: state.log.slice(-10)
    };
  }

  /* ============================================================
     启动
     ============================================================ */

  function startSolo() {
    if (S) return;
    if (C.state.money < CONF.ante || C.state.actions <= 0) {
      UI.toast('现金或行动不足，暂时不能入座。', 'lose');
      return;
    }
    if (!C.Game.beginActivity({ action: 1, minMoney: CONF.ante, label: '恶魔轮盘赌' })) return;
    C.state.money -= CONF.ante;
    UI.refresh();
    const players = [
      makePlayer('p0', '你', '🧑', false),
      makePlayer('p1', '恶魔', '😈', true)
    ];

    S = {
      mode: 'solo',
      myId: 'p0',
      state: createState(players, { mode: 'solo', ante: CONF.ante, pot: CONF.ante * 2, houseCut: CONF.houseCut }),
      view: null,
      busy: false,
      pending: false,
      aiTimer: null,
      settled: false,
      netHandler: null
    };

    openTable('单人 · 对恶魔', `底注 ${util.fmt(CONF.ante)} · ${CONF.startHp} 点生命`, () => {
      S = null;
      C.Game.endActivity();
    });
    render();
    scheduleAI();
  }

  function startMultiplayer(ctx) {
    if (S) return;
    if (!C.Game.beginActivity({ action: 0, label: '局域网 · 恶魔轮盘赌' })) return;
    const players = (ctx.players || []).slice(0, 2).map((p, i) =>
      makePlayer(p.id, p.name || `玩家 ${i + 1}`, p.avatar || ['🧑', '😈'][i], false)
    );
    if (players.length < 2) {
      UI.toast('恶魔轮盘赌需要 2 名玩家。', 'lose');
      C.Game.endActivity();
      return;
    }

    S = {
      mode: ctx.role,
      myId: ctx.myId,
      state: null,
      view: null,
      busy: false,
      pending: false,
      aiTimer: null,
      settled: false,
      netHandler: null
    };

    if (ctx.role === 'host') {
      S.state = createState(players, { mode: 'host', ante: 0, pot: 0, houseCut: 0 });
      State.unlock('lan_first');
      State.unlock('lan_host');
    } else {
      State.unlock('lan_first');
    }

    const handler = (msg) => handleNet(msg);
    S.netHandler = handler;
    C.Net.on('message', handler);

    openTable(ctx.role === 'host' ? '局域网 · 房主' : '局域网 · 联机', '友谊赛 · 不计现金', () => {
      if (S && S.netHandler) C.Net.off('message', S.netHandler);
      S = null;
      C.Game.endActivity();
    });

    if (ctx.role === 'host') {
      broadcast();
      render();
    } else {
      renderLoading();
    }
  }

  function openTable(kicker, subtitle, onClosed) {
    UI.openPanel({
      kicker: 'BUCKSHOT ROULETTE · ' + kicker,
      title: '恶魔轮盘赌',
      subtitle,
      wide: true,
      body: '<div id="rouletteRoot"></div>',
      onClose: requestClose,
      onClosed
    });
  }

  /* ============================================================
     联机
     ============================================================ */

  function broadcast() {
    if (!S || S.mode !== 'host' || !C.Net) return;
    for (const p of S.state.players) {
      if (p.id === S.myId) continue;
      C.Net.send('state', p.id, { view: viewFor(S.state, p.id) });
    }
  }

  function handleNet(msg) {
    if (!S) return;
    if (S.mode === 'host' && msg.type === 'action') {
      const action = msg.payload && msg.payload.action;
      let result;
      if (action && action.type === 'item') result = useItem(S.state, msg.from, action.item);
      else if (action && action.type === 'shoot') result = shoot(S.state, msg.from, action.targetId);
      else result = { ok: false, error: '未知操作。' };
      if (!result.ok) {
        C.Net.send('error', msg.from, { message: result.error });
        return;
      }
      afterAction();
      return;
    }
    if (S.mode === 'host' && msg.type === 'leave') {
      hostPlayerLeave(msg.from);
      return;
    }
    if (S.mode === 'client' && msg.type === 'state') {
      S.view = msg.payload.view;
      S.pending = false;
      render();
      if (S.view && S.view.phase === 'result') settleLan();
      return;
    }
    if (S.mode === 'client' && msg.type === 'abort') {
      UI.toast('房主解散了房间。', 'info');
      UI.closePanel();
      setTimeout(() => { try { C.Net.leave(); } catch (e) { /* ignore */ } }, 120);
      return;
    }
    if (S.mode === 'client' && msg.type === 'error') {
      S.pending = false;
      UI.toast(msg.payload && msg.payload.message ? msg.payload.message : '操作无效。', 'lose');
      render();
    }
  }

  function hostPlayerLeave(playerId) {
    if (!S || S.mode !== 'host') return;
    const state = S.state;
    const p = state.players.find((item) => item.id === playerId);
    if (!p || !p.alive) return;
    p.alive = false;
    p.hp = 0;
    state.log.push(`${p.name} 离开了牌局。`);
    const winner = state.players.find((item) => item.alive);
    if (winner) finish(state, winner.id);
    afterAction();
  }

  /* ============================================================
     操作
     ============================================================ */

  function act(action) {
    if (!S) return;
    if (S.mode === 'client') {
      if (!S.view || S.pending || S.view.phase !== 'playing' || S.view.turnId !== S.myId) return;
      S.pending = true;
      C.Net.send('action', null, { action }).catch(() => {
        if (!S) return;
        S.pending = false;
        UI.toast('网络断开，操作没有发出去。', 'lose');
        render();
      });
      render();
      return;
    }

    const state = S.state;
    if (!state || state.phase !== 'playing') return;
    if (state.players[state.turn].id !== S.myId) return;
    let result;
    if (action.type === 'item') result = useItem(state, S.myId, action.item);
    else if (action.type === 'shoot') result = shoot(state, S.myId, action.targetId);
    else result = { ok: false, error: '未知操作。' };
    if (!result.ok) {
      UI.toast(result.error, 'lose');
      return;
    }
    afterAction();
  }

  function afterAction() {
    if (!S) return;
    if (S.mode === 'solo') {
      if (S.state.phase === 'result') settleSolo();
      else {
        render();
        scheduleAI();
      }
      return;
    }
    if (S.mode === 'host') {
      broadcast();
      render();
      if (S.state.phase === 'result') settleLan();
    }
  }

  /* ============================================================
     AI
     ============================================================ */

  function scheduleAI() {
    if (!S || S.mode !== 'solo' || !S.state || S.state.phase !== 'playing') return;
    const p = S.state.players[S.state.turn];
    if (!p || !p.isAI) return;
    if (S.aiTimer) return;
    S.busy = true;
    render();
    S.aiTimer = setTimeout(() => {
      if (!S || !S.state || S.state.phase !== 'playing') return;
      S.aiTimer = null;
      S.busy = false;
      const current = S.state.players[S.state.turn];
      if (!current || !current.isAI) return;
      aiStep();
      afterAction();
    }, 760 + Math.random() * 500);
  }

  function aiStep() {
    const state = S.state;
    const p = state.players[state.turn];
    const opp = state.players.find((item) => item.alive && item.id !== p.id);
    if (!opp) return;

    if (p.hp < p.maxHp && p.items.includes('cig') && Math.random() < 0.75) {
      useItem(state, p.id, 'cig');
      return;
    }

    const shell = currentShell(state);
    const known = shell && shell.knownTo.includes(p.id);

    if (shell && !known && p.items.includes('glass') && Math.random() < 0.8) {
      useItem(state, p.id, 'glass');
      return;
    }

    if (known && state.sawed === false && p.items.includes('saw') && shell.live) {
      useItem(state, p.id, 'saw');
      return;
    }

    if (known && !shell.live && p.items.includes('beer') && Math.random() < 0.45) {
      useItem(state, p.id, 'beer');
      return;
    }

    if (p.items.includes('cuffs') && Math.random() < 0.35) {
      useItem(state, p.id, 'cuffs');
      return;
    }

    let targetId;
    if (known) {
      targetId = shell.live ? opp.id : (Math.random() < 0.7 ? p.id : opp.id);
    } else {
      targetId = Math.random() < 0.72 ? opp.id : p.id;
    }
    shoot(state, p.id, targetId);
  }

  /* ============================================================
     结算
     ============================================================ */

  function settleSolo() {
    if (!S || S.settled) return;
    S.settled = true;
    const state = S.state;
    const me = state.players.find((p) => p.id === 'p0');
    const won = state.winnerId === 'p0';
    State.addStat('rouletteGames', 1);

    if (won) {
      const payout = Math.floor(state.pot * (1 - state.houseCut));
      C.state.money += payout;
      State.addStat('rouletteWins', 1);
      State.unlock('first_win');
      State.unlock('roulette_win');
      if (me && me.hp === 1) State.unlock('roulette_last');
      if (state.lastShot && state.lastShot.sawed && state.lastShot.shooterId === 'p0') State.unlock('roulette_saw');
      C.sound.play('bigwin');
      UI.toast(`你活下来了，拿走 ${util.fmt(payout)}`, 'win', '🔫');
    } else {
      C.sound.play('lose');
      UI.toast(`恶魔收走了你的 ${util.fmt(state.ante)} 底注`, 'lose', '💀');
    }
    State.bumpStat('maxCash', C.state.money);
    UI.refresh();
    render();
  }

  function settleLan() {
    if (!S || S.settled) return;
    S.settled = true;
    State.addStat('lanGames', 1);
    State.unlock('lan_first');
    const view = currentView();
    if (view && view.winnerId === S.myId) {
      State.addStat('lanWins', 1);
      State.unlock('lan_win');
      State.unlock('roulette_win');
    }
    render();
  }

  /* ============================================================
     渲染
     ============================================================ */

  function currentView() {
    if (!S) return null;
    if (S.mode === 'client') return S.view;
    return viewFor(S.state, S.myId);
  }

  function renderLoading() {
    const root = document.getElementById('rouletteRoot');
    if (!root) return;
    root.innerHTML = `<div class="roulette-loading"><span class="thinking"><i></i><i></i><i></i></span><p>正在等房主装填……</p></div>`;
  }

  function render() {
    const root = document.getElementById('rouletteRoot');
    if (!root) return;
    const view = currentView();
    if (!view) {
      renderLoading();
      return;
    }

    const me = view.players.find((p) => p.id === view.myId);
    const opp = view.players.find((p) => p.id !== view.myId);
    const myTurn = view.phase === 'playing' && view.turnId === view.myId && !S.pending;
    const knownShell = view.shell ? (view.shell.live ? '实弹' : '空包') : '未知';
    const shellClass = view.shell ? (view.shell.live ? 'is-live' : 'is-blank') : '';
    const shells = [];
    const total = Math.min(view.shellCount || 0, 10);
    for (let i = 0; i < total; i++) {
      shells.push(`<span class="roulette-shell${i < view.shellIndex ? ' is-used' : ''}"></span>`);
    }

    const items = view.myItems.map((id) => {
      const def = itemDef(id);
      return `<button class="roulette-item" type="button" data-roulette-item="${id}" ${myTurn ? '' : 'disabled'} title="${util.escapeHtml(def.desc)}">
        <span>${def.icon}</span><strong>${def.name}</strong>
      </button>`;
    }).join('');

    const oppItems = [];
    for (let i = 0; i < (opp ? opp.itemCount : 0); i++) oppItems.push('<span class="roulette-item-dot"></span>');

    const result = view.phase === 'result' ? resultHTML(view) : '';
    const status = view.phase === 'result'
      ? ''
      : myTurn
        ? `轮到你 · 当前弹壳：${knownShell}`
        : view.turnId
          ? `等待 ${nameById(view, view.turnId)} 行动`
          : '';

    root.innerHTML = `
      <div class="roulette-table">
        <div class="roulette-hud">
          <div class="roulette-hud__item"><span>弹仓</span><strong>${view.remaining.live} 实弹 / ${view.remaining.blank} 空包</strong></div>
          <div class="roulette-hud__item"><span>当前弹壳</span><strong class="${shellClass}">${knownShell}</strong></div>
          <div class="roulette-hud__item"><span>底池</span><strong>${view.pot ? util.fmt(view.pot) : '友谊赛'}</strong></div>
        </div>

        <div class="roulette-opponent${view.turnId === (opp && opp.id) ? ' is-turn' : ''}">
          <span class="roulette-avatar">${opp ? opp.avatar : '😈'}</span>
          <div>
            <strong>${opp ? util.escapeHtml(opp.name) : '恶魔'}${opp && opp.skipNext ? ' · 被铐住' : ''}</strong>
            <div class="roulette-hp">${hpHTML(opp)}</div>
            <small>道具 ${opp ? opp.itemCount : 0} 个</small>
          </div>
          <div class="roulette-item-dots">${oppItems.join('')}</div>
        </div>

        <div class="roulette-gun">
          <div class="roulette-gun__barrel ${view.sawed ? 'is-sawed' : ''}">
            <span class="roulette-gun__muzzle"></span>
            <span class="roulette-gun__body"></span>
            <span class="roulette-gun__grip"></span>
          </div>
          <div class="roulette-shells">${shells.join('')}</div>
          <p class="roulette-gun__hint">${view.sawed ? '枪管已锯短：下一枪伤害 ×2' : '弹壳顺序保密，靠道具和运气。'}</p>
        </div>

        <div class="roulette-me">
          <div class="roulette-me__head">
            <span>你</span>
            <span class="roulette-hp">${hpHTML(me)}</span>
            <span>${me ? `${me.hp} / ${me.maxHp}` : ''}</span>
          </div>
          <div class="roulette-items">${items || '<span class="roulette-items__empty">没有道具。硬着头皮开枪吧。</span>'}</div>
        </div>

        ${view.phase === 'result' ? '' : `
          <div class="roulette-controls">
            <button class="btn btn--danger" type="button" data-roulette="self" ${myTurn ? '' : 'disabled'}>对自己开枪</button>
            <button class="btn btn--primary" type="button" data-roulette="opponent" ${myTurn && opp ? '' : 'disabled'}>对${opp ? util.escapeHtml(opp.name) : '恶魔'}开枪</button>
            <button class="btn btn--ghost" type="button" data-roulette="leave">离开</button>
          </div>
          <div class="roulette-status">${status}</div>
        `}
        <div class="roulette-feed">${view.log.map((line) => `<div>${util.escapeHtml(line)}</div>`).join('')}</div>
        ${result}
      </div>
    `;

    bind(root);
    if (view.phase === 'result') {
      const resultEl = root.querySelector('.roulette-result');
      if (resultEl) resultEl.scrollIntoView({ block: 'nearest' });
    }
  }

  function nameById(view, id) {
    const p = view.players.find((item) => item.id === id);
    return p ? p.name : '某人';
  }

  function hpHTML(p) {
    if (!p) return '';
    const out = [];
    for (let i = 0; i < p.maxHp; i++) out.push(`<i class="${i < p.hp ? 'is-on' : ''}">${i < p.hp ? '❤' : '♡'}</i>`);
    return out.join('');
  }

  function resultHTML(view) {
    const won = view.winnerId === view.myId;
    const winner = view.players.find((p) => p.id === view.winnerId);
    const amount = view.mode === 'solo'
      ? (won ? Math.floor(view.pot * (1 - view.houseCut)) : -view.ante)
      : 0;
    const cls = amount > 0 ? 'pos' : amount < 0 ? 'neg' : 'tie';
    const canAgain = view.mode === 'solo' && C.state.actions > 0 && C.state.money >= view.ante && !C.state.gameOver;
    return `<div class="roulette-result roulette-result--${won ? 'win' : 'loss'}">
      <p class="roulette-result__eyebrow">GAME OVER</p>
      <h3>${won ? '你活下来了' : `${util.escapeHtml(winner ? winner.name : '恶魔')} 活下来了`}</h3>
      <div class="roulette-result__amount roulette-result__amount--${cls}">${view.mode === 'solo' ? util.fmtSigned(amount) : '友谊赛 · 不计现金'}</div>
      <p>${view.mode === 'solo' ? (won ? `底池 ${util.fmt(view.pot)}，抽水 10% 后到手 ${util.fmt(amount)}。` : `底注 ${util.fmt(view.ante)} 留在了桌上。`) : '局域网友谊赛，输赢只关乎面子。'}</p>
      <div class="roulette-result__actions">
        ${view.mode === 'solo' ? `<button class="btn btn--primary" type="button" data-roulette="again" ${canAgain ? '' : 'disabled'}>再来一局（1 行动）</button>` : ''}
        <button class="btn btn--ghost" type="button" data-roulette="leave">离开轮盘</button>
      </div>
    </div>`;
  }

  function bind(root) {
    root.querySelectorAll('[data-roulette-item]').forEach((btn) => {
      btn.addEventListener('click', () => act({ type: 'item', item: btn.dataset.rouletteItem }));
    });
    root.querySelectorAll('[data-roulette]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!S) return;
        const action = btn.dataset.roulette;
        if (action === 'leave') {
          UI.requestClose();
          return;
        }
        if (action === 'again') {
          UI.closePanel();
          setTimeout(startSolo, 180);
          return;
        }
        if (action === 'self') {
          act({ type: 'shoot', targetId: S.myId });
          return;
        }
        if (action === 'opponent') {
          const view = currentView();
          const opp = view && view.players.find((p) => p.id !== view.myId);
          if (opp) act({ type: 'shoot', targetId: opp.id });
        }
      });
    });
  }

  /* ============================================================
     离开
     ============================================================ */

  function requestClose() {
    if (!S) {
      UI.closePanel();
      return;
    }
    if (S.mode === 'client') {
      return UI.modal({
        title: '离开轮盘？',
        message: '联机牌局中途离开会被视为死亡，房间里的另一方直接获胜。',
        confirmText: '离开',
        cancelText: '继续赌',
        danger: true,
        icon: '🔫'
      }).then((ok) => {
        if (!ok || !S) return;
        C.Net.send('leave', null, {});
        setTimeout(() => { try { C.Net.leave(); } catch (e) { /* ignore */ } }, 120);
        UI.closePanel();
      });
    }
    if (S.mode === 'host') {
      return UI.modal({
        title: '解散房间？',
        message: '你会离开轮盘，房间里的另一名玩家会被请出去。',
        confirmText: '解散并离开',
        cancelText: '继续赌',
        danger: true,
        icon: '🔫'
      }).then((ok) => {
        if (!ok || !S) return;
        C.Net.send('abort', null, {});
        setTimeout(() => { try { C.Net.leave(); } catch (e) { /* ignore */ } }, 120);
        UI.closePanel();
      });
    }

    if (S.state && S.state.phase === 'result') {
      UI.closePanel();
      return;
    }
    return UI.modal({
      title: '认输离桌？',
      message: `现在离开会直接判负，底注 ${util.fmt(S.state.ante)} 不退。`,
      confirmText: '认输离桌',
      cancelText: '继续赌',
      danger: true,
      icon: '🔫'
    }).then((ok) => {
      if (!ok || !S) return;
      if (S.aiTimer) {
        clearTimeout(S.aiTimer);
        S.aiTimer = null;
      }
      const winner = S.state.players.find((p) => p.alive && p.id !== 'p0');
      if (winner) {
        finish(S.state, winner.id);
        settleSolo();
      }
      UI.closePanel();
    });
  }

  C.Roulette = {
    open,
    start,
    startSolo,
    startMultiplayer,
    isActive: () => !!S,
    viewFor,
    createState,
    useItem,
    shoot,
    reload,
    remaining,
    currentShell
  };
})(window.Casino = window.Casino || {});
