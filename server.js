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
const TERMINAL_SSH_ROUTES = parseRoutes(process.env.TERMINAL_SSH_ROUTES || '');
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

function parseRoutes(raw) {
  const routes = new Map();
  for (const entry of raw.split(/[\n,]+/)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [slug, ...targetParts] = trimmed.split('=');
    const target = targetParts.join('=').trim();
    const key = slug.trim().replace(/^\/+|\/+$/g, '');
    if (key && target) routes.set(key, target);
  }
  return routes;
}

function routeForPath(pathname) {
  const slug = pathname.split('/').filter(Boolean)[0];
  if (!slug) return null;
  const target = TERMINAL_SSH_ROUTES.get(slug);
  return target ? { slug, target } : null;
}

function stripRouteSlug(req, slug) {
  const prefix = `/${slug}`;
  if (req.url === prefix) {
    req.url = '/';
    return;
  }
  if (req.url?.startsWith(`${prefix}/`)) req.url = req.url.slice(prefix.length) || '/';
}

function renderIndexHtml(basePath = APP_BASE_PATH) {
  return fs
    .readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
    .replaceAll('__APP_BASE_PATH__', normalizeBasePath(basePath));
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

function sshCommandForTarget(target) {
  const args = ['-tt', '-o', 'StrictHostKeyChecking=accept-new', target];
  return { command: 'ssh', args, displayCwd: `ssh://${target}` };
}

const app = express();
app.use((req, res, next) => {
  const route = routeForPath(req.path);
  if (!route) return next();
  res.locals.appBasePath = `/${route.slug}/`;
  stripRouteSlug(req, route.slug);
  next();
});
app.use(express.json({ limit: '8kb' }));
app.use((req, res, next) => {
  if (
    req.method === 'GET' &&
    req.path !== '/healthz' &&
    !req.path.startsWith('/api/') &&
    (req.path === '/' || (!req.path.endsWith('/') && !path.basename(req.path).includes('.')))
  ) {
    res.type('html').send(renderIndexHtml(res.locals.appBasePath));
    return;
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    startingDirectory: STARTING_DIRECTORY,
    shell: SHELL,
    passwordRequired: Boolean(TERMINAL_PASSWORD),
    sshRoutes: [...TERMINAL_SSH_ROUTES.keys()],
  });
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
  const route = routeForPath(pathname);
  if (route) {
    req.terminalSshRoute = route;
    stripRouteSlug(req, route.slug);
  }
  const terminalPath = new URL(req.url || '/', 'http://localhost').pathname;
  if (terminalPath === '/terminal' || (!route && pathname.endsWith('/terminal'))) {
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

  const sshRoute = req.terminalSshRoute;
  const spawnSpec = sshRoute ? sshCommandForTarget(sshRoute.target) : { command: SHELL, args: [], displayCwd: STARTING_DIRECTORY };
  const term = pty.spawn(spawnSpec.command, spawnSpec.args, {
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

  ws.send(JSON.stringify({ type: 'ready', cwd: spawnSpec.displayCwd, pid: term.pid }));

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
  console.log(`TERMINAL_SSH_ROUTES=${[...TERMINAL_SSH_ROUTES.entries()].map(([slug, target]) => `${slug}->${target}`).join(',') || 'none'}`);
  console.log(`SHELL=${SHELL}`);
  console.log(`TERMINAL_PASSWORD=${TERMINAL_PASSWORD ? 'set' : 'not set'}`);
});
