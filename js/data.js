/* ============================================================
   赌徒模拟器 · 静态配置
   所有可调参数集中在这里，方便平衡数值。
   ============================================================ */
(function (C) {
  'use strict';

  const SUITS = [
    { symbol: '♠', name: '黑桃', red: false },
    { symbol: '♥', name: '红桃', red: true },
    { symbol: '♣', name: '梅花', red: false },
    { symbol: '♦', name: '方块', red: true }
  ];

  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const RANK_VALUES = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
  };

  C.DATA = {
    SUITS,
    RANKS,
    RANK_VALUES,

    DIFFICULTIES: {
      1: {
        id: 1, name: '简单', tag: '新手友好', icon: '🌱', tone: 'green',
        desc: '每天 4 次行动，贷款利率 ×0.8；赌石高爆率，油田浅层富油、瓦斯也少。',
        actions: 4, loanRate: 0.8,
        stoneProb: 1.5, stonePay: 1.0, aiSkill: 0.85,
        oilCells: 10, oilTreasure: 3, oilGas: 0.14, oilPrice: 1.08,
        oilVol: 0.06, oilRepair: 0.7,
        oilDepth: [0.30, 0.30, 0.22, 0.12, 0.06]
      },
      2: {
        id: 2, name: '普通', tag: '标准体验', icon: '🎲', tone: 'gold',
        desc: '标准规则：每天 3 次行动，利率、牌桌 AI 和油田都取基准值。',
        actions: 3, loanRate: 1.0,
        stoneProb: 1.0, stonePay: 1.0, aiSkill: 1.0,
        oilCells: 8, oilTreasure: 2, oilGas: 0.20, oilPrice: 1.0,
        oilVol: 0.08, oilRepair: 1.0,
        oilDepth: [0.15, 0.25, 0.30, 0.20, 0.10]
      },
      3: {
        id: 3, name: '困难', tag: '老手挑战', icon: '🔥', tone: 'orange',
        desc: '每天 3 次行动，贷款利率 ×1.2；赌石更难涨，油田更深、瓦斯更多。',
        actions: 3, loanRate: 1.2,
        stoneProb: 0.75, stonePay: 1.3, aiSkill: 1.15,
        oilCells: 7, oilTreasure: 1, oilGas: 0.28, oilPrice: 0.9,
        oilVol: 0.11, oilRepair: 1.3,
        oilDepth: [0.05, 0.12, 0.28, 0.33, 0.22]
      },
      4: {
        id: 4, name: '地狱', tag: '九死一生', icon: '💀', tone: 'red',
        desc: '每天只有 2 次行动，贷款利率 ×1.4；爆率最低、牌桌最强、油田最凶。',
        actions: 2, loanRate: 1.4,
        stoneProb: 0.55, stonePay: 1.8, aiSkill: 1.30,
        oilCells: 6, oilTreasure: 1, oilGas: 0.36, oilPrice: 0.8,
        oilVol: 0.14, oilRepair: 1.6,
        oilDepth: [0.02, 0.06, 0.18, 0.34, 0.40]
      }
    },

    DAY_OPTIONS: [
      { days: 7, title: '7 天', desc: '短期豪赌', sub: '快进快出' },
      { days: 15, title: '15 天', desc: '中期经营', sub: '推荐' },
      { days: 30, title: '30 天', desc: '长期传奇', sub: '细水长流' }
    ],

    /* 赌石基础赔率：普通难度下期望值低于售价，庄家占优 */
    STONES: [
      {
        id: 'raw', name: '普通原石', price: 100, desc: '全赌料，皮壳一般，练手首选。',
        img: 'assets/jade-raw.svg', prob: 0.30, min: 120, max: 500,
        quality: '豆种', tag: '入门', accent: '#9db3a4'
      },
      {
        id: 'white', name: '白砂皮', price: 300, desc: '皮薄有松花，出糯种的机会不小。',
        img: 'assets/jade-white.svg', prob: 0.24, min: 500, max: 1600,
        quality: '糯种', tag: '进阶', accent: '#cfd8c8'
      },
      {
        id: 'black', name: '黑乌沙', price: 800, desc: '老坑黑皮，一刀冰种，一刀砖头。',
        img: 'assets/jade-black.svg', prob: 0.18, min: 1200, max: 5000,
        quality: '冰种', tag: '刺激', accent: '#6f8f84'
      },
      {
        id: 'king', name: '帝王料', price: 2000, desc: '极品老坑，神仙难断寸玉。',
        img: 'assets/jade-king.svg', prob: 0.12, min: 4000, max: 18000,
        quality: '帝王绿', tag: '豪赌', accent: '#59d69a'
      }
    ],

    /* 贷款：按天计息，到期一次性还本付息 */
    LOAN_PLANS: [
      { term: 3, rate: 5, name: '3 天', desc: '短期周转', tone: 'green' },
      { term: 7, rate: 7, name: '7 天', desc: '标准借贷', tone: 'gold' },
      { term: 15, rate: 10, name: '15 天', desc: '高风险长贷', tone: 'red' }
    ],

    POKER: {
      smallBlind: 10,
      bigBlind: 20,
      minBuyIn: 20,
      aiName: '铁面庄家',
      aiEmoji: '🤖'
    },

    /* 德州扑克场次：买入即带入上限，盲注随场次放大 */
    POKER_LEVELS: [
      { id: 'micro', name: '零钱场', buyIn: 20, sb: 1, bb: 2, icon: '🪙', desc: '20 买入 · 盲注 1 / 2', tone: 'green' },
      { id: 'low', name: '100 元场', buyIn: 100, sb: 5, bb: 10, icon: '💵', desc: '100 买入 · 盲注 5 / 10', tone: 'gold' },
      { id: 'mid', name: '500 元场', buyIn: 500, sb: 10, bb: 20, icon: '💴', desc: '500 买入 · 盲注 10 / 20', tone: 'gold' },
      { id: 'high', name: '1,000 元场', buyIn: 1000, sb: 20, bb: 40, icon: '💰', desc: '1,000 买入 · 盲注 20 / 40', tone: 'orange' },
      { id: 'vip', name: '10,000 元场', buyIn: 10000, sb: 100, bb: 200, icon: '👑', desc: '10,000 买入 · 盲注 100 / 200', tone: 'red' }
    ],

    /* 骗子酒馆：2-8 人自定义人数，剩最后一人获胜；只用 J-A + 两张万能牌 */
    LIAR: {
      ante: 250,
      minMoney: 250,
      lives: 2,
      handSize: 5,
      maxPlay: 3,
      houseCut: 0.1,
      ranks: ['J', 'Q', 'K', 'A'],
      decks: 2,
      wildcards: 2,
      echoMax: 3,
      minPlayers: 2,
      maxPlayers: 8,
      defaultPlayers: 4,
      avatars: ['🧑', '🎩', '💃', '🥃', '🕵️', '💋', '🤡', '🧔'],
      opponents: [
        { name: '老 K', emoji: '🎩' },
        { name: '阿珍', emoji: '💃' },
        { name: '醉汉', emoji: '🥃' },
        { name: '独眼杰克', emoji: '🕵️' },
        { name: '红发莉娜', emoji: '💋' },
        { name: '小丑', emoji: '🤡' },
        { name: '教父', emoji: '🧔' },
        { name: '哑巴', emoji: '😶' }
      ]
    },

    /* 牌桌聊天：文字长度 / 图片压缩 / 表情面板 */
    CHAT: {
      maxText: 300,
      maxHistory: 80,
      imageMaxSide: 560,
      imageQuality: 0.68,
      imageMaxChars: 180000,
      minIntervalMs: 450,
      emojis: [
        '😀', '😄', '😁', '😂', '🤣', '😊', '😉', '😎',
        '😏', '😅', '😭', '😡', '🤔', '😱', '🤫', '😴',
        '🥺', '😈', '🤡', '👻', '💀', '🤖', '🎩', '💃',
        '🕵️', '🧔', '🥃', '🍻', '🍺', '🍷', '🃏', '🎲',
        '🔥', '💥', '✨', '🎉', '❤️', '💔', '👍', '👎',
        '👏', '🙏', '🤝', '👀', '💯', '✅', '❓', '🤑'
      ]
    },

    /* 恶魔轮盘赌：2-4 人，实弹 / 空包 + 道具，最后活着的人赢 */
    ROULETTE: {
      ante: 250,
      minMoney: 250,
      maxHp: 4,
      startHp: 3,
      houseCut: 0.1,
      minPlayers: 2,
      maxPlayers: 4,
      defaultPlayers: 2,
      avatars: ['🧑', '😈', '🤖', '💀'],
      opponents: [
        { name: '恶魔', emoji: '😈' },
        { name: '机械师', emoji: '🤖' },
        { name: '掘墓人', emoji: '💀' }
      ],
      items: [
        { id: 'cig', name: '香烟', icon: '🚬', desc: '恢复 1 点生命' },
        { id: 'glass', name: '放大镜', icon: '🔍', desc: '查看当前弹壳' },
        { id: 'beer', name: '啤酒', icon: '🍺', desc: '退掉当前弹壳' },
        { id: 'cuffs', name: '手铐', icon: '⛓️', desc: '对手跳过下一回合' },
        { id: 'saw', name: '锯子', icon: '🪚', desc: '下一枪伤害 ×2' }
      ]
    },

    LAN: {
      maxPlayers: 8,
      pollMs: 700
    },

    DDZ: {
      baseBet: 100,
      minMoney: 200,
      opponents: [
        { name: '老 K', emoji: '🎩' },
        { name: '阿珍', emoji: '💃' }
      ]
    },

    /* 隐藏牌桌：黑金油田（致敬《石油大亨 / Turmoil》）——进入消耗 1 行动 */
    OIL: {
      lease: 250,
      minMoney: 250,
      wells: 3,
      columns: 6,
      rows: 5,
      basePrice: 60,
      treasureMin: 200,
      treasureMax: 800,
      barrels: [0, 3, 5, 8],       // 油层规模 1 / 2 / 3 对应的桶数
      repairBase: 80,              // 瓦斯井喷的基础修井费
      repairPerDepth: 40,          // 每多钻一层，修井费增加
      priceFloor: 0.55,            // 油价最低为基准价的 55%
      priceCeil: 1.6               // 油价最高为基准价的 160%
    },

    ACHIEVEMENTS: {
      first_win: { name: '开张了', desc: '在任意牌局中赢下第一笔。', icon: '🎉' },
      poker_win: { name: '牌桌猎手', desc: '在德州扑克中赢下一手牌。', icon: '♠' },
      poker_strong: { name: '牌型大师', desc: '以同花或更强的牌型赢下摊牌。', icon: '🃏' },
      ddz_win: { name: '地主克星', desc: '赢下一局斗地主。', icon: '👑' },
      stone_first: { name: '一刀见绿', desc: '第一次赌石切涨。', icon: '💚' },
      stone_king: { name: '一刀暴富', desc: '单次赌石切出价值 $20,000 以上的翡翠。', icon: '💎' },
      billion_debt: { name: '欠钱才是大爷', desc: '前 3 天内欠款达到 10 亿。', icon: '🏦' },
      bankrupt: { name: '老赖末路', desc: '无力偿还贷款，被高利贷洗劫一空。', icon: '💀' },
      no_debt: { name: '稳健投资', desc: '全程不借钱，最终净资产为正。', icon: '🛡️' },
      rich_50k: { name: '赌场传奇', desc: '最终净资产达到 $50,000。', icon: '🏆' },
      rich_1b: { name: '富可敌国', desc: '最终净资产达到 10 亿。', icon: '👑' },

      /* ---- 隐藏油田 ---- */
      oil_secret: {
        name: '钻井执照', desc: '第一次进入赌场地底的黑金油田。', icon: '🛢️', secret: true
      },
      oil_first: { name: '第一桶黑金', desc: '在一次油田租约中净赚一笔。', icon: '🛢️' },
      oil_gusher: { name: '井喷富翁', desc: '单次油田租约净赚 $3,000 以上。', icon: '🌋' },
      oil_baron: { name: '黑金大亨', desc: '油田累计净赚 $20,000。', icon: '🏭' },
      oil_deep: { name: '地心之油', desc: '从第五层深处抽出石油。', icon: '🕳️' },
      oil_dry: { name: '干井纪念', desc: '租约到期，一滴油都没抽到。', icon: '🪨' },
      oil_blowout: { name: '井喷现场', desc: '在油田遇上瓦斯井喷。', icon: '💥' },

      /* ---- 难度 ---- */
      clear_hard: { name: '硬骨头', desc: '在困难或更高难度下，以正的净资产收场。', icon: '🔥' },
      clear_hell: { name: '地狱归来', desc: '在地狱难度下，以正的净资产活着离开。', icon: '💀' },

      /* ---- 骗子酒馆 ---- */
      liar_win: { name: '酒馆常胜', desc: '赢下一局骗子酒馆。', icon: '🍻' },
      liar_bluff: { name: '弥天大谎', desc: '带着至少一次诈唬赢下骗子酒馆。', icon: '🤥' },
      liar_flawless: { name: '一滴血都没掉', desc: '满血赢下一局骗子酒馆。', icon: '🛡️', secret: true },
      liar_echo: { name: '回响不绝', desc: '在回响模式下赢下一局骗子酒馆。', icon: '🔁', secret: true },

      /* ---- 恶魔轮盘赌 ---- */
      roulette_win: { name: '与恶魔对赌', desc: '赢下一局恶魔轮盘赌。', icon: '🔫' },
      roulette_last: { name: '最后一枪', desc: '只剩 1 点生命时赢下恶魔轮盘赌。', icon: '💀', secret: true },
      roulette_saw: { name: '锯短了', desc: '用锯子打出双倍伤害并赢下这一局。', icon: '🪚', secret: true },

      /* ---- 局域网 ---- */
      lan_first: { name: '局域网来客', desc: '完成第一局局域网联机游戏。', icon: '📡', secret: true },
      lan_win: { name: '局域网之王', desc: '在局域网联机中赢下一局。', icon: '👑', secret: true },
      lan_host: { name: '开房的人', desc: '作为房主在局域网里开出一局游戏。', icon: '🔑', secret: true },

      /* ---- 高额德州 ---- */
      poker_high_roller: { name: '万元桌的客人', desc: '在 10,000 元场赢下一手德州扑克。', icon: '💎', secret: true }
    },

    STREET_NAMES: ['翻牌前', '翻牌圈', '转牌圈', '河牌圈', '摊牌']
  };
})(window.Casino = window.Casino || {});
