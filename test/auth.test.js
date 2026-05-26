import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const port = 4600 + Math.floor(Math.random() * 1000);

async function startServer(env = {}) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), STARTING_DIRECTORY: '/tmp/terminal-view-auth-test', SHELL: '/bin/bash', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await once(child.stdout, 'data');
  return child;
}

function wsMessage(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for websocket message')), timeoutMs);
    ws.once('message', (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()));
    });
  });
}

test('password endpoint returns a token for the configured terminal password', async () => {
  const child = await startServer({ TERMINAL_PASSWORD: 'correct horse' });
  try {
    const bad = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    assert.equal(bad.status, 401);

    const good = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct horse' }),
    });
    assert.equal(good.status, 200);
    const body = await good.json();
    assert.equal(typeof body.token, 'string');
    assert.ok(body.token.length > 20);
  } finally {
    child.kill('SIGTERM');
  }
});

test('terminal websocket requires a valid login token when TERMINAL_PASSWORD is set', async () => {
  const child = await startServer({ TERMINAL_PASSWORD: 'secret' });
  try {
    const unauth = new WebSocket(`ws://127.0.0.1:${port}/terminal`);
    await once(unauth, 'open');
    const rejected = await wsMessage(unauth);
    assert.equal(rejected.type, 'auth_required');

    const login = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'secret' }),
    }).then((r) => r.json());
    const authed = new WebSocket(`ws://127.0.0.1:${port}/terminal?token=${encodeURIComponent(login.token)}`);
    await once(authed, 'open');
    const ready = await wsMessage(authed);
    assert.equal(ready.type, 'ready');
    authed.close();
  } finally {
    child.kill('SIGTERM');
  }
});
