import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import QRCode from 'qrcode';

import { config } from './src/server/config.js';
import { buildQuestionIndex } from './src/server/gameEngine.js';
import { initState, saveNow } from './src/server/stateStore.js';
import { registerHandlers } from './src/server/socketHandlers.js';

// ---- load content ----
const teams = JSON.parse(fs.readFileSync(config.paths.teams, 'utf8'));
const questionsData = JSON.parse(fs.readFileSync(config.paths.questions, 'utf8'));
const { order, byId } = buildQuestionIndex(questionsData);

// ---- state ----
initState(teams, order);

// ---- http + static ----
const app = express();
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => res.status(200).json({ ok: true, questions: order.length }));

// Public: captain phones need the team list before they can pick + join.
app.get('/api/teams', (_req, res) => res.json(teams.map(({ id, name, color, emoji }) => ({ id, name, color, emoji }))));

// Server-side QR (no client CDN dependency). /qr?data=<encoded url>
app.get('/qr', async (req, res) => {
  const data = req.query.data || '';
  try {
    const png = await QRCode.toBuffer(String(data), { width: 520, margin: 1, color: { dark: '#1a0f3d', light: '#ffffff' } });
    res.type('png').send(png);
  } catch (e) {
    res.status(400).send('bad qr');
  }
});

// Page routes (each serves its own index.html)
const page = (dir) => (_req, res) => res.sendFile(path.join(config.paths.public, dir, 'index.html'));
app.get('/', (_req, res) => res.redirect('/play'));
app.get('/host', page('host'));
app.get('/screen', page('screen'));
app.get('/play', page('play'));

app.use(express.static(config.paths.public));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

registerHandlers(io, byId, order);

server.listen(config.port, () => {
  console.log(`\n🎮  Marketing PT Game running on :${config.port}`);
  console.log(`    /host?key=${config.hostKey}   (operator)`);
  console.log(`    /screen?key=${config.hostKey} (projector)`);
  console.log(`    /play                          (captains — QR target)`);
  console.log(`    ${order.length} questions loaded\n`);
});

// Save a final snapshot on graceful shutdown.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    saveNow();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000);
  });
}
