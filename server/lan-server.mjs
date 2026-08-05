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
  const requested = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
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
    if (!rooms.has(message.room)) rooms.set(message.room, new Map());
    rooms.get(message.room).set(message.id, message);
    for (const client of wss.clients) {
      if (client !== socket && client.readyState === 1 && client.room === message.room) {
        client.send(JSON.stringify(message));
      }
    }
  });
  socket.on('close', () => {
    if (socket.room && socket.id) rooms.get(socket.room)?.delete(socket.id);
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
