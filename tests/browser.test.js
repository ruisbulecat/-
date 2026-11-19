/* 浏览器交互冒烟测试：需要 Chrome 以 --remote-debugging-port=9222 启动 */
'use strict';

const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  let list;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/list');
      list = await res.json();
      if (list.length) break;
    } catch (e) { /* retry */ }
    await sleep(300);
  }
  if (!list || !list.length) throw new Error('Chrome devtools endpoint not ready');

  const page = list.find((p) => p.type === 'page' && p.url.includes('index.html')) || list.find((p) => p.type === 'page');
  if (!page) throw new Error('No page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  let nextId = 1;
  const pending = new Map();
  const errors = [];
  const consoleErrors = [];

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value || a.description).join(' '));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push(msg.params.entry.text);
    }
  });

  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      const d = result.exceptionDetails;
      throw new Error('Evaluate failed: ' + ((d.exception && d.exception.description) || d.text));
    }
    return result.result.value;
  }

  async function waitFor(expression, timeout = 4000, interval = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await evaluate(expression)) return true;
      await sleep(interval);
    }
    return false;
  }

  async function shot(name) {
    const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const dir = path.resolve(__dirname, '..', 'shots');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cdp-' + name + '.png'), Buffer.from(result.data, 'base64'));
  }

  async function click(selector) {
    return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'missing'; el.click(); return 'ok'; })()`);
  }

  const checks = [];
  function check(name, cond, detail) {
    checks.push({ name, ok: !!cond, detail });
    console.log((cond ? '  ok  ' : 'FAIL  ') + name + (cond || detail == null ? '' : '  -> ' + JSON.stringify(detail)));
  }

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  await sleep(300);
  await waitFor('typeof Casino.UI === "object" && typeof Casino.Liar === "object"', 8000);

  check('page has Casino namespace', await evaluate('typeof Casino === "object"'));
  check('setup screen visible initially', await evaluate('!document.getElementById("setupScreen").classList.contains("hidden")'));
  await evaluate('localStorage.removeItem("casino.oilUnlocked"); Casino.UI.refresh();');
  check('hidden oil card starts hidden', await evaluate('document.getElementById("btnOil").classList.contains("hidden")'));
  await shot('setup');

  // ---------- 难度差异 ----------
  await click('[data-diff="4"]');
  await sleep(120);
  check('difficulty matrix renders', (await evaluate('document.getElementById("diffMatrix").innerText')).includes('每日行动'));
  check('hell difficulty shows 2 actions', (await evaluate('document.getElementById("dailyActionsNote").textContent')).includes('2 次'));
  check('difficulty matrix has hell loan multiplier', (await evaluate('document.getElementById("diffMatrix").innerText')).includes('×1.4'));
  await click('[data-diff="2"]');
  await sleep(120);
  check('normal difficulty restores 3 actions', (await evaluate('document.getElementById("dailyActionsNote").textContent')).includes('3 次'));

  await click('#helpBtn');
  await sleep(250);
  check('help modal opens', await evaluate('!!document.querySelector(".modal--wide")'));
  check('help modal has content', (await evaluate('document.querySelector(".modal--wide .modal__body")?.innerText.length || 0')) > 100);
  await shot('help');
  await click('[data-modal-confirm]');
  await sleep(200);
  check('help modal closes', await evaluate('!document.querySelector(".modal-overlay")'));

  await evaluate('Casino.Game.startNewGame(2, 15)');
  await sleep(200);
  check('main screen visible after start', await evaluate('!document.getElementById("mainGame").classList.contains("hidden")'));
  check('hud shows 3 actions', (await evaluate('document.getElementById("hudActionsText").textContent')).includes('3 / 3'));
  check('no log placeholder once messages exist', (await evaluate('document.querySelectorAll(".log-empty").length')) === 0);
  await shot('main');

  // ---------- 赌石 ----------
  await click('#btnStone');
  await sleep(250);
  check('stone panel opens', await evaluate('!!document.querySelector("#stoneRoot")'));
  check('stone costs one action', (await evaluate('Casino.state.actions')) === 2);
  await shot('stone-shop');
  const beforeStone = await evaluate('Casino.state.money');
  await click('[data-stone-buy="raw"]');
  await sleep(1900);
  check('stone result renders', await evaluate('!!document.querySelector("[data-stone-shop]")'));
  const afterStone = await evaluate('Casino.state.money');
  const stoneCuts = await evaluate('Casino.state.stats.stoneCuts');
  check('stone cut recorded', stoneCuts === 1, stoneCuts);
  check('stone money changed by cut', afterStone !== beforeStone, { beforeStone, afterStone });
  check('stone continues without extra action', (await evaluate('Casino.state.actions')) === 2);
  await shot('stone-result');
  // 强制再切一刀切涨，用于验证切涨画面
  await evaluate('window.__origRandom = Math.random; Math.random = () => 0.01;');
  await click('[data-stone-again="raw"]');
  await evaluate('Math.random = window.__origRandom;');
  await sleep(1900);
  await shot('stone-win');
  await click('[data-stone-leave]');
  await sleep(200);
  check('stone panel closes', await evaluate('!document.querySelector("#stoneRoot")'));

  // ---------- 斗地主 ----------
  await click('#btnDoudizhu');
  await sleep(300);
  check('ddz panel opens', await evaluate('!!document.querySelector("#ddzRoot")'));
  check('ddz costs one action', (await evaluate('Casino.state.actions')) === 1);
  await shot('ddz-start');

  for (let i = 0; i < 12; i++) {
    const over = await evaluate('!!document.querySelector(".ddz-result")');
    if (over) break;
    const isPlayerTurn = await evaluate('!document.querySelector("[data-ddz-hint]")?.disabled');
    if (isPlayerTurn) {
      await click('[data-ddz-hint]');
      await sleep(80);
      const playDisabled = await evaluate('document.querySelector("[data-ddz-play]")?.disabled');
      if (!playDisabled) {
        await click('[data-ddz-play]');
        await sleep(400);
        continue;
      }
      await click('[data-ddz-pass]');
      await sleep(400);
    }
    await sleep(900);
  }
  check('ddz game reached a state without crash', await evaluate('!!document.querySelector("#ddzRoot")'));
  const ddzLog = await evaluate('document.getElementById("messageArea").innerText.slice(-1200)');
  check('ddz produced log lines', ddzLog.length > 20, ddzLog.length);
  await shot('ddz-mid');

  if (await evaluate('!!document.querySelector(".ddz-result")')) {
    await click('[data-ddz-leave]');
  } else {
    await evaluate('Casino.UI.requestClose()');
    await sleep(200);
    await click('[data-modal-confirm]');
  }
  await sleep(300);
  check('ddz panel closes', await evaluate('!document.querySelector("#ddzRoot")'));

  // ---------- 扑克 ----------
  await evaluate('Casino.state.actions = 3; Casino.UI.refresh()');
  await click('#btnPoker');
  await sleep(300);
  check('poker lobby opens', await evaluate('!!document.getElementById("pokerLobby")'));
  check('poker offers multiple stakes', (await evaluate('document.querySelectorAll("[data-poker-level]").length')) >= 5);
  check('poker lobby does not cost action', (await evaluate('Casino.state.actions')) === 3);
  await click('[data-poker-level="micro"]');
  await sleep(300);
  check('poker panel opens', await evaluate('!!document.querySelector("#pokerRoot")'));
  check('poker costs one action', (await evaluate('Casino.state.actions')) === 2);
  // 连续跟注/过牌，直到摊牌或需要新的操作
  for (let i = 0; i < 10; i++) {
    const over = await evaluate('!!document.querySelector(".poker-result")');
    if (over) break;
    const canCheck = await evaluate('!!document.querySelector("[data-poker=check]:not([disabled])")');
    if (canCheck) await click('[data-poker="check"]');
    else if (await evaluate('!!document.querySelector("[data-poker=call]:not([disabled])")')) await click('[data-poker="call"]');
    else await sleep(600);
    await sleep(1500);
  }
  check('poker produced a result', await evaluate('!!document.querySelector(".poker-result")'));
  const pokerLog = await evaluate('document.querySelector(".poker-feed")?.innerText || ""');
  check('poker log records actions', pokerLog.length > 10, pokerLog.length);
  await shot('poker-result');
  await click('[data-poker="leave"]');
  await sleep(300);
  check('poker panel closes', await evaluate('!document.querySelector("#pokerRoot")'));

  // ---------- 贷款 ----------
  const cashBeforeLoan = await evaluate('Casino.state.money');
  await click('#btnLoan');
  await sleep(250);
  check('loan panel opens', await evaluate('!!document.querySelector("#loanRoot")'));
  await shot('loan');
  await evaluate(`(() => { const i = document.getElementById('loanAmount'); i.value = 10000; i.dispatchEvent(new Event('input', { bubbles: true })); return i.value; })()`);
  await click('[data-loan-borrow="0"]');
  await sleep(350);
  check('loan adds cash', (await evaluate('Casino.state.money')) === cashBeforeLoan + 10000);
  check('loan debt is tracked', (await evaluate('Casino.State.totalDebt()')) >= 10000);
  check('loan does not consume action', (await evaluate('Casino.state.actions')) === 2);
  await click('[data-loan-close]');
  await sleep(300);
  check('loan panel closes', await evaluate('!document.querySelector("#loanRoot")'));

  // ---------- 隐藏油田 ----------
  const actionsBeforeOil = await evaluate('Casino.state.actions');
  await evaluate(`['o','i','l'].forEach((key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));`);
  await sleep(300);
  check('typing oil opens the secret modal', await evaluate('!!document.querySelector(".modal-overlay")'));
  await click('[data-modal-confirm]');
  await sleep(450);
  check('oil panel opens after discovery', await evaluate('!!document.querySelector("#oilRoot")'));
  check('oil discovery starts free', (await evaluate('Casino.state.actions')) === actionsBeforeOil, { actionsBeforeOil, now: await evaluate('Casino.state.actions') });
  check('oil card becomes visible', await evaluate('!document.getElementById("btnOil").classList.contains("hidden")'));
  check('oil secret achievement unlocks', await evaluate('!!Casino.state.achievements.oil_secret'));

  const cashBeforeOil = await evaluate('Casino.state.money');
  await click('[data-oil-rent]');
  await sleep(300);
  check('oil field renders six wells', (await evaluate('document.querySelectorAll(".oil-col").length')) === 6);
  check('oil rent is deducted', (await evaluate('Casino.state.money')) === cashBeforeOil - 250);
  await shot('oil-field');

  await evaluate('window.__origRandomOil = Math.random; Math.random = () => 0.99;');
  for (let r = 0; r < 5; r++) {
    await click(`[data-oil-cell="0-${r}"]`);
    await sleep(280);
  }
  await evaluate('Math.random = window.__origRandomOil;');
  check('oil drilling records oil layers', (await evaluate('Casino.state.stats.oilLayers')) >= 1, await evaluate('Casino.state.stats.oilLayers'));
  check('oil well is used up', (await evaluate('document.querySelectorAll(".oil-col.is-used").length')) >= 1);

  await click('[data-oil-sell]');
  await sleep(250);
  check('oil sell confirmation appears', await evaluate('!!document.querySelector(".modal-overlay")'));
  await click('[data-modal-confirm]');
  await sleep(400);
  check('oil result renders', await evaluate('!!document.querySelector(".oil-result")'));
  check('oil lease recorded', (await evaluate('Casino.state.stats.oilLeases')) === 1);
  check('oil barrels were sold', (await evaluate('Casino.state.stats.oilBarrels')) > 0, await evaluate('Casino.state.stats.oilBarrels'));
  await shot('oil-result');

  await click('[data-oil-leave]');
  await sleep(300);
  check('oil panel closes after result', await evaluate('!document.querySelector("#oilRoot")'));

  await click('#btnOil');
  await sleep(300);
  check('normal oil entry costs one action', (await evaluate('Casino.state.actions')) === actionsBeforeOil - 1);
  check('oil shop opens on paid entry', await evaluate('!!document.querySelector("#oilRoot")'));
  await click('[data-oil-leave]');
  await sleep(300);
  check('oil shop closes', await evaluate('!document.querySelector("#oilRoot")'));

  // ---------- 成就面板 ----------
  await click('#achieveBtn');
  await sleep(300);
  check('achievement panel opens', await evaluate('!!document.querySelector(".ach-panel")'));
  check('achievement panel lists achievements', (await evaluate('document.querySelector(".ach-panel")?.innerText.length || 0')) > 80);
  await click('[data-modal-confirm]');
  await sleep(200);

  // ---------- 骗子酒馆 / 恶魔轮盘赌（单人入座） ----------
  await evaluate('Casino.state.actions = 3; Casino.UI.refresh()');
  await click('#btnLiar');
  await sleep(300);
  check('liar lobby opens', await evaluate('!!document.getElementById("liarLobby")'));
  check('liar offers solo 2p and 4p', (await evaluate('document.querySelectorAll("[data-liar-solo]").length')) === 2);
  check('liar offers classic and echo modes', (await evaluate('document.querySelectorAll("[data-liar-mode]").length')) === 2);
  await click('[data-liar-solo="2"]');
  await sleep(600);
  check('liar table renders', await evaluate('!!document.querySelector(".liar-table")'));
  check('liar deals five cards', (await evaluate('document.querySelectorAll("[data-liar-card]").length')) === 5);
  check('liar costs one action', (await evaluate('Casino.state.actions')) === 2);
  await evaluate('Casino.UI.requestClose()');
  await sleep(250);
  check('liar forfeit confirmation appears', await evaluate('!!document.querySelector("[data-modal-confirm]")'));
  await click('[data-modal-confirm]');
  await sleep(400);
  check('liar panel closes', await evaluate('!document.querySelector("#liarRoot")'));
  check('liar game recorded', (await evaluate('Casino.state.stats.liarGames')) === 1);

  await evaluate('Casino.state.actions = 3; Casino.UI.refresh()');
  await click('#btnRoulette');
  await sleep(300);
  check('roulette lobby opens', await evaluate('!!document.getElementById("rouletteLobby")'));
  await click('[data-roulette-solo]');
  await sleep(600);
  check('roulette table renders', await evaluate('!!document.querySelector(".roulette-table")'));
  check('roulette shows shells and items', (await evaluate('document.querySelectorAll(".roulette-shell").length')) > 0);
  check('roulette costs one action', (await evaluate('Casino.state.actions')) === 2);
  await evaluate('Casino.UI.requestClose()');
  await sleep(250);
  check('roulette forfeit confirmation appears', await evaluate('!!document.querySelector("[data-modal-confirm]")'));
  await click('[data-modal-confirm]');
  await sleep(400);
  check('roulette panel closes', await evaluate('!document.querySelector("#rouletteRoot")'));
  check('roulette game recorded', (await evaluate('Casino.state.stats.rouletteGames')) === 1);

  // ---------- 结束一天 ----------
  const dayBefore = await evaluate('Casino.state.day');
  await click('#btnEndDay');
  await sleep(250);
  const modalOpen = await evaluate('!!document.querySelector("[data-modal-confirm]")');
  check('end day confirmation appears', modalOpen);
  if (modalOpen) await click('[data-modal-confirm]');
  await sleep(700);
  const dayAfter = await evaluate('Casino.state.day');
  check('day advances', dayAfter === dayBefore + 1, { dayBefore, dayAfter });
  check('actions reset to 3', (await evaluate('Casino.state.actions')) === 3);

  // ---------- 结局 ----------
  await evaluate('Casino.Game.endGame("time")');
  await sleep(300);
  check('ending screen visible', await evaluate('!document.getElementById("endingScreen").classList.contains("hidden")'));
  check('ending has a title', (await evaluate('document.querySelector(".ending__title")?.textContent || ""')).length > 0);
  await shot('ending');
  await click('#restartBtn');
  await sleep(200);
  check('restart returns to setup', await evaluate('!document.getElementById("setupScreen").classList.contains("hidden")'));
  check('restart resets displayed cash', (await evaluate('document.getElementById("topbarMoney").textContent')) === '$1,000');

  // ---------- 地狱难度确实更狠 ----------
  await click('[data-diff="4"]');
  await sleep(100);
  await click('#startGameBtn');
  await sleep(250);
  check('hell run starts with 2 actions', (await evaluate('document.getElementById("hudActionsText").textContent')).includes('2 / 2'));
  await click('#btnLoan');
  await sleep(250);
  check('hell loan shows 7% daily rate', (await evaluate('document.getElementById("loanRoot").innerText')).includes('日息 7%'));
  await click('[data-loan-close]');
  await sleep(250);

  await sleep(300);
  check('no runtime exceptions', errors.length === 0, errors);
  check('no console errors', consoleErrors.length === 0, consoleErrors);

  console.log('\n--- summary ---');
  const failed = checks.filter((c) => !c.ok);
  console.log(`passed ${checks.length - failed.length}/${checks.length}`);
  if (errors.length) console.log('exceptions:', errors);
  if (consoleErrors.length) console.log('console errors:', consoleErrors);
  ws.close();
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error('TEST HARNESS ERROR:', err);
  process.exit(2);
});
