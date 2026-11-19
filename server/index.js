const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3300);
const HOST = process.env.HOST || '0.0.0.0';
const SNAPSHOT_MS = 83;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

function sendFrame(socket, opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload || ''));
  const length = data.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  if (socket.writable) socket.write(Buffer.concat([header, data]));
}

class Client {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragment = '';
    this.handlers = {};
    this.alive = true;
    this.id = null;
    this.room = null;
    socket.on('data', (chunk) => {
      this.alive = true;
      this.onData(chunk);
    });
    socket.on('close', () => this.emit('close'));
    socket.on('error', () => this.emit('close'));
  }

  on(name, callback) {
    if (!this.handlers[name]) this.handlers[name] = [];
    this.handlers[name].push(callback);
  }

  emit(name, ...args) {
    const callbacks = this.handlers[name] || [];
    callbacks.forEach((callback) => callback(...args));
  }

  send(object) {
    sendFrame(this.socket, 0x1, JSON.stringify(object));
  }

  pong(payload) {
    sendFrame(this.socket, 0xA, payload);
  }

  close() {
    sendFrame(this.socket, 0x8, Buffer.alloc(0));
    this.socket.end();
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      const fin = (first & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      let maskOffset = -1;
      if (masked) {
        maskOffset = offset;
        offset += 4;
      }
      if (length > 1024 * 64) {
        this.socket.destroy();
        return;
      }
      if (this.buffer.length < offset + length) return;
      let payload = Buffer.from(this.buffer.slice(offset, offset + length));
      if (masked) {
        const key = this.buffer.slice(maskOffset, maskOffset + 4);
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= key[index % 4];
      }
      this.buffer = this.buffer.slice(offset + length);

      if (opcode === 0x8) {
        this.emit('close');
        this.socket.end();
        return;
      }
      if (opcode === 0x9) { this.pong(payload); continue; }
      if (opcode === 0xA) continue;
      if (opcode === 0x1 || opcode === 0x0) {
        this.fragment += payload.toString('utf8');
        if (fin) {
          const text = this.fragment;
          this.fragment = '';
          let message;
          try { message = JSON.parse(text); } catch (error) { continue; }
          this.emit('message', message);
        }
      }
    }
  }
}

const rooms = new Map();

function getRoom(id) {
  if (!rooms.has(id)) {
    rooms.set(id, {
      id,
      players: new Map(),
    });
  }
  return rooms.get(id);
}

function publicPlayers(room) {
  return Array.from(room.players.values()).map((player) => ({
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    z: player.z,
    yaw: player.yaw,
    pitch: player.pitch,
    hp: player.hp,
    alive: player.alive,
    tint: player.tint,
    kills: player.kills,
  }));
}

function broadcast(room, object) {
  const payload = JSON.stringify(object);
  for (const player of room.players.values()) {
    if (player.client.socket.writable) player.client.socket.write(sendBuffer(payload));
  }
}

function sendBuffer(text) {
  const data = Buffer.from(text);
  const header = data.length < 126
    ? Buffer.from([0x81, data.length])
    : data.length < 65536
      ? Buffer.from([0x81, 126, (data.length >> 8) & 0xff, data.length & 0xff])
      : (() => {
        const head = Buffer.alloc(10);
        head[0] = 0x81;
        head[1] = 127;
        head.writeBigUInt64BE(BigInt(data.length), 2);
        return head;
      })();
  return Buffer.concat([header, data]);
}

function event(room, name, data) {
  broadcast(room, { type: 'event', event: name, data });
}

