import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('terminal UI exposes a logout button', () => {
  assert.match(html, /id="logout"/);
  assert.match(html, />\s*Log out\s*</);
});

test('auth token persists in localStorage so login survives browser restarts', () => {
  assert.match(app, /localStorage\.getItem\('terminalViewToken'\)/);
  assert.match(app, /localStorage\.setItem\('terminalViewToken'/);
  assert.doesNotMatch(app, /sessionStorage\.setItem\('terminalViewToken'/);
});

test('logout clears persisted token and returns to login screen', () => {
  assert.match(app, /localStorage\.removeItem\('terminalViewToken'\)/);
  assert.match(app, /logoutButton\.addEventListener\('click'/);
});

test('frontend builds API and WebSocket URLs from the configured subpath', () => {
  assert.match(html, /window\.TERMINAL_VIEW_BASE_PATH = '__APP_BASE_PATH__'/);
  assert.match(html, /href="__APP_BASE_PATH__styles\.css"/);
  assert.match(html, /src="__APP_BASE_PATH__app\.js"/);
  assert.match(app, /window\.TERMINAL_VIEW_BASE_PATH/);
  assert.match(app, /function appBasePath\(\)/);
  assert.match(app, /return `\$\{path\}\/`/);
  assert.match(app, /fetch\(appUrl\('api\/login'\)/);
  assert.match(app, /return `\$\{proto\}\/\/\$\{location\.host\}\$\{appUrl\('terminal'\)\}/);
});
