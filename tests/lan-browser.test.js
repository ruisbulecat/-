/* 局域网多人浏览器测试：自定义人数、三人同桌、文字 / 表情 / 图片聊天 */
'use strict';

const fs = require('fs');
const path = require('path');

const GAME_URL = process.env.GAME_URL || 'http://127.0.0.1:8787/index.html';
const DEVTOOLS = process.env.DEVTOOLS || 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let passed = 0;
let failed = 0;
const errors = [];

function check(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log('  ok  ' + name);
  } else {
    failed += 1;
    console.error('FAIL  ' + name + (extra == null ? '' : '  -> ' + JSON.stringify(extra)));
  }
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  let nextId = 1;
  const pending = new Map();
  const pageErrors = [];

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
      pageErrors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
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

  async function waitFor(expression, timeout = 6000, interval = 120) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await evaluate(expression)) return true;
      await sleep(interval);
    }
    return false;
  }

  async function click(selector) {
    const result = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'missing'; el.click(); return 'ok'; })()`);
    if (result !== 'ok') throw new Error('Missing selector: ' + selector);
    return result;
  }

  await send('Runtime.enable');
  await send('Page.enable');

  return { ws, evaluate, waitFor, click, pageErrors, send };
}

async function openPage(label) {
  const res = await fetch(`${DEVTOOLS}/json/new?${encodeURIComponent(GAME_URL)}`, { method: 'PUT' });
  if (!res.ok) throw new Error('Cannot create page: ' + res.status);
  const info = await res.json();
  const page = await connect(info.webSocketDebuggerUrl);
  page.id = info.id;
  page.label = label;
  const ready = await page.waitFor('typeof Casino === "object" && !!Casino.Lan', 10000);
  if (!ready) throw new Error(label + ' did not boot');
  await page.waitFor('document.readyState === "complete"', 6000);
  return page;
}

async function prepareLiarLobby(page, name) {
  await page.evaluate(`Casino.Lan.open('liar', { players: 3 })`);
  if (!(await page.waitFor('!!document.getElementById("lanLobby")', 6000))) throw new Error(page.label + ': lobby did not open');
  if (!(await page.waitFor('document.querySelector("#lanName") !== null', 4000))) throw new Error(page.label + ': name input missing');
  await page.evaluate(`(() => {
    const input = document.querySelector('#lanName');
    input.value = ${JSON.stringify(name)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function shot(page, name) {
  const result = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const dir = path.resolve(__dirname, '..', 'shots');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cdp-' + name + '.png'), Buffer.from(result.data, 'base64'));
}

async function main() {
  const pages = [];
  try {
    const host = await openPage('host');
    pages.push(host);
    await host.waitFor('document.querySelector("#lanLobby") === null', 4000);
    await prepareLiarLobby(host, '房主甲');
    await host.click('[data-lan-create]');

    const gotRoom = await host.waitFor('!!document.querySelector(".lan-room__code strong")', 8000);
    check('host creates a 3-player liar room', gotRoom);
    const code = await host.evaluate('document.querySelector(".lan-room__code strong").textContent.trim()');
    check('room code has four characters', /^[A-Z0-9]{4}$/.test(code), code);
    check('host room shows 1 / 3 players', (await host.evaluate('document.querySelector(".lan-room__game small").textContent')).includes('1 / 3'));

    const guestB = await openPage('guestB');
    pages.push(guestB);
    await prepareLiarLobby(guestB, '客人乙');
    await guestB.click('[data-lan-tab="join"]');
    await guestB.waitFor('!!document.querySelector("#lanCode")', 4000);
    await guestB.evaluate(`(() => {
      const input = document.querySelector('#lanCode');
      input.value = ${JSON.stringify(code)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-lan-join]').click();
    })()`);
    check('guest B joins the room', await guestB.waitFor('!!document.querySelector(".lan-room__code strong")', 8000));
    check('guest B sees host settings', (await guestB.evaluate('document.body.innerText')).includes('3 人局'));

    const guestC = await openPage('guestC');
    pages.push(guestC);
    await prepareLiarLobby(guestC, '客人丙');
    await guestC.click('[data-lan-tab="join"]');
    await guestC.waitFor('!!document.querySelector("#lanCode")', 4000);
    await guestC.evaluate(`(() => {
      const input = document.querySelector('#lanCode');
      input.value = ${JSON.stringify(code)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-lan-join]').click();
    })()`);
    check('guest C joins the room', await guestC.waitFor('!!document.querySelector(".lan-room__code strong")', 8000));

    check('host sees 3 / 3 players', await host.waitFor('(document.querySelector(".lan-room__game small") || {}).textContent === "3 / 3 人"', 6000));
    check('start button unlocks at three players', await host.waitFor('document.querySelector("[data-lan-start]") && !document.querySelector("[data-lan-start]").disabled', 5000));

    await host.click('[data-lan-start]');

    const tableReady = [];
    for (const page of pages) {
      tableReady.push(await page.waitFor('!!document.querySelector(".liar-table")', 9000));
    }
    check('all three players enter the liar table', tableReady.every(Boolean), tableReady);
    check('every table has the chat panel', (await Promise.all(pages.map((p) => p.evaluate('!!document.querySelector(".liar-chat__input")')))).every(Boolean));
    check('guest B is dealt five cards', (await guestB.evaluate('document.querySelectorAll("[data-liar-card]").length')) === 5);
    check('three-player table has two opponents', (await guestB.evaluate('document.querySelectorAll(".liar-opponent").length')) === 2);

    // ---- 文字聊天 ----
    await guestB.evaluate(`(() => {
      const input = document.querySelector('.liar-chat__input');
      input.value = '今晚谁先掀桌？🍻';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    check('text chat reaches the host', await host.waitFor('Array.from(document.querySelectorAll(".liar-chat__text")).some((el) => el.textContent.includes("今晚谁先掀桌"))', 6000));
    check('text chat reaches the third player', await guestC.waitFor('Array.from(document.querySelectorAll(".liar-chat__text")).some((el) => el.textContent.includes("今晚谁先掀桌"))', 6000));

    // ---- 表情聊天 ----
    await guestC.click('[data-chat-emoji]');
    await guestC.waitFor('!!document.querySelector("[data-chat-emoji-value=\\"🔥\\"]")', 3000);
    await guestC.evaluate(`document.querySelector('[data-chat-emoji-value="🔥"]').click()`);
    check('emoji is inserted into the composer', (await guestC.evaluate('document.querySelector(".liar-chat__input").value')).includes('🔥'));
    await guestC.click('[data-chat-send]');
    check('emoji chat reaches the host', await host.waitFor('Array.from(document.querySelectorAll(".liar-chat__text")).some((el) => el.textContent.includes("🔥"))', 6000));

    // ---- 图片聊天（本机 canvas 生成 PNG 后压缩发送）----
    await guestB.evaluate(`(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, 96, 64);
      gradient.addColorStop(0, '#c79bf0');
      gradient.addColorStop(1, '#0a2c21');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 96, 64);
      ctx.fillStyle = '#f8e6b3';
      ctx.font = '30px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♠', 48, 34);
      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          const file = new File([blob], 'chat-test.png', { type: 'image/png' });
          const transfer = new DataTransfer();
          transfer.items.add(file);
          const input = document.querySelector('.liar-chat__file');
          input.files = transfer.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          resolve(true);
        }, 'image/png');
      });
    })()`);
    check('picked image is compressed into a preview', await guestB.waitFor('!document.querySelector(".liar-chat__preview").classList.contains("hidden")', 6000));
    await guestB.click('[data-chat-send]');
    check('image chat reaches the host', await host.waitFor('document.querySelectorAll(".liar-chat__image").length > 0', 8000));
    check('image chat reaches the third player', await guestC.waitFor('document.querySelectorAll(".liar-chat__image").length > 0', 8000));

    const imageFits = await host.evaluate(`(() => {
      const img = document.querySelector('.liar-chat__image');
      return img ? img.getBoundingClientRect().width <= 320 : false;
    })()`);
    check('chat image is displayed at a compact size', imageFits);
    await host.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await host.evaluate(`(() => {
      const chat = document.querySelector('.liar-chat');
      if (chat && chat.classList.contains('is-collapsed')) chat.querySelector('[data-chat-toggle]').click();
      const toasts = document.getElementById('toastRoot');
      if (toasts) toasts.innerHTML = '';
    })()`);
    await sleep(350);
    await shot(host, 'liar-lan-chat');
    await host.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await host.evaluate(`(() => {
      const chat = document.querySelector('.liar-chat');
      if (chat) chat.scrollIntoView({ block: 'start' });
    })()`);
    await sleep(350);
    await shot(host, 'liar-lan-chat-mobile');
    await host.send('Emulation.clearDeviceMetricsOverride');
    await host.click('.liar-chat__image');
    check('chat image opens a lightbox', await host.waitFor('!!document.querySelector(".chat-lightbox img")', 3000));
    await host.click('.chat-lightbox__close');
    check('chat image lightbox closes', await host.waitFor('!document.querySelector(".chat-lightbox")', 3000));

    // ---- 游戏操作同步 ----
    let turnPage = null;
    for (const page of pages) {
      const active = await page.evaluate('document.querySelectorAll("[data-liar-card]:not(:disabled)").length > 0');
      if (active) {
        turnPage = page;
        break;
      }
    }
    check('one player has an active turn', !!turnPage);
    if (turnPage) {
      await turnPage.evaluate(`(() => {
        const card = document.querySelector('[data-liar-card]:not(:disabled)');
        card.click();
        document.querySelector('[data-liar="play"]').click();
      })()`);
      check('an in-game play propagates to the host', await host.waitFor('!!document.querySelector(".liar-claim strong")', 6000));
    }

    check('no runtime exceptions in the multiplayer run', pages.every((p) => p.pageErrors.length === 0), pages.map((p) => p.pageErrors).flat());
  } finally {
    for (const page of pages) {
      try { page.ws.close(); } catch (e) { /* ignore */ }
      try { await fetch(`${DEVTOOLS}/json/close/${page.id}`); } catch (e) { /* ignore */ }
    }
  }

  console.log('\n----------------------------------------');
  console.log(`passed: ${passed}, failed: ${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
