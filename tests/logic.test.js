/* 纯逻辑测试：node tests/logic.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = global;

const root = path.resolve(__dirname, '..');
for (const file of ['js/data.js', 'js/core.js', 'js/state.js', 'js/poker-engine.js', 'js/doudizhu-rules.js', 'js/oil.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}

const C = global.Casino;
const Engine = C.PokerEngine;
const Rules = C.DDZRules;

let passed = 0;
let failed = 0;

function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log('  ok  ' + name);
  } else {
    failed++;
    console.error('FAIL  ' + name + (extra ? '  -> ' + extra : ''));
  }
}

function cardsFrom(str) {
  const deck = C.cards.create(false).concat([
    { uid: 'joker-s', suit: 'JOKER', suitName: '王', suitIdx: -1, rank: '小王', value: 16, red: false, joker: true },
    { uid: 'joker-b', suit: 'JOKER', suitName: '王', suitIdx: -1, rank: '大王', value: 17, red: true, joker: true }
  ]);
  return str.split(/\s+/).filter(Boolean).map((token) => {
    if (token === 'SJ') return deck.find((c) => c.rank === '小王');
    if (token === 'BJ') return deck.find((c) => c.rank === '大王');
    const suit = { S: '♠', H: '♥', C: '♣', D: '♦' }[token.slice(-1)];
    const rank = token.slice(0, -1);
    const found = deck.find((c) => c.suit === suit && c.rank === rank && !c.joker);
    if (!found) throw new Error('unknown card ' + token);
    return found;
  });
}

console.log('\n[Texas Hold\'em evaluator]');
{
  const royal = Engine.evaluate5(cardsFrom('AS KS QS JS 10S'));
  check('royal flush is category 8', royal && royal.cat === 8, royal && royal.cat);
  check('royal flush name', royal && Engine.describe(royal) === '皇家同花顺', royal && Engine.describe(royal));

  const wheel = Engine.evaluate5(cardsFrom('AS 2H 3D 4C 5S'));
  check('A2345 is a straight with high 5', wheel && wheel.cat === 4 && wheel.ranks[0] === 5, wheel && JSON.stringify(wheel.ranks));

  const full = Engine.evaluate5(cardsFrom('AS AH AD KC KS'));
  check('full house', full && full.cat === 6 && full.ranks[0] === 14 && full.ranks[1] === 13);

  const flush = Engine.evaluate5(cardsFrom('AS 9S 7S 4S 2S'));
  const straight = Engine.evaluate5(cardsFrom('9H 8C 7D 6S 5H'));
  check('flush beats straight', Engine.compare(flush, straight) > 0);

  const quads = Engine.evaluate5(cardsFrom('9S 9H 9D 9C AS'));
  check('quads', quads && quads.cat === 7 && quads.ranks[0] === 9);

  const twoPairA = Engine.evaluate5(cardsFrom('AS AH KD KC 2S'));
  const twoPairB = Engine.evaluate5(cardsFrom('AS AH QD QC KS'));
  check('two pair compares high pair then kicker', Engine.compare(twoPairA, twoPairB) > 0);

  const seven = Engine.evaluate7(cardsFrom('AS KS QS JS 10S 2H 3D'));
  check('7-card best is royal flush', seven && seven.cat === 8 && seven.ranks[0] === 14);

  const e1 = Engine.equity(cardsFrom('AS AH'), [], 220);
  const e2 = Engine.equity(cardsFrom('7S 2H'), [], 220);
  check('AA equity is high', e1 > 0.75 && e1 < 0.98, e1);
  check('72o equity is low', e2 > 0.2 && e2 < 0.45, e2);
}

console.log('\n[Dou Dizhu rules]');
{
  const t1 = Rules.analyze(cardsFrom('3S 3H 3D 4C'));
  check('333+4 is triple_one', t1 && t1.type === 'triple_one' && t1.main === 3, t1 && JSON.stringify(t1));

  const t2 = Rules.analyze(cardsFrom('3S 3H 3D 4C 4D'));
  check('333+44 is triple_pair', t2 && t2.type === 'triple_pair' && t2.main === 3);

  const t3 = Rules.analyze(cardsFrom('3S 4H 5D 6C 7S'));
  check('34567 is straight', t3 && t3.type === 'straight' && t3.main === 7);

  const t4 = Rules.analyze(cardsFrom('10S JH QD KC AS'));
  check('10JQKA is straight', t4 && t4.type === 'straight' && t4.main === 14);

  const t5 = Rules.analyze(cardsFrom('JS QH KD AC 2S'));
  check('JQKA2 is not straight', t5 === null, JSON.stringify(t5));

  const t6 = Rules.analyze(cardsFrom('3S 3H 4D 4C 5S 5H'));
  check('334455 is double_straight', t6 && t6.type === 'double_straight' && t6.main === 5);

  const t7 = Rules.analyze(cardsFrom('3S 3H 3D 4C 4D 4H'));
  check('333444 is plane', t7 && t7.type === 'plane' && t7.main === 4);

  const bomb = Rules.analyze(cardsFrom('9S 9H 9D 9C'));
  const rocket = Rules.analyze(cardsFrom('SJ BJ'));
  const straight = Rules.analyze(cardsFrom('3S 4H 5D 6C 7S'));
  check('bomb beats straight', Rules.beats(bomb, straight));
  check('rocket beats bomb', Rules.beats(rocket, bomb));
  check('bomb cannot beat rocket', !Rules.beats(bomb, rocket));

  const a = Rules.analyze(cardsFrom('4S 4H 4D 3C'));
  const b = Rules.analyze(cardsFrom('3S 3H 3D AC'));
  check('triple_one compares triple, not kicker', Rules.beats(a, b));

  const shortStraight = Rules.analyze(cardsFrom('3S 4H 5D 6C 7S'));
  const longStraight = Rules.analyze(cardsFrom('4S 5H 6D 7C 8S 9H'));
  check('different straights lengths cannot beat each other', !Rules.beats(longStraight, shortStraight));

  // 随机牌堆上验证 AI 生成的每一手都合法
  let aiMoves = 0;
  let aiBad = 0;
  for (let i = 0; i < 400; i++) {
    const deck = C.util.shuffle(C.cards.create(true));
    const hand = deck.slice(0, 17 + (i % 4));
    const leads = Rules.generateLeadMoves(hand);
    for (const move of leads) {
      aiMoves++;
      if (!Rules.analyze(move.cards) || !move.cards.every((card) => hand.some((h) => h.uid === card.uid))) aiBad++;
    }
    const last = Rules.analyze(deck.slice(0, 1 + (i % 5)));
    if (last) {
      for (const move of Rules.findFollowMoves(hand, last)) {
        aiMoves++;
        if (!Rules.beats(move, last)) aiBad++;
      }
    }
  }
  check('AI generated moves are legal', aiBad === 0, aiBad + ' bad of ' + aiMoves);

  const hand = cardsFrom('3S 4H 5D 6C 7S 8H 9D 10C JS QH KD AS 2S SJ BJ');
  check('chooseLead returns a legal move', (() => {
    const move = Rules.chooseLead(hand, { minOpponent: 3 });
    return move && Rules.analyze(move.cards);
  })());

  const follow = Rules.chooseFollow(cardsFrom('4S 5H 6D 7C 8S 9H 10D JC QS KH AD'), Rules.analyze(cardsFrom('3S 3H 3D 4C 4D')), { minOpponent: 5 }, { force: true });
  check('chooseFollow returns null or a legal beating move', !follow || Rules.beats(follow, Rules.analyze(cardsFrom('3S 3H 3D 4C 4D'))));
}

console.log('\n[Loans / day settlement]');
{
  C.State.reset(2, 15);
  const state = C.state;
  const r = C.State.borrow(1000, 0); // 3 天，日息 5%
  check('borrow succeeds', r.ok);
  check('cash increases to 2000', state.money === 2000, state.money);
  check('debt equals principal right after borrowing', C.State.totalDebt() === 1000, C.State.totalDebt());

  C.State.processDay();
  check('after day 1, 2 days left', state.loans[0].daysLeft === 2);
  check('accrued interest after 1 day is 50', C.State.loanAccrued(state.loans[0]) === 50, C.State.loanAccrued(state.loans[0]));
  check('payoff is 1050', C.State.loanPayoff(state.loans[0]) === 1050, C.State.loanPayoff(state.loans[0]));

  C.State.processDay();
  check('after day 2, 1 day left', state.loans[0].daysLeft === 1);
  C.State.processDay();
  check('loan matures and is removed', state.loans.length === 0);
  check('full term interest 150 is deducted', state.money === 850, state.money);
  check('debt is zero', C.State.totalDebt() === 0);

  C.State.reset(2, 15);
  C.State.borrow(10000, 0);
  const bank = C.State.processDay();
  C.State.processDay();
  const final = C.State.processDay();
  check('insufficient cash triggers bankruptcy', final.bankrupt && C.state.isBankrupt, JSON.stringify(final));
}

console.log('\n[Difficulty]');
{
  C.State.reset(1, 15);
  check('easy grants 4 actions per day', C.state.maxActions === 4 && C.state.actions === 4, C.state.maxActions);
  check('easy loan rate 5% -> 4%', C.State.planRate(C.DATA.LOAN_PLANS[0]) === 4, C.State.planRate(C.DATA.LOAN_PLANS[0]));

  C.State.reset(2, 15);
  check('normal keeps 3 actions', C.state.maxActions === 3, C.state.maxActions);
  check('normal loan rate unchanged', C.State.planRate(C.DATA.LOAN_PLANS[0]) === 5);

  C.State.reset(3, 15);
  check('hard loan rate 5% -> 6%', C.State.planRate(C.DATA.LOAN_PLANS[0]) === 6, C.State.planRate(C.DATA.LOAN_PLANS[0]));
  const hardLoan = C.State.borrow(1000, 0);
  check('hard borrow stores effective rate', hardLoan.ok && C.state.loans[0].rate === 6, hardLoan.ok && C.state.loans[0].rate);

  C.State.reset(4, 15);
  check('hell grants only 2 actions per day', C.state.maxActions === 2, C.state.maxActions);
  check('hell loan rate 5% -> 7%', C.State.planRate(C.DATA.LOAN_PLANS[0]) === 7, C.State.planRate(C.DATA.LOAN_PLANS[0]));
  C.State.borrow(1000, 0);
  C.State.processDay();
  check('hell accrued interest after one day is 70', C.State.loanAccrued(C.state.loans[0]) === 70, C.State.loanAccrued(C.state.loans[0]));
}

console.log('\n[Oil field generation]');
{
  const Oil = C.Oil;
  const easy = Oil.configFor(1);
  const normal = Oil.configFor(2);
  const hard = Oil.configFor(3);
  const hell = Oil.configFor(4);

  check('difficulty orders oil abundance', easy.oilCells > normal.oilCells && normal.oilCells > hard.oilCells && hard.oilCells >= hell.oilCells, [easy.oilCells, normal.oilCells, hard.oilCells, hell.oilCells]);
  check('difficulty orders gas risk', easy.gasChance < normal.gasChance && normal.gasChance < hard.gasChance && hard.gasChance < hell.gasChance);
  check('difficulty orders oil price', easy.priceMul > normal.priceMul && normal.priceMul > hard.priceMul && hard.priceMul > hell.priceMul);

  function seeded(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function stats(field) {
    let oil = 0;
    let treasure = 0;
    let depthSum = 0;
    const perColumn = [];
    field.forEach((col) => {
      let columnOil = 0;
      col.forEach((cell, r) => {
        if (cell.type === 'oil') { oil++; columnOil++; depthSum += r + 1; }
        if (cell.type === 'treasure') treasure++;
      });
      perColumn.push(columnOil);
    });
    return { oil, treasure, depthSum, perColumn };
  }

  for (const diff of [1, 2, 3, 4]) {
    const field = Oil.generateField(diff, seeded(100 + diff));
    check(`field ${diff} has 6 columns x 5 layers`, field.length === 6 && field.every((col) => col.length === 5));
    const s = stats(field);
    const cfg = Oil.configFor(diff);
    check(`field ${diff} has exact oil count`, s.oil === cfg.oilCells, s.oil + ' vs ' + cfg.oilCells);
    check(`field ${diff} has exact treasure count`, s.treasure === cfg.treasureCells, s.treasure + ' vs ' + cfg.treasureCells);
    check(`field ${diff} gives every column oil`, s.perColumn.every((n) => n >= 1), s.perColumn);
  }

  // 退化随机源也不能让生成器卡死或漏放
  const degenerate0 = stats(Oil.generateField(4, () => 0));
  const degenerate1 = stats(Oil.generateField(1, () => 0.999));
  check('field generation is robust to rng=0', degenerate0.oil === 6 && degenerate0.treasure === 1);
  check('field generation is robust to rng~1', degenerate1.oil === 10 && degenerate1.treasure === 3);

  // 难度越高，油藏得越深（多个种子取平均）
  let easyDepth = 0;
  let hellDepth = 0;
  const rounds = 24;
  for (let i = 0; i < rounds; i++) {
    easyDepth += stats(Oil.generateField(1, seeded(1000 + i))).depthSum;
    hellDepth += stats(Oil.generateField(4, seeded(1000 + i))).depthSum;
  }
  check('hell oil sits deeper than easy oil', hellDepth > easyDepth, [easyDepth, hellDepth]);

  const cfgNormal = Oil.configFor(2);
  check('barrels map 3 / 5 / 8', Oil.barrelsFor(1) === 3 && Oil.barrelsFor(2) === 5 && Oil.barrelsFor(3) === 8);
  check('gas on low roll', Oil.resolveLayer(cfgNormal, 1, () => 0) === 'gas');
  check('rock on high roll', Oil.resolveLayer(cfgNormal, 1, () => 0.999) === 'rock');
  check('deeper layers are riskier', Oil.resolveLayer(cfgNormal, 5, () => 0.23) === 'gas' && Oil.resolveLayer(cfgNormal, 1, () => 0.23) === 'rock');
  check('deeper repair costs more', Oil.repairCost(Oil.configFor(4), 5) > Oil.repairCost(Oil.configFor(1), 5), [Oil.repairCost(Oil.configFor(4), 5), Oil.repairCost(Oil.configFor(1), 5)]);
  check('sell value rounds barrels x price', Oil.sellValue(7, 60.5) === 424, Oil.sellValue(7, 60.5));

  const hellCfg = Oil.configFor(4);
  check('start price respects difficulty multiplier', Math.abs(Oil.startPrice(hellCfg, () => 0.5) - 48) < 0.01, Oil.startPrice(hellCfg, () => 0.5));
  const up = Oil.nextPrice(48, hellCfg, () => 1);
  const down = Oil.nextPrice(48, hellCfg, () => 0);
  check('price stays within floor and ceiling', up <= 60 * 1.6 + 0.01 && down >= 60 * 0.55 - 0.01, [down, up]);

  check('secret oil achievement is hidden', C.DATA.ACHIEVEMENTS.oil_secret && C.DATA.ACHIEVEMENTS.oil_secret.secret === true);
  check('oil achievements exist', ['oil_first', 'oil_gusher', 'oil_baron', 'oil_deep', 'oil_dry', 'oil_blowout'].every((id) => !!C.DATA.ACHIEVEMENTS[id]));
  check('difficulty achievements exist', ['clear_hard', 'clear_hell'].every((id) => !!C.DATA.ACHIEVEMENTS[id]));
}

console.log('\n----------------------------------------');
console.log(`passed: ${passed}, failed: ${failed}`);
if (failed > 0) process.exit(1);
