/* ============================================================
   赌徒模拟器 · 斗地主规则与 AI
   纯逻辑，不依赖 DOM。
   牌值：3..14 = 3..A，2 = 15，小王 = 16，大王 = 17
   ============================================================ */
(function (C) {
  'use strict';

  function valueOf(card) {
    if (card.joker) return card.value;
    if (card.rank === '2') return 15;
    return card.value;
  }

  function makeCombo(type, main, cards) {
    return {
      type,
      main,
      length: cards.length,
      cards: cards.slice()
    };
  }

  function isConsecutive(values) {
    if (!values.length) return false;
    for (let i = 1; i < values.length; i++) {
      if (values[i] !== values[i - 1] + 1) return false;
    }
    return true;
  }

  /**
   * 识别牌型。返回 null 表示不合法。
   */
  function analyze(cards) {
    if (!cards || !cards.length) return null;
    const vals = cards.map(valueOf).sort((a, b) => a - b);
    const n = vals.length;
    const counts = new Map();
    for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
    const groups = Array.from(counts.entries()).sort((a, b) => a[0] - b[0]);
    const unique = groups.map((g) => g[0]);
    const maxV = vals[n - 1];

    if (n === 2 && counts.get(16) === 1 && counts.get(17) === 1) {
      return makeCombo('rocket', 17, cards);
    }
    if (n === 4 && unique.length === 1) {
      return makeCombo('bomb', unique[0], cards);
    }
    if (n === 1) {
      return makeCombo('single', vals[0], cards);
    }
    if (n === 2 && unique.length === 1) {
      return makeCombo('pair', unique[0], cards);
    }
    if (n === 3 && unique.length === 1) {
      return makeCombo('triple', unique[0], cards);
    }
    if (n === 4) {
      const triple = groups.find((g) => g[1] === 3);
      if (triple) return makeCombo('triple_one', triple[0], cards);
    }
    if (n === 5) {
      const triple = groups.find((g) => g[1] === 3);
      const pair = groups.find((g) => g[1] === 2);
      if (triple && pair) return makeCombo('triple_pair', triple[0], cards);
    }

    // 顺子：至少 5 张，不能带 2 和王
    if (n >= 5 && unique.length === n && maxV <= 14 && isConsecutive(unique)) {
      return makeCombo('straight', maxV, cards);
    }
    // 连对：至少 3 对且连续
    if (n >= 6 && n % 2 === 0 && unique.length === n / 2 && maxV <= 14 &&
        groups.every((g) => g[1] === 2) && isConsecutive(unique)) {
      return makeCombo('double_straight', maxV, cards);
    }
    // 飞机：至少 2 个连续的三张（本作不带翅膀）
    if (n >= 6 && n % 3 === 0 && unique.length === n / 3 && maxV <= 14 &&
        groups.every((g) => g[1] === 3) && isConsecutive(unique)) {
      return makeCombo('plane', maxV, cards);
    }
    return null;
  }

  function beats(combo, last) {
    if (!combo) return false;
    if (!last) return true;
    if (combo.type === 'rocket') return true;
    if (last.type === 'rocket') return false;
    if (combo.type === 'bomb' && last.type !== 'bomb') return true;
    if (last.type === 'bomb' && combo.type !== 'bomb') return false;
    if (combo.type !== last.type || combo.length !== last.length) return false;
    return combo.main > last.main;
  }

  function groupHand(hand) {
    const map = new Map();
    for (const card of hand) {
      const v = valueOf(card);
      if (!map.has(v)) map.set(v, []);
      map.get(v).push(card);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]).map(([value, cards]) => ({ value, cards }));
  }

  function lowestSingle(groups, excludeValue, allowJoker) {
    let best = null;
    for (const group of groups) {
      if (group.value === excludeValue) continue;
      if (!allowJoker && group.value >= 16) continue;
      if (!best) best = group.cards[0];
      if (group.value < 15) return group.cards[0];
    }
    return best;
  }

  function lowestPair(groups, excludeValue) {
    for (const group of groups) {
      if (group.value === excludeValue) continue;
      if (group.value >= 16) continue;
      if (group.cards.length >= 2) return group.cards.slice(0, 2);
    }
    return null;
  }

  function findRuns(groups, runLength, minHigh, perValue) {
    const byValue = new Map(groups.map((g) => [g.value, g.cards]));
    const result = [];
    for (let start = 3; start + runLength - 1 <= 14; start++) {
      const high = start + runLength - 1;
      if (high <= minHigh) continue;
      let ok = true;
      const cards = [];
      for (let v = start; v <= high; v++) {
        const list = byValue.get(v);
        if (!list || list.length < perValue) { ok = false; break; }
        cards.push(...list.slice(0, perValue));
      }
      if (ok) result.push(cards);
    }
    return result;
  }

  function findFollowMoves(hand, last) {
    if (!last) return [];
    const groups = groupHand(hand);
    const moves = [];
    const seen = new Set();
    const push = (cards) => {
      const combo = analyze(cards);
      if (!combo || !beats(combo, last)) return;
      const key = combo.type + ':' + combo.main + ':' + combo.length + ':' + cards.map((c) => c.uid || c.suit + c.rank).sort().join(',');
      if (seen.has(key)) return;
      seen.add(key);
      moves.push(combo);
    };

    switch (last.type) {
      case 'single':
        for (const g of groups) if (g.value > last.main) push([g.cards[0]]);
        break;
      case 'pair':
        for (const g of groups) if (g.value > last.main && g.cards.length >= 2) push(g.cards.slice(0, 2));
        break;
      case 'triple':
        for (const g of groups) if (g.value > last.main && g.cards.length >= 3) push(g.cards.slice(0, 3));
        break;
      case 'triple_one':
        for (const g of groups) {
          if (g.value <= last.main || g.cards.length < 3) continue;
          const kicker = lowestSingle(groups, g.value, true);
          if (kicker) push([...g.cards.slice(0, 3), kicker]);
        }
        break;
      case 'triple_pair':
        for (const g of groups) {
          if (g.value <= last.main || g.cards.length < 3) continue;
          const pair = lowestPair(groups, g.value);
          if (pair) push([...g.cards.slice(0, 3), ...pair]);
        }
        break;
      case 'straight':
        for (const cards of findRuns(groups, last.length, last.main, 1)) push(cards);
        break;
      case 'double_straight':
        for (const cards of findRuns(groups, last.length / 2, last.main, 2)) push(cards);
        break;
      case 'plane':
        for (const cards of findRuns(groups, last.length / 3, last.main, 3)) push(cards);
        break;
      default:
        break;
    }

    // 炸弹可以压任何非炸弹；王炸压一切
    for (const g of groups) {
      if (g.cards.length === 4) push(g.cards.slice(0, 4));
    }
    const small = groups.find((g) => g.value === 16);
    const big = groups.find((g) => g.value === 17);
    if (small && big) push([small.cards[0], big.cards[0]]);

    return moves;
  }

  function generateLeadMoves(hand) {
    const groups = groupHand(hand);
    const moves = [];
    const seen = new Set();
    const push = (cards) => {
      const combo = analyze(cards);
      if (!combo) return;
      const key = combo.type + ':' + combo.main + ':' + combo.length + ':' + cards.map((c) => c.uid || c.suit + c.rank).sort().join(',');
      if (seen.has(key)) return;
      seen.add(key);
      moves.push(combo);
    };

    for (const g of groups) {
      push([g.cards[0]]);
      if (g.cards.length >= 2) push(g.cards.slice(0, 2));
      if (g.cards.length >= 3) push(g.cards.slice(0, 3));
      if (g.cards.length === 4) push(g.cards.slice(0, 4));
      if (g.cards.length >= 3) {
        const kicker = lowestSingle(groups, g.value, true);
        if (kicker) push([...g.cards.slice(0, 3), kicker]);
        const pair = lowestPair(groups, g.value);
        if (pair) push([...g.cards.slice(0, 3), ...pair]);
      }
    }

    // 所有长度的顺子 / 连对 / 飞机
    for (let len = 5; len <= 12; len++) {
      for (const cards of findRuns(groups, len, 0, 1)) push(cards);
    }
    for (let len = 3; len <= 10; len++) {
      for (const cards of findRuns(groups, len, 0, 2)) push(cards);
    }
    for (let len = 2; len <= 6; len++) {
      for (const cards of findRuns(groups, len, 0, 3)) push(cards);
    }

    const small = groups.find((g) => g.value === 16);
    const big = groups.find((g) => g.value === 17);
    if (small && big) push([small.cards[0], big.cards[0]]);

    return moves;
  }

  function comboValueCounts(combo, hand) {
    const handCounts = new Map();
    for (const card of hand) {
      const v = valueOf(card);
      handCounts.set(v, (handCounts.get(v) || 0) + 1);
    }
    return handCounts;
  }

  function breaksBomb(combo, hand) {
    if (combo.type === 'bomb' || combo.type === 'rocket') return false;
    const handCounts = comboValueCounts(combo, hand);
    const used = new Map();
    for (const card of combo.cards) {
      const v = valueOf(card);
      used.set(v, (used.get(v) || 0) + 1);
    }
    for (const [value, count] of used) {
      if (handCounts.get(value) === 4 && count < 4) return true;
    }
    return false;
  }

  function leadScore(combo, hand, ctx) {
    let score = 0;
    score -= combo.length * 100;
    score += combo.main * 1.2;
    if (combo.type === 'bomb') score += 950;
    if (combo.type === 'rocket') score += 1300;
    if (breaksBomb(combo, hand)) score += 260;
    if (combo.type === 'single' && combo.main >= 15) score += 90;
    if (combo.type === 'pair' && combo.main >= 15) score += 60;
    if (ctx && ctx.minOpponent <= 2) {
      if (combo.type === 'single') score -= combo.main * 9;
      else if (combo.type === 'pair') score -= combo.main * 3;
      else if (combo.length >= 4) score -= 70;
    }
    return score;
  }

  function followScore(combo, hand) {
    let score = combo.main;
    if (combo.type === 'bomb') score += 500;
    if (combo.type === 'rocket') score += 900;
    if (breaksBomb(combo, hand)) score += 120;
    return score;
  }

  function chooseLead(hand, ctx) {
    if (!hand.length) return null;
    const moves = generateLeadMoves(hand);
    if (!moves.length) return null;
    const finisher = moves.find((m) => m.length === hand.length && m.type !== 'rocket');
    if (finisher) return finisher;

    let best = null;
    let bestScore = Infinity;
    for (const move of moves) {
      if ((move.type === 'bomb' || move.type === 'rocket') && hand.length > 4) continue;
      const score = leadScore(move, hand, ctx);
      if (score < bestScore) {
        bestScore = score;
        best = move;
      }
    }
    if (best) return best;
    return moves[0];
  }

  function chooseFollow(hand, last, ctx, opts) {
    const moves = findFollowMoves(hand, last);
    if (!moves.length) return null;
    const force = opts && opts.force;
    const normal = moves.filter((m) => m.type !== 'bomb' && m.type !== 'rocket');
    if (normal.length) {
      let best = null;
      let bestScore = Infinity;
      for (const move of normal) {
        const score = followScore(move, hand);
        if (score < bestScore) {
          bestScore = score;
          best = move;
        }
      }
      return best;
    }
    const bombs = moves.slice().sort((a, b) => {
      const order = { bomb: 0, rocket: 1 };
      return (order[a.type] - order[b.type]) || (a.main - b.main);
    });
    if (force) return bombs[0];
    const threat = ctx && ctx.minOpponent <= 2;
    if (threat || hand.length <= 6 || Math.random() < 0.32) return bombs[0];
    return null;
  }

  function chooseMove(hand, last, ctx, opts) {
    if (!last) return chooseLead(hand, ctx);
    return chooseFollow(hand, last, ctx, opts);
  }

  C.DDZRules = {
    valueOf,
    analyze,
    beats,
    groupHand,
    findFollowMoves,
    generateLeadMoves,
    chooseLead,
    chooseFollow,
    chooseMove
  };
})(window.Casino = window.Casino || {});