function number(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function handleJoin(client, message) {
  const roomId = String(message.room || 'adybe').slice(0, 32);
  const room = getRoom(roomId);
  const id = crypto.randomBytes(6).toString('hex');
  const map = message.map === 'city' ? 'city' : 'forest';
  const player = {
    id,
    client,
    room,
    name: String(message.name || 'Combattant').slice(0, 16),
    map,
    x: Math.cos(Math.random() * Math.PI * 2) * (map === 'city' ? 95 : 150),
    y: 0,
    z: Math.sin(Math.random() * Math.PI * 2) * (map === 'city' ? 95 : 150),
    yaw: 0,
    pitch: 0,
    hp: 100,
    alive: true,
    kills: 0,
    tint: [0.4 + Math.random() * 0.5, 0.4 + Math.random() * 0.5, 0.4 + Math.random() * 0.5],
  };
  room.players.set(id, player);
  client.id = id;
  client.room = room;
  client.send({ type: 'welcome', id, room: roomId, players: publicPlayers(room) });
  event(room, 'join', { name: player.name });
}

function handleState(client, message) {
  const player = client.room && client.room.players.get(client.id);
  if (!player) return;
  player.x = number(message.x, player.x, -400, 400);
  player.y = number(message.y, player.y, 0, 50);
  player.z = number(message.z, player.z, -400, 400);
  player.yaw = number(message.yaw, player.yaw, -100, 100);
  player.pitch = number(message.pitch, player.pitch, -2, 2);
  player.hp = number(message.hp, player.hp, 0, 100);
  player.alive = message.alive !== false && player.hp > 0;
  if (typeof message.name === 'string') player.name = message.name.slice(0, 16);
}

function handleShot(client, message) {
  const room = client.room;
  if (!room) return;
  const attacker = room.players.get(client.id);
  const target = room.players.get(String(message.targetId || ''));
  if (!attacker || !target || !target.alive || target === attacker) return;
  const damage = number(message.damage, 20, 1, 120);
  target.hp = Math.max(0, target.hp - damage);
  if (target.hp <= 0) {
    target.alive = false;
    attacker.kills += 1;
    event(room, 'death', { targetId: target.id, attackerId: attacker.id, killer: attacker.name, victim: target.name });
  }
  event(room, 'hit', { targetId: target.id, damage, hp: target.hp, attackerId: attacker.id });
  if (message.dir) {
    event(room, 'shot', {
      shooterId: attacker.id,
      dir: {
        x: number(message.dir.x, 0, -1, 1),
        y: number(message.dir.y, 0, -1, 1),
        z: number(message.dir.z, -1, -1, 1),
      },
    });
  }
}

function handleMessage(client, message) {
  if (!message || typeof message.type !== 'string') return;
  switch (message.type) {
    case 'join':
      if (!client.id) handleJoin(client, message);
      break;
    case 'state': handleState(client, message); break;
    case 'shot': handleShot(client, message); break;
    case 'chat':
      if (client.room && client.id) {
        event(client.room, 'chat', {
          name: client.room.players.get(client.id).name,
          text: String(message.text || '').slice(0, 120),
        });
      }
      break;
    default: break;
  }
}

function detach(client) {
  const room = client.room;
  if (!room || !client.id) return;
  const player = room.players.get(client.id);
  room.players.delete(client.id);
  if (player) event(room, 'leave', { name: player.name });
  client.room = null;
  client.id = null;
}

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch (error) {
    response.writeHead(400).end('Requete invalide');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  const target = path.resolve(ROOT, `.${pathname}`);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    response.writeHead(403).end('Acces refuse');
    return;
  }
  fs.stat(target, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Introuvable');
      return;
    }
    const extension = path.extname(target).toLowerCase();
    const cache = extension === '.html' || extension === '.js' || extension === '.css'
      ? 'no-cache'
      : 'public, max-age=3600';
    response.writeHead(200, {
      'Content-Type': MIME[extension] || 'application/octet-stream',
      'Cache-Control': cache,
      'Content-Length': stats.size,
    });
    fs.createReadStream(target).pipe(response);
  });
});

server.on('upgrade', (request, socket) => {
  let url;
  try { url = new URL(request.url, 'http://localhost'); } catch (error) { socket.destroy(); return; }
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  const key = request.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  const client = new Client(socket);
  client.on('message', (message) => handleMessage(client, message));
  client.on('close', () => detach(client));
  const params = url.searchParams;
  handleJoin(client, {
    name: params.get('name'),
    room: params.get('room'),
    map: params.get('map'),
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    broadcast(room, { type: 'snapshot', players: publicPlayers(room), time: Date.now() });
    if (room.players.size === 0) rooms.delete(room.id);
  }
}, SNAPSHOT_MS);

setInterval(() => {
  for (const room of rooms.values()) {
    for (const player of room.players.values()) {
      if (!player.client.alive) {
        player.client.socket.destroy();
        continue;
      }
      player.client.alive = false;
      sendFrame(player.client.socket, 0x9, Buffer.alloc(0));
    }
  }
}, 20000);

server.listen(PORT, HOST, () => {
  console.log(`Adybe pret sur http://localhost:${PORT}`);
});
