/* ============================================================
   赌徒模拟器 · 界面层
   DOM 渲染、播报、弹窗、卡牌组件
   ============================================================ */
(function (C) {
  'use strict';

  const util = C.util;
  const state = C.state;

  const dom = {};
  let panelState = null;
  let modalState = null;

  const TYPE_ICONS = {
    info: '·',
    win: '✓',
    lose: '✕',
    warn: '!',
    achievement: '★',
    system: '♠',
    headline: '◆',
    neutral: '·'
  };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $$(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  function init() {
    dom.setupScreen = $('#setupScreen');
    dom.mainGame = $('#mainGame');
    dom.endingScreen = $('#endingScreen');
    dom.endingContent = $('#endingContent');
    dom.dynamicPanel = $('#dynamicPanel');
    dom.modalRoot = $('#modalRoot');
    dom.toastRoot = $('#toastRoot');
    dom.messageArea = $('#messageArea');
    dom.topbarMoney = $('#topbarMoney');
    dom.hudDay = $('#hudDay');
    dom.hudDaysLeft = $('#hudDaysLeft');
    dom.hudActions = $('#hudActions');
    dom.hudActionsText = $('#hudActionsText');
    dom.hudMoney = $('#hudMoney');
    dom.hudNet = $('#hudNet');
    dom.hudDebt = $('#hudDebt');
    dom.hudLoans = $('#hudLoans');
    dom.hudRate = $('#hudRate');
    dom.hudRateNote = $('#hudRateNote');
    dom.dayProgressFill = $('#dayProgressFill');
    dom.dayChip = $('#dayChip');
    dom.sideCash = $('#sideCash');
    dom.sideDebt = $('#sideDebt');
    dom.sideLoans = $('#sideLoans');
    dom.sideNext = $('#sideNext');
    dom.sideNet = $('#sideNet');
    dom.sideHint = $('#sideHint');
    dom.dealerTip = $('#dealerTip');
    dom.btnPoker = $('#btnPoker');
    dom.btnStone = $('#btnStone');
    dom.btnDoudizhu = $('#btnDoudizhu');
    dom.btnLoan = $('#btnLoan');
    dom.btnOil = $('#btnOil');
    dom.btnLiar = $('#btnLiar');
    dom.btnRoulette = $('#btnRoulette');
    dom.btnLan = $('#btnLan');
    dom.btnEndDay = $('#btnEndDay');
    dom.soundBtn = $('#soundBtn');
    dom.achieveBtn = $('#achieveBtn');
    dom.helpBtn = $('#helpBtn');
    dom.clearLogBtn = $('#clearLogBtn');
    dom.bestRecord = $('#bestRecord');
    dom.diffMatrix = $('#diffMatrix');
    dom.dailyActionsNote = $('#dailyActionsNote');

    updateSoundButton();

    dom.soundBtn.addEventListener('click', () => {
      C.sound.toggle();
      updateSoundButton();
      toast(C.sound.enabled ? '音效已开启' : '音效已关闭', 'info', C.sound.enabled ? '🔊' : '🔇');
    });

    dom.helpBtn.addEventListener('click', showHelp);
    if (dom.achieveBtn) dom.achieveBtn.addEventListener('click', showAchievements);
    dom.clearLogBtn.addEventListener('click', clearMessages);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (modalState) {
        e.preventDefault();
        modalState.resolve(false);
        return;
      }
      if (panelState) {
        e.preventDefault();
        requestClose();
      }
    });

    updateBestRecord();
  }

  function updateSoundButton() {
    if (!dom.soundBtn) return;
    const use = dom.soundBtn.querySelector('use');
    if (use) use.setAttribute('href', C.sound.enabled ? '#icon-sound' : '#icon-mute');
    dom.soundBtn.classList.toggle('is-muted', !C.sound.enabled);
    dom.soundBtn.setAttribute('aria-pressed', C.sound.enabled ? 'true' : 'false');
    dom.soundBtn.setAttribute('aria-label', C.sound.enabled ? '关闭音效' : '开启音效');
  }

  /* ---------- 播报 ---------- */
  function message(text, type, icon) {
    if (!dom.messageArea) return;
    const empty = dom.messageArea.querySelector('.log-empty');
    if (empty) empty.remove();
    const line = document.createElement('div');
    line.className = 'log-line log-line--' + (type || 'info');
    const iconEl = document.createElement('span');
    iconEl.className = 'log-line__icon';
    iconEl.textContent = icon || TYPE_ICONS[type] || TYPE_ICONS.info;
    const textEl = document.createElement('span');
    textEl.className = 'log-line__text';
    textEl.textContent = text;
    line.appendChild(iconEl);
    line.appendChild(textEl);
    dom.messageArea.appendChild(line);

    const lines = dom.messageArea.querySelectorAll('.log-line');
    if (lines.length > 120) {
      for (let i = 0; i < lines.length - 120; i++) lines[i].remove();
    }
    dom.messageArea.scrollTop = dom.messageArea.scrollHeight;
  }

  function headline(text) {
    message(text, 'headline', '◆');
  }

  function clearMessages() {
    if (!dom.messageArea) return;
    dom.messageArea.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'log-empty';
    empty.textContent = '牌桌还没开张。';
    dom.messageArea.appendChild(empty);
  }

  /* ---------- Toast ---------- */
  function toast(text, type, icon) {
    if (!dom.toastRoot) return;
    const el = document.createElement('div');
    el.className = 'toast toast--' + (type || 'info');
    const ic = document.createElement('span');
    ic.className = 'toast__icon';
    ic.textContent = icon || (type === 'win' ? '✓' : type === 'lose' ? '✕' : type === 'achievement' ? '★' : '·');
    const txt = document.createElement('span');
    txt.textContent = text;
    el.appendChild(ic);
    el.appendChild(txt);
    dom.toastRoot.appendChild(el);

    const toasts = dom.toastRoot.querySelectorAll('.toast');
    if (toasts.length > 4) toasts[0].remove();

    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 260);
    }, 3200);
  }

  /* ---------- 主 HUD ---------- */
  function hudMoney(value) {
    return Math.abs(value) >= 1000000 ? util.fmtCompact(value) : util.fmt(value);
  }

  function refresh() {
    if (!dom.hudMoney) return;
    const debt = C.State.totalDebt();
    const rate = C.State.weightedRate();
    const net = state.money - debt;
    const locked = state.gameOver || state.isBankrupt;

    dom.topbarMoney.textContent = hudMoney(state.money);
    dom.hudDay.textContent = `第 ${state.day} / ${state.totalDays} 天`;
    dom.hudDaysLeft.textContent = state.daysLeft > 1 ? `还剩 ${state.daysLeft} 天` : '最后一天';
    dom.hudActionsText.textContent = `${state.actions} / ${state.maxActions} 次`;
    dom.hudActions.innerHTML = '';
    for (let i = 0; i < state.maxActions; i++) {
      const pip = document.createElement('span');
      pip.className = 'pip' + (i < state.actions ? ' is-active' : '');
      dom.hudActions.appendChild(pip);
    }

    dom.hudMoney.textContent = hudMoney(state.money);
    dom.hudNet.textContent = '净资产 ' + hudMoney(net);
    dom.hudDebt.textContent = hudMoney(debt);
    dom.hudLoans.textContent = state.loans.length ? `${state.loans.length} 笔贷款` : '暂无贷款';
    dom.hudRate.textContent = state.loans.length ? rate.toFixed(1) + '%' : '0%';
    dom.hudRateNote.textContent = state.loans.length
      ? `按本金加权 · 共 ${util.fmt(C.State.totalPrincipal())}`
      : '无债一身轻';

    dom.dayProgressFill.style.width = Math.min(100, (state.day / state.totalDays) * 100) + '%';
    dom.dayChip.textContent = 'DAY ' + state.day;

    dom.sideCash.textContent = util.fmt(state.money);
    dom.sideDebt.textContent = util.fmt(debt);
    dom.sideLoans.textContent = state.loans.length + ' 笔';
    const nextLoan = state.loans.slice().sort((a, b) => a.daysLeft - b.daysLeft)[0];
    dom.sideNext.textContent = nextLoan ? `${nextLoan.daysLeft} 天后` : '—';
    dom.sideNet.textContent = util.fmt(net);
    dom.sideNet.classList.toggle('text-red', net < 0);
    dom.sideNet.classList.toggle('text-gold', net >= 0);

    if (locked) {
      dom.sideHint.textContent = state.isBankrupt ? '催收已经上门，牌局结束。' : '牌局已经结束。';
      dom.btnEndDay.disabled = true;
    } else if (state.actions <= 0) {
      dom.sideHint.textContent = '今日行动已经用完，可以结束今天了。';
      dom.btnEndDay.disabled = state.inMinigame;
    } else {
      dom.sideHint.textContent = `还有 ${state.actions} 次行动。结束今天会结算到期贷款。`;
      dom.btnEndDay.disabled = state.inMinigame;
    }

    const disabled = locked || state.inMinigame;
    dom.btnPoker.disabled = disabled || state.actions <= 0 || state.money < 20;
    dom.btnStone.disabled = disabled || state.actions <= 0;
    dom.btnDoudizhu.disabled = disabled || state.actions <= 0 || state.money < 200;
    dom.btnLoan.disabled = disabled;
    if (dom.btnLiar) dom.btnLiar.disabled = disabled || state.actions <= 0 || state.money < 250;
    if (dom.btnRoulette) dom.btnRoulette.disabled = disabled || state.actions <= 0 || state.money < 250;
    if (dom.btnLan) dom.btnLan.disabled = locked || state.inMinigame;
    if (dom.btnOil) {
      const unlocked = !!(C.Oil && C.Oil.isUnlocked());
      const oilMin = C.DATA.OIL ? C.DATA.OIL.minMoney : 250;
      dom.btnOil.classList.toggle('hidden', !unlocked || !state.started);
      dom.btnOil.disabled = disabled || state.actions <= 0 || state.money < oilMin;
    }
    dom.btnEndDay.disabled = disabled;

    if (dom.dealerTip) updateDealerTip();
  }

  function updateDealerTip() {
    if (!dom.dealerTip) return;
    const debt = C.State.totalDebt();
    const net = state.money - debt;
    let tip;
    if (state.isBankrupt) {
      tip = '门已经锁了。灯还亮着，但不会再有人来翻本。';
    } else if (state.day <= 3 && state.loans.length) {
      tip = '前三天借到十亿，会解锁一个不太体面的成就。银行柜员已经记住你的脸。';
    } else if (debt > 0 && net < 0) {
      tip = '你现在的净资产是负数。冷静一点，先想想下一笔利息从哪来。';
    } else if (state.money < 100) {
      tip = '筹码不多了。赌石 $100 起，斗地主需要 $200——先借，还是先收手？';
    } else if (state.actions === 0) {
      tip = '今天的运气用完了。结束今天，明天还有三次机会。';
    } else if (state.daysLeft <= 3) {
      tip = '留给你的时间不多了。到期贷款不会因为你说“再等等”就消失。';
    } else if (!(C.Oil && C.Oil.isUnlocked()) && state.day % 3 === 2) {
      tip = '地底下好像还有一层。老荷官说：对着牌桌敲出“oil”，或者连点七下门口那排花色。';
    } else {
      const tips = [
        '牌桌不看眼泪，只看筹码。先保住本金，再谈翻倍。',
        '德州扑克里，会弃牌的人才能活得久。',
        '赌石切涨了就想再切一块？庄家最喜欢这种客人。',
        '斗地主记牌比运气重要，尤其是外面还剩几张 2。',
        '借来的钱也是钱，但利息不是。',
        '连输三把之后，最划算的选择通常是站起来。'
      ];
      if (C.Oil && C.Oil.isUnlocked()) {
        tips.push('黑金油田的油罐不会自己变满。见好就收，比钻到底更难。');
        tips.push('油田里每钻一层，油价都会动。你赌的不只是瓦斯，还有时机。');
      }
      tip = tips[(state.day - 1) % tips.length];
    }
    dom.dealerTip.textContent = tip;
  }

  /* ---------- 屏幕切换 ---------- */
  function showScreen(name) {
    const map = {
      setup: dom.setupScreen,
      game: dom.mainGame,
      ending: dom.endingScreen
    };
    Object.keys(map).forEach((key) => {
      if (map[key]) map[key].classList.toggle('hidden', key !== name);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- 面板 ---------- */
  function openPanel(opts) {
    if (!dom.dynamicPanel) return null;
    closePanel();

    const title = util.escapeHtml(opts.title || '');
    const subtitle = util.escapeHtml(opts.subtitle || '');
    const kicker = util.escapeHtml(opts.kicker || 'DEALER\'S TABLE');

    dom.dynamicPanel.innerHTML = `
      <div class="panel-backdrop" data-panel-close></div>
      <section class="game-panel${opts.wide ? ' game-panel--wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
        <header class="game-panel__head">
          <div>
            <p class="eyebrow eyebrow--small">${kicker}</p>
            <h2>${title}</h2>
            ${subtitle ? `<p>${subtitle}</p>` : ''}
          </div>
          <button class="panel-close" type="button" data-panel-close aria-label="关闭">
            <svg class="icon"><use href="#icon-close"></use></svg>
          </button>
        </header>
        <div class="game-panel__body">${opts.body || ''}</div>
      </section>
    `;
    dom.dynamicPanel.classList.remove('hidden');
    document.body.classList.add('has-panel');

    panelState = {
      onClose: opts.onClose || null,
      onClosed: opts.onClosed || null,
      closable: opts.closable !== false,
      closing: false
    };

    $$('[data-panel-close]', dom.dynamicPanel).forEach((el) => {
      el.addEventListener('click', () => {
        if (panelState && panelState.closable) requestClose();
      });
    });

    const focusTarget = dom.dynamicPanel.querySelector('.game-panel__body input, .game-panel .btn, .panel-close');
    if (focusTarget) {
      setTimeout(() => {
        try { focusTarget.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      }, 60);
    }

    return dom.dynamicPanel.querySelector('.game-panel__body');
  }

  function requestClose() {
    if (!panelState || panelState.closing) return;
    if (!panelState.closable) return;
    panelState.closing = true;
    if (panelState.onClose) {
      Promise.resolve(panelState.onClose()).catch(() => {}).finally(() => {
        if (panelState) panelState.closing = false;
      });
    } else {
      closePanel();
    }
  }

  function closePanel() {
    if (!dom.dynamicPanel) return;
    const callback = panelState && panelState.onClosed;
    panelState = null;
    dom.dynamicPanel.classList.add('hidden');
    dom.dynamicPanel.innerHTML = '';
    document.body.classList.remove('has-panel');
    if (callback) callback();
  }

  function isPanelOpen() {
    return !!panelState;
  }

  function panelBody() {
    return dom.dynamicPanel ? dom.dynamicPanel.querySelector('.game-panel__body') : null;
  }

  /* ---------- 对话框 ---------- */
  function modal(opts) {
    if (!dom.modalRoot) return Promise.resolve(false);
    if (modalState) {
      modalState.resolve(false);
      modalState = null;
    }
    return new Promise((resolve) => {
      const danger = !!opts.danger;
      const hideCancel = !!opts.hideCancel;
      const title = util.escapeHtml(opts.title || '确认');
      const body = opts.html || util.escapeHtml(opts.message || '');
      const confirmText = util.escapeHtml(opts.confirmText || '确认');
      const cancelText = util.escapeHtml(opts.cancelText || '取消');
      const icon = opts.icon || (danger ? '!' : '?');
      const wide = opts.wide ? ' modal--wide' : '';

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal${wide}" role="dialog" aria-modal="true" aria-label="${title}">
          <div class="modal__icon${danger ? ' modal__icon--danger' : ''}">${util.escapeHtml(icon)}</div>
          <h3>${title}</h3>
          <div class="modal__body">${body}</div>
          <div class="modal__actions">
            ${hideCancel ? '' : `<button class="btn btn--ghost" type="button" data-modal-cancel>${cancelText}</button>`}
            <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" type="button" data-modal-confirm>${confirmText}</button>
          </div>
        </div>
      `;
      dom.modalRoot.appendChild(overlay);
      document.body.classList.add('has-modal');

      const finish = (value) => {
        if (!modalState) return;
        modalState = null;
        overlay.remove();
        if (!dom.modalRoot.querySelector('.modal-overlay')) {
          document.body.classList.remove('has-modal');
        }
        resolve(value);
      };

      modalState = { resolve: finish };

      overlay.querySelector('[data-modal-confirm]').addEventListener('click', () => finish(true));
      const cancelBtn = overlay.querySelector('[data-modal-cancel]');
      if (cancelBtn) cancelBtn.addEventListener('click', () => finish(false));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) finish(false);
      });

      const confirmBtn = overlay.querySelector('[data-modal-confirm]');
      setTimeout(() => { try { confirmBtn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 50);
    });
  }

  function confirm(opts) {
    return modal(opts);
  }

  /* ---------- 帮助 ---------- */
  function showHelp() {
    const diff = C.State.diff();
    const planText = C.DATA.LOAN_PLANS
      .map((plan) => `${plan.term} 天 ${C.State.planRate(plan)}% / 天`)
      .join('，');
    const oilUnlocked = !!(C.Oil && C.Oil.isUnlocked());
    const oilSection = oilUnlocked ? `
      <div class="help-section">
        <h3><svg class="icon"><use href="#icon-oil"></use></svg>隐藏牌桌 · 黑金油田</h3>
        <ul>
          <li>进入消耗 1 次行动，租金 ${util.fmt(C.DATA.OIL.lease)}：6 口井位、地下 5 层，油层和遗物一开始就看得见。</li>
          <li>点一口井的顶层开始下钻；「?」可能是岩层，也可能是瓦斯。每钻一层，油价都会波动。</li>
          <li>撞上瓦斯会烧掉本井全部原油，还要赔修井费。随时可以“收井”，把本井产出存进油罐。</li>
          <li>“卖油收工”按当前油价结算整罐油；3 口井用完会自动结算。</li>
          <li>难度会影响油层数量、埋藏深度、瓦斯概率、油价和修井费。见好就收，是油田里最贵的一课。</li>
        </ul>
      </div>` : `
      <div class="help-section">
        <h3><svg class="icon"><use href="#icon-oil"></use></svg>隐藏牌桌</h3>
        <p>赌场地底下还有一层，账本上没有记录。老荷官只肯说一句：<strong>对着牌桌敲出它的名字（三个字母）</strong>，或者<strong>连点页脚那排花色七次</strong>。信不信由你。</p>
      </div>`;

    const html = `
      <div class="help-section">
        <h3><svg class="icon"><use href="#icon-calendar"></use></svg>基本规则</h3>
        <p>你带着 <strong>$1,000</strong> 入场，在 7 / 15 / 30 天里经营你的赌场生涯。当前难度下每天有 <strong>${diff.actions} 次行动</strong>，每次进入牌局或赌石消耗 1 次。贷款、查看账本不消耗行动。</p>
        <p>每天结束时，到期的贷款会自动扣除本息。现金不足会直接破产。倒计时归零时，按<strong>净资产 = 现金 − 贷款本息</strong>结算结局。</p>
      </div>
      <div class="help-section">
        <h3><svg class="icon"><use href="#icon-spade"></use></svg>德州扑克</h3>
        <ul>
          <li>先选场次：零钱场 / 100 元场 / 500 元场 / 1,000 元场 / 10,000 元场。买入就是带上桌的筹码，剩余现金留在账上。</li>
          <li>单挑庄家，盲注随场次放大（例如 100 元场 5 / 10，1,000 元场 20 / 40）。</li>
          <li>四轮下注：翻牌前、翻牌、转牌、河牌。摊牌时用 7 张牌里最好的 5 张比大小。</li>
          <li>本局结束时，桌上的筹码会回到现金；10,000 元场赢下一手有隐藏成就。</li>
        </ul>
      </div>
      <div class="help-section">
        <h3><svg class="icon"><use href="#icon-gem"></use></svg>赌石</h3>
        <ul>
          <li>花固定价格买原石，切割后有概率切涨。当前难度：爆率 <strong>×${mult(diff.stoneProb)}</strong>，赔付 <strong>×${mult(diff.stonePay)}</strong>。</li>
          <li>进入赌石场消耗 1 次行动；在场内连续切石<strong>不再消耗行动</strong>，只花钱。</li>
          <li>切涨金额随机，越贵的料波动越大。单次切出 $20,000 以上会解锁成就。</li>
        </ul>
      </div>
      <div class="help-section">
        <h3><svg class="icon"><use href="#icon-cards"></use></svg>斗地主</h3>
        <ul>
          <li>你和两个 AI 打三人局，随机抢地主，底牌公开。底注 $100，需要至少 $200 现金。</li>
          <li>地主赢收双倍，农民赢收单倍；输了按同样倍率扣钱。中途退出视为认输。</li>
          <li>支持单张、对子、三张、三带一、三带二、顺子、连对、飞机、炸弹、王炸。</li>
          <li>“提示”会帮你选一手能管上的牌。自由出牌时不能“不出”。</li>
        </ul>
      </div>
      <div class="help-section">
        <h3><svg class="icon"><use href="#icon-mask"></use></svg>骗子酒馆</h3>
        <ul>
          <li>2-4 人，每人 2 条命、5 张手牌。牌堆只发 <strong>J / Q / K / A</strong>，另有两张<strong>万能牌</strong>，可当作任意目标牌。</li>
          <li>每轮随机一张目标牌；轮到你时打出 1-3 张并声称它们是目标牌。下一位可以继续出牌，也可以“质疑”上一手。</li>
          <li>质疑后只翻开最后一手：全是目标牌/万能牌，质疑者掉 1 条命；有假，出牌者掉 1 条命。最后活着的人赢。</li>
          <li><strong>回响模式</strong>：开局可选 1-3 张回响。每轮桌上会出现对应数量的公开目标牌，你可以带 1 张进自己的出牌（计入 3 张上限）。</li>
          <li>单人局 1 行动 + $250 底注；本地 / 局域网联机是友谊赛，且支持同房间再来一局。</li>
        </ul>
      </div>
      <div class="help-section">
        <h3><svg class="icon"><use href="#icon-gun"></use></svg>恶魔轮盘赌</h3>
        <ul>
          <li>1v1，双方 3 点生命。每轮装填若干实弹和空包，数量公开、顺序保密。</li>
          <li>轮到你时可以先使用道具，再朝自己或对手开枪。空包打自己可以保留回合，实弹打自己会掉血。</li>
          <li>道具：香烟回血、放大镜看当前弹壳、啤酒退弹、手铐锁对手一回合、锯子让下一枪伤害翻倍。</li>
          <li>单人局 1 行动 + $250 底注；局域网为双人友谊赛，不计现金。</li>
        </ul>
      </div>
      <div class="help-section">
        <h3><svg class="icon"><use href="#icon-wifi"></use></svg>局域网联机</h3>
        <ul>
          <li>在项目目录运行 <code>node server/lan-server.js</code>，用终端打印的局域网地址打开游戏。</li>
          <li>同一 Wi-Fi 下，一人创建房间，其他人输入 4 位房间码加入；房主选游戏并开始。</li>
          <li>联机支持骗子酒馆（2-4 人）和恶魔轮盘赌（2 人），是友谊赛，不计现金和行动，但有隐藏联机成就。</li>
          <li>服务器只是内存房间中继，关闭服务或所有人离开后房间即消失。</li>
        </ul>
      </div>
      <div class="help-section">
        <h3><svg class="icon"><use href="#icon-bank"></use></svg>银行贷款</h3>
        <ul>
          <li>借款按天计息：${planText}。当前难度利率系数 <strong>×${diff.loanRate}</strong>，利息按本金和已过天数累计。</li>
          <li>到期自动扣除本金 + 全部利息。可以随时提前结清，只付已经产生的利息。</li>
          <li>总欠款达到 10 亿、且游戏开始不超过 3 天，会解锁隐藏成就。</li>
        </ul>
      </div>
      <div class="help-section">
        <h3><svg class="icon"><use href="#icon-bolt"></use></svg>难度差异</h3>
        <ul>
          <li>简单：每天 4 次行动，贷款利率 ×0.8，赌石高爆率，油田浅层富油、瓦斯少。</li>
          <li>普通：每天 3 次行动，所有数值取基准。</li>
          <li>困难：每天 3 次行动，贷款利率 ×1.2，赌石爆率 ×0.75，油田更深、瓦斯更多。</li>
          <li>地狱：每天只有 2 次行动，贷款利率 ×1.4，牌桌 AI 最强，油田油少、气多、价低。</li>
          <li>开始界面的“难度差异”表格可以逐项对照。</li>
        </ul>
      </div>
      ${oilSection}
      <div class="help-section">
        <h3><svg class="icon"><use href="#icon-trophy"></use></svg>成就与操作</h3>
        <p>本局成就随时可以点右上角奖杯查看；结算页会展示完整成就墙。音效可用右上角按钮开关，历史最佳净资产保存在本机浏览器里。<span class="help-kbd">Esc</span> 可以关闭弹层。</p>
      </div>
    `;
    modal({
      title: '玩法说明',
      html,
      confirmText: '知道了',
      hideCancel: true,
      wide: true,
      icon: '♠'
    });
  }

  /* ---------- 成就墙 ---------- */
  function achievementHTML(list) {
    return list.map((a) => {
      const hidden = a.secret && !a.unlocked;
      const name = hidden ? '？？？' : a.name;
      const icon = hidden ? '❓' : a.icon;
      return `<span class="achievement${a.unlocked ? '' : ' achievement--locked'}${hidden ? ' achievement--secret' : ''}" title="${util.escapeHtml(hidden ? '隐藏成就' : a.desc)}">
        <span class="achievement__icon">${icon}</span>${util.escapeHtml(name)}
      </span>`;
    }).join('');
  }

  function showAchievements() {
    if (!C.State || !C.state.started) {
      modal({
        title: '成就',
        message: '成就按单局记录。先开一局，再来看看你能带走几枚。',
        confirmText: '知道了',
        hideCancel: true,
        icon: '🏆'
      });
      return;
    }
    const list = C.State.achievementList();
    const unlocked = list.filter((a) => a.unlocked).length;
    const rows = list.map((a) => {
      const hidden = a.secret && !a.unlocked;
      return `<div class="ach-row${a.unlocked ? ' is-on' : ''}${hidden ? ' is-secret' : ''}">
        <span class="ach-row__icon">${hidden ? '❓' : a.icon}</span>
        <div class="ach-row__body">
          <strong>${hidden ? '？？？' : util.escapeHtml(a.name)}</strong>
          <small>${hidden ? '隐藏成就 · 赌场地底下似乎藏着什么' : util.escapeHtml(a.desc)}</small>
        </div>
        <span class="ach-row__state">${a.unlocked ? '已解锁' : '未解锁'}</span>
      </div>`;
    }).join('');

    modal({
      title: `成就 · ${unlocked} / ${list.length}`,
      html: `<div class="ach-panel">${rows}</div>`,
      confirmText: '知道了',
      hideCancel: true,
      wide: true,
      icon: '🏆'
    });
  }

  /* ---------- 卡牌 ---------- */
  function cardHTML(card, opts) {
    const options = opts || {};
    const classes = ['pcard'];
    if (options.size === 'small') classes.push('pcard--small');
    if (options.size === 'mini') classes.push('pcard--mini');
    if (options.size === 'tiny') classes.push('pcard--tiny');
    if (options.selected) classes.push('pcard--selected');
    if (options.dim) classes.push('pcard--dim');
    if (options.className) classes.push(options.className);

    if (options.hidden || !card) {
      classes.push('pcard--back');
      if (options.hidden && !card) classes.push('pcard--back');
      return `<span class="${classes.join(' ')}"${options.style ? ` style="${options.style}"` : ''}></span>`;
    }

    if (card.joker) classes.push('pcard--joker');
    if (card.wild) classes.push('pcard--wild');
    if (card.red) classes.push('pcard--red');

    const corner = card.wild ? '万' : card.joker ? (card.rank === '大王' ? '大' : '小') : card.rank;
    const suit = card.wild ? '★' : card.joker ? '王' : card.suit;
    const pip = card.wild ? '★' : card.joker ? '王' : card.suit;
    const data = options.uidAttr == null ? (card.uid ? ` data-uid="${card.uid}"` : '') : ` data-uid="${options.uidAttr}"`;
    const title = card.wild ? '万能牌' : card.joker ? card.rank : card.suit + card.rank;

    return `<span class="${classes.join(' ')}"${data}${options.style ? ` style="${options.style}"` : ''} title="${title}">
      <span class="pcard__corner"><b>${corner}</b><i>${suit}</i></span>
      <span class="pcard__pip">${pip}</span>
      <span class="pcard__corner pcard__corner--br"><b>${corner}</b><i>${suit}</i></span>
    </span>`;
  }

  function cardBackHTML(opts) {
    const options = opts || {};
    const classes = ['pcard', 'pcard--back'];
    if (options.size === 'small') classes.push('pcard--small');
    if (options.size === 'mini') classes.push('pcard--mini');
    if (options.size === 'tiny') classes.push('pcard--tiny');
    if (options.className) classes.push(options.className);
    return `<span class="${classes.join(' ')}"${options.style ? ` style="${options.style}"` : ''}></span>`;
  }

  function cardRow(cards, opts) {
    return (cards || []).map((card, i) => cardHTML(card, {
      ...opts,
      style: (opts && opts.style ? opts.style : '') + `--d:${i * 0.05}s;`
    })).join('');
  }

  /* ---------- 开始界面 ---------- */
  function updateSetupSummary(difficulty, days) {
    const diff = C.DATA.DIFFICULTIES[difficulty] || C.DATA.DIFFICULTIES[2];
    const el = $('#setupSummary');
    if (el) {
      el.innerHTML = `<span class="setup-summary__dot"></span><span>当前选择：<strong>${diff.name}</strong> · <strong>${days} 天</strong> · 每天 <strong>${diff.actions} 次行动</strong> · 初始资金 $1,000</span>`;
    }
    if (dom.dailyActionsNote) {
      dom.dailyActionsNote.textContent = `每天 ${diff.actions} 次行动`;
    }
    $$('#difficultyButtons .choice').forEach((btn) => {
      btn.classList.toggle('is-active', Number(btn.dataset.diff) === Number(difficulty));
    });
    $$('#daysButtons .segment').forEach((btn) => {
      btn.classList.toggle('is-active', Number(btn.dataset.days) === Number(days));
    });
    renderDiffMatrix(difficulty);
  }

  function mult(v) {
    const n = Math.round(Number(v) * 100) / 100;
    return '×' + String(n).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }

  function renderDiffMatrix(difficulty) {
    if (!dom.diffMatrix) return;
    const ids = [1, 2, 3, 4];
    const diffs = ids.map((id) => C.DATA.DIFFICULTIES[id]);
    const rows = [
      { label: '每日行动', value: (d) => `${d.actions} 次` },
      { label: '贷款利率', value: (d) => mult(d.loanRate) },
      { label: '赌石爆率', value: (d) => mult(d.stoneProb) },
      { label: '赌石赔付', value: (d) => mult(d.stonePay) },
      { label: '牌桌 AI', value: (d) => `${Math.round(d.aiSkill * 100)}%` },
      { label: '油田瓦斯', value: (d) => `${Math.round(d.oilGas * 100)}%` },
      { label: '油田油价', value: (d) => mult(d.oilPrice) }
    ];
    const head = `<tr><th>项目</th>${diffs.map((d) => `<th class="${d.id === Number(difficulty) ? 'is-active' : ''}">${d.icon} ${d.name}</th>`).join('')}</tr>`;
    const body = rows.map((row) => `<tr><th>${row.label}</th>${diffs.map((d) => `<td class="${d.id === Number(difficulty) ? 'is-active' : ''}">${row.value(d)}</td>`).join('')}</tr>`).join('');

    dom.diffMatrix.innerHTML = `
      <div class="diff-matrix__head">
        <span>难度差异</span>
        <small>同一张牌桌，完全不同的活法</small>
      </div>
      <div class="diff-matrix__scroll">
        <table>
          <thead>${head}</thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
  }

  function updateBestRecord() {
    if (!dom.bestRecord) return;
    const best = C.storage.get('casino.bestNet', null);
    dom.bestRecord.innerHTML = `<span>历史最佳</span><strong>${best == null ? '—' : util.fmt(best)}</strong>`;
  }

  C.UI = {
    init,
    $,
    $$,
    message,
    headline,
    clearMessages,
    toast,
    refresh,
    updateDealerTip,
    showScreen,
    openPanel,
    closePanel,
    requestClose,
    isPanelOpen,
    panelBody,
    modal,
    confirm,
    showHelp,
    showAchievements,
    achievementHTML,
    cardHTML,
    cardBackHTML,
    cardRow,
    updateSetupSummary,
    updateBestRecord
  };
})(window.Casino = window.Casino || {});
