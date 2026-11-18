/* ============================================================
   赌徒模拟器 · 骗子酒馆（Liar's Tavern）
   单人（1v1 / 1v3）与局域网多人（2-4 人）。
   ============================================================ */
(function (C) {
  'use strict';

  const util = C.util;
  const State = C.State;
  const UI = C.UI;
  const DATA = C.DATA;
  const CONF = DATA.LIAR;
  const RANKS = DATA.RANKS;

  let S = null;
  let lobbyOpen = false;

  /* ============================================================
     入口：模式选择
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
      kicker: 'LIAR\'S TAVERN',
      title: '骗子酒馆',
      subtitle: '打出牌，声称它们是目标牌；不信就掀桌。最后活着的人拿走底池。',
      wide: true,
      body: `
        <div class="liar-lobby" id="liarLobby">
          <div class="liar-lobby__banner">
            <span class="liar-lobby__icon">🍻</span>
            <p>每人 <strong>2 条命</strong>，5 张手牌。目标牌每轮随机；你可以老实出牌，也可以把一张烂牌说成目标牌。被质疑时，只有最后打出的牌会被翻开。</p>
          </div>
          <div class="liar-lobby__modes">
            <button class="liar-mode" type="button" data-liar-solo="2" ${canPlay ? '' : 'disabled'}>
              <span class="liar-mode__icon">🤖</span>
              <span><strong>单人 · 2 人局</strong><small>你 vs 1 个 AI · 底注 ${util.fmt(ante)}</small></span>
              <em>1 行动</em>
            </button>
            <button class="liar-mode" type="button" data-liar-solo="4" ${canPlay ? '' : 'disabled'}>
              <span class="liar-mode__icon">🎭</span>
              <span><strong>单人 · 4 人局</strong><small>你 vs 3 个 AI · 底注 ${util.fmt(ante)}</small></span>
              <em>1 行动</em>
            </button>
            <button class="liar-mode" type="button" data-liar-lan ${lanAvailable ? '' : 'disabled'}>
              <span class="liar-mode__icon">📡</span>
              <span><strong>局域网联机</strong><small>${lanAvailable ? '2-4 人 · 友谊赛不计现金' : '需先用 node server/lan-server.js 启动'}</small></span>
              <em>${lanAvailable ? '联机' : '不可用'}</em>
            </button>
          </div>
          ${canPlay ? '' : `<p class="liar-lobby__warn">${reason}，暂时不能入座单人局。</p>`}
          <p class="liar-lobby__hint">单人局会消耗 1 次行动和 ${util.fmt(ante)} 底注；赢家拿走底池的 90%。</p>
        </div>
      `,
      onClosed: () => { lobbyOpen = false; }
    });

    const root = document.getElementById('liarLobby') || document.querySelector('.game-panel__body');
    if (root) {
      root.querySelectorAll('[data-liar-solo]').forEach((btn) => {
        btn.addEventListener('click', () => startSolo(Number(btn.dataset.liarSolo)));
      });
      const lan = root.querySelector('[data-liar-lan]');
      if (lan) lan.addEventListener('click', () => C.Lan.open('liar'));
    }
  }

  function start() {
    open();
  }

  /* ============================================================
     游戏状态
     ============================================================ */

  function makePlayer(id, name, avatar, isAI) {
    return {
      id, name, avatar, isAI: !!isAI,
      lives: CONF.lives,
      alive: true,
      hand: [],
      bluffed: false
    };
  }

  function createState(players, opts) {
    const state = {
      mode: opts.mode,
      players,
      deck: util.shuffle(C.cards.create(false)),
      discard: [],
      target: RANKS[0],
      turn: 0,
      pile: null,
      reveal: null,
      phase: 'playing',
      round: 0,
      pot: opts.pot,
      ante: opts.ante,
      houseCut: opts.houseCut == null ? CONF.houseCut : opts.houseCut,
      livesMax: CONF.lives,
      winnerId: null,
      log: []
    };
    const starter = state.players[util.randomInt(state.players.length)].id;
    newRound(state, starter);
    return state;
  }

  function nameOf(state, id) {
    const p = state.players.find((item) => item.id === id);
    return p ? p.name : '某人';
  }

  function nextAlive(state, fromIndex) {
    const n = state.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (fromIndex + i) % n;
      if (state.players[idx].alive) return idx;
    }
    return fromIndex;
  }

  function aliveCount(state) {
    return state.players.filter((p) => p.alive).length;
  }

  function newRound(state, starterId) {
    const pool = [];
    for (const p of state.players) pool.push.apply(pool, p.hand);
    if (state.pile) pool.push.apply(pool, state.pile.cards);
    pool.push.apply(pool, state.deck);
    pool.push.apply(pool, state.discard);

    let deck = util.shuffle(pool);
    const need = aliveCount(state) * CONF.handSize;
    if (deck.length < need) deck = util.shuffle(C.cards.create(false));

    state.deck = deck;
    state.discard = [];
    state.pile = null;
    state.reveal = null;
    state.target = RANKS[util.randomInt(RANKS.length)];
    state.round = (state.round || 0) + 1;

    for (const p of state.players) {
      p.hand = p.alive ? state.deck.splice(0, CONF.handSize) : [];
    }

    let starterIndex = state.players.findIndex((p) => p.id === starterId && p.alive);
    if (starterIndex < 0) starterIndex = state.players.findIndex((p) => p.alive);
    state.turn = starterIndex;

    state.log.push(`第 ${state.round} 轮开始：目标牌是 ${state.target}，${state.players[starterIndex].name} 先手。`);
    if (state.log.length > 60) state.log.shift();
  }

  function finish(state, winnerId) {
    state.phase = 'result';
    state.winnerId = winnerId;
    state.turn = -1;
    state.log.push(`${nameOf(state, winnerId)} 活到了最后。`);
    if (state.log.length > 60) state.log.shift();
  }

  function applyAction(state, playerId, action) {
    if (!state || state.phase !== 'playing') return { ok: false, error: '牌局已经结束。' };
    const pIndex = state.players.findIndex((p) => p.id === playerId);
    if (pIndex < 0) return { ok: false, error: '找不到这名玩家。' };
    const player = state.players[pIndex];
    if (!player.alive) return { ok: false, error: '你已经出局了。' };
    if (state.turn !== pIndex) return { ok: false, error: '还没轮到你。' };

    if (action.type === 'challenge') {
      if (!state.pile || state.pile.actorId === playerId) {
        return { ok: false, error: '现在没有可以质疑的出牌。' };
      }
      const actor = state.players.find((p) => p.id === state.pile.actorId);
      const cards = state.pile.cards.slice();
      const truthful = cards.every((card) => card.rank === state.pile.claimedRank);
      const loser = truthful ? player : actor;
      const winner = truthful ? actor : player;

      loser.lives -= 1;
      state.log.push(`质疑！${player.name} 掀开 ${actor.name} 的 ${cards.length} 张牌：${truthful ? '全是真的' : '有诈'}。`);
      state.log.push(`${loser.name} 失去 1 条命${loser.lives <= 0 ? '，出局。' : '。'}`);

      const reveal = {
        cards,
        truthful,
        challengerId: player.id,
        actorId: actor.id,
        loserId: loser.id,
        winnerId: winner.id
      };

      if (loser.lives <= 0) {
        loser.alive = false;
        if (aliveCount(state) === 1) {
          state.reveal = reveal;
          finish(state, winner.id);
          return { ok: true, reveal, result: true };
        }
      }

      newRound(state, winner.id);
      state.reveal = reveal;
      return { ok: true, reveal };
    }

    if (action.type === 'play') {
      const ids = Array.isArray(action.cards) ? action.cards.slice(0, CONF.maxPlay) : [];
      if (ids.length < 1) return { ok: false, error: '至少打出 1 张牌。' };
      const unique = new Set(ids);
      if (unique.size !== ids.length) return { ok: false, error: '选牌重复了。' };
      const cards = [];
      for (const uid of ids) {
        const card = player.hand.find((item) => item.uid === uid);
        if (!card) return { ok: false, error: '手牌里没有这张牌。' };
        cards.push(card);
      }
      if (cards.length > CONF.maxPlay) return { ok: false, error: `最多打出 ${CONF.maxPlay} 张。` };

      const lie = cards.some((card) => card.rank !== state.target);
      player.bluffed = player.bluffed || lie;
      player.hand = player.hand.filter((card) => !unique.has(card.uid));
      state.pile = {
        actorId: player.id,
        cards,
        count: cards.length,
        claimedRank: state.target
      };
      state.reveal = null;
      state.log.push(`${player.name} 打出 ${cards.length} 张，声称是 ${state.target}。`);
      if (state.log.length > 60) state.log.shift();
      state.turn = nextAlive(state, pIndex);
      return { ok: true, lie };
    }

    return { ok: false, error: '未知操作。' };
  }

  function viewFor(state, viewerId) {
    const viewer = state.players.find((p) => p.id === viewerId);
    return {
      myId: viewerId,
      mode: state.mode,
      phase: state.phase,
      target: state.target,
      turnId: state.phase === 'playing' && state.players[state.turn] ? state.players[state.turn].id : null,
      pot: state.pot,
      ante: state.ante,
      round: state.round,
      livesMax: state.livesMax,
      houseCut: state.houseCut,
      players: state.players.map((p) => ({
        id: p.id, name: p.name, avatar: p.avatar, lives: p.lives,
        alive: p.alive, handCount: p.hand.length, isAI: p.isAI
      })),
      myHand: viewer && viewer.alive ? viewer.hand.slice() : [],
      pile: state.pile ? {
        count: state.pile.count,
        actorId: state.pile.actorId,
        actorName: nameOf(state, state.pile.actorId),
        claimedRank: state.pile.claimedRank
      } : null,
      reveal: state.reveal,
      winnerId: state.winnerId,
      log: state.log.slice(-8)
    };
  }

  /* ============================================================
     单人 / 局域网启动
     ============================================================ */

  function startSolo(count) {
    if (S) return;
    const ante = CONF.ante;
    if (!C.Game.beginActivity({ action: 1, minMoney: ante, label: '骗子酒馆' })) return;
    C.state.money -= ante;
    UI.refresh();
    const human = makePlayer('p0', '你', '🧑', false);
    const ais = CONF.opponents.slice(0, Math.max(1, count - 1)).map((item, i) =>
      makePlayer('p' + (i + 1), item.name, item.emoji, true)
    );
    const players = [human].concat(ais);

    S = {
      mode: 'solo',
      myId: 'p0',
      playerCount: count,
      state: createState(players, { mode: 'solo', ante, pot: ante * count, houseCut: CONF.houseCut }),
      view: null,
      selected: new Set(),
      busy: false,
      pending: false,
      aiTimer: null,
      settled: false,
      netHandler: null
    };

    openTable(`单人 · ${count} 人局`, `底注 ${util.fmt(ante)} · 你有 ${CONF.lives} 条命`, () => {
      S = null;
      C.Game.endActivity();
    });
    render();
    scheduleAI();
  }

  function startMultiplayer(ctx) {
    if (S) return;
    if (!C.Game.beginActivity({ action: 0, label: '局域网 · 骗子酒馆' })) return;

    const players = (ctx.players || []).slice(0, CONF.maxPlayers || 4).map((p, i) =>
      makePlayer(p.id, p.name || `玩家 ${i + 1}`, p.avatar || ['🧑', '🎩', '💃', '🥃'][i % 4], false)
    );
    const ante = 0;
    const role = ctx.role;

    S = {
      mode: role,
      myId: ctx.myId,
      playerCount: players.length,
      state: null,
      view: null,
      selected: new Set(),
      busy: false,
      pending: false,
      aiTimer: null,
      settled: false,
      netHandler: null
    };

    if (role === 'host') {
      S.state = createState(players, {
        mode: 'host',
        ante: 0,
        pot: 0,
        houseCut: 0
      });
      State.unlock('lan_first');
      State.unlock('lan_host');
    } else {
      State.unlock('lan_first');
    }

    const handler = (msg) => handleNet(msg);
    S.netHandler = handler;
    C.Net.on('message', handler);

    openTable(
      role === 'host' ? '局域网 · 房主' : '局域网 · 联机',
      '友谊赛 · 不计现金 · 掉线视为离开',
      () => {
        if (S && S.netHandler) C.Net.off('message', S.netHandler);
        S = null;
        C.Game.endActivity();
      }
    );

    if (role === 'host') {
      broadcast();
      render();
    } else {
      renderLoading();
    }
  }

  function openTable(kicker, subtitle, onClosed) {
    UI.openPanel({
      kicker: 'LIAR\'S TAVERN · ' + kicker,
      title: '骗子酒馆',
      subtitle,
      wide: true,
      body: '<div id="liarRoot"></div>',
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
      const result = applyAction(S.state, msg.from, msg.payload && msg.payload.action);
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
    const index = state.players.findIndex((p) => p.id === playerId);
    if (index < 0) return;
    const p = state.players[index];
    if (!p.alive) return;
    p.alive = false;
    p.lives = 0;
    state.log.push(`${p.name} 离开了牌局。`);
    if (aliveCount(state) === 1) {
      const winner = state.players.find((item) => item.alive);
      if (winner) finish(state, winner.id);
    } else if (state.turn === index) {
      state.turn = nextAlive(state, index);
    }
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
    const result = applyAction(state, S.myId, action);
    if (!result.ok) {
      UI.toast(result.error, 'lose');
      return;
    }
    S.selected.clear();
    afterAction();
  }

  function afterAction() {
    if (!S) return;
    S.selected.clear();
    if (S.mode === 'solo') {
      if (S.state.phase === 'result') {
        settleSolo();
      } else {
        render();
        scheduleAI();
      }
      return;
    }
    if (S.mode === 'host') {
      broadcast();
      render();
      if (S.state.phase === 'result') settleLan();
      return;
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
      const action = chooseAIAction(S.state, current);
      const result = applyAction(S.state, current.id, action);
      if (!result.ok) {
        // 兜底：随便打一张
        const fallback = current.hand[0];
        if (fallback) applyAction(S.state, current.id, { type: 'play', cards: [fallback.uid] });
      }
      afterAction();
    }, 760 + Math.random() * 620);
  }

  function chooseAIAction(state, player) {
    const targetCards = player.hand.filter((card) => card.rank === state.target);
    const canChallenge = !!state.pile && state.pile.actorId !== player.id;

    if (canChallenge) {
      let chance = 0.12;
      if (player.hand.length === 0) chance = 1;
      else if (targetCards.length >= 3) chance = 0.62;
      else if (state.pile.count >= 2) chance = 0.38;
      else if (targetCards.length >= 2) chance = 0.30;
      if (Math.random() < chance) return { type: 'challenge' };
    }

    let cards = [];
    if (targetCards.length) {
      const take = 1 + (Math.random() < 0.35 ? 1 : 0);
      cards = targetCards.slice(0, take);
      if (Math.random() < 0.18) {
        const extra = player.hand.find((card) => card.rank !== state.target);
        if (extra && cards.length < CONF.maxPlay) cards.push(extra);
      }
    }
    if (!cards.length) {
      const sorted = player.hand.slice().sort((a, b) => a.value - b.value);
      const take = Math.min(sorted.length, 1 + (Math.random() < 0.35 ? 1 : 0));
      cards = sorted.slice(0, take);
    }
    return { type: 'play', cards: cards.map((card) => card.uid) };
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
    State.addStat('liarGames', 1);

    if (won) {
      const payout = Math.floor(state.pot * (1 - state.houseCut));
      C.state.money += payout;
      State.addStat('liarWins', 1);
      State.unlock('first_win');
      State.unlock('liar_win');
      if (me && me.bluffed) State.unlock('liar_bluff');
      if (me && me.lives === state.livesMax) State.unlock('liar_flawless');
      C.sound.play('bigwin');
      UI.toast(`你活到了最后，拿走 ${util.fmt(payout)}`, 'win', '🍻');
    } else {
      C.sound.play('lose');
      UI.toast(`这局输了 ${util.fmt(state.ante)} 底注`, 'lose', '💀');
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
      State.unlock('liar_win');
      if (view.players) {
        const me = view.players.find((p) => p.id === S.myId);
        if (me && me.lives === view.livesMax) State.unlock('liar_flawless');
      }
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
    const root = document.getElementById('liarRoot');
    if (!root) return;
    root.innerHTML = `
      <div class="liar-loading">
        <span class="thinking"><i></i><i></i><i></i></span>
        <p>正在等房主发牌……</p>
      </div>
    `;
  }

  function render() {
    const root = document.getElementById('liarRoot');
    if (!root) return;
    const view = currentView();
    if (!view) {
      renderLoading();
      return;
    }

    const me = view.players.find((p) => p.id === view.myId);
    const myTurn = view.phase === 'playing' && view.turnId === view.myId && !S.pending;
    const target = view.target;
    const myHand = view.myHand || [];
    for (const uid of Array.from(S.selected)) {
      if (!myHand.some((card) => card.uid === uid)) S.selected.delete(uid);
    }
    const selectedCount = S.selected.size;

    const opponents = view.players.filter((p) => p.id !== view.myId);
    const opponentHTML = opponents.map((p) => {
      const lives = [];
      for (let i = 0; i < view.livesMax; i++) lives.push(`<i class="${i < p.lives ? 'is-on' : ''}">${i < p.lives ? '❤' : '♡'}</i>`);
      return `<div class="liar-opponent${p.alive ? '' : ' is-dead'}${view.turnId === p.id ? ' is-turn' : ''}">
        <div class="liar-opponent__avatar">${p.avatar || '🎩'}</div>
        <div class="liar-opponent__info">
          <strong>${util.escapeHtml(p.name)}</strong>
          <span class="liar-lives">${lives.join('')}</span>
          <small>手牌 ${p.handCount} 张${p.alive ? '' : ' · 出局'}</small>
        </div>
        ${view.turnId === p.id ? `<em class="liar-turn">${p.isAI ? '思考中' : '行动中'}</em>` : ''}
      </div>`;
    }).join('');

    const pileCards = view.pile
      ? Array.from({ length: Math.min(view.pile.count, 4) }, () => '<span class="pcard pcard--mini pcard--back"></span>').join('')
      : '<span class="liar-pile__empty">还没有人出牌</span>';

    const claim = view.pile
      ? `<strong>${util.escapeHtml(view.pile.actorName)}</strong> 声称打出 ${view.pile.count} 张 <b class="liar-target">${view.pile.claimedRank}</b>`
      : '新一轮开始，出牌吧。';

    const canChallenge = myTurn && view.pile && view.pile.actorId !== view.myId;
    const revealHTML = view.reveal ? `
      <div class="liar-reveal ${view.reveal.truthful ? 'is-true' : 'is-lie'}">
        <span>${view.reveal.truthful ? '质疑失败：牌是真的' : '抓到骗子：牌是假的'}</span>
        <div class="card-row">${view.reveal.cards.map((card) => UI.cardHTML(card, { size: 'mini' })).join('')}</div>
        <small>${view.reveal.truthful ? `${nameById(view, view.reveal.challengerId)} 失去 1 条命` : `${nameById(view, view.reveal.actorId)} 失去 1 条命`}</small>
      </div>` : '';

    const handHTML = myHand.map((card) => {
      const selected = S.selected.has(card.uid);
      return `<button class="liar-card${selected ? ' is-selected' : ''}" type="button" data-liar-card="${card.uid}" aria-pressed="${selected}" ${myTurn ? '' : 'disabled'}>${UI.cardHTML(card, { size: 'small' })}</button>`;
    }).join('');

    const result = view.phase === 'result' ? resultHTML(view) : '';
    const pendingText = S.pending ? '已出牌，等房主确认……' : '';
    const statusText = view.phase === 'result'
      ? ''
      : myTurn
        ? `轮到你 · 目标牌 ${target}`
        : view.turnId
          ? `等待 ${nameById(view, view.turnId)} 行动`
          : '';

    root.innerHTML = `
      <div class="liar-table">
        <div class="liar-hud">
          <div class="liar-target-box"><span>目标牌</span><strong>${target}</strong></div>
          <div class="liar-pot-box"><span>底池</span><strong>${view.pot ? util.fmt(view.pot) : '友谊赛'}</strong></div>
          <div class="liar-round-box"><span>轮次</span><strong>第 ${view.round} 轮</strong></div>
        </div>

        <div class="liar-opponents">${opponentHTML}</div>

        <div class="liar-center">
          <div class="liar-pile">
            <div class="liar-pile__cards">${pileCards}</div>
            <p class="liar-claim">${claim}</p>
            ${view.pile ? `<button class="btn btn--danger" type="button" data-liar="challenge" ${canChallenge ? '' : 'disabled'}>质疑（掀桌）</button>` : ''}
          </div>
          ${revealHTML}
        </div>

        <div class="liar-me${me && !me.alive ? ' is-dead' : ''}">
          <div class="liar-me__head">
            <span>你的手牌 · <b>${myHand.length}</b> 张</span>
            <span class="liar-lives">${livesHTML(me, view.livesMax)}</span>
          </div>
          <div class="liar-hand">${handHTML || '<span class="liar-hand__empty">没有手牌了，只能质疑。</span>'}</div>
        </div>

        ${view.phase === 'result' ? '' : `
          <div class="liar-controls">
            <button class="btn btn--primary" type="button" data-liar="play" ${myTurn && selectedCount > 0 ? '' : 'disabled'}>
              打出 ${selectedCount || 0} 张（声称 ${target}）
            </button>
            <button class="btn btn--ghost" type="button" data-liar="leave">离开</button>
          </div>
          <div class="liar-status">${statusText}${pendingText}</div>
        `}
        <div class="liar-feed">${view.log.map((line) => `<div>${util.escapeHtml(line)}</div>`).join('')}</div>
        ${result}
      </div>
    `;

    bind(root);
    if (view.phase === 'result') {
      const resultEl = root.querySelector('.liar-result');
      if (resultEl) resultEl.scrollIntoView({ block: 'nearest' });
    }
  }

  function nameById(view, id) {
    const p = view.players.find((item) => item.id === id);
    return p ? p.name : '某人';
  }

  function livesHTML(player, max) {
    if (!player) return '';
    const out = [];
    for (let i = 0; i < max; i++) out.push(`<i class="${i < player.lives ? 'is-on' : ''}">${i < player.lives ? '❤' : '♡'}</i>`);
    return out.join('');
  }

  function resultHTML(view) {
    const won = view.winnerId === view.myId;
    const winner = view.players.find((p) => p.id === view.winnerId);
    const amount = view.mode === 'solo'
      ? (won ? Math.floor(view.pot * (1 - view.houseCut)) : -view.ante)
      : 0;
    const amountClass = amount > 0 ? 'pos' : amount < 0 ? 'neg' : 'tie';
    const canAgain = view.mode === 'solo' && C.state.actions > 0 && C.state.money >= view.ante && !C.state.gameOver;
    return `<div class="liar-result liar-result--${won ? 'win' : 'loss'}">
      <p class="liar-result__eyebrow">GAME OVER</p>
      <h3>${won ? '你活到了最后' : `${util.escapeHtml(winner ? winner.name : '某人')} 活到了最后`}</h3>
      <div class="liar-result__amount liar-result__amount--${amountClass}">${view.mode === 'solo' ? util.fmtSigned(amount) : '友谊赛 · 不计现金'}</div>
      <p>${view.mode === 'solo' ? (won ? `底池 ${util.fmt(view.pot)}，抽水 10% 后到手 ${util.fmt(amount)}。` : `底注 ${util.fmt(view.ante)} 留在了桌上。`) : '局域网友谊赛，输赢只关乎面子。'}</p>
      <div class="liar-result__actions">
        ${view.mode === 'solo' ? `<button class="btn btn--primary" type="button" data-liar="again" ${canAgain ? '' : 'disabled'}>再来一局（1 行动）</button>` : ''}
        <button class="btn btn--ghost" type="button" data-liar="leave">离开酒馆</button>
      </div>
    </div>`;
  }

  function bind(root) {
    root.querySelectorAll('[data-liar-card]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!S) return;
        const uid = btn.dataset.liarCard;
        if (S.selected.has(uid)) S.selected.delete(uid);
        else if (S.selected.size < CONF.maxPlay) S.selected.add(uid);
        render();
      });
    });

    root.querySelectorAll('[data-liar]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!S) return;
        const action = btn.dataset.liar;
        if (action === 'leave') {
          UI.requestClose();
          return;
        }
        if (action === 'again') {
          const count = S.playerCount;
          UI.closePanel();
          setTimeout(() => startSolo(count), 180);
          return;
        }
        if (action === 'challenge') {
          act({ type: 'challenge' });
          return;
        }
        if (action === 'play') {
          act({ type: 'play', cards: Array.from(S.selected) });
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
        title: '离开牌局？',
        message: '联机牌局中途离开会被视为弃权，房间里的其他人会继续。',
        confirmText: '离开',
        cancelText: '继续打',
        danger: true,
        icon: '🍻'
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
        message: '你会离开酒馆，房间里的其他玩家会被请出去。',
        confirmText: '解散并离开',
        cancelText: '继续打',
        danger: true,
        icon: '🍻'
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
      message: `你还有 ${S.state.players.find((p) => p.id === 'p0')?.lives || 0} 条命。现在离开会直接判负，底注 ${util.fmt(S.state.ante)} 不退。`,
      confirmText: '认输离桌',
      cancelText: '继续打',
      danger: true,
      icon: '🍻'
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

  C.Liar = {
    open,
    start,
    startSolo,
    startMultiplayer,
    isActive: () => !!S,
    viewFor,
    createState,
    applyAction
  };
})(window.Casino = window.Casino || {});
