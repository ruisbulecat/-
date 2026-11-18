/* ============================================================
   赌徒模拟器 · 黑金油田（隐藏牌桌）
   致敬《石油大亨 / Turmoil》：租地、看地质、逐层下钻、赌油价。
   ============================================================ */
(function (C) {
  'use strict';

  const util = C.util;
  const State = C.State;
  const UI = C.UI;
  const DATA = C.DATA;
  const OIL = DATA.OIL;

  const STORAGE_KEY = 'casino.oilUnlocked';
  const SECRET_WORD = 'oil';
  const SIZE_NAMES = { 1: '小油层', 2: '油层', 3: '富油层' };

  let S = null;
  let unlocking = false;
  let secretBuffer = '';
  let footerClicks = 0;
  let footerTimer = null;
  let bound = false;

  /* ============================================================
     难度配置 / 纯逻辑（可在 Node 里单独测试）
     ============================================================ */

  function configFor(difficulty) {
    const d = DATA.DIFFICULTIES[difficulty] || DATA.DIFFICULTIES[2];
    return {
      difficulty: d.id,
      name: d.name,
      actions: d.actions || 3,
      oilCells: d.oilCells == null ? 8 : d.oilCells,
      treasureCells: d.oilTreasure == null ? 2 : d.oilTreasure,
      gasChance: d.oilGas == null ? 0.20 : d.oilGas,
      priceMul: d.oilPrice == null ? 1 : d.oilPrice,
      priceVol: d.oilVol == null ? 0.08 : d.oilVol,
      repairMul: d.oilRepair == null ? 1 : d.oilRepair,
      depthWeights: d.oilDepth || [0.15, 0.25, 0.30, 0.20, 0.10]
    };
  }

  function roll01(rng) {
    return (rng || Math.random)();
  }

  function weightedIndex(weights, rng) {
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = roll01(rng) * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll < 0) return i;
    }
    return weights.length - 1;
  }

  function sizeForDepth(row, rng) {
    const depth = row / Math.max(1, OIL.rows - 1);
    const roll = roll01(rng);
    if (depth < 0.45) return roll < 0.60 ? 1 : roll < 0.90 ? 2 : 3;
    if (depth < 0.75) return roll < 0.45 ? 1 : roll < 0.80 ? 2 : 3;
    return roll < 0.25 ? 1 : roll < 0.65 ? 2 : 3;
  }

  function treasureValue(row, rng) {
    const base = OIL.treasureMin + roll01(rng) * (OIL.treasureMax - OIL.treasureMin);
    return Math.round(base * (1 + row * 0.12) / 10) * 10;
  }

  /**
   * 生成一张油田：6 列 × 5 层。
   * 油层 / 遗物从一开始就可见；「?」是未知层，下钻时才判定岩层或瓦斯。
   * 每列保证至少一层油，避免出现完全无用的井。
   */
  function generateField(difficulty, rng) {
    const cfg = configFor(difficulty);
    const random = rng || Math.random;
    const cols = OIL.columns;
    const rows = OIL.rows;
    const field = [];
    for (let c = 0; c < cols; c++) {
      const col = [];
      for (let r = 0; r < rows; r++) col.push({ type: 'unknown' });
      field.push(col);
    }

    function putOil(c, row) {
      field[c][row] = { type: 'oil', size: sizeForDepth(row, random) };
    }

    for (let c = 0; c < cols; c++) putOil(c, weightedIndex(cfg.depthWeights, random));

    function takeFromPool(pool) {
      const total = pool.reduce((sum, item) => sum + item.weight, 0);
      let roll = random() * total;
      let index = 0;
      while (index < pool.length - 1) {
        roll -= pool[index].weight;
        if (roll < 0) break;
        index++;
      }
      return pool.splice(index, 1)[0];
    }

    const oilPool = [];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (field[c][r].type !== 'oil') oilPool.push({ c, r, weight: cfg.depthWeights[r] || 0.1 });
      }
    }
    let remaining = Math.max(0, cfg.oilCells - cols);
    while (remaining > 0 && oilPool.length > 0) {
      const pick = takeFromPool(oilPool);
      putOil(pick.c, pick.r);
      remaining--;
    }

    let placed = 0;
    const treasurePool = [];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (field[c][r].type === 'unknown') treasurePool.push({ c, r, weight: cfg.depthWeights[r] || 0.1 });
      }
    }
    while (placed < cfg.treasureCells && treasurePool.length > 0) {
      const pick = takeFromPool(treasurePool);
      field[pick.c][pick.r] = { type: 'treasure', value: treasureValue(pick.r, random) };
      placed++;
    }

    return field;
  }

  /** 未知层判定：深度越大，瓦斯风险略微上升。 */
  function resolveLayer(cfg, depth, rng) {
    const risk = Math.min(0.75, cfg.gasChance + Math.max(0, depth - 1) * 0.015);
    return roll01(rng) < risk ? 'gas' : 'rock';
  }

  function barrelsFor(size) {
    return OIL.barrels[Math.max(0, Math.min(3, size))] || 0;
  }

  function repairCost(cfg, depth) {
    const raw = (OIL.repairBase + Math.max(0, depth) * OIL.repairPerDepth) * cfg.repairMul;
    return Math.round(raw / 10) * 10;
  }

  function startPrice(cfg, rng) {
    const raw = OIL.basePrice * cfg.priceMul * (0.95 + roll01(rng) * 0.10);
    return Math.round(raw * 10) / 10;
  }

  function nextPrice(price, cfg, rng) {
    const raw = price * (1 + (roll01(rng) * 2 - 1) * cfg.priceVol);
    const floor = OIL.basePrice * OIL.priceFloor;
    const ceil = OIL.basePrice * OIL.priceCeil;
    return Math.round(util.clamp(raw, floor, ceil) * 10) / 10;
  }

  function sellValue(barrels, price) {
    return Math.round(Math.max(0, barrels) * Math.max(0, price));
  }

  /* ============================================================
     解锁 / 隐藏入口
     ============================================================ */

  function isUnlocked() {
    return C.storage.get(STORAGE_KEY, false) === true;
  }

  function unlock(source) {
    if (unlocking || isUnlocked()) return false;
    unlocking = true;
    C.storage.set(STORAGE_KEY, true);

    const state = C.state;
    const inRun = state.started && !state.gameOver && !state.isBankrupt;
    if (inRun) State.unlock('oil_secret');
    UI.refresh();
    C.sound.play('achievement');

    UI.modal({
      title: '地底下还有一层',
      icon: '🛢️',
      wide: true,
      html: `
        <p>你在账本夹层里翻到一张泛黄的租地契，落款是三十年前。</p>
        <p>电梯下到负三层，门开的时候，一股原油味扑面而来。墙上的老式压力表还在轻轻抖动——这里的井，从来没有真正关死过。</p>
        <p><strong>隐藏牌桌「黑金油田」已解锁。</strong>牌桌上会多出一张油井卡：租地、逐层下钻、赶在瓦斯喷出来之前把油卖出去。</p>
        <p class="oil-secret__hint">线索会留在荷官提示和玩法说明里。别告诉赌场经理。</p>
      `,
      confirmText: inRun ? '下井看看' : '记下了',
      cancelText: inRun ? '先回牌桌' : '关闭'
    }).then((ok) => {
      unlocking = false;
      if (ok && inRun && !C.state.inMinigame) {
        start({ free: true, source: source || 'secret' });
      } else {
        UI.toast('已解锁「黑金油田」，可在牌桌选择。', 'win', '🛢️');
      }
    });
    return true;
  }

  /** 键盘敲 oil、或连点页脚花色七次，都能把地下的井叫醒。 */
  function bindSecrets() {
    if (bound) return;
    bound = true;

    const footer = document.getElementById('footerSuits');
    if (footer) {
      footer.addEventListener('click', () => {
        if (isUnlocked() || UI.isPanelOpen() || document.querySelector('.modal-overlay')) return;
        footerClicks += 1;
        if (footerTimer) clearTimeout(footerTimer);
        footerTimer = setTimeout(() => { footerClicks = 0; }, 4000);
        if (footerClicks >= 7) {
          footerClicks = 0;
          if (footerTimer) clearTimeout(footerTimer);
          unlock('footer');
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!e.key || e.key.length !== 1) return;
      const target = e.target;
      const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (target && target.isContentEditable) return;
      if (UI.isPanelOpen() || document.querySelector('.modal-overlay')) return;
      secretBuffer = (secretBuffer + e.key.toLowerCase()).slice(-SECRET_WORD.length);
      if (secretBuffer === SECRET_WORD) {
        secretBuffer = '';
        unlock('typing');
      }
    });
  }

  /* ============================================================
     会话 / 牌桌
     ============================================================ */

  function start(options) {
    if (S) return;
    const opts = options || {};
    if (!isUnlocked()) {
      unlock(opts.source || 'direct');
      return;
    }
    if (!C.state.started) {
      UI.toast('先开一局，再下油田。', 'info');
      return;
    }
    if (!C.Game.beginActivity({
      action: opts.free ? 0 : 1,
      minMoney: OIL.minMoney,
      label: '黑金油田'
    })) return;

    State.unlock('oil_secret');

    S = {
      free: !!opts.free,
      phase: 'shop',
      busy: false,
      lockUntil: 0,
      cfg: configFor(C.state.difficulty),
      field: null,
      tank: 0,
      price: 0,
      prevPrice: 0,
      wellsLeft: OIL.wells,
      activeCol: null,
      depth: 0,
      colUsed: new Array(OIL.columns).fill(false),
      colBlown: new Array(OIL.columns).fill(false),
      colDrilled: new Array(OIL.columns).fill(0),
      wellOutput: 0,
      leaseCost: 0,
      leaseTreasure: 0,
      leaseRepair: 0,
      lastEvent: null,
      lastResult: null,
      sessionCost: 0,
      sessionGain: 0,
      sessionLeases: 0,
      timer: null
    };

    UI.openPanel({
      kicker: 'BLACK GOLD · OFF THE BOOKS',
      title: '黑金油田',
      subtitle: `${OIL.columns} 口井位 · 地下 ${OIL.rows} 层 · 油价每钻一层都会变。`,
      wide: true,
      body: '<div id="oilRoot"></div>',
      onClose: () => requestLeave(),
      onClosed: () => {
        if (S && S.timer) clearTimeout(S.timer);
        S = null;
        C.Game.endActivity();
      }
    });

    renderShop();
    UI.message(`=== 黑金油田 === 租一块地 ${util.fmt(OIL.lease)}，地下 ${OIL.rows} 层，钻到油是本事，活着卖出去才是钱。`, 'info');
  }

  function priceText(price) {
    return '$' + Number(price).toFixed(1);
  }

  function renderShop() {
    const root = document.getElementById('oilRoot');
    if (!S || !root) return;
    S.phase = 'shop';
    S.busy = false;
    const state = C.state;
    const canRent = state.money >= OIL.lease;

    root.innerHTML = `
      <div class="oil-shop">
        <div class="oil-shop__hero">
          <div class="oil-shop__rig" aria-hidden="true">
            <img src="assets/oil-rig.svg" alt="">
          </div>
          <div class="oil-shop__intro">
            <p class="eyebrow eyebrow--small">LEASE No.${String(state.day).padStart(2, '0')}</p>
            <h3>地下有油，但没人替你承担瓦斯。</h3>
            <p>先看地质图：亮着的是油层和遗物，"?" 可能是岩层，也可能是瓦斯。逐层下钻，随时可以收手。油罐里的油按<strong>当前油价</strong>结算，钻得越深，油价波动越大。</p>
          </div>
        </div>

        <div class="oil-facts">
          <div><span>租金</span><b>${util.fmt(OIL.lease)}</b></div>
          <div><span>井位</span><b>${OIL.wells} 口</b></div>
          <div><span>地层</span><b>${OIL.columns} × ${OIL.rows}</b></div>
          <div><span>瓦斯 / 层</span><b class="${S.cfg.gasChance >= 0.3 ? 'is-red' : ''}">${(S.cfg.gasChance * 100).toFixed(0)}%</b></div>
          <div><span>基准油价</span><b>$${OIL.basePrice}/桶</b></div>
          <div><span>难度</span><b>${S.cfg.name}</b></div>
        </div>

        <ul class="oil-rules">
          <li>油层先标在图上：数字代表规模，越深通常越大。</li>
          <li>点一口井的顶层开始下钻；每钻一层，油价随机波动。</li>
          <li>撞上瓦斯，本井原油全部烧掉，还要赔修井费。</li>
          <li>${OIL.wells} 口井用完或点“卖油收工”，就按当时油价结算整罐油。</li>
          <li>每钻一层瓦斯风险增加 1.5%；难度越高，风险与波动越大。</li>
        </ul>

        <div class="oil-shop__actions">
          <button class="btn btn--primary btn--lg" type="button" data-oil-rent ${canRent ? '' : 'disabled'}>
            租下这块地（${util.fmt(OIL.lease)}）
          </button>
          <button class="btn btn--ghost" type="button" data-oil-leave>离开油田</button>
        </div>

        <div class="oil-stats">
          <span>当前现金 <b>${util.fmt(state.money)}</b></span>
          <span>本场投入 <b>${util.fmt(S.sessionCost)}</b></span>
          <span>本场回收 <b>${util.fmt(S.sessionGain)}</b></span>
          <span>本场租约 <b>${S.sessionLeases}</b></span>
        </div>
      </div>
    `;

    const rentBtn = root.querySelector('[data-oil-rent]');
    if (rentBtn) rentBtn.addEventListener('click', rentLease);
    const leaveBtn = root.querySelector('[data-oil-leave]');
    if (leaveBtn) leaveBtn.addEventListener('click', () => UI.requestClose());
  }

  function rentLease() {
    if (!S || S.busy) return;
    if (C.state.money < OIL.lease) {
      UI.toast(`现金不足，租地需要 ${util.fmt(OIL.lease)}。`, 'lose');
      return;
    }

    C.state.money -= OIL.lease;
    S.sessionCost += OIL.lease;
    S.leaseCost = OIL.lease;
    S.leaseTreasure = 0;
    S.leaseRepair = 0;
    S.field = generateField(C.state.difficulty);
    S.tank = 0;
    S.price = startPrice(S.cfg);
    S.prevPrice = S.price;
    S.wellsLeft = OIL.wells;
    S.activeCol = null;
    S.depth = 0;
    S.colUsed = new Array(OIL.columns).fill(false);
    S.colBlown = new Array(OIL.columns).fill(false);
    S.colDrilled = new Array(OIL.columns).fill(0);
    S.wellOutput = 0;
    S.lastEvent = null;
    S.lastResult = null;
    S.phase = 'field';
    S.busy = false;

    C.sound.play('valve');
    UI.message(`租下油田，支付 ${util.fmt(OIL.lease)}。开钻时油价 ${priceText(S.price)}/桶。`, 'info');
    renderField();
  }

  function renderField() {
    const root = document.getElementById('oilRoot');
    if (!S || !root) return;
    S.phase = 'field';

    const trend = S.price > S.prevPrice ? 'up' : S.price < S.prevPrice ? 'down' : 'flat';
    const trendIcon = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '·';
    const active = S.activeCol;

    const columns = [];
    for (let c = 0; c < OIL.columns; c++) {
      const used = !!S.colUsed[c];
      const isActive = active === c;
      const drilled = isActive ? S.depth : (used ? S.colDrilled[c] : 0);
      const layers = [];

      for (let r = 0; r < OIL.rows; r++) {
        const cell = S.field[c][r];
        const isDrilled = r < drilled;
        const drillable = !used && (
          (isActive && r === S.depth) ||
          (active === null && r === 0)
        ) && S.wellsLeft > 0 && !S.busy;

        let kind;
        let body;
        if (isDrilled) {
          if (cell.type === 'oil') {
            kind = 'oil-hit';
            body = `<b>油</b><span>${barrelsFor(cell.size)} 桶</span>`;
          } else if (cell.type === 'treasure') {
            kind = 'treasure-hit';
            body = `<b>宝</b><span>${util.fmt(cell.value)}</span>`;
          } else if (cell.type === 'gas') {
            kind = 'gas';
            body = '<b>喷</b><span>瓦斯</span>';
          } else {
            kind = 'rock';
            body = '<b>岩</b><span>干层</span>';
          }
        } else if (cell.type === 'oil') {
          kind = 'oil';
          body = `<b>油</b><span>${'●'.repeat(cell.size)}</span>`;
        } else if (cell.type === 'treasure') {
          kind = 'treasure';
          body = '<b>宝</b><span>???</span>';
        } else {
          kind = 'unknown';
          body = '<b>?</b><span>未知</span>';
        }

        const classes = ['oil-cell', 'oil-cell--' + kind];
        if (isDrilled) classes.push('is-drilled');
        if (drillable) classes.push('is-drillable');
        if (isActive) classes.push('is-active');
        if (used) classes.push('is-locked');
        layers.push(`<button class="${classes.join(' ')}" type="button" data-oil-cell="${c}-${r}" ${drillable ? '' : 'disabled'} aria-label="第 ${c + 1} 口井第 ${r + 1} 层">${body}</button>`);
      }

      columns.push(`
        <div class="oil-col${isActive ? ' is-active' : ''}${used ? ' is-used' : ''}">
          <div class="oil-col__head">
            <strong>${c + 1} 号井</strong>
            <span>${used ? (S.colBlown[c] ? '已喷井' : '已收井') : isActive ? `钻探中 ${S.depth}/${OIL.rows}` : '待开钻'}</span>
          </div>
          <div class="oil-col__stack">${layers.join('')}</div>
        </div>
      `);
    }

    const derrick = active == null
      ? (S.wellsLeft > 0 ? '点任意一口井的顶层，把钻头放下去。' : '井位用尽，准备结算。')
      : `正在钻 ${active + 1} 号井第 ${S.depth + 1} 层 · 本井已抽出 ${S.wellOutput} 桶`;

    const event = S.lastEvent;
    const eventClass = event ? ' oil-status--' + event.type : '';

    const drillLabel = active == null ? '先点一口井' : `下钻第 ${Math.min(S.depth + 1, OIL.rows)} 层`;
    const canDrill = active != null && S.depth < OIL.rows && S.wellsLeft > 0 && !S.busy;
    const canStop = active != null && S.depth > 0 && !S.busy;

    root.innerHTML = `
      <div class="oil-hud">
        <div class="oil-stat"><span>现金</span><strong>${util.fmt(C.state.money)}</strong></div>
        <div class="oil-stat"><span>油罐</span><strong>${S.tank} 桶</strong></div>
        <div class="oil-stat"><span>当前油价</span><strong class="is-${trend}">${priceText(S.price)}<small>${trendIcon}</small></strong></div>
        <div class="oil-stat"><span>剩余井位</span><strong>${S.wellsLeft} / ${OIL.wells}</strong></div>
        <div class="oil-stat"><span>本井产出</span><strong>${S.wellOutput} 桶</strong></div>
      </div>

      <div class="oil-status${eventClass}">${event ? event.text : derrick}</div>

      <div class="oil-field">
        ${columns.join('')}
      </div>

      <div class="oil-controls">
        <button class="btn btn--primary" type="button" data-oil-drill ${canDrill ? '' : 'disabled'}>${drillLabel}</button>
        <button class="btn btn--ghost" type="button" data-oil-stop ${canStop ? '' : 'disabled'}>收井（${S.wellOutput} 桶）</button>
        <button class="btn btn--ghost" type="button" data-oil-sell ${S.busy ? 'disabled' : ''}>卖油收工</button>
        <button class="btn btn--ghost" type="button" data-oil-leave>离开油田</button>
      </div>

      <div class="oil-note">
        <span>瓦斯风险：每层 ${(S.cfg.gasChance * 100).toFixed(0)}% 起，越深越高</span>
        <span>租约已付 <b>${util.fmt(S.leaseCost)}</b></span>
        <span>油价波动 <b>±${(S.cfg.priceVol * 100).toFixed(0)}%</b>/层</span>
      </div>

      <div class="oil-stats">
        <span>本场投入 <b>${util.fmt(S.sessionCost)}</b></span>
        <span>本场回收 <b>${util.fmt(S.sessionGain)}</b></span>
        <span>本场租约 <b>${S.sessionLeases}</b></span>
      </div>
    `;

    root.querySelectorAll('[data-oil-cell]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const parts = btn.dataset.oilCell.split('-');
        drill(Number(parts[0]), Number(parts[1]));
      });
    });

    const drillBtn = root.querySelector('[data-oil-drill]');
    if (drillBtn) drillBtn.addEventListener('click', () => {
      if (active == null) {
        UI.toast('先点一口井的顶层。', 'info');
        return;
      }
      drill(active, S.depth);
    });
    const stopBtn = root.querySelector('[data-oil-stop]');
    if (stopBtn) stopBtn.addEventListener('click', stopWell);
    const sellBtn = root.querySelector('[data-oil-sell]');
    if (sellBtn) sellBtn.addEventListener('click', confirmSell);
    const leaveBtn = root.querySelector('[data-oil-leave]');
    if (leaveBtn) leaveBtn.addEventListener('click', () => UI.requestClose());
  }

  function drill(c, r) {
    if (!S || S.phase !== 'field' || S.busy) return;
    if (Date.now() < S.lockUntil) return;
    if (S.wellsLeft <= 0) return;

    if (S.activeCol === null) {
      if (r !== 0 || S.colUsed[c]) return;
      S.activeCol = c;
      S.depth = 0;
      S.wellOutput = 0;
      S.colUsed[c] = false;
    } else if (c !== S.activeCol || r !== S.depth) {
      return;
    }

    if (S.depth >= OIL.rows) return;
    S.busy = true;
    S.lockUntil = Date.now() + 180;

    const depth = S.depth + 1;
    S.depth = depth;
    const cell = S.field[c][depth - 1];

    if (cell.type === 'unknown') {
      cell.type = resolveLayer(S.cfg, depth);
    }

    if (cell.type === 'oil') {
      const barrels = barrelsFor(cell.size);
      S.wellOutput += barrels;
      C.state.stats.oilLayers += 1;
      S.lastEvent = {
        type: 'oil',
        text: `第 ${depth} 层：${SIZE_NAMES[cell.size]}！抽出 ${barrels} 桶，本井累计 ${S.wellOutput} 桶。`
      };
      C.sound.play('gusher');
      if (depth === OIL.rows) State.unlock('oil_deep');
    } else if (cell.type === 'treasure') {
      const value = Math.max(0, Number(cell.value) || 0);
      C.state.money += value;
      S.leaseTreasure += value;
      S.sessionGain += value;
      S.lastEvent = {
        type: 'treasure',
        text: `第 ${depth} 层：挖到一只旧钱箱，${util.fmt(value)} 直接进账。`
      };
      C.sound.play('win');
      UI.toast(`挖到遗物 ${util.fmt(value)}`, 'win', '💰');
    } else if (cell.type === 'gas') {
      S.lastEvent = {
        type: 'gas',
        text: `第 ${depth} 层：瓦斯！钻头刚碰到气袋，整口井就烧了起来。`
      };
    } else {
      S.lastEvent = {
        type: 'rock',
        text: `第 ${depth} 层是岩层，什么都没有。钻头还能再往下一点。`
      };
      C.sound.play('drill');
    }

    S.prevPrice = S.price;
    S.price = nextPrice(S.price, S.cfg);

    if (cell.type === 'gas') {
      finishWell(true);
      return;
    }
    if (depth >= OIL.rows) {
      finishWell(false);
      return;
    }

    S.busy = false;
    renderField();
  }

  function stopWell() {
    if (!S || S.phase !== 'field' || S.busy) return;
    if (S.activeCol === null || S.depth <= 0) return;
    finishWell(false);
  }

  function finishWell(blown) {
    if (!S || S.activeCol === null) return;
    const c = S.activeCol;
    const output = S.wellOutput;

    S.colDrilled[c] = S.depth;
    S.colUsed[c] = true;
    S.colBlown[c] = !!blown;

    if (blown) {
      const repair = repairCost(S.cfg, S.depth);
      const paid = Math.min(C.state.money, repair);
      C.state.money -= paid;
      S.leaseRepair += paid;
      S.sessionCost += paid;
      C.state.stats.oilBlowouts += 1;
      State.unlock('oil_blowout');
      State.bumpStat('maxCash', C.state.money);
      const lostText = output > 0 ? `本井 ${output} 桶原油全烧光` : '本井还没来得及出油';
      S.lastEvent = {
        type: 'gas',
        text: `瓦斯井喷！${lostText}，修井又赔了 ${util.fmt(paid)}。`
      };
      C.sound.play('blowout');
      UI.toast(`井喷！${output > 0 ? `${output} 桶原油归零` : '颗粒无收'}，修井 ${util.fmt(paid)}`, 'lose', '💥');
      UI.message(`${c + 1} 号井瓦斯井喷：${lostText}，修井费 ${util.fmt(paid)}。`, 'lose');
    } else {
      S.tank += output;
      S.lastEvent = output > 0
        ? { type: 'bank', text: `${c + 1} 号井收工，${output} 桶原油进了油罐。` }
        : { type: 'bank', text: `${c + 1} 号井打到底，一滴油也没有。` };
      C.sound.play('valve');
      UI.message(`${c + 1} 号井收工，${output} 桶原油入罐。油罐共 ${S.tank} 桶。`, output > 0 ? 'win' : 'warn');
    }

    S.activeCol = null;
    S.depth = 0;
    S.wellOutput = 0;
    S.wellsLeft = Math.max(0, S.wellsLeft - 1);
    S.busy = false;
    S.lockUntil = Date.now() + 160;

    if (S.wellsLeft <= 0) {
      S.busy = true;
      renderField();
      S.timer = setTimeout(() => {
        if (!S) return;
        S.busy = false;
        sell();
      }, 750);
    } else {
      renderField();
    }
  }

  function confirmSell() {
    if (!S || S.phase !== 'field' || S.busy) return;
    const barrels = S.tank + (S.activeCol != null ? S.wellOutput : 0);
    const value = sellValue(barrels, S.price);
    UI.modal({
      title: '卖油收工？',
      message: `油罐里的 <strong>${barrels}</strong> 桶油会按当前价 <strong>${priceText(S.price)}/桶</strong> 卖出，约 <strong>${util.fmt(value)}</strong>。本租约到此结束。`,
      confirmText: '卖油收工',
      cancelText: '再钻一层',
      icon: '🛢️'
    }).then((ok) => {
      if (ok && S && S.phase === 'field') sell();
    });
  }

  /** 结算本租约，返回明细；不负责渲染。 */
  function cashOut() {
    if (!S) return null;

    if (S.activeCol != null) {
      S.tank += S.wellOutput;
      S.colDrilled[S.activeCol] = S.depth;
      S.colUsed[S.activeCol] = true;
      S.activeCol = null;
      S.depth = 0;
      S.wellOutput = 0;
    }

    const barrels = S.tank;
    const payout = sellValue(barrels, S.price);
    C.state.money += payout;
    S.sessionGain += payout;
    S.sessionLeases += 1;

    const profit = payout + S.leaseTreasure - S.leaseCost - S.leaseRepair;
    C.state.stats.oilLeases += 1;
    C.state.stats.oilProfit += profit;
    C.state.stats.oilBarrels += barrels;
    State.bumpStat('oilBestLease', profit);
    State.bumpStat('maxCash', C.state.money);

    if (profit > 0) State.unlock('oil_first');
    if (profit >= 3000) State.unlock('oil_gusher');
    if (C.state.stats.oilProfit >= 20000) State.unlock('oil_baron');
    if (barrels === 0 && profit < 0) State.unlock('oil_dry');

    const summary = {
      barrels,
      price: S.price,
      payout,
      treasure: S.leaseTreasure,
      lease: S.leaseCost,
      repair: S.leaseRepair,
      profit
    };
    S.tank = 0;
    UI.refresh();
    return summary;
  }

  function sell() {
    if (!S || S.phase !== 'field') return;
    const result = cashOut();
    if (!result) return;
    S.phase = 'result';
    S.lastResult = result;

    C.sound.play(result.profit > 0 ? 'bigwin' : 'lose');
    UI.message(
      `卖油收工：${result.barrels} 桶 × ${priceText(result.price)} = ${util.fmt(result.payout)}，本租约净${result.profit >= 0 ? '赚' : '亏'} ${util.fmt(Math.abs(result.profit))}。`,
      result.profit >= 0 ? 'win' : 'lose'
    );
    if (result.profit < 0) UI.toast(`本租约亏损 ${util.fmt(Math.abs(result.profit))}`, 'lose', '🪨');
    renderResult(result);
  }

  function renderResult(result) {
    const root = document.getElementById('oilRoot');
    if (!S || !root) return;
    const state = C.state;
    const canRent = state.money >= OIL.lease;
    const totalProfit = state.stats.oilProfit;

    root.innerHTML = `
      <div class="oil-result ${result.profit >= 0 ? 'oil-result--win' : 'oil-result--loss'}">
        <p class="oil-result__eyebrow">LEASE CLOSED · ${S.cfg.name}</p>
        <div class="oil-result__value">${util.fmtSigned(result.profit)}</div>
        <div class="oil-result__label">本次租约盈亏</div>

        <div class="oil-result__rows">
          <div><span>卖油 ${result.barrels} 桶 × ${priceText(result.price)}</span><b class="is-gold">+${util.fmt(result.payout)}</b></div>
          <div><span>地下遗物</span><b class="is-gold">+${util.fmt(result.treasure)}</b></div>
          <div><span>租地成本</span><b class="is-red">-${util.fmt(result.lease)}</b></div>
          <div><span>修井 / 井喷</span><b class="is-red">-${util.fmt(result.repair)}</b></div>
        </div>

        <div class="oil-result__badges">
          <span>本场租约 <b>${S.sessionLeases}</b></span>
          <span>油田累计净赚 <b>${util.fmt(state.stats.oilProfit)}</b></span>
          <span>单租约最佳 <b>${util.fmt(state.stats.oilBestLease)}</b></span>
        </div>

        <div class="oil-result__actions">
          <button class="btn btn--primary" type="button" data-oil-again ${canRent ? '' : 'disabled'}>再租一块（${util.fmt(OIL.lease)}）</button>
          <button class="btn btn--ghost" type="button" data-oil-leave>离开油田</button>
        </div>

        <p class="oil-result__hint">
          ${totalProfit >= 20000 ? '油田已经成了你的提款机。赌场经理开始怀疑地下那层到底是谁的产业。'
            : canRent ? '油价永远在动，下一块地未必还有这么好的运气。'
            : '现金不够再租一块了。带着这笔钱回牌桌吧。'}
        </p>
      </div>
    `;

    const again = root.querySelector('[data-oil-again]');
    if (again) again.addEventListener('click', rentLease);
    const leave = root.querySelector('[data-oil-leave]');
    if (leave) leave.addEventListener('click', () => UI.requestClose());
  }

  function requestLeave() {
    if (!S) {
      UI.closePanel();
      return undefined;
    }
    if (S.phase !== 'field') {
      UI.closePanel();
      return undefined;
    }
    if (S.busy) return undefined;

    const barrels = S.tank + (S.activeCol != null ? S.wellOutput : 0);
    return UI.modal({
      title: '离开油田？',
      message: `油罐里还有 <strong>${barrels}</strong> 桶油。离开前会按当前价 <strong>${priceText(S.price)}/桶</strong> 卖掉，本租约立即结算。`,
      confirmText: '卖油离开',
      cancelText: '继续钻',
      icon: '🛢️'
    }).then((ok) => {
      if (!ok || !S) return;
      const result = cashOut();
      if (result) {
        UI.message(
          `离开油田，卖油 ${result.barrels} 桶，本租约净${result.profit >= 0 ? '赚' : '亏'} ${util.fmt(Math.abs(result.profit))}。`,
          result.profit >= 0 ? 'win' : 'lose'
        );
      }
      UI.closePanel();
    });
  }

  C.Oil = {
    start,
    unlock,
    isUnlocked,
    bindSecrets,
    isActive: () => !!S,
    configFor,
    generateField,
    resolveLayer,
    barrelsFor,
    repairCost,
    startPrice,
    nextPrice,
    sellValue,
    STORAGE_KEY
  };
})(window.Casino = window.Casino || {});
