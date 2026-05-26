import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import pty from 'node-pty';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const SHELL = process.env.SHELL || '/bin/bash';
const STARTING_DIRECTORY = resolveStartingDirectory(process.env.STARTING_DIRECTORY || '~/workspace');
const TERMINAL_PASSWORD = process.env.TERMINAL_PASSWORD || '';
const APP_BASE_PATH = normalizeBasePath(process.env.APP_BASE_PATH || '/');
const sessions = new Map();

function resolveStartingDirectory(dir) {
  const expanded = dir.replace(/^~(?=$|\/)/, os.homedir());
  const resolved = path.resolve(expanded);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`STARTING_DIRECTORY is not a directory: ${resolved}`);
  }
  return resolved;
}

function normalizeBasePath(basePath) {
  if (!basePath || basePath === '/') return '/';
  return `/${basePath.replace(/^\/+|\/+$/g, '')}/`;
}

function renderIndexHtml() {
  return fs
    .readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
    .replaceAll('__APP_BASE_PATH__', APP_BASE_PATH);
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function issueToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, Date.now() + 1000 * 60 * 60 * 12);
  return token;
}

function isValidToken(token) {
  if (!TERMINAL_PASSWORD) return true;
  const expires = sessions.get(token);
  if (!expires) return false;
  if (expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

const app = express();
app.use(express.json({ limit: '8kb' }));
app.use((req, res, next) => {
  if (
    req.method === 'GET' &&
    req.path !== '/healthz' &&
    !req.path.startsWith('/api/') &&
    (req.path === '/' || (!req.path.endsWith('/') && !path.basename(req.path).includes('.')))
  ) {
    res.type('html').send(renderIndexHtml());
    return;
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, startingDirectory: STARTING_DIRECTORY, shell: SHELL, passwordRequired: Boolean(TERMINAL_PASSWORD) });
});

app.post('/api/login', (req, res) => {
  if (!TERMINAL_PASSWORD) {
    res.json({ token: issueToken(), passwordRequired: false });
    return;
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!timingSafeEqualString(password, TERMINAL_PASSWORD)) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }
  res.json({ token: issueToken(), passwordRequired: true });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (pathname === '/terminal' || pathname.endsWith('/terminal')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
    return;
  }
  socket.destroy();
});

wss.on('connection', (ws, req) => {
  const token = new URL(req.url || '/terminal', 'http://localhost').searchParams.get('token') || '';
  if (!isValidToken(token)) {
    ws.send(JSON.stringify({ type: 'auth_required' }));
    ws.close(1008, 'Authentication required');
    return;
  }

  const term = pty.spawn(SHELL, [], {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: STARTING_DIRECTORY,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      STARTING_DIRECTORY,
    },
  });

  ws.send(JSON.stringify({ type: 'ready', cwd: STARTING_DIRECTORY, pid: term.pid }));

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'data', data }));
  });

  term.onExit(({ exitCode, signal }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', exitCode, signal }));
      ws.close();
    }
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'data' && typeof msg.data === 'string') term.write(msg.data);
    if (msg.type === 'resize' && Number.isFinite(msg.cols) && Number.isFinite(msg.rows)) {
      term.resize(Math.max(10, msg.cols), Math.max(5, msg.rows));
    }
  });

  ws.on('close', () => term.kill());
  ws.on('error', () => term.kill());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`terminal-view listening on http://0.0.0.0:${PORT}`);
  console.log(`PORT=${PORT}`);
  console.log(`STARTING_DIRECTORY=${STARTING_DIRECTORY}`);
  console.log(`APP_BASE_PATH=${APP_BASE_PATH}`);
  console.log(`SHELL=${SHELL}`);
  console.log(`TERMINAL_PASSWORD=${TERMINAL_PASSWORD ? 'set' : 'not set'}`);
});
