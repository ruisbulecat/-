#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
赌徒模拟器 · 局域网联机服务器（Python 标准库版）
与 server/lan-server.js 使用同一套 HTTP 房间接口，Windows 上无需安装 Node。

启动：py -3 server/lan-server.py
或：  python server/lan-server.py
"""

import json
import mimetypes
import os
import random
import secrets
import socket
import string
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PORT = int(os.environ.get('PORT', '8787'))
MAX_PLAYERS = 4
ROOM_TTL = 2 * 60 * 60
CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
PLAYER_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

ROOMS = {}
ROOM_LOCK = threading.RLock()

MIME = {
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
    '.woff2': 'font/woff2',
}


def random_id(length, alphabet=CODE_ALPHABET):
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def clean_name(value, fallback):
    text = str(value or '').replace('\x00', '').replace('<', '').replace('>', '').strip()[:16]
    return text or fallback


def find_player(room, token):
    for player in room['players']:
        if player['token'] == token:
            return player
    return None


def public_room(room, after):
    return {
        'roomId': room['id'],
        'hostId': room['hostId'],
        'started': room['started'],
        'game': room['game'],
        'seq': room['seq'],
        'players': [
            {'id': p['id'], 'name': p['name'], 'host': p['id'] == room['hostId']}
            for p in room['players']
        ],
        'messages': [m for m in room['messages'] if m['seq'] > after],
    }


def push_message(room, source, msg_type, to, payload):
    room['seq'] += 1
    message = {
        'seq': room['seq'],
        'from': source,
        'to': to,
        'type': msg_type,
        'payload': payload,
        'at': int(time.time() * 1000),
    }
    room['messages'].append(message)
    if len(room['messages']) > 600:
        del room['messages'][:len(room['messages']) - 600]
    room['touchedAt'] = time.time()
    if msg_type == 'start':
        room['started'] = True
        if isinstance(payload, dict) and payload.get('game'):
            room['game'] = payload['game']
    return message


def room_code():
    code = random_id(4)
    while code in ROOMS:
        code = random_id(4)
    return code


class LanHandler(BaseHTTPRequestHandler):
    server_version = 'CasinoLan/1.0'
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        # 保持终端干净，只保留错误级别的输出
        if args and str(args[0]).startswith(('4', '5')):
            sys.stderr.write('[lan] ' + (fmt % args) + '\n')

    def handle_one_request(self):
        # 浏览器关闭轮询连接时经常出现连接重置，安静地结束即可
        try:
            super().handle_one_request()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, TimeoutError):
            self.close_connection = True

    # ---------- 基础响应 ----------

    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, status, text, content_type='text/plain; charset=utf-8'):
        body = text.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0:
            return {}
        if length > 256 * 1024:
            raise ValueError('body too large')
        raw = self.rfile.read(length)
        return json.loads(raw.decode('utf-8'))

    # ---------- HTTP 方法 ----------

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/health':
            with ROOM_LOCK:
                count = len(ROOMS)
            self.send_json(200, {'ok': True, 'rooms': count, 'port': PORT})
            return
        if parsed.path == '/api/room':
            self.handle_room(parsed)
            return
        if parsed.path.startswith('/api/'):
            self.send_json(404, {'ok': False, 'error': '未知接口。'})
            return
        self.serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            body = self.read_json()
        except Exception:
            self.send_json(400, {'ok': False, 'error': '请求格式错误。'})
            return

        if parsed.path == '/api/create':
            self.handle_create(body)
        elif parsed.path == '/api/join':
            self.handle_join(body)
        elif parsed.path == '/api/send':
            self.handle_send(body)
        elif parsed.path == '/api/leave':
            self.handle_leave(body)
        else:
            self.send_json(404, {'ok': False, 'error': '未知接口。'})

    # ---------- API ----------

    def handle_create(self, body):
        with ROOM_LOCK:
            code = room_code()
            token = secrets.token_hex(18)
            player = {
                'id': random_id(6, PLAYER_ALPHABET),
                'name': clean_name(body.get('name'), '房主'),
                'token': token,
            }
            room = {
                'id': code,
                'hostId': player['id'],
                'players': [player],
                'messages': [],
                'seq': 0,
                'started': False,
                'game': None,
                'createdAt': time.time(),
                'touchedAt': time.time(),
            }
            ROOMS[code] = room
            push_message(room, player['id'], 'system', None, {'text': player['name'] + ' 创建了房间。'})
            self.send_json(200, {
                'roomId': code,
                'playerId': player['id'],
                'token': token,
                'hostId': room['hostId'],
                'seq': room['seq'],
                'players': public_room(room, 0)['players'],
            })

    def handle_join(self, body):
        code = str(body.get('roomId') or '').strip().upper()
        with ROOM_LOCK:
            room = ROOMS.get(code)
            if not room:
                self.send_json(404, {'ok': False, 'error': '房间不存在。'})
                return
            if room['started']:
                self.send_json(409, {'ok': False, 'error': '牌局已经开始了。'})
                return
            if len(room['players']) >= MAX_PLAYERS:
                self.send_json(409, {'ok': False, 'error': '房间满了。'})
                return
            token = secrets.token_hex(18)
            name = clean_name(body.get('name'), '玩家')
            if any(p['name'] == name for p in room['players']):
                name += ' 2'
            player = {
                'id': random_id(6, PLAYER_ALPHABET),
                'name': name,
                'token': token,
            }
            room['players'].append(player)
            push_message(room, player['id'], 'system', None, {'text': player['name'] + ' 加入了房间。'})
            self.send_json(200, {
                'roomId': room['id'],
                'playerId': player['id'],
                'token': token,
                'hostId': room['hostId'],
                'seq': room['seq'],
                'players': public_room(room, 0)['players'],
            })

    def handle_room(self, parsed):
        query = parse_qs(parsed.query)
        code = (query.get('roomId') or [''])[0].strip().upper()
        token = (query.get('token') or [''])[0]
        try:
            after = int((query.get('after') or ['0'])[0] or 0)
        except (TypeError, ValueError):
            after = 0
        with ROOM_LOCK:
            room = ROOMS.get(code)
            if not room:
                self.send_json(404, {'ok': False, 'error': '房间不存在。'})
                return
            if not find_player(room, token):
                self.send_json(403, {'ok': False, 'error': '没有房间凭证。'})
                return
            room['touchedAt'] = time.time()
            self.send_json(200, public_room(room, after))

    def handle_send(self, body):
        code = str(body.get('roomId') or '').strip().upper()
        with ROOM_LOCK:
            room = ROOMS.get(code)
            if not room:
                self.send_json(404, {'ok': False, 'error': '房间不存在。'})
                return
            player = find_player(room, body.get('token'))
            if not player:
                self.send_json(403, {'ok': False, 'error': '没有房间凭证。'})
                return
            msg_type = str(body.get('type') or '')[:24]
            if not msg_type:
                self.send_json(400, {'ok': False, 'error': '缺少消息类型。'})
                return
            if msg_type == 'start' and player['id'] != room['hostId']:
                self.send_json(403, {'ok': False, 'error': '只有房主可以开始游戏。'})
                return
            to = body.get('to')
            if to:
                to = str(to)[:24]
                if not any(p['id'] == to for p in room['players']):
                    self.send_json(400, {'ok': False, 'error': '目标玩家不在房间。'})
                    return
            message = push_message(room, player['id'], msg_type, to, body.get('payload'))
            self.send_json(200, {'ok': True, 'seq': message['seq']})

    def handle_leave(self, body):
        code = str(body.get('roomId') or '').strip().upper()
        with ROOM_LOCK:
            room = ROOMS.get(code)
            if not room:
                self.send_json(200, {'ok': True})
                return
            player = find_player(room, body.get('token'))
            if not player:
                self.send_json(200, {'ok': True})
                return
            room['players'] = [p for p in room['players'] if p['id'] != player['id']]
            push_message(room, player['id'], 'system', None, {'text': player['name'] + ' 离开了房间。'})
            if not room['players']:
                ROOMS.pop(room['id'], None)
            elif room['hostId'] == player['id']:
                room['hostId'] = room['players'][0]['id']
                push_message(room, None, 'system', None, {'text': room['players'][0]['name'] + ' 成为新房主。'})
            self.send_json(200, {'ok': True})

    # ---------- 静态文件 ----------

    def serve_static(self, path):
        try:
            decoded = unquote(path)
        except Exception:
            self.send_text(400, 'Bad request')
            return
        rel = decoded.lstrip('/') or 'index.html'
        target = os.path.realpath(os.path.join(ROOT, rel))
        if target != ROOT and not target.startswith(ROOT + os.sep):
            self.send_text(403, 'Forbidden')
            return
        if os.path.isdir(target):
            target = os.path.join(target, 'index.html')
        if not os.path.isfile(target):
            self.send_text(404, '404 Not Found')
            return
        try:
            with open(target, 'rb') as handle:
                data = handle.read()
        except OSError:
            self.send_text(404, '404 Not Found')
            return
        ext = os.path.splitext(target)[1].lower()
        content_type = MIME.get(ext) or mimetypes.guess_type(target)[0] or 'application/octet-stream'
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(data)


def lan_addresses():
    found = []
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(('8.8.8.8', 80))
            found.append(sock.getsockname()[0])
        finally:
            sock.close()
    except OSError:
        pass
    try:
        host = socket.gethostname()
        for info in socket.getaddrinfo(host, None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith('127.') and ip not in found:
                found.append(ip)
    except OSError:
        pass
    return found


def cleanup_loop():
    while True:
        time.sleep(10 * 60)
        now = time.time()
        with ROOM_LOCK:
            stale = [code for code, room in ROOMS.items() if now - room['touchedAt'] > ROOM_TTL]
            for code in stale:
                ROOMS.pop(code, None)


def main():
    try:
        server = ThreadingHTTPServer(('0.0.0.0', PORT), LanHandler)
    except OSError as exc:
        print('无法启动服务器：端口 %d 可能被占用。' % PORT)
        print('可以换一个端口，例如 PowerShell:')
        print('  $env:PORT=8788; py -3 server/lan-server.py')
        print('错误：%s' % exc)
        return 1

    server.daemon_threads = True
    threading.Thread(target=cleanup_loop, daemon=True).start()

    print('========================================')
    print(' 赌徒模拟器 · 局域网服务器已启动（Python）')
    print(' 本机:  http://localhost:%d' % PORT)
    for ip in lan_addresses():
        print(' 局域网: http://%s:%d' % (ip, PORT))
    print(' 把局域网地址发给同 Wi-Fi 的朋友，浏览器打开即可。')
    print(' Windows 防火墙弹窗请选择“允许访问”（专用网络）。')
    print(' 房间保存在内存里，关闭服务即清空。')
    print('========================================')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n服务器已停止。')
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
