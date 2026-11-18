/* ============================================================
   赌徒模拟器 · 德州扑克（单挑）
   完整四轮下注 + 7 选 5 牌型 + 蒙特卡洛 AI
   ============================================================ */
(function (C) {
  'use strict';

  const util = C.util;
  const State = C.State;
  const UI = C.UI;
  const Engine = C.PokerEngine;
  const CONF = C.DATA.POKER;

  let S = null;

  function start() {
    if (S) return;
    if (!C.Game.beginActivity({ action: 1, minMoney: CONF.minBuyIn, label: '德州扑克' })) return;

    const state = C.state;
    const playerStack = Math.max(0, Math.floor(state.money));
    const aiStack = util.clamp(
      util.roundTo(Math.max(1000, playerStack * 0.8), 100),
      1000,
      5000
    );

    const deck = util.shuffle(C.cards.create(false));
    const playerHole = [deck.pop(), deck.pop()];
    const aiHole = [deck.pop(), deck.pop()];

    S = {
      deck,
      hole: { player: playerHole, ai: aiHole },
      board: [],
      stacks: { player: playerStack, ai: aiStack },
      startStack: playerStack,
      bets: { player: 0, ai: 0 },
      pot: 0,
      street: 0,
      currentBet: 0,
      minRaise: CONF.bigBlind,
      acted: { player: false, ai: false },
      turn: 'player',
      handOver: false,
      showdown: false,
      busy: false,
      paused: false,
      aiTimer: null,
      result: null,
      log: [],
      handNo: (state.stats.pokerHands || 0) + 1
    };

    postBlinds();

    UI.openPanel({
      kicker: 'HEADS-UP HOLD\'EM',
      title: '德州扑克 · 单挑',
      subtitle: `盲注 ${util.fmt(CONF.smallBlind)} / ${util.fmt(CONF.bigBlind)} · 你 ${util.fmt(playerStack)} · 庄家 ${util.fmt(aiStack)}`,
      size: 'wide',
      wide: true,
      body: '<div id="pokerRoot"></div>',
      onClose: requestClose,
      onClosed: () => {
        if (S && S.aiTimer) clearTimeout(S.aiTimer);
        S = null;
        C.Game.endActivity();
      }
    });

    State.addStat('pokerHands', 1);
    render();
    scheduleAI();
  }

  function postBlinds() {
    const sb = Math.min(CONF.smallBlind, S.stacks.player);
    const bb = Math.min(CONF.bigBlind, S.stacks.ai);
    S.stacks.player -= sb;
    S.bets.player += sb;
    S.stacks.ai -= bb;
    S.bets.ai += bb;
    S.pot = sb + bb;
    S.currentBet = Math.max(sb, bb);
    S.minRaise = CONF.bigBlind;
    S.acted.player = false;
    S.acted.ai = false;
    addLog(`你下小盲 ${util.fmt(sb)}，庄家下大盲 ${util.fmt(bb)}。`);
  }

  /* ---------- 渲染 ---------- */
  function render() {
    const root = document.getElementById('pokerRoot');
    if (!S || !root) return;

    const toCall = Math.max(0, S.currentBet - S.bets.player);
    const playerEv = S.board.length >= 3 ? Engine.evaluate7(S.hole.player.concat(S.board)) : null;
    const aiRevealed = S.showdown;
    const playerName = playerEv ? Engine.describe(playerEv) : Engine.preflopLabel(S.hole.player);
    const me = C.state;

    const aiCards = S.hole.ai.map((card, i) =>
      aiRevealed ? UI.cardHTML(card, { size: 'small', style: `--d:${i * 0.07}s;` }) : UI.cardBackHTML({ size: 'small', style: `--d:${i * 0.07}s;` })
    ).join('');

    const community = [];
    for (let i = 0; i < 5; i++) {
      if (S.board[i]) community.push(UI.cardHTML(S.board[i], { style: `--d:${i * 0.07}s;` }));
      else community.push('<span class="pcard pcard--empty"></span>');
    }

    const feed = S.log.slice(-5).map((entry, i) =>
      `<div class="${i === S.log.slice(-5).length - 1 ? 'is-new' : ''}">${util.escapeHtml(entry)}</div>`
    ).join('');

    const result = S.result ? resultHTML() : '';
    const controls = S.handOver ? endControlsHTML() : (S.busy || S.turn === 'ai' ? thinkingHTML() : playerControlsHTML());
    const potDisplay = S.result ? S.result.pot : S.pot;

    root.innerHTML = `
      <div class="poker-table">
        <div class="seat seat--ai">
          <div class="seat__left">
            <div class="avatar avatar--gold">${CONF.aiEmoji}</div>
            <div class="seat__meta">
              <div class="seat__name">${CONF.aiName} <span class="role-badge role-badge--farmer">庄家</span></div>
              <div class="seat__sub">筹码 ${util.fmt(S.stacks.ai)}${S.bets.ai ? ' · 本轮已下 ' + util.fmt(S.bets.ai) : ''}</div>
            </div>
          </div>
          <div class="seat__cards">${aiCards}</div>
          ${S.bets.ai ? `<span class="seat__bet">${util.fmt(S.bets.ai)}</span>` : ''}
        </div>

        <div class="poker-board">
          <div class="pot"><span>底池</span><strong>${util.fmt(potDisplay)}</strong></div>
          <div class="community">${community.join('')}</div>
          <div class="street-label">${C.DATA.STREET_NAMES[S.street] || '摊牌'}</div>
        </div>

        <div class="seat seat--player">
          <div class="seat__left">
            <div class="avatar">🧑</div>
            <div class="seat__meta">
              <div class="seat__name">你 <span class="hand-badge">${playerName}</span></div>
              <div class="seat__sub">筹码 ${util.fmt(S.stacks.player)}${S.bets.player ? ' · 本轮已下 ' + util.fmt(S.bets.player) : ''}</div>
            </div>
          </div>
          <div class="seat__cards">${S.hole.player.map((card, i) => UI.cardHTML(card, { size: 'small', style: `--d:${i * 0.08}s;` })).join('')}</div>
          ${S.bets.player ? `<span class="seat__bet">${util.fmt(S.bets.player)}</span>` : ''}
        </div>
      </div>

      <div class="poker-controls">${controls}</div>

      ${result}

      <div class="poker-feed">${feed || '<div>牌局开始，翻牌前请下注。</div>'}</div>
    `;
    bindActions(root);
  }

  function thinkingHTML() {
    return `<div class="poker-status"><span class="thinking"><i></i><i></i><i></i></span> 庄家在思考……</div>`;
  }

  function playerControlsHTML() {
    const toCall = Math.max(0, S.currentBet - S.bets.player);
    const stack = S.stacks.player;
    const maxTarget = S.bets.player + stack;
    const canRaise = maxTarget > S.currentBet;
    const buttons = [];

    buttons.push('<button class="btn btn--danger" type="button" data-poker="fold">弃牌</button>');

    if (toCall > 0) {
      buttons.push(`<button class="btn btn--primary" type="button" data-poker="call">跟注 ${util.fmt(Math.min(toCall, stack))}</button>`);
    } else {
      buttons.push('<button class="btn btn--primary" type="button" data-poker="check">过牌</button>');
    }

    if (canRaise) {
      const targets = raiseTargets();
      for (const item of targets) {
        buttons.push(`<button class="btn btn--ghost" type="button" data-poker="raise" data-target="${item.target}">${item.label} ${util.fmt(item.target)}</button>`);
      }
    }

    return buttons.join('');
  }

  function raiseTargets() {
    const toCall = Math.max(0, S.currentBet - S.bets.player);
    const maxTarget = S.bets.player + S.stacks.player;
    const minTarget = Math.min(S.currentBet + S.minRaise, maxTarget);
    const halfTarget = Math.min(S.currentBet + Math.max(CONF.bigBlind, Math.round(S.pot * 0.5)), maxTarget);
    const potTarget = Math.min(S.currentBet + Math.max(CONF.bigBlind, S.pot), maxTarget);
    const list = [];
    const seen = new Set();

    const add = (target, label) => {
      target = Math.min(Math.floor(target), maxTarget);
      if (target <= S.currentBet || target <= S.bets.player) return;
      if (seen.has(target)) return;
      seen.add(target);
      list.push({ target, label: toCall > 0 || S.currentBet > 0 ? '加注至' : '下注' });
    };

    add(minTarget, '最小加注');
    add(halfTarget, '½ 池');
    add(potTarget, '满池');
    if (maxTarget > S.currentBet && !seen.has(maxTarget)) add(maxTarget, '全下');

    // 只保留 3 个，避免按钮过多；全下始终保留
    if (list.length > 3) {
      const allIn = list[list.length - 1];
      const compact = list.slice(0, 2);
      if (allIn.target !== compact[compact.length - 1].target) compact.push(allIn);
      return compact;
    }
    return list;
  }

  function endControlsHTML() {
    const canReplay = C.state.actions > 0 && C.state.money >= CONF.minBuyIn && !C.state.gameOver;
    return `
      <button class="btn btn--ghost" type="button" data-poker="leave">离开牌桌</button>
      <button class="btn btn--primary" type="button" data-poker="replay" ${canReplay ? '' : 'disabled'}>再来一局（1 行动）</button>
    `;
  }

  function resultHTML() {
    if (!S.result) return '';
    const r = S.result;
    const cls = r.winner === 'player' ? 'win' : r.winner === 'ai' ? 'lose' : 'tie';
    const amountCls = r.amount > 0 ? 'pos' : r.amount < 0 ? 'neg' : '';
    const title = r.winner === 'player' ? '你赢下了这手牌' : r.winner === 'ai' ? '庄家赢下了这手牌' : '平分底池';
    const sortCards = (ev) => ev.cards.slice().sort((a, b) => b.value - a.value);
    const handInfo = r.evPlayer
      ? `<div class="showdown-hands">
          <div class="showdown-hand"><span>你 · ${Engine.describe(r.evPlayer)}</span>
            <div class="card-row">${sortCards(r.evPlayer).map((c) => UI.cardHTML(c, { size: 'mini' })).join('')}</div>
          </div>
          <div class="showdown-hand"><span>庄家 · ${Engine.describe(r.evAi)}</span>
            <div class="card-row">${sortCards(r.evAi).map((c) => UI.cardHTML(c, { size: 'mini' })).join('')}</div>
          </div>
        </div>`
      : '';
    return `<div class="poker-result poker-result--${cls}">
      <h3>${title}</h3>
      <div class="poker-result__amount poker-result__amount--${amountCls}">${util.fmtSigned(r.amount)}</div>
      <p class="poker-result__meta">底池 ${util.fmt(r.pot || 0)} · ${r.reason === 'fold' ? '弃牌结束' : '摊牌'}</p>
      ${handInfo}
    </div>`;
  }

  function bindActions(root) {
    root.querySelectorAll('[data-poker]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!S) return;
        const action = btn.dataset.poker;
        if (action === 'leave') {
          closeTable();
          return;
        }
        if (action === 'replay') {
          closeTable();
          setTimeout(start, 120);
          return;
        }
        if (S.handOver || S.busy || S.paused || S.turn !== 'player') return;
        if (action === 'fold') foldHand('player');
        else if (action === 'check') check('player');
        else if (action === 'call') call('player');
        else if (action === 'raise') raise('player', Number(btn.dataset.target));
      });
    });
  }

  /* ---------- 玩家 / AI 动作 ---------- */
  function pay(who, amount) {
    const paid = Math.min(Math.max(0, Math.floor(amount)), S.stacks[who]);
    S.stacks[who] -= paid;
    S.bets[who] += paid;
    S.pot += paid;
    return paid;
  }

  function call(who) {
    if (!S || S.handOver) return;
    const toCall = Math.max(0, S.currentBet - S.bets[who]);
    if (toCall <= 0) {
      check(who);
      return;
    }
    const paid = pay(who, toCall);
    S.acted[who] = true;
    if (S.stacks[who] === 0) addLog(`${who === 'player' ? '你' : '庄家'}全下跟注 ${util.fmt(paid)}。`);
    else addLog(`${who === 'player' ? '你' : '庄家'}跟注 ${util.fmt(paid)}。`);
    C.sound.play('chip');
    afterAction(who);
  }

  function check(who) {
    if (!S || S.handOver) return;
    if (S.currentBet - S.bets[who] > 0) {
      call(who);
      return;
    }
    S.acted[who] = true;
    addLog(`${who === 'player' ? '你' : '庄家'}过牌。`);
    C.sound.play('click');
    afterAction(who);
  }

  function raise(who, target) {
    if (!S || S.handOver) return;
    const other = who === 'player' ? 'ai' : 'player';
    // 对手已经全下时，加注没有意义，只能跟注或弃牌
    if (S.stacks[other] === 0) {
      call(who);
      return;
    }
    const maxTarget = S.bets[who] + S.stacks[who];
    target = Math.floor(Number(target));
    if (!Number.isFinite(target)) return;
    target = Math.min(target, maxTarget);
    if (target <= S.bets[who]) return;

    if (target <= S.currentBet) {
      call(who);
      return;
    }

    const previousBet = S.currentBet;
    const paid = pay(who, target - S.bets[who]);
    const newBet = S.bets[who];
    const raiseSize = newBet - previousBet;

    if (raiseSize > 0) {
      S.minRaise = Math.max(S.minRaise, raiseSize);
      S.currentBet = newBet;
      S.acted[who] = true;
      S.acted[who === 'player' ? 'ai' : 'player'] = false;
      if (S.stacks[who] === 0) addLog(`${who === 'player' ? '你' : '庄家'}全下 ${util.fmt(newBet)}！`);
      else addLog(`${who === 'player' ? '你' : '庄家'}加注至 ${util.fmt(newBet)}。`);
      C.sound.play('chip');
    } else {
      S.acted[who] = true;
      addLog(`${who === 'player' ? '你' : '庄家'}跟注 ${util.fmt(paid)}。`);
    }

    afterAction(who);
  }

  function foldHand(who) {
    if (!S || S.handOver) return;
    const winner = who === 'player' ? 'ai' : 'player';
    S.handOver = true;
    S.showdown = false;
    S.paused = false;
    const pot = S.pot;
    S.stacks[winner] += pot;
    S.pot = 0;
    S.bets = { player: 0, ai: 0 };
    S.result = {
      winner,
      amount: S.stacks.player - S.startStack,
      reason: 'fold',
      pot,
      evPlayer: null,
      evAi: null
    };
    addLog(`${who === 'player' ? '你' : '庄家'}弃牌。`);
    settle();
    render();
  }

  function afterAction(who) {
    if (!S || S.handOver) return;
    const other = who === 'player' ? 'ai' : 'player';

    if (S.bets.player === S.bets.ai && S.acted.player && S.acted.ai) {
      scheduleNextStreet();
      return;
    }

    // 有一方全下：只要另一方已经跟到相同金额（或双方都全下），下注轮直接结束
    const pAllIn = S.stacks.player === 0;
    const aAllIn = S.stacks.ai === 0;
    if (pAllIn || aAllIn) {
      const noMoreAction =
        (pAllIn && aAllIn) ||
        (pAllIn && S.bets.ai >= S.bets.player) ||
        (aAllIn && S.bets.player >= S.bets.ai);
      if (noMoreAction) {
        scheduleNextStreet();
        return;
      }
    }

    S.turn = other;
    S.busy = false;
    render();
    scheduleAI();
  }

  function scheduleNextStreet() {
    if (!S) return;
    S.busy = true;
    S.turn = null;
    render();
    setTimeout(() => {
      if (!S || S.handOver) return;
      S.busy = false;
      nextStreet();
    }, 620);
  }

  function reconcileBets() {
    if (S.bets.player === S.bets.ai) return;
    const higher = S.bets.player > S.bets.ai ? 'player' : 'ai';
    const diff = Math.abs(S.bets.player - S.bets.ai);
    S.bets[higher] -= diff;
    S.stacks[higher] += diff;
    S.pot -= diff;
  }

  function nextStreet() {
    if (!S || S.handOver) return;
    reconcileBets();

    // 河牌轮结束，或有人全下：直接发完公共牌摊牌
    if (S.street >= 3 || S.stacks.player === 0 || S.stacks.ai === 0) {
      runoutAndShowdown();
      return;
    }

    S.street += 1;
    if (S.street === 1) {
      S.deck.pop();
      S.board.push(S.deck.pop(), S.deck.pop(), S.deck.pop());
      addLog('翻牌圈：' + S.board.map((c) => C.cards.label(c)).join(' '));
    } else if (S.street === 2) {
      S.deck.pop();
      S.board.push(S.deck.pop());
      addLog('转牌：' + C.cards.label(S.board[S.board.length - 1]));
    } else if (S.street === 3) {
      S.deck.pop();
      S.board.push(S.deck.pop());
      addLog('河牌：' + C.cards.label(S.board[S.board.length - 1]));
    }

    S.bets = { player: 0, ai: 0 };
    S.currentBet = 0;
    S.minRaise = CONF.bigBlind;
    S.acted = { player: false, ai: false };
    S.turn = 'ai';
    C.sound.play('deal');
    render();
    scheduleAI();
  }

  function runoutAndShowdown() {
    if (!S) return;
    while (S.board.length < 5) {
      S.deck.pop();
      S.board.push(S.deck.pop());
    }
    if (!S.showdown) addLog('公共牌发完，摊牌。');
    S.busy = true;
    S.turn = null;
    S.street = 4;
    render();
    C.sound.play('flip');
    setTimeout(() => {
      if (!S || S.handOver) return;
      S.busy = false;
      showdown();
    }, 750);
  }

  function showdown() {
    if (!S || S.handOver) return;
    const evPlayer = Engine.evaluate7(S.hole.player.concat(S.board));
    const evAi = Engine.evaluate7(S.hole.ai.concat(S.board));
    const cmp = Engine.compare(evPlayer, evAi);
    const pot = S.pot;

    S.handOver = true;
    S.showdown = true;
    S.pot = 0;
    S.bets = { player: 0, ai: 0 };

    let winner;
    if (cmp > 0) {
      winner = 'player';
      S.stacks.player += pot;
    } else if (cmp < 0) {
      winner = 'ai';
      S.stacks.ai += pot;
    } else {
      winner = 'tie';
      const half = Math.floor(pot / 2);
      S.stacks.player += half;
      S.stacks.ai += pot - half;
    }

    S.result = {
      winner,
      amount: S.stacks.player - S.startStack,
      reason: 'showdown',
      pot,
      evPlayer,
      evAi
    };

    addLog(`摊牌：你 ${Engine.describe(evPlayer)}，庄家 ${Engine.describe(evAi)}。`);
    settle();
    render();
  }

  function settle() {
    if (!S) return;
    const state = C.state;
    state.money = Math.max(0, Math.round(S.stacks.player));
    State.bumpStat('maxCash', state.money);

    if (S.result && S.result.winner === 'player') {
      State.addStat('pokerWins', 1);
      State.unlock('first_win');
      State.unlock('poker_win');
      if (S.result.evPlayer && S.result.evPlayer.cat >= 5) State.unlock('poker_strong');
      if (S.result.amount > 0) {
        C.sound.play(S.result.amount >= 500 ? 'bigwin' : 'win');
        UI.toast(`你赢了 ${util.fmtSigned(S.result.amount)}`, 'win');
      }
    } else if (S.result && S.result.winner === 'ai') {
      C.sound.play('lose');
      if (S.result.amount < 0) UI.toast(`这手牌输了 ${util.fmtSigned(S.result.amount)}`, 'lose');
    } else {
      C.sound.play('chip');
    }
    UI.refresh();
  }

  function addLog(text) {
    if (!S) return;
    S.log.push(text);
    if (S.log.length > 40) S.log.shift();
  }

  /* ---------- AI ---------- */
  function scheduleAI() {
    if (!S || S.handOver || S.turn !== 'ai' || S.paused || S.aiTimer) return;
    S.busy = true;
    render();
    const delay = 700 + Math.random() * 500;
    S.aiTimer = setTimeout(() => {
      if (!S) return;
      S.aiTimer = null;
      if (S.handOver || S.paused) return;
      S.busy = false;
      aiAct();
    }, delay);
  }

  function aiAct() {
    if (!S || S.handOver || S.paused || S.turn !== 'ai') return;

    const toCall = Math.max(0, S.currentBet - S.bets.ai);
    const potOdds = toCall > 0 ? toCall / (S.pot + toCall) : 0;
    const iterations = 120 + Math.round((State.diff().aiSkill || 1) * 40);
    const equity = Engine.equity(S.hole.ai, S.board, iterations);
    const skill = State.diff().aiSkill || 1;
    const r = Math.random();

    if (toCall === 0) {
      const threshold = 0.6 - (skill - 1) * 0.08 + r * 0.06;
      if (equity > threshold) {
        const target = aiRaiseTarget(equity > 0.8 ? 0.85 : 0.55);
        if (target) {
          raise('ai', target);
          return;
        }
      }
      if (equity > 0.42 && Math.random() < 0.2) {
        const target = aiRaiseTarget(0.4);
        if (target) {
          raise('ai', target);
          return;
        }
      }
      check('ai');
      return;
    }

    const continueAt = potOdds + 0.02 - (skill - 1) * 0.03;
    if (equity > 0.8 && Math.random() < 0.62 + (skill - 1) * 0.2) {
      const target = aiRaiseTarget(0.8);
      if (target) {
        raise('ai', target);
        return;
      }
    }
    if (equity > continueAt) {
      call('ai');
      return;
    }
    if (Math.random() < 0.06) {
      call('ai');
      return;
    }
    foldHand('ai');
  }

  function aiRaiseTarget(fraction) {
    if (!S) return 0;
    const maxTarget = S.bets.ai + S.stacks.ai;
    const minTarget = Math.min(S.currentBet + S.minRaise, maxTarget);
    let target = Math.max(minTarget, S.currentBet + Math.round(S.pot * fraction));
    target = Math.min(target, maxTarget);
    if (target <= S.currentBet || target <= S.bets.ai) return 0;
    return target;
  }

  /* ---------- 离开 ---------- */
  function requestClose() {
    if (!S) {
      UI.closePanel();
      return;
    }
    if (S.handOver) {
      closeTable();
      return;
    }
    if (S.busy && !S.aiTimer) {
      UI.toast('牌桌正在结算，稍等一下。', 'info');
      return;
    }

    S.paused = true;
    if (S.aiTimer) {
      clearTimeout(S.aiTimer);
      S.aiTimer = null;
    }

    return UI.modal({
      title: '离开牌桌？',
      message: '这手牌还没打完。离开会视为弃牌，已经投入底池的筹码不会退还。',
      confirmText: '弃牌离开',
      cancelText: '继续打',
      danger: true,
      icon: '♠'
    }).then((ok) => {
      if (!S) return;
      if (!ok) {
        S.paused = false;
        S.busy = false;
        render();
        scheduleAI();
        return;
      }
      if (!S.handOver) foldHand('player');
      closeTable();
    });
  }

  function closeTable() {
    if (S && S.aiTimer) clearTimeout(S.aiTimer);
    S = null;
    UI.closePanel();
  }

  C.Poker = {
    start,
    isActive: () => !!S
  };
})(window.Casino = window.Casino || {});
