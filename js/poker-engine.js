/* ============================================================
   赌徒模拟器 · 德州扑克牌力引擎
   纯逻辑，不依赖 DOM，可单独测试。
   ============================================================ */
(function (C) {
  'use strict';

  const CAT_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];
  const RANK_NAMES = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

  function rankName(v) {
    return RANK_NAMES[v] || String(v);
  }

  function straightHigh(uniqueDesc) {
    const set = new Set(uniqueDesc);
    for (let high = 14; high >= 5; high--) {
      if (set.has(high) && set.has(high - 1) && set.has(high - 2) && set.has(high - 3) && set.has(high - 4)) {
        return high;
      }
    }
    if (set.has(14) && set.has(5) && set.has(4) && set.has(3) && set.has(2)) return 5;
    return 0;
  }

  function evaluate5(cards) {
    if (!cards || cards.length !== 5) return null;
    const values = cards.map((c) => c.value).sort((a, b) => b - a);
    const suits = cards.map((c) => c.suit);
    const flush = suits[0] !== 'JOKER' && suits.every((s) => s === suits[0]);

    const counts = new Map();
    for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    const unique = Array.from(counts.keys()).sort((a, b) => b - a);
    const groups = Array.from(counts.entries()).sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]));
    const high = unique.length === 5 ? straightHigh(unique) : 0;

    if (flush && high) return { cat: 8, ranks: [high], cards: cards.slice(), name: high === 14 ? '皇家同花顺' : '同花顺' };
    if (groups[0][1] === 4) {
      const quad = groups[0][0];
      const kicker = unique.find((v) => v !== quad);
      return { cat: 7, ranks: [quad, kicker], cards: cards.slice(), name: '四条' };
    }
    if (groups[0][1] === 3 && groups[1] && groups[1][1] >= 2) {
      return { cat: 6, ranks: [groups[0][0], groups[1][0]], cards: cards.slice(), name: '葫芦' };
    }
    if (flush) return { cat: 5, ranks: values.slice(), cards: cards.slice(), name: '同花' };
    if (high) return { cat: 4, ranks: [high], cards: cards.slice(), name: '顺子' };
    if (groups[0][1] === 3) {
      const trip = groups[0][0];
      const kickers = unique.filter((v) => v !== trip).sort((a, b) => b - a);
      return { cat: 3, ranks: [trip, ...kickers], cards: cards.slice(), name: '三条' };
    }
    if (groups[0][1] === 2 && groups[1] && groups[1][1] === 2) {
      const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
      const kicker = unique.find((v) => v !== pairs[0] && v !== pairs[1]);
      return { cat: 2, ranks: [pairs[0], pairs[1], kicker], cards: cards.slice(), name: '两对' };
    }
    if (groups[0][1] === 2) {
      const pair = groups[0][0];
      const kickers = unique.filter((v) => v !== pair).sort((a, b) => b - a);
      return { cat: 1, ranks: [pair, ...kickers], cards: cards.slice(), name: '一对' };
    }
    return { cat: 0, ranks: values.slice(), cards: cards.slice(), name: '高牌' };
  }

  function compare(a, b) {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    if (a.cat !== b.cat) return a.cat - b.cat;
    for (let i = 0; i < Math.max(a.ranks.length, b.ranks.length); i++) {
      const av = a.ranks[i] || 0;
      const bv = b.ranks[i] || 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  }

  function evaluate7(cards) {
    if (!cards || cards.length < 5) return null;
    if (cards.length === 5) return evaluate5(cards);
    let best = null;
    const n = cards.length;
    // 7 选 5 的暴力枚举，最多 21 种，稳定且足够快
    for (let a = 0; a < n - 4; a++) {
      for (let b = a + 1; b < n - 3; b++) {
        for (let c = b + 1; c < n - 2; c++) {
          for (let d = c + 1; d < n - 1; d++) {
            for (let e = d + 1; e < n; e++) {
              const ev = evaluate5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
              if (!best || compare(ev, best) > 0) best = ev;
            }
          }
        }
      }
    }
    return best;
  }

  function describe(ev) {
    if (!ev) return '—';
    switch (ev.cat) {
      case 8:
        return ev.ranks[0] === 14 ? '皇家同花顺' : '同花顺 · ' + rankName(ev.ranks[0]) + ' 高';
      case 7:
        return '四条 ' + rankName(ev.ranks[0]);
      case 6:
        return '葫芦 · ' + rankName(ev.ranks[0]) + ' 带 ' + rankName(ev.ranks[1]);
      case 5:
        return '同花 · ' + rankName(ev.ranks[0]) + ' 高';
      case 4:
        return '顺子 · ' + rankName(ev.ranks[0]) + ' 高';
      case 3:
        return '三条 ' + rankName(ev.ranks[0]);
      case 2:
        return '两对 · ' + rankName(ev.ranks[0]) + ' / ' + rankName(ev.ranks[1]);
      case 1:
        return '一对 ' + rankName(ev.ranks[0]);
      default:
        return '高牌 ' + rankName(ev.ranks[0]);
    }
  }

  function preflopLabel(hole) {
    if (!hole || hole.length !== 2) return '—';
    const [a, b] = hole;
    if (a.value === b.value) return '口袋对子 ' + rankName(a.value);
    const suited = a.suit === b.suit;
    const gap = Math.abs(a.value - b.value);
    const high = Math.max(a.value, b.value);
    if (gap === 1) return (suited ? '同花连张' : '连张') + ' · ' + rankName(high) + ' 高';
    if (suited) return '同花牌 · ' + rankName(high) + ' 高';
    return '高牌 · ' + rankName(high) + ' 高';
  }

  function cardKey(card) {
    // 模拟牌堆是新建的，uid 与已知牌不同，必须按花色+点数排除已知牌
    return card.suit + '|' + card.rank;
  }

  /**
   * 蒙特卡洛胜率：已知手牌 + 公共牌，对抗 1 名随机对手。
   * 返回 0..1，平局算半胜。
   */
  function equity(hole, board, iterations) {
    const iters = Math.max(20, iterations || 140);
    if (!hole || hole.length !== 2) return 0.5;
    const known = new Set();
    for (const card of hole) known.add(cardKey(card));
    for (const card of board || []) known.add(cardKey(card));

    const pool = C.cards.create(false).filter((card) => !known.has(cardKey(card)));
    const needBoard = 5 - (board || []).length;
    const need = needBoard + 2;
    if (pool.length < need) return 0.5;

    let score = 0;
    const boardBase = (board || []).slice();

    for (let i = 0; i < iters; i++) {
      // 每轮重新洗牌，保证样本独立
      for (let k = pool.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        const tmp = pool[k];
        pool[k] = pool[j];
        pool[j] = tmp;
      }
      const runout = boardBase.concat(pool.slice(0, needBoard));
      const oppHole = [pool[needBoard], pool[needBoard + 1]];
      const mine = evaluate7(hole.concat(runout));
      const theirs = evaluate7(oppHole.concat(runout));
      const cmp = compare(mine, theirs);
      if (cmp > 0) score += 1;
      else if (cmp === 0) score += 0.5;
    }
    return score / iters;
  }

  C.PokerEngine = {
    CAT_NAMES,
    rankName,
    evaluate5,
    evaluate7,
    compare,
    describe,
    preflopLabel,
    equity
  };
})(window.Casino = window.Casino || {});
