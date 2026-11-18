/* ============================================================
   赌徒模拟器 · 赌石
   进入消耗 1 次行动，场内连续切石只花钱、不再消耗行动。
   ============================================================ */
(function (C) {
  'use strict';

  const util = C.util;
  const State = C.State;
  const UI = C.UI;
  const DATA = C.DATA;

  let S = null;

  function start() {
    if (S) return;
    if (!C.Game.beginActivity({ action: 1, minMoney: 100, label: '赌石' })) return;

    S = {
      sessionCost: 0,
      sessionWin: 0,
      phase: 'shop',
      stone: null,
      timer: null,
      busy: false
    };

    UI.openPanel({
      kicker: 'JADE STONE MARKET',
      title: '赌石场',
      subtitle: '一刀穷，一刀富，一刀穿麻布。进入已消耗 1 次行动，场内连切不再扣行动。',
      wide: true,
      body: '<div id="stoneRoot"></div>',
      onClosed: () => {
        if (S && S.timer) clearTimeout(S.timer);
        S = null;
        C.Game.endActivity();
      }
    });

    renderShop();
  }

  function stoneOdds(stone) {
    const config = State.diff();
    const prob = util.clamp(stone.prob * config.stoneProb, 0.02, 0.62);
    const max = Math.round(stone.max * config.stonePay / 10) * 10;
    return { prob, min: stone.min, max };
  }

  function renderShop() {
    const root = document.getElementById('stoneRoot');
    if (!S || !root) return;
    S.phase = 'shop';
    S.stone = null;
    S.busy = false;

    const config = State.diff();
    const state = C.state;
    const cards = DATA.STONES.map((stone) => {
      const odds = stoneOdds(stone);
      const canBuy = state.money >= stone.price;
      return `<div class="stone-card" style="--stone-accent:${stone.accent}">
        <div class="stone-card__img"><img src="${stone.img}" alt="${stone.name}" loading="lazy"></div>
        <div class="stone-card__body">
          <div class="stone-card__top">
            <strong>${stone.name}</strong>
            <span class="stone-card__tag">${stone.tag}</span>
          </div>
          <div class="stone-card__desc">${stone.desc}</div>
          <div class="stone-card__odds">爆率 <b>${(odds.prob * 100).toFixed(1)}%</b><span>·</span><span>估价 ${util.fmt(odds.min)} – ${util.fmt(odds.max)}</span></div>
          <div class="stone-card__bottom">
            <span class="stone-card__price">${util.fmt(stone.price)}<small> / 块</small></span>
            <button class="btn ${canBuy ? 'btn--primary' : 'btn--ghost'}" type="button" data-stone-buy="${stone.id}" ${canBuy ? '' : 'disabled'}>切一刀</button>
          </div>
        </div>
      </div>`;
    }).join('');

    root.innerHTML = `
      <div class="stone-shop__bar">
        <span>现金 <strong>${util.fmt(state.money)}</strong></span>
        <span>本次投入 <strong>${util.fmt(S.sessionCost)}</strong> · 回收 <strong>${util.fmt(S.sessionWin)}</strong></span>
        <span>难度 <strong>${config.name}</strong> · 爆率 ×${config.stoneProb}</span>
      </div>
      <div class="stone-grid">${cards}</div>
      <div class="cut-actions">
        <button class="btn btn--ghost" type="button" data-stone-leave>离开赌石场</button>
      </div>
      <div class="stone-stats">
        <span>本次切石 <b>${C.state.stats.stoneCuts}</b> 刀</span>
        <span>历史最大单刀 <b>${util.fmt(C.state.stats.maxSingleStoneWin)}</b></span>
        <span>提示：切涨后继续切，是庄家最喜欢的客人。</span>
      </div>
    `;

    root.querySelectorAll('[data-stone-buy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const stone = DATA.STONES.find((item) => item.id === btn.dataset.stoneBuy);
        if (stone) cut(stone);
      });
    });

    const leaveBtn = root.querySelector('[data-stone-leave]');
    if (leaveBtn) leaveBtn.addEventListener('click', leave);
  }

  function cut(stone) {
    if (!S || S.busy) return;
    if (C.state.money < stone.price) {
      UI.toast('现金不足，买不起这块料。', 'lose');
      return;
    }

    S.busy = true;
    S.phase = 'cutting';
    S.stone = stone;
    C.state.money -= stone.price;
    S.sessionCost += stone.price;
    C.state.stats.stoneCuts += 1;
    UI.refresh();
    C.sound.play('cut');

    const root = document.getElementById('stoneRoot');
    if (!root) return;
    root.innerHTML = `
      <div class="cut-stage">
        <div class="cut-stone"><img src="${stone.img}" alt="${stone.name}"></div>
        <h3>正在切割……</h3>
        <p>${stone.name} · 成交价 ${util.fmt(stone.price)} · 手别抖</p>
      </div>
    `;

    const roll = Math.random();
    const odds = stoneOdds(stone);
    const win = roll < odds.prob;
    let value = 0;
    if (win) {
      let t = Math.pow(Math.random(), 1.75);
      if (Math.random() < 0.03) t = 0.9 + Math.random() * 0.1;
      value = Math.round((odds.min + (odds.max - odds.min) * t) / 10) * 10;
    }

    S.timer = setTimeout(() => {
      if (!S) return;
      S.timer = null;
      reveal(stone, win, value, odds);
    }, 1100 + Math.random() * 350);
  }

  function reveal(stone, win, value, odds) {
    if (!S) return;
    S.phase = 'result';
    S.busy = false;

    if (win) {
      C.state.money += value;
      S.sessionWin += value;
      C.state.stats.stoneWins += 1;
      State.bumpStat('maxSingleStoneWin', value);
      State.unlock('first_win');
      State.unlock('stone_first');
      if (value >= 20000) State.unlock('stone_king');
      State.bumpStat('maxCash', C.state.money);
      C.sound.play(value >= 20000 ? 'bigwin' : 'win');
      UI.toast(`切涨 ${util.fmt(value)}！`, 'win', '💎');
    } else {
      C.sound.play('lose');
      UI.toast(`切垮了，亏掉 ${util.fmt(stone.price)}`, 'lose', '🪨');
    }

    UI.refresh();

    const root = document.getElementById('stoneRoot');
    if (!root) return;
    const state = C.state;
    const profit = win ? value - stone.price : -stone.price;
    const again = state.money >= stone.price;

    if (win) {
      const ratio = value / stone.price;
      const revealImg = stone.id === 'king' ? 'assets/jade-king.svg' : 'assets/jade-cut.svg';
      let flavor = '切面一般，但至少没亏。';
      if (ratio >= 1.5) flavor = '色阳水足，旁边几个老板的眼睛都直了。';
      if (ratio >= 3) flavor = '满绿！切面像一汪水，围观的人开始掏手机。';
      if (ratio >= 6) flavor = '玻璃种帝王绿！整条街的人都围过来了，你听见有人倒吸冷气。';
      if (value >= 20000) flavor = '这一刀，够你吹一辈子。庄家脸上的笑终于僵住了。';
      root.innerHTML = `
        <div class="cut-stage">
          <div class="jade-result">
            <div class="jade-result__img">
              <div class="jade-result__glow" style="--glow:${stone.accent}55"></div>
              <img src="${revealImg}" alt="${stone.quality}翡翠">
            </div>
            <div class="jade-result__grade">切涨 · ${stone.quality}翡翠</div>
            <div class="jade-result__value">${util.fmt(value)}</div>
            <div class="jade-result__profit jade-result__profit--pos">本刀盈亏 ${util.fmtSigned(profit)} · 成本 ${util.fmt(stone.price)}</div>
            <p class="jade-result__desc">${flavor}</p>
          </div>
          <div class="cut-actions">
            <button class="btn btn--primary" type="button" data-stone-again="${stone.id}" ${again ? '' : 'disabled'}>再切一块（${util.fmt(stone.price)}）</button>
            <button class="btn btn--ghost" type="button" data-stone-shop>换一块</button>
            <button class="btn btn--ghost" type="button" data-stone-leave>离开</button>
          </div>
          <div class="stone-stats">
            <span>本次投入 <b>${util.fmt(S.sessionCost)}</b></span>
            <span>本次回收 <b>${util.fmt(S.sessionWin)}</b></span>
            <span>当前现金 <b>${util.fmt(state.money)}</b></span>
          </div>
        </div>
      `;
    } else {
      root.innerHTML = `
        <div class="cut-stage">
          <div class="jade-result jade-result--lose">
            <div class="jade-result__img">
              <div class="jade-result__glow" style="--glow:rgba(120,120,120,.25)"></div>
              <img src="${stone.img}" alt="切垮的原石">
            </div>
            <div class="jade-result__grade" style="color:var(--red)">切垮了</div>
            <div class="jade-result__value" style="color:var(--muted)">${util.fmt(0)}</div>
            <div class="jade-result__profit jade-result__profit--neg">本刀盈亏 ${util.fmtSigned(profit)} · 成本 ${util.fmt(stone.price)}</div>
            <p class="jade-result__desc">${stone.id === 'king' ? '神仙难断寸玉，更何况你。' : '里面全是石头，连个像样的雾都没有。'} 老板拍了拍你的肩：“再来一块？”</p>
          </div>
          <div class="cut-actions">
            <button class="btn btn--primary" type="button" data-stone-again="${stone.id}" ${again ? '' : 'disabled'}>再切一块（${util.fmt(stone.price)}）</button>
            <button class="btn btn--ghost" type="button" data-stone-shop>换一块</button>
            <button class="btn btn--ghost" type="button" data-stone-leave>离开</button>
          </div>
          <div class="stone-stats">
            <span>本次投入 <b>${util.fmt(S.sessionCost)}</b></span>
            <span>本次回收 <b>${util.fmt(S.sessionWin)}</b></span>
            <span>当前现金 <b>${util.fmt(state.money)}</b></span>
          </div>
        </div>
      `;
    }

    const againBtn = root.querySelector('[data-stone-again]');
    if (againBtn) {
      againBtn.addEventListener('click', () => {
        const next = DATA.STONES.find((item) => item.id === againBtn.dataset.stoneAgain);
        if (next) cut(next);
      });
    }
    const shopBtn = root.querySelector('[data-stone-shop]');
    if (shopBtn) shopBtn.addEventListener('click', renderShop);
    const leaveBtn = root.querySelector('[data-stone-leave]');
    if (leaveBtn) leaveBtn.addEventListener('click', leave);
  }

  function leave() {
    if (!S) return;
    if (S.timer) {
      clearTimeout(S.timer);
      S.timer = null;
    }
    UI.closePanel();
  }

  C.Stone = {
    start,
    isActive: () => !!S
  };
})(window.Casino = window.Casino || {});
