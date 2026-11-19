/* 局域网服务器接口测试：房间人数、配置同步、聊天中继与校验 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8800 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_KIND = process.env.LAN_SERVER === 'python' ? 'python' : 'node';
const SERVER_COMMAND = SERVER_KIND === 'python' ? (process.env.PYTHON || 'python') : process.execPath;
const SERVER_SCRIPT = path.join(ROOT, 'server', SERVER_KIND === 'python' ? 'lan-server.py' : 'lan-server.js');

let passed = 0;
let failed = 0;

function check(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log('  ok  ' + name);
  } else {
    failed += 1;
    console.error('FAIL  ' + name + (extra == null ? '' : '  -> ' + JSON.stringify(extra)));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(pathname, body) {
  const options = body == null
    ? undefined
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(BASE + pathname, options);
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + '/api/health');
      if (res.ok) return true;
    } catch (e) { /* retry */ }
    await sleep(150);
  }
  return false;
}

async function main() {
  const server = spawn(SERVER_COMMAND, [SERVER_SCRIPT], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }),
    stdio: 'ignore',
    windowsHide: true
  });

  try {
    check(SERVER_KIND + ' lan server starts', await waitForServer());

    const created = await request('/api/create', {
      name: '房主', game: 'liar', maxPlayers: 6, liarMode: 'echo', echoCount: 2
    });
    check('room is created with a custom size', created.status === 200 && created.data.maxPlayers === 6, created.data);
    check('room keeps liar mode settings', created.data.liarMode === 'echo' && created.data.echoCount === 2);
    const code = created.data.roomId;
    const host = created.data;

    const joined = [];
    for (let i = 2; i <= 6; i++) {
      const res = await request('/api/join', { roomId: code, name: '玩家' + i });
      joined.push(res.data);
      check('player ' + i + ' joins the room', res.status === 200 && res.data.maxPlayers === 6, res.data);
    }

    const overflow = await request('/api/join', { roomId: code, name: '多余的玩家' });
    check('room capacity is enforced', overflow.status === 409, overflow.data);

    const guest = joined[0];
    const badConfig = await request('/api/send', {
      roomId: code, token: guest.token, type: 'config', payload: { maxPlayers: 8 }
    });
    check('only the host can change room config', badConfig.status === 403, badConfig.data);

    const resized = await request('/api/send', {
      roomId: code, token: host.token, type: 'config',
      payload: { game: 'liar', maxPlayers: 8, liarMode: 'classic', echoCount: 1 }
    });
    check('host updates room config', resized.status === 200, resized.data);

    const roomView = await request(`/api/room?roomId=${code}&token=${guest.token}&after=0`);
    check('polling reflects the new capacity', roomView.data && roomView.data.maxPlayers === 8, roomView.data && roomView.data.maxPlayers);
    check('polling reflects liar mode sync', roomView.data && roomView.data.liarMode === 'classic' && roomView.data.echoCount === 1);

    const extraJoin = await request('/api/join', { roomId: code, name: '第七人' });
    const eighth = await request('/api/join', { roomId: code, name: '第八人' });
    check('room accepts the raised capacity', extraJoin.status === 200 && eighth.status === 200, [extraJoin.status, eighth.status]);

    const textMessage = await request('/api/send', {
      roomId: code, token: guest.token, type: 'chat',
      payload: { text: '  你好 🍻  ', image: '' }
    });
    check('chat text is accepted', textMessage.status === 200, textMessage.data);

    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const imageMessage = await request('/api/send', {
      roomId: code, token: guest.token, type: 'chat', payload: { text: '', image: png }
    });
    check('chat image is accepted', imageMessage.status === 200, imageMessage.data);

    const unsafeMessage = await request('/api/send', {
      roomId: code, token: guest.token, type: 'chat',
      payload: { text: '', image: 'javascript:alert(1)' }
    });
    check('unsafe chat image is rejected', unsafeMessage.status === 400, unsafeMessage.data);

    const emptyMessage = await request('/api/send', {
      roomId: code, token: guest.token, type: 'chat', payload: { text: '   ', image: '' }
    });
    check('empty chat is rejected', emptyMessage.status === 400, emptyMessage.data);

    const fakeSystem = await request('/api/send', {
      roomId: code, token: guest.token, type: 'system', payload: { text: '假系统消息' }
    });
    check('clients cannot forge system messages', fakeSystem.status === 400, fakeSystem.data);

    const seen = await request(`/api/room?roomId=${code}&token=${host.token}&after=${roomView.data.seq}`);
    const chats = (seen.data.messages || []).filter((m) => m.type === 'chat');
    check('chat relays to the whole room', chats.length === 2, chats.length);
    check('chat text is trimmed on the server', chats.some((m) => m.payload.text === '你好 🍻'), chats.map((m) => m.payload.text));
    check('chat image is relayed unchanged', chats.some((m) => m.payload.image === png));

    const members = [host].concat(joined).concat([extraJoin.data, eighth.data]).map((p) => ({ id: p.playerId, name: '玩家' }));
    const started = await request('/api/send', {
      roomId: code, token: host.token, type: 'start',
      payload: { game: 'liar', players: members, maxPlayers: 8, liarMode: 'classic', echoCount: 1 }
    });
    check('host starts an eight-player game', started.status === 200, started.data);

    const lateJoin = await request('/api/join', { roomId: code, name: '迟到的人' });
    check('joining after start is rejected', lateJoin.status === 409, lateJoin.data);

    const startedView = await request(`/api/room?roomId=${code}&token=${host.token}&after=0`);
    check('room reports started state', startedView.data && startedView.data.started === true);

    // ---------- 恶魔轮盘赌 2-4 人 ----------
    const rouletteHost = await request('/api/create', {
      name: '轮盘房主', game: 'roulette', maxPlayers: 4
    });
    check('roulette room opens with four seats', rouletteHost.status === 200 && rouletteHost.data.maxPlayers === 4, rouletteHost.data);
    const rouletteCode = rouletteHost.data.roomId;
    const rouletteMembers = [rouletteHost.data];
    for (let i = 2; i <= 4; i++) {
      const res = await request('/api/join', { roomId: rouletteCode, name: '轮盘玩家' + i });
      rouletteMembers.push(res.data);
      check('roulette player ' + i + ' joins', res.status === 200 && res.data.maxPlayers === 4, res.data);
    }
    const rouletteOverflow = await request('/api/join', { roomId: rouletteCode, name: '轮盘第五人' });
    check('roulette room capacity is four', rouletteOverflow.status === 409, rouletteOverflow.data);

    const rouletteStart = await request('/api/send', {
      roomId: rouletteCode, token: rouletteHost.data.token, type: 'start',
      payload: {
        game: 'roulette',
        players: rouletteMembers.map((p) => ({ id: p.playerId, name: '轮盘玩家' })),
        maxPlayers: 4
      }
    });
    check('host starts a four-player roulette', rouletteStart.status === 200, rouletteStart.data);

    const oversized = await request('/api/create', {
      name: '轮盘房主二', game: 'roulette', maxPlayers: 8
    });
    check('roulette capacity caps at four', oversized.status === 200 && oversized.data.maxPlayers === 4, oversized.data);
  } finally {
    server.kill();
  }

  console.log('\n----------------------------------------');
  console.log(`passed: ${passed}, failed: ${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
