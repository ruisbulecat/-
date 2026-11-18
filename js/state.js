/* ============================================================
   赌徒模拟器 · 游戏状态与贷款/日程结算
   ============================================================ */
(function (C) {
  'use strict';

  const DATA = C.DATA;
  const util = C.util;

  const state = {
    difficulty: 2,
    totalDays: 15,
    daysLeft: 15,
    day: 1,
    money: 1000,
    actions: 3,
    maxActions: 3,
    loans: [],
    achievements: {},
    everBorrowed: false,
    gameOver: false,
    isBankrupt: false,
    inMinigame: false,
    started: false,
    stats: {
      maxCash: 1000,
      maxSingleStoneWin: 0,
      stoneCuts: 0,
      stoneWins: 0,
      pokerHands: 0,
      pokerWins: 0,
      ddzGames: 0,
      ddzWins: 0,
      borrowedTotal: 0,
      repaidTotal: 0,
      oilLeases: 0,
      oilProfit: 0,
      oilBestLease: 0,
      oilBarrels: 0,
      oilLayers: 0,
      oilBlowouts: 0,
      liarGames: 0,
      liarWins: 0,
      rouletteGames: 0,
      rouletteWins: 0,
      lanGames: 0,
      lanWins: 0
    }
  };

  C.state = state;

  function diff() {
    return DATA.DIFFICULTIES[state.difficulty] || DATA.DIFFICULTIES[2];
  }

  function reset(difficulty, days) {
    state.difficulty = Number(difficulty) || 2;
    state.totalDays = Number(days) || 15;
    state.daysLeft = state.totalDays;
    state.day = 1;
    state.money = 1000;
    state.maxActions = diff().actions || 3;
    state.actions = state.maxActions;
    state.loans = [];
    state.achievements = {};
    state.everBorrowed = false;
    state.gameOver = false;
    state.isBankrupt = false;
    state.inMinigame = false;
    state.started = true;
    state.stats = {
      maxCash: 1000,
      maxSingleStoneWin: 0,
      stoneCuts: 0,
      stoneWins: 0,
      pokerHands: 0,
      pokerWins: 0,
      ddzGames: 0,
      ddzWins: 0,
      borrowedTotal: 0,
      repaidTotal: 0,
      oilLeases: 0,
      oilProfit: 0,
      oilBestLease: 0,
      oilBarrels: 0,
      oilLayers: 0,
      oilBlowouts: 0,
      liarGames: 0,
      liarWins: 0,
      rouletteGames: 0,
      rouletteWins: 0,
      lanGames: 0,
      lanWins: 0
    };
  }

  /* ---------- 贷款计算 ---------- */

  function loanElapsed(loan) {
    return util.clamp(loan.term - loan.daysLeft, 0, loan.term);
  }

  function loanAccrued(loan) {
    return Math.floor(loan.principal * loan.rate / 100 * loanElapsed(loan));
  }

  function loanPayoff(loan) {
    return loan.principal + loanAccrued(loan);
  }

  function loanMaturityInterest(loan) {
    return Math.floor(loan.principal * loan.rate / 100 * loan.term);
  }

  function totalDebt() {
    return state.loans.reduce((sum, loan) => sum + loanPayoff(loan), 0);
  }

  function totalPrincipal() {
    return state.loans.reduce((sum, loan) => sum + loan.principal, 0);
  }

  function weightedRate() {
    const principal = totalPrincipal();
    if (!principal) return 0;
    const weighted = state.loans.reduce((sum, loan) => sum + loan.principal * loan.rate, 0);
    return weighted / principal;
  }

  /* 难度会调整贷款利率：简单更便宜，地狱贵得多 */
  function planRate(plan) {
    if (!plan) return 0;
    const mult = diff().loanRate == null ? 1 : diff().loanRate;
    return Math.round(Number(plan.rate) * mult * 10) / 10;
  }

  function borrow(amount, planIndex) {
    if (state.gameOver || state.isBankrupt) {
      return { ok: false, error: '牌局已经结束了。' };
    }
    const plan = DATA.LOAN_PLANS[planIndex];
    if (!plan) return { ok: false, error: '未知的贷款方案。' };

    amount = Math.floor(Number(amount));
    if (!Number.isFinite(amount) || amount < 1000) {
      return { ok: false, error: '单笔借款不能低于 $1,000。' };
    }
    if (amount > 1000000000) {
      return { ok: false, error: '单笔借款不能超过 $10 亿，银行也怕你跑路。' };
    }

    const loan = {
      id: util.uid('loan'),
      principal: amount,
      rate: planRate(plan),
      term: plan.term,
      daysLeft: plan.term,
      takenDay: state.day
    };
    state.loans.push(loan);
    state.money += amount;
    state.everBorrowed = true;
    state.stats.borrowedTotal += amount;
    state.stats.maxCash = Math.max(state.stats.maxCash, state.money);
    checkBillionDebt();
    return { ok: true, loan };
  }

  function repay(loanId) {
    const index = state.loans.findIndex((loan) => loan.id === loanId);
    if (index === -1) return { ok: false, error: '找不到这笔贷款。' };
    const loan = state.loans[index];
    const payoff = loanPayoff(loan);
    if (state.money < payoff) {
      return { ok: false, error: `现金不足，需要 ${util.fmt(payoff)} 才能结清。` };
    }
    state.money -= payoff;
    state.loans.splice(index, 1);
    state.stats.repaidTotal += payoff;
    C.sound.play('chip');
    return { ok: true, paid: payoff };
  }

  /* ---------- 成就 / 统计 ---------- */

  function unlock(id) {
    const def = DATA.ACHIEVEMENTS[id];
    if (!def || state.achievements[id]) return false;
    state.achievements[id] = true;
    if (C.UI) {
      if (C.UI.toast) C.UI.toast(`成就解锁 · ${def.name}`, 'achievement', def.icon);
      if (C.UI.message) C.UI.message(`🏆 成就解锁：${def.name} — ${def.desc}`, 'achievement');
    }
    C.sound.play('achievement');
    return true;
  }

  function achievementList() {
    return Object.keys(DATA.ACHIEVEMENTS).map((id) => ({
      id,
      unlocked: !!state.achievements[id],
      ...DATA.ACHIEVEMENTS[id]
    }));
  }

  function checkBillionDebt() {
    if (state.day <= 3 && totalDebt() >= 1000000000) {
      unlock('billion_debt');
    }
  }

  function addStat(key, value) {
    if (typeof state.stats[key] !== 'number') state.stats[key] = 0;
    state.stats[key] += value;
  }

  function bumpStat(key, value) {
    state.stats[key] = Math.max(state.stats[key] || 0, value);
  }

  /* ---------- 日结算 ---------- */

  function processDay() {
    const lines = [];
    const matured = [];
    const remaining = [];

    for (const loan of state.loans) {
      loan.daysLeft -= 1;
      if (loan.daysLeft <= 0) matured.push(loan);
      else remaining.push(loan);
    }

    const dueItems = matured.map((loan) => ({
      loan,
      principal: loan.principal,
      interest: loanMaturityInterest(loan),
      due: loan.principal + loanMaturityInterest(loan)
    }));
    const totalDue = dueItems.reduce((sum, item) => sum + item.due, 0);

    if (totalDue > 0) {
      if (state.money >= totalDue) {
        state.money -= totalDue;
        state.loans = remaining;
        for (const item of dueItems) {
          lines.push({
            type: 'paid',
            text: `贷款到期：本金 ${util.fmt(item.principal)} + 利息 ${util.fmt(item.interest)}，已自动扣款 ${util.fmt(item.due)}。`
          });
        }
      } else {
        state.isBankrupt = true;
        lines.push({
          type: 'bankrupt',
          text: `贷款到期，应还 ${util.fmt(totalDue)}，但现金只有 ${util.fmt(state.money)}。`
        });
        lines.push({
          type: 'bankrupt',
          text: '催收的人踹开了门，你被洗劫一空……'
        });
        unlock('bankrupt');
      }
    } else {
      state.loans = remaining;
    }

    if (state.loans.length > 0) {
      lines.push({
        type: 'info',
        text: `未到期贷款 ${state.loans.length} 笔，当前本息合计 ${util.fmt(totalDebt())}。`
      });
    }

    return {
      lines,
      bankrupt: state.isBankrupt,
      totalDue,
      maturedCount: matured.length,
      changed: totalDue > 0 || matured.length > 0
    };
  }

  function netWorth() {
    return state.money - totalDebt();
  }

  C.State = {
    reset,
    diff,
    loanElapsed,
    loanAccrued,
    loanPayoff,
    loanMaturityInterest,
    totalDebt,
    totalPrincipal,
    weightedRate,
    planRate,
    borrow,
    repay,
    unlock,
    achievementList,
    checkBillionDebt,
    addStat,
    bumpStat,
    processDay,
    netWorth
  };
})(window.Casino = window.Casino || {});
