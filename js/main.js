/* ============================================================
   赌徒模拟器 · 主程序
   开始界面、日程循环、主菜单、结局与初始化
   ============================================================ */
(function (C) {
  'use strict';

  const util = C.util;
  const State = C.State;
  const UI = C.UI;

  let selectedDifficulty = 2;
  let selectedDays = 15;
  let endingDay = false;

  /* ---------- 行动 / 牌局生命周期 ---------- */
  function beginActivity(opts) {
    const options = opts || {};
    const action = options.action == null ? 1 : options.action;
    const state = C.state;

    if (state.gameOver || state.isBankrupt) {
      UI.toast('牌局已经结束了。', 'lose');
      return false;
    }
    if (state.inMinigame) {
      UI.toast('你已经在牌桌上了。', 'info');
      return false;
    }
    if (action > 0 && state.actions < action) {
      UI.toast('今日行动次数已用完。', 'lose');
      UI.message('今日行动次数已用完，结束今天再继续。', 'warn');
      return false;
    }
    if (options.minMoney && state.money < options.minMoney) {
      UI.toast(`现金不足，至少需要 ${util.fmt(options.minMoney)}。`, 'lose');
      UI.message(`${options.label || '这个项目'}需要至少 ${util.fmt(options.minMoney)}，你现在的现金不够。`, 'warn');
      return false;
    }

    if (action > 0) {
      state.actions -= action;
    }
    state.inMinigame = true;
    UI.refresh();
    return true;
  }

  function endActivity() {
    C.state.inMinigame = false;
    UI.refresh();
  }

  /* ---------- 新游戏 / 重开 ---------- */
  function startNewGame(difficulty, days) {
    State.reset(difficulty, days);
    selectedDifficulty = C.state.difficulty;
    selectedDays = C.state.totalDays;

    UI.closePanel();
    UI.clearMessages();
    UI.showScreen('game');
    UI.refresh();

    const diff = State.diff();
    UI.headline(`第 1 天 · ${diff.name}模式 · ${C.state.totalDays} 天`);
    UI.message(`你带着 ${util.fmt(C.state.money)} 走进赌场。每天 ${C.state.maxActions} 次行动，${C.state.totalDays} 天后结算。`, 'system');
    UI.message('目标：在期限内尽可能赚钱，并在贷款到期前还清。点击桌上的项目开始。', 'info');
    UI.message('提示：先看看“银行贷款”的利息，再决定要不要借。', 'info');
    if (C.Oil && C.Oil.isUnlocked()) {
      UI.message('地下的黑金油田已经解锁：牌桌最下方多了一张油井卡，租金 $250，瓦斯会吃人。', 'info');
    }

    C.sound.play('deal');
  }

  function restart() {
    UI.closePanel();
    C.State.reset(selectedDifficulty, selectedDays);
    C.state.started = false;
    UI.showScreen('setup');
    UI.updateSetupSummary(selectedDifficulty, selectedDays);
    UI.updateBestRecord();
    UI.refresh();
  }

  /* ---------- 结束一天 ---------- */
  async function endDay() {
    const state = C.state;
    if (endingDay) return;
    if (state.gameOver || state.isBankrupt) return;
    if (state.inMinigame) {
      UI.toast('先结束桌上的牌局。', 'info');
      return;
    }

    if (state.actions > 0) {
      const ok = await UI.modal({
        title: '还有行动没用完',
        message: `你还有 <strong>${state.actions}</strong> 次行动。确定要直接结束今天吗？未使用的行动不会保留到明天。`,
        confirmText: '结束今天',
        cancelText: '再玩一会',
        icon: '🌙'
      });
      if (!ok) return;
    }

    endingDay = true;
    try {
      const result = State.processDay();
      state.daysLeft -= 1;

      UI.clearMessages();
      UI.headline(`第 ${state.day} 天结束`);
      for (const line of result.lines) {
        UI.message(line.text, line.type === 'bankrupt' ? 'lose' : line.type === 'paid' ? 'warn' : 'info');
      }

      if (result.bankrupt) {
        endGame('bankrupt');
        return;
      }
      if (state.daysLeft <= 0) {
        endGame('time');
        return;
      }

      state.day += 1;
      state.actions = state.maxActions;
      UI.refresh();
      UI.headline(`第 ${state.day} 天 · 牌桌重新开张`);
      UI.message(`新的一天，你有 ${state.maxActions} 次行动。现金 ${util.fmt(state.money)}，贷款本息 ${util.fmt(State.totalDebt())}。`, 'system');
      C.sound.play('deal');
    } finally {
      endingDay = false;
    }
  }

  /* ---------- 结局 ---------- */
  function endingFor(net, reason) {
    if (reason === 'bankrupt') {
      return {
        title: '老赖末路',
        eyebrow: 'THE HOUSE COLLECTED',
        narrative: '你没能还上那笔钱。催收的人踹开门时，你还在算下一把能不能翻本。后来你只记得走廊很长，灯很冷，手指很疼。赌博害人，切记，切记。'
      };
    }
    if (net < 0) {
      return {
        title: '负债累累',
        eyebrow: 'IN THE RED',
        narrative: '你输光了筹码，还欠了一屁股债。高利贷的追债人正在门外等你，而你已经想不起自己为什么要走进这家赌场。'
      };
    }
    if (net < 1000) {
      return {
        title: '亏损离场',
        eyebrow: 'A LOSS, BUT ALIVE',
        narrative: `你带着 ${util.fmt(net)} 的净资产离开了赌场，本金亏掉了 ${util.fmt(1000 - net)}。至少你还活着，而赌场最不缺的就是下一次机会。`
      };
    }
    if (net === 1000) {
      return {
        title: '全身而退',
        eyebrow: 'BREAK EVEN',
        narrative: '你勉强保住了本金，带着一身疲惫离开了赌场。没有赢，也没有输，这已经是大多数人求而不得的结局。'
      };
    }
    if (net < 3000) {
      return {
        title: '小赚一笔',
        eyebrow: 'A SMALL WIN',
        narrative: `你带着 ${util.fmt(net)} 的净资产离开，净赚 ${util.fmt(net - 1000)}。虽然不多，但至少这一趟没有白来。你告诉自己：见好就收。`
      };
    }
    if (net < 11000) {
      return {
        title: '满载而归',
        eyebrow: 'WELL PLAYED',
        narrative: `你把 ${util.fmt(net)} 装进口袋，净赚 ${util.fmt(net - 1000)}。赌场经理亲自送你出门，脸上的笑容恰到好处，眼神里却有一点不甘。`
      };
    }
    if (net < 51000) {
      return {
        title: '赌场常客',
        eyebrow: 'HIGH ROLLER',
        narrative: `你赢下了 ${util.fmt(net)}，净赚 ${util.fmt(net - 1000)}，已经算得上赌场里的一号人物。荷官开始记住你的脸，免费的酒也换了更好的年份。`
      };
    }
    if (net < 1000000) {
      return {
        title: '赌场传奇',
        eyebrow: 'LEGEND OF THE TABLE',
        narrative: `你狂赚 ${util.fmt(net - 1000)}！赌场里开始流传你的传说，连门口泊车的小弟都能讲出三个版本。`
      };
    }
    if (net < 1000000000) {
      return {
        title: '赌神降临',
        eyebrow: 'THE GOD OF GAMBLERS',
        narrative: `你带着 ${util.fmt(net)} 离开。赌场已经容不下你了，从此江湖上多了一个传说，而赌场多了一条新规矩：禁止你入内。`
      };
    }
    return {
      title: '富可敌国',
      eyebrow: 'THE HOUSE IS YOURS',
      narrative: `十亿。你数了三遍才确认自己没有看错。赌场老板亲自把大门钥匙放进你手里，声音有点发抖：“以后……这里您说了算。”`
    };
  }

  function endGame(reason) {
    const state = C.state;
    if (state.gameOver) return;
    state.gameOver = true;
    state.inMinigame = false;

    UI.closePanel();

    const debt = State.totalDebt();
    const net = state.money - debt;
    const profit = net - 1000;

    if (net >= 50000) State.unlock('rich_50k');
    if (net >= 1000000000) State.unlock('rich_1b');
    if (!state.everBorrowed && net > 0) State.unlock('no_debt');
    if (net > 0 && state.difficulty >= 3) State.unlock('clear_hard');
    if (net > 0 && state.difficulty === 4) State.unlock('clear_hell');

    const ending = endingFor(net, reason);
    const best = C.storage.get('casino.bestNet', null);
    if (typeof best !== 'number' || net > best) {
      C.storage.set('casino.bestNet', net);
    }
    UI.updateBestRecord();

    const achievements = State.achievementList();
    const unlocked = achievements.filter((a) => a.unlocked);
    const achievementHTML = UI.achievementHTML(achievements);

    const warning = debt > 0
      ? `<div class="ending__warning">你还有 ${util.fmt(debt)} 的贷款本息没有还清。这笔账不会因为游戏结束就消失。</div>`
      : '';

    document.getElementById('endingContent').innerHTML = `
      <p class="ending__eyebrow">${ending.eyebrow}</p>
      <h2 class="ending__title">${ending.title}</h2>
      <p class="ending__narrative">${ending.narrative}</p>
      <div class="ending__net ending__net--${profit >= 0 ? 'pos' : 'neg'}">${util.fmtSigned(profit)}</div>
      <div class="ending__net-label">最终盈亏 · 已扣除 $1,000 本金</div>
      <div class="ending__stats">
        <div class="ending__stat"><span>最终现金</span><strong class="is-gold">${util.fmt(state.money)}</strong></div>
        <div class="ending__stat"><span>未还贷款</span><strong class="${debt > 0 ? 'is-red' : ''}">${util.fmt(debt)}</strong></div>
        <div class="ending__stat"><span>最终净资产</span><strong class="${net < 0 ? 'is-red' : 'is-gold'}">${util.fmt(net)}</strong></div>
        <div class="ending__stat"><span>单刀最大</span><strong>${util.fmt(state.stats.maxSingleStoneWin)}</strong></div>
        <div class="ending__stat"><span>牌局胜场</span><strong>${state.stats.pokerWins + state.stats.ddzWins}</strong></div>
        <div class="ending__stat"><span>油田利润</span><strong class="${state.stats.oilProfit < 0 ? 'is-red' : state.stats.oilProfit > 0 ? 'is-gold' : ''}">${util.fmt(state.stats.oilProfit)}</strong></div>
        <div class="ending__stat"><span>原油产出</span><strong>${state.stats.oilBarrels} 桶</strong></div>
      </div>
      <div class="ending__achievements">
        <h3>成就 · ${unlocked.length} / ${achievements.length}</h3>
        <div class="achievement-wall">${achievementHTML}</div>
      </div>
      ${warning}
    `;

    UI.showScreen('ending');
    C.sound.play(profit > 0 ? 'bigwin' : 'lose');
  }

  /* ---------- 初始化 ---------- */
  function bindMenu() {
    document.getElementById('btnPoker').addEventListener('click', () => C.Poker.start());
    document.getElementById('btnStone').addEventListener('click', () => C.Stone.start());
    document.getElementById('btnDoudizhu').addEventListener('click', () => C.Doudizhu.start());
    document.getElementById('btnLoan').addEventListener('click', () => C.Loans.open());
    const oilBtn = document.getElementById('btnOil');
    if (oilBtn) oilBtn.addEventListener('click', () => C.Oil.start());
    document.getElementById('btnEndDay').addEventListener('click', endDay);
    document.getElementById('startGameBtn').addEventListener('click', () => startNewGame(selectedDifficulty, selectedDays));
    document.getElementById('restartBtn').addEventListener('click', restart);
    document.getElementById('brandHome').addEventListener('click', (e) => {
      e.preventDefault();
      if (C.state.gameOver) {
        restart();
        return;
      }
      if (C.state.started) {
        UI.modal({
          title: '回到开始界面？',
          message: '当前这局进度不会保存。确定要离开牌桌吗？',
          confirmText: '离开',
          cancelText: '继续玩',
          danger: true,
          icon: '♠'
        }).then((ok) => {
          if (ok) restart();
        });
      }
    });

    document.getElementById('difficultyButtons').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-diff]');
      if (!btn) return;
      selectedDifficulty = Number(btn.dataset.diff);
      UI.updateSetupSummary(selectedDifficulty, selectedDays);
      C.sound.play('click');
    });

    document.getElementById('daysButtons').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-days]');
      if (!btn) return;
      selectedDays = Number(btn.dataset.days);
      UI.updateSetupSummary(selectedDifficulty, selectedDays);
      C.sound.play('click');
    });
  }

  function boot() {
    UI.init();
    C.Oil.bindSecrets();
    bindMenu();
    UI.updateSetupSummary(selectedDifficulty, selectedDays);
    UI.updateBestRecord();
    UI.showScreen('setup');
    UI.refresh();

    // 开发预览钩子：?dev=main|poker|stone|ddz|loan|oil|ending
    const params = new URLSearchParams(window.location.search);
    const dev = params.get('dev');
    if (dev) {
      setTimeout(() => {
        startNewGame(2, 15);
        if (dev === 'poker') C.Poker.start();
        else if (dev === 'stone') C.Stone.start();
        else if (dev === 'ddz') C.Doudizhu.start();
        else if (dev === 'loan') C.Loans.open();
        else if (dev === 'oil') {
          C.storage.set(C.Oil.STORAGE_KEY, true);
          UI.refresh();
          C.Oil.start({ free: true });
        } else if (dev === 'ending') endGame('time');
      }, 120);
    }
  }

  C.Game = {
    beginActivity,
    endActivity,
    endDay,
    startNewGame,
    endGame,
    restart,
    boot
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.Casino = window.Casino || {});
