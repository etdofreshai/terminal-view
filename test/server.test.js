import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const port = 3300 + Math.floor(Math.random() * 1000);
const startingDirectory = '/tmp/terminal-view-test-start';

function waitForMessage(ws, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for websocket message')), timeoutMs);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

test('server exposes health and starts shell in STARTING_DIRECTORY', async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), STARTING_DIRECTORY: startingDirectory, SHELL: '/bin/bash' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await once(child.stdout, 'data');
    const health = await fetch(`http://127.0.0.1:${port}/healthz`).then((r) => r.json());
    assert.equal(health.ok, true);
    assert.equal(health.startingDirectory, startingDirectory);

    const subpath = await fetch(`http://127.0.0.1:${port}/etzminisforumx1pro`).then((r) => r.text());
    assert.match(subpath, /window\.TERMINAL_VIEW_BASE_PATH = '\/'/);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/terminal`);
    await once(ws, 'open');
    const ready = await waitForMessage(ws, (msg) => msg.type === 'ready');
    assert.equal(ready.cwd, startingDirectory);

    ws.send(JSON.stringify({ type: 'data', data: 'pwd; exit\r' }));
    const output = await waitForMessage(ws, (msg) => msg.type === 'data' && msg.data.includes(startingDirectory));
    assert.match(output.data, /terminal-view-test-start/);
    ws.close();
  } finally {
    child.kill('SIGTERM');
  }
});
