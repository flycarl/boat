import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';

const port = Number(process.env.PORT ?? 5173);
const root = join(process.cwd(), 'dist');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  // Production assets are built with the GitHub Pages base path (`/boat/`).
  // Strip that prefix when serving the same build from the LAN server root.
  const pathname = url.pathname === '/boat' ? '/' : url.pathname.replace(/^\/boat\//, '/');
  const requested = normalize(pathname === '/' ? '/index.html' : pathname);
  const filePath = join(root, requested);
  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = extname(filePath);
  res.writeHead(200, { 'content-type': mime[ext] ?? 'application/octet-stream' });
  res.end(await readFile(filePath));
});

const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new Map();

const broadcastToRoom = (room, message, except) => {
  for (const client of wss.clients) {
    if (client !== except && client.readyState === 1 && client.room === room) {
      client.send(JSON.stringify(message));
    }
  }
};

wss.on('connection', (socket) => {
  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!message?.room) return;
    socket.room = message.room;
    socket.id = message.id;
    socket.name = message.name ?? socket.name;
    if (!rooms.has(message.room)) rooms.set(message.room, new Map());
    if (message.type === 'leave') {
      socket.didLeave = true;
      rooms.get(message.room).delete(message.id);
    } else {
      rooms.get(message.room).set(message.id, message);
    }
    broadcastToRoom(message.room, message, socket);
  });
  socket.on('close', () => {
    if (!socket.room || !socket.id) return;
    rooms.get(socket.room)?.delete(socket.id);
    if (!socket.didLeave) {
      broadcastToRoom(socket.room, { type: 'leave', id: socket.id, room: socket.room, name: socket.name ?? '玩家' }, socket);
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((item) => item?.family === 'IPv4' && !item.internal)
    .map((item) => `http://${item.address}:${port}`);
  console.log(`局域网服务器已启动：`);
  console.log(`  本机: http://localhost:${port}`);
  for (const address of addresses) console.log(`  局域网: ${address}`);
});
