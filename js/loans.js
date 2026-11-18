/* ============================================================
   赌徒模拟器 · 银行贷款
   查看账本、借款、提前结清；不消耗行动次数。
   ============================================================ */
(function (C) {
  'use strict';

  const util = C.util;
  const State = C.State;
  const UI = C.UI;
  const DATA = C.DATA;

  let S = null;

  function open() {
    if (S) return;
    if (!C.Game.beginActivity({ action: 0, minMoney: 0, label: '银行贷款' })) return;

    S = { amount: 1000 };
    const diff = State.diff();
    const minRate = Math.min.apply(null, DATA.LOAN_PLANS.map((plan) => State.planRate(plan)));

    UI.openPanel({
      kicker: 'THE BANK ALWAYS COLLECTS',
      title: '银行贷款',
      subtitle: `日息 ${minRate}% 起 · ${diff.name}难度利率 ×${diff.loanRate} · 到期自动扣款 · 不消耗行动次数`,
      wide: true,
      body: '<div id="loanRoot"></div>',
      onClosed: () => {
        S = null;
        C.Game.endActivity();
      }
    });

    render();
    UI.message(`=== 银行贷款 === 当前现金 ${util.fmt(C.state.money)}，总欠款 ${util.fmt(State.totalDebt())}。`, 'info');
  }

  function render() {
    const root = document.getElementById('loanRoot');
    if (!S || !root) return;
    const state = C.state;
    const debt = State.totalDebt();
    const rate = State.weightedRate();
    const plans = DATA.LOAN_PLANS;
    const amount = Math.max(0, Math.floor(Number(S.amount) || 0));

    const loanRows = state.loans.length
      ? state.loans.map((loan) => {
        const accrued = State.loanAccrued(loan);
        const payoff = State.loanPayoff(loan);
        return `<div class="loan-row">
          <div class="loan-row__main">
            <div class="loan-row__title">${loan.term} 天贷款 · 日息 ${loan.rate}%</div>
            <div class="loan-row__sub">第 ${loan.takenDay} 天借入 · 剩余 ${loan.daysLeft} 天 · 已产生利息 ${util.fmt(accrued)}</div>
          </div>
          <div class="loan-row__amount">
            <strong>${util.fmt(payoff)}</strong>
            <span>结清本息</span>
            <button class="btn btn--ghost btn--sm" type="button" data-loan-repay="${loan.id}" style="margin-top:4px;">提前结清</button>
          </div>
        </div>`;
      }).join('')
      : '<div class="loan-empty">目前没有贷款。银行经理看你的眼神都有些失望。</div>';

    const planCards = plans.map((plan, index) => {
      const rate = State.planRate(plan);
      const due = amount > 0 ? amount + Math.floor(amount * rate / 100 * plan.term) : 0;
      return `<button class="plan-card" type="button" data-loan-borrow="${index}" ${amount < 1000 ? 'disabled' : ''}>
        <strong>${plan.name}</strong>
        <span class="plan-card__rate">日息 ${rate}%</span>
        <small>${plan.desc} · 到期还本付息</small>
        <span class="plan-card__due">借 ${util.fmt(amount)}，到期还 <b>${util.fmt(due)}</b></span>
        <span class="plan-card__cta">点击借入 →</span>
      </button>`;
    }).join('');

    root.innerHTML = `
      <div class="loan-stats">
        <div class="loan-stat"><span>当前现金</span><strong class="is-gold">${util.fmt(state.money)}</strong></div>
        <div class="loan-stat"><span>总欠款（含已产生利息）</span><strong class="is-red">${util.fmt(debt)}</strong></div>
        <div class="loan-stat"><span>综合日利率</span><strong>${state.loans.length ? rate.toFixed(1) + '%' : '0%'}</strong></div>
      </div>

      <div class="loan-section">
        <div class="loan-section__head">
          <h3>我的贷款</h3>
          <span>${state.loans.length} 笔 · 到期日会从现金自动扣款</span>
        </div>
        <div class="loan-list">${loanRows}</div>
      </div>

      <div class="loan-section">
        <div class="loan-section__head">
          <h3>再借一笔</h3>
          <span>单笔 $1,000 – $10 亿 · ${State.diff().name}难度利率 ×${State.diff().loanRate}</span>
        </div>
        <div class="borrow-box">
          <label class="input-label" for="loanAmount">借款金额</label>
          <input class="amount-input" id="loanAmount" type="number" min="1000" step="1000" value="${amount}" inputmode="numeric">
          <div class="quick-amounts">
            <button type="button" data-loan-quick="1000">$1,000</button>
            <button type="button" data-loan-quick="10000">$1万</button>
            <button type="button" data-loan-quick="100000">$10万</button>
            <button type="button" data-loan-quick="1000000">$100万</button>
            <button type="button" data-loan-quick="100000000">$1亿</button>
          </div>
          <div class="plan-grid">${planCards}</div>
          <div class="loan-note">
            利息按<strong>已过天数</strong>累计，提前结清只付已经产生的利息；到期未还清会直接破产。
            ${state.day <= 3 ? '提示：前三天欠款达到 10 亿会解锁隐藏成就。' : ''}
          </div>
        </div>
      </div>

      <div class="cut-actions">
        <button class="btn btn--ghost" type="button" data-loan-close>返回主菜单</button>
      </div>
    `;

    const input = root.querySelector('#loanAmount');
    input.addEventListener('input', () => {
      const value = Math.max(0, Math.floor(Number(input.value) || 0));
      S.amount = value;
      updatePreviews(root, value);
      root.querySelectorAll('[data-loan-borrow]').forEach((btn) => {
        btn.disabled = value < 1000;
      });
    });
    input.addEventListener('change', () => {
      const value = Math.max(0, Math.floor(Number(input.value) || 0));
      S.amount = value;
      input.value = value;
      updatePreviews(root, value);
    });

    root.querySelectorAll('[data-loan-quick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        S.amount = Number(btn.dataset.loanQuick);
        input.value = S.amount;
        updatePreviews(root, S.amount);
        root.querySelectorAll('[data-loan-borrow]').forEach((b) => { b.disabled = false; });
        input.focus();
      });
    });

    root.querySelectorAll('[data-loan-borrow]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const value = Math.floor(Number(input.value) || S.amount);
        borrow(value, Number(btn.dataset.loanBorrow));
      });
    });

    root.querySelectorAll('[data-loan-repay]').forEach((btn) => {
      btn.addEventListener('click', () => repay(btn.dataset.loanRepay));
    });

    const closeBtn = root.querySelector('[data-loan-close]');
    if (closeBtn) closeBtn.addEventListener('click', () => UI.requestClose());
  }

  function updatePreviews(root, amount) {
    root.querySelectorAll('[data-loan-borrow]').forEach((btn) => {
      const plan = DATA.LOAN_PLANS[Number(btn.dataset.loanBorrow)];
      const rate = State.planRate(plan);
      const due = amount > 0 ? amount + Math.floor(amount * rate / 100 * plan.term) : 0;
      const dueEl = btn.querySelector('.plan-card__due b');
      if (dueEl) dueEl.textContent = util.fmt(due);
    });
  }

  function borrow(amount, planIndex) {
    const result = State.borrow(amount, planIndex);
    if (!result.ok) {
      UI.toast(result.error, 'lose');
      C.sound.play('lose');
      return;
    }
    const plan = DATA.LOAN_PLANS[planIndex];
    const rate = State.planRate(plan);
    const due = amount + Math.floor(amount * rate / 100 * plan.term);
    C.sound.play('loan');
    UI.toast(`到账 ${util.fmt(amount)}，${plan.term} 天后还 ${util.fmt(due)}`, 'win', '💰');
    UI.message(`借入 ${util.fmt(amount)}，期限 ${plan.term} 天，日息 ${rate}%。到期应还 ${util.fmt(due)}。`, 'warn');
    UI.refresh();
    render();
  }

  function repay(loanId) {
    const loan = C.state.loans.find((item) => item.id === loanId);
    if (!loan) return;
    const payoff = State.loanPayoff(loan);
    if (C.state.money < payoff) {
      UI.toast(`现金不足，结清需要 ${util.fmt(payoff)}。`, 'lose');
      return;
    }
    UI.modal({
      title: '提前结清？',
      message: `这笔 ${loan.term} 天贷款当前应还 <strong>${util.fmt(payoff)}</strong>（本金 ${util.fmt(loan.principal)} + 利息 ${util.fmt(State.loanAccrued(loan))}）。结清后贷款记录会消失。`,
      confirmText: '确认结清',
      cancelText: '再想想',
      icon: '🏦'
    }).then((ok) => {
      if (!ok) return;
      const result = State.repay(loanId);
      if (!result.ok) {
        UI.toast(result.error, 'lose');
        return;
      }
      UI.toast(`已结清，支付 ${util.fmt(result.paid)}`, 'win');
      UI.message(`提前结清一笔贷款，支付 ${util.fmt(result.paid)}。`, 'win');
      UI.refresh();
      render();
    });
  }

  C.Loans = { open };
})(window.Casino = window.Casino || {});
