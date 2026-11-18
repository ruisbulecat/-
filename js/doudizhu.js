/* ============================================================
   赌徒模拟器 · 斗地主
   三人局，随机地主，支持常见牌型，AI 会优先出能管上的最小牌。
   ============================================================ */
(function (C) {
  'use strict';

  const util = C.util;
  const State = C.State;
  const UI = C.UI;
  const Rules = C.DDZRules;
  const CONF = C.DATA.DDZ;

  const TYPE_NAMES = {
    single: '单张',
    pair: '对子',
    triple: '三张',
    triple_one: '三带一',
    triple_pair: '三带二',
    straight: '顺子',
    double_straight: '连对',
    plane: '飞机',
    bomb: '炸弹',
    rocket: '王炸'
  };

  let S = null;

  function sortHand(hand) {
    return hand.sort((a, b) => {
      const diff = Rules.valueOf(b) - Rules.valueOf(a);
      if (diff !== 0) return diff;
      return a.suitIdx - b.suitIdx;
    });
  }

  function start() {
    if (S) return;
    if (!C.Game.beginActivity({ action: 1, minMoney: CONF.minMoney, label: '斗地主' })) return;

    const deck = util.shuffle(C.cards.create(true));
    const players = [
      { id: 0, name: '你', emoji: '🧑', hand: [], isAI: false, isLandlord: false },
      { id: 1, name: CONF.opponents[0].name, emoji: CONF.opponents[0].emoji, hand: [], isAI: true, isLandlord: false },
      { id: 2, name: CONF.opponents[1].name, emoji: CONF.opponents[1].emoji, hand: [], isAI: true, isLandlord: false }
    ];

    for (let i = 0; i < 51; i++) players[i % 3].hand.push(deck.pop());
    const bottomCards = [deck.pop(), deck.pop(), deck.pop()];
    const landlord = util.randomInt(3);
    players[landlord].isLandlord = true;
    players[landlord].hand.push(...bottomCards);
    players.forEach((p) => sortHand(p.hand));

    S = {
      players,
      landlord,
      turn: landlord,
      lastCombo: null,
      lastOwner: -1,
      selected: new Set(),
      bottomCards,
      over: false,
      winner: -1,
      baseBet: CONF.baseBet,
      busy: false,
      paused: false,
      timer: null,
      settled: false,
      log: []
    };

    State.addStat('ddzGames', 1);

    UI.openPanel({
      kicker: 'FIGHT THE LANDLORD',
      title: '斗地主 · 三人局',
      subtitle: `底注 ${util.fmt(CONF.baseBet)} · 你已入座 · 随机抢地主`,
      wide: true,
      body: '<div id="ddzRoot"></div>',
      onClose: requestClose,
      onClosed: () => {
        if (S && S.timer) clearTimeout(S.timer);
        S = null;
        C.Game.endActivity();
      }
    });

    UI.message(`=== 斗地主 · 底注 ${util.fmt(CONF.baseBet)} ===`);
    UI.message(`本局地主是 ${players[landlord].name}${landlord === 0 ? '（你）' : ''}。底牌：${bottomCards.map((c) => C.cards.label(c)).join(' ')}`, landlord === 0 ? 'win' : 'info');
    if (landlord === 0) {
      UI.message('你拿到了地主，赢了收双倍，输了也赔双倍。', 'warn');
    }

    render();
    scheduleAI();
  }

  /* ---------- 渲染 ---------- */
  function opponentHTML(idx, side) {
    const p = S.players[idx];
    const isTurn = S.turn === idx && !S.over;
    const backs = Math.min(p.hand.length, 7);
    let cardBacks = '';
    for (let i = 0; i < backs; i++) cardBacks += UI.cardBackHTML({ className: 'pcard--back' });
    const role = p.isLandlord
      ? '<span class="role-badge role-badge--landlord">👑 地主</span>'
      : '<span class="role-badge role-badge--farmer">🌾 农民</span>';
    return `<div class="ddz-seat ddz-seat--${side}${isTurn ? ' is-turn' : ''}">
      <div class="avatar${p.isLandlord ? ' avatar--gold' : ''}">${p.emoji}</div>
      <div class="ddz-seat__body">
        <div class="ddz-seat__name">${p.name} ${role}</div>
        <div class="ddz-seat__meta">剩 ${p.hand.length} 张${isTurn ? ' · 思考中' : ''}</div>
      </div>
      <div class="ddz-seat__cards">${cardBacks}</div>
    </div>`;
  }

  function lastPlayHTML() {
    if (!S.lastCombo) {
      return `<div class="last-play last-play--empty">自由出牌 · 你可以出任意合法牌型</div>`;
    }
    const owner = S.players[S.lastOwner];
    return `<div class="last-play">
      <div class="last-play__label">${owner.name} 出牌 · ${TYPE_NAMES[S.lastCombo.type] || ''} · ${S.lastCombo.cards.length} 张</div>
      <div class="last-play__cards">${S.lastCombo.cards.map((c) => UI.cardHTML(c, { size: 'small' })).join('')}</div>
    </div>`;
  }

  function resultHTML() {
    if (!S.over) return '';
    const player = S.players[0];
    const winner = S.players[S.winner];
    const landlordWon = winner.isLandlord;
    const playerWon = player.isLandlord ? landlordWon : !landlordWon;
    const stake = S.baseBet * (player.isLandlord ? 2 : 1);
    const delta = playerWon ? stake : -Math.min(stake, S.lastMoney || stake);
    const canReplay = C.state.actions > 0 && C.state.money >= CONF.minMoney && !C.state.gameOver;

    const reveal = S.players.map((p) => `<div class="reveal-hand">
      <span>${p.name}${p.isLandlord ? ' · 地主' : ''}</span>
      ${p.hand.map((c) => UI.cardHTML(c, { size: 'mini' })).join('')}
    </div>`).join('');

    return `<div class="ddz-result ${playerWon ? 'ddz-result--win' : 'ddz-result--lose'}">
      <h3>${playerWon ? '你赢了这一局' : '你输了这一局'}</h3>
      <div class="ddz-result__amount ${delta > 0 ? 'text-green' : 'text-red'}">${util.fmtSigned(delta)}</div>
      <p>${landlordWon ? '地主胜利' : '农民胜利'} · 底注 ${util.fmt(S.baseBet)} · ${player.isLandlord ? '地主双倍' : '农民单倍'}</p>
      <div class="reveal-hands">${reveal}</div>
      <div class="cut-actions">
        <button class="btn btn--ghost" type="button" data-ddz-leave>离开牌桌</button>
        <button class="btn btn--primary" type="button" data-ddz-replay ${canReplay ? '' : 'disabled'}>再来一局（1 行动）</button>
      </div>
    </div>`;
  }

  function render() {
    const root = document.getElementById('ddzRoot');
    if (!S || !root) return;
    const me = S.players[0];
    const selectedCards = me.hand.filter((c) => S.selected.has(c.uid));
    const combo = selectedCards.length ? Rules.analyze(selectedCards) : null;
    const canPlay = S.turn === 0 && !S.over && !S.busy;
    const canPass = canPlay && !!S.lastCombo;

    const handHTML = me.hand.map((card) => {
      const selected = S.selected.has(card.uid);
      return UI.cardHTML(card, {
        selected,
        className: 'ddz-card' + (canPlay ? '' : ' pcard--dim'),
        uidAttr: card.uid
      });
    }).join('');

    const status = S.over
      ? ''
      : S.turn === 0
        ? (S.lastCombo ? '轮到你出牌，选牌后点“出牌”。' : '轮到你自由出牌。')
        : `<span class="thinking"><i></i><i></i><i></i></span> 等待 ${S.players[S.turn].name} 出牌……`;

    const controls = S.over
      ? resultHTML()
      : `<div class="ddz-controls">
          <button class="btn btn--ghost" type="button" data-ddz-hint ${canPlay ? '' : 'disabled'}>提示</button>
          <button class="btn btn--danger" type="button" data-ddz-pass ${canPass ? '' : 'disabled'}>不出</button>
          <button class="btn btn--primary" type="button" data-ddz-play ${canPlay && selectedCards.length ? '' : 'disabled'}>
            出牌${combo ? ' · ' + (TYPE_NAMES[combo.type] || '') : ''}
          </button>
        </div>
        <div class="ddz-status">${status}</div>`;

    root.innerHTML = `
      <div class="ddz-table">
        <div class="ddz-opponents">
          ${opponentHTML(1, 'left')}
          ${opponentHTML(2, 'right')}
        </div>
        <div class="ddz-center">
          <div class="ddz-bottom">
            <span>底牌</span>
            ${S.bottomCards.map((c) => UI.cardHTML(c, { size: 'mini' })).join('')}
          </div>
          ${lastPlayHTML()}
        </div>
        <div class="ddz-player">
          <div class="ddz-player__head">
            <div class="avatar${me.isLandlord ? ' avatar--gold' : ''}">${me.emoji}</div>
            <div>
              <div class="ddz-player__name">你 ${me.isLandlord ? '<span class="role-badge role-badge--landlord">👑 地主</span>' : '<span class="role-badge role-badge--farmer">🌾 农民</span>'}</div>
              <div class="ddz-seat__meta">手牌 ${me.hand.length} 张 · 底注 ${util.fmt(S.baseBet)}</div>
            </div>
          </div>
          <div class="ddz-hand">${handHTML}</div>
        </div>
        ${controls}
      </div>
    `;

    // 选牌
    root.querySelectorAll('.ddz-card').forEach((el) => {
      el.addEventListener('click', () => {
        if (!canPlay) return;
        const uid = el.dataset.uid;
        if (S.selected.has(uid)) S.selected.delete(uid);
        else S.selected.add(uid);
        render();
      });
    });

    const hintBtn = root.querySelector('[data-ddz-hint]');
    if (hintBtn) hintBtn.addEventListener('click', hint);

    const passBtn = root.querySelector('[data-ddz-pass]');
    if (passBtn) passBtn.addEventListener('click', pass);

    const playBtn = root.querySelector('[data-ddz-play]');
    if (playBtn) playBtn.addEventListener('click', playSelected);

    const leaveBtn = root.querySelector('[data-ddz-leave]');
    if (leaveBtn) leaveBtn.addEventListener('click', closeTable);

    const replayBtn = root.querySelector('[data-ddz-replay]');
    if (replayBtn) replayBtn.addEventListener('click', () => {
      closeTable();
      setTimeout(start, 120);
    });
  }

  /* ---------- 玩家操作 ---------- */
  function selectedCards() {
    const me = S.players[0];
    return me.hand.filter((c) => S.selected.has(c.uid));
  }

  function playSelected() {
    if (!S || S.over || S.turn !== 0 || S.busy) return;
    if (!S.selected.size) {
      UI.toast('先选牌。', 'info');
      return;
    }
    const me = S.players[0];
    const cards = selectedCards();
    const combo = Rules.analyze(cards);
    if (!combo) {
      UI.toast('这几张牌凑不成合法牌型。', 'lose');
      C.sound.play('lose');
      return;
    }
    if (S.lastCombo && !Rules.beats(combo, S.lastCombo)) {
      UI.toast('管不上上家的牌。', 'lose');
      C.sound.play('lose');
      return;
    }
    playCards(0, cards);
  }

  function playCards(playerIdx, cards) {
    if (!S || S.over) return;
    const p = S.players[playerIdx];
    const uids = new Set(cards.map((c) => c.uid));
    p.hand = p.hand.filter((c) => !uids.has(c.uid));
    const combo = Rules.analyze(cards);
    S.lastCombo = combo;
    S.lastOwner = playerIdx;
    S.selected.clear();

    UI.message(`${p.name} 出牌：${cards.map((c) => C.cards.label(c)).join(' ')}（${TYPE_NAMES[combo.type] || ''}）`, p.isAI ? 'info' : 'system');
    C.sound.play('chip');

    if (p.hand.length === 0) {
      finish(playerIdx);
      return;
    }
    nextTurn(false);
  }

  function pass() {
    if (!S || S.over || S.turn !== 0 || S.busy) return;
    if (!S.lastCombo) {
      UI.toast('你是自由出牌，不能不出。', 'lose');
      return;
    }
    S.selected.clear();
    UI.message('你选择不出。', 'neutral');
    nextTurn(true);
  }

  function hint() {
    if (!S || S.over || S.turn !== 0 || S.busy) return;
    const me = S.players[0];
    const ctx = { minOpponent: minRivalCount(0) };
    const move = S.lastCombo
      ? Rules.chooseFollow(me.hand, S.lastCombo, ctx, { force: true })
      : Rules.chooseLead(me.hand, ctx);
    if (!move || !move.cards.length) {
      UI.toast('没有能管上的牌，只能不出。', 'info');
      return;
    }
    S.selected = new Set(move.cards.map((c) => c.uid));
    render();
    UI.toast(`提示：${TYPE_NAMES[move.type] || ''}`, 'info');
  }

  function nextTurn(afterPass) {
    if (!S || S.over) return;
    S.turn = (S.turn + 1) % 3;
    if (afterPass && S.turn === S.lastOwner) {
      S.lastCombo = null;
      S.lastOwner = -1;
      UI.message(`两家都不出，${S.players[S.turn].name} 重新出牌。`, 'info');
      S.selected.clear();
    }
    render();
    scheduleAI();
  }

  /* ---------- AI ---------- */
  function minRivalCount(idx) {
    const p = S.players[idx];
    const rivals = S.players.filter((other, i) => i !== idx && (p.isLandlord ? !other.isLandlord : other.isLandlord));
    return Math.min(...rivals.map((r) => r.hand.length));
  }

  function isTeammate(a, b) {
    return a !== b && !a.isLandlord && !b.isLandlord;
  }

  function scheduleAI() {
    if (!S || S.over || S.busy || S.paused) return;
    if (S.turn === 0) return;
    S.busy = true;
    render();
    const delay = 650 + Math.random() * 550;
    S.timer = setTimeout(() => {
      if (!S) return;
      S.timer = null;
      if (S.over || S.paused) {
        S.busy = false;
        return;
      }
      S.busy = false;
      aiAct();
    }, delay);
  }

  function aiAct() {
    if (!S || S.over || S.turn === 0 || S.paused) return;
    const ai = S.players[S.turn];

    // 队友出的牌，通常不压；除非自己马上能走完
    if (S.lastCombo && S.lastOwner >= 0) {
      const owner = S.players[S.lastOwner];
      if (isTeammate(ai, owner) && ai.hand.length > 1) {
        const teammateLow = owner.hand.length <= 5;
        if (teammateLow) {
          passAI(ai);
          return;
        }
      }
    }

    const ctx = { minOpponent: minRivalCount(S.turn) };
    const move = S.lastCombo
      ? Rules.chooseFollow(ai.hand, S.lastCombo, ctx)
      : Rules.chooseLead(ai.hand, ctx);

    if (move && move.cards.length) {
      playCards(S.turn, move.cards);
    } else {
      passAI(ai);
    }
  }

  function passAI(ai) {
    UI.message(`${ai.name} 不出。`, 'neutral');
    nextTurn(true);
  }

  /* ---------- 结算 ---------- */
  function finish(winnerIdx) {
    if (!S || S.settled) return;
    S.over = true;
    S.winner = winnerIdx;
    S.settled = true;
    S.busy = false;
    S.paused = false;
    if (S.timer) {
      clearTimeout(S.timer);
      S.timer = null;
    }

    const state = C.state;
    const player = S.players[0];
    const winner = S.players[winnerIdx];
    const landlordWon = winner.isLandlord;
    const playerWon = player.isLandlord ? landlordWon : !landlordWon;
    const stake = S.baseBet * (player.isLandlord ? 2 : 1);
    S.lastMoney = state.money;

    let delta;
    if (playerWon) {
      delta = stake;
      state.money += stake;
      State.unlock('first_win');
      State.unlock('ddz_win');
      State.addStat('ddzWins', 1);
      C.sound.play('win');
      UI.toast(`斗地主胜利，赢下 ${util.fmt(stake)}`, 'win');
    } else {
      delta = -Math.min(stake, state.money);
      state.money += delta;
      C.sound.play('lose');
      UI.toast(`斗地主失败，输掉 ${util.fmt(-delta)}`, 'lose');
    }

    state.money = Math.max(0, Math.round(state.money));
    State.bumpStat('maxCash', state.money);
    UI.message(`${winner.name} 手牌出完，${landlordWon ? '地主' : '农民'}胜利。`, playerWon ? 'win' : 'lose');
    UI.message(`本局结算：${util.fmtSigned(delta)}，当前现金 ${util.fmt(state.money)}。`, playerWon ? 'win' : 'lose');
    UI.refresh();
    render();
  }

  /* ---------- 离开 ---------- */
  function requestClose() {
    if (!S) {
      UI.closePanel();
      return;
    }
    if (S.over) {
      closeTable();
      return;
    }

    S.paused = true;
    if (S.timer) {
      clearTimeout(S.timer);
      S.timer = null;
    }

    const stake = S.baseBet * (S.players[0].isLandlord ? 2 : 1);
    return UI.modal({
      title: '认输离场？',
      message: `这局还没打完。中途退出视为认输，将扣除 ${util.fmt(stake)}。`,
      confirmText: '认输离开',
      cancelText: '继续打',
      danger: true,
      icon: '🃏'
    }).then((ok) => {
      if (!S) return;
      if (!ok) {
        S.paused = false;
        S.busy = false;
        render();
        scheduleAI();
        return;
      }
      const loss = Math.min(stake, C.state.money);
      C.state.money = Math.max(0, C.state.money - loss);
      UI.message(`你中途认输，扣除 ${util.fmt(loss)}。`, 'lose');
      UI.toast(`认输，损失 ${util.fmt(loss)}`, 'lose');
      C.sound.play('lose');
      UI.refresh();
      closeTable();
    });
  }

  function closeTable() {
    if (S && S.timer) clearTimeout(S.timer);
    S = null;
    UI.closePanel();
  }

  C.Doudizhu = {
    start,
    isActive: () => !!S
  };
})(window.Casino = window.Casino || {});
