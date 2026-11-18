/* ============================================================
   赌徒模拟器 · 局域网联机服务器
   零依赖 Node.js 服务：静态文件 + 房间轮询 / 消息中继。
   启动：node server/lan-server.js
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8787;
const MAX_PLAYERS = 4;
const ROOM_TTL = 2 * 60 * 60 * 1000;

const rooms = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function randomId(length, alphabet) {
  const chars = alphabet || 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[crypto.randomInt(chars.length)];
  return out;
}

function newToken() {
  return crypto.randomBytes(18).toString('hex');
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 256 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

function cleanName(name, fallback) {
  const text = String(name == null ? '' : name).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return text || fallback || '玩家';
}

function roomCode() {
  let code = randomId(4);
  while (rooms.has(code)) code = randomId(4);
  return code;
}

function findPlayer(room, token) {
  return room.players.find((p) => p.token === token);
}

function publicRoom(room, after) {
  return {
    roomId: room.id,
    hostId: room.hostId,
    started: room.started,
    game: room.game,
    seq: room.seq,
    players: room.players.map((p) => ({ id: p.id, name: p.name, host: p.id === room.hostId })),
    messages: room.messages.filter((m) => m.seq > after)
  };
}

function pushMessage(room, from, type, to, payload) {
  room.seq += 1;
  const message = {
    seq: room.seq,
    from: from || null,
    to: to || null,
    type,
    payload: payload == null ? null : payload,
    at: Date.now()
  };
  room.messages.push(message);
  if (room.messages.length > 600) room.messages.splice(0, room.messages.length - 600);
  room.touchedAt = Date.now();
  if (type === 'start') {
    room.started = true;
    if (payload && payload.game) room.game = payload.game;
  }
  return message;
}

async function handleApi(req, res, url) {
  const action = url.pathname.slice('/api/'.length);

  if (action === 'health' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, rooms: rooms.size, port: PORT });
  }

  if (action === 'create' && req.method === 'POST') {
    const body = await readBody(req);
    const id = roomCode();
    const token = newToken();
    const player = {
      id: randomId(6, 'abcdefghijkmnpqrstuvwxyz23456789'),
      name: cleanName(body.name, '房主'),
      token
    };
    const room = {
      id,
      hostId: player.id,
      players: [player],
      messages: [],
      seq: 0,
      started: false,
      game: null,
      createdAt: Date.now(),
      touchedAt: Date.now()
    };
    rooms.set(id, room);
    pushMessage(room, player.id, 'system', null, { text: `${player.name} 创建了房间。` });
    return sendJson(res, 200, {
      roomId: id,
      playerId: player.id,
      token,
      hostId: room.hostId,
      seq: room.seq,
      players: publicRoom(room, 0).players
    });
  }

  if (action === 'join' && req.method === 'POST') {
    const body = await readBody(req);
    const room = rooms.get(String(body.roomId || '').toUpperCase().trim());
    if (!room) return sendJson(res, 404, { ok: false, error: '房间不存在。' });
    if (room.started) return sendJson(res, 409, { ok: false, error: '牌局已经开始了。' });
    if (room.players.length >= MAX_PLAYERS) return sendJson(res, 409, { ok: false, error: '房间满了。' });
    const token = newToken();
    const player = {
      id: randomId(6, 'abcdefghijkmnpqrstuvwxyz23456789'),
      name: cleanName(body.name, '玩家'),
      token
    };
    if (room.players.some((p) => p.name === player.name)) player.name += ' 2';
    room.players.push(player);
    pushMessage(room, player.id, 'system', null, { text: `${player.name} 加入了房间。` });
    return sendJson(res, 200, {
      roomId: room.id,
      playerId: player.id,
      token,
      hostId: room.hostId,
      seq: room.seq,
      players: publicRoom(room, 0).players
    });
  }

  if (action === 'room' && req.method === 'GET') {
    const room = rooms.get(String(url.searchParams.get('roomId') || '').toUpperCase());
    if (!room) return sendJson(res, 404, { ok: false, error: '房间不存在。' });
    const token = url.searchParams.get('token') || '';
    if (!findPlayer(room, token)) return sendJson(res, 403, { ok: false, error: '没有房间凭证。' });
    const after = Number(url.searchParams.get('after')) || 0;
    room.touchedAt = Date.now();
    return sendJson(res, 200, publicRoom(room, after));
  }

  if (action === 'send' && req.method === 'POST') {
    const body = await readBody(req);
    const room = rooms.get(String(body.roomId || '').toUpperCase());
    if (!room) return sendJson(res, 404, { ok: false, error: '房间不存在。' });
    const player = findPlayer(room, body.token);
    if (!player) return sendJson(res, 403, { ok: false, error: '没有房间凭证。' });
    const type = String(body.type || '').slice(0, 24);
    if (!type) return sendJson(res, 400, { ok: false, error: '缺少消息类型。' });
    if (type === 'start' && player.id !== room.hostId) {
      return sendJson(res, 403, { ok: false, error: '只有房主可以开始游戏。' });
    }
    const to = body.to ? String(body.to).slice(0, 24) : null;
    if (to && !room.players.some((p) => p.id === to)) {
      return sendJson(res, 400, { ok: false, error: '目标玩家不在房间。' });
    }
    const message = pushMessage(room, player.id, type, to, body.payload || null);
    return sendJson(res, 200, { ok: true, seq: message.seq });
  }

  if (action === 'leave' && req.method === 'POST') {
    const body = await readBody(req);
    const room = rooms.get(String(body.roomId || '').toUpperCase());
    if (!room) return sendJson(res, 200, { ok: true });
    const player = findPlayer(room, body.token);
    if (!player) return sendJson(res, 200, { ok: true });
    room.players = room.players.filter((p) => p.id !== player.id);
    pushMessage(room, player.id, 'system', null, { text: `${player.name} 离开了房间。` });
    if (room.players.length === 0) {
      rooms.delete(room.id);
    } else if (room.hostId === player.id) {
      room.hostId = room.players[0].id;
      pushMessage(room, null, 'system', null, { text: `${room.players[0].name} 成为新房主。` });
    }
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { ok: false, error: '未知接口。' });
}

function serveStatic(res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (e) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  let rel = decoded.replace(/^\/+/, '');
  if (!rel || rel === '') rel = 'index.html';
  const target = path.resolve(ROOT, rel);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.stat(target, (err, stat) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const file = stat.isDirectory() ? path.join(target, 'index.html') : target;
    fs.readFile(file, (readErr, data) => {
      if (readErr) {
        res.writeHead(404);
        res.end('404 Not Found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => {
      sendJson(res, 400, { ok: false, error: err.message || '请求失败' });
    });
    return;
  }
  serveStatic(res, url.pathname);
});

function lanAddresses() {
  const out = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal) out.push({ name, address: info.address });
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log(' 赌徒模拟器 · 局域网服务器已启动');
  console.log(` 本机:  http://localhost:${PORT}`);
  for (const item of lanAddresses()) {
    console.log(` 局域网: http://${item.address}:${PORT}  (${item.name})`);
  }
  console.log(' 把局域网地址发给同 Wi-Fi 的朋友，浏览器打开即可。');
  console.log(' 房间保存在内存里，关闭服务即清空。');
  console.log('========================================');
});

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.touchedAt > ROOM_TTL) rooms.delete(id);
  }
}, 10 * 60 * 1000).unref();
