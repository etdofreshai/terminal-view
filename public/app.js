const { Terminal } = window;
const { FitAddon } = window.FitAddon;

const loginScreen = document.querySelector('#login-screen');
const terminalScreen = document.querySelector('#terminal-screen');
const loginForm = document.querySelector('#login-form');
const passwordInput = document.querySelector('#terminal-password');
const loginError = document.querySelector('#login-error');
const terminalEl = document.querySelector('#terminal');
const statusEl = document.querySelector('#status');
const reconnectButton = document.querySelector('#reconnect');

const term = new Terminal({
  cursorBlink: true,
  convertEol: true,
  fontFamily: 'JetBrains Mono, SFMono-Regular, Consolas, Liberation Mono, monospace',
  fontSize: 14,
  theme: {
    background: '#020409',
    foreground: '#d8f3ff',
    cursor: '#00e5ff',
    selectionBackground: '#174c64',
    black: '#0b1220',
    red: '#ff5c7a',
    green: '#40ffaa',
    yellow: '#ffd166',
    blue: '#5cc8ff',
    magenta: '#c084fc',
    cyan: '#00e5ff',
    white: '#effaff',
  },
});
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

let socket;
let resizeTimer;
let authToken = sessionStorage.getItem('terminalViewToken') || '';
let terminalOpened = false;

function socketUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const tokenParam = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
  return `${proto}//${location.host}/terminal${tokenParam}`;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function showTerminal() {
  loginScreen.hidden = true;
  terminalScreen.hidden = false;
  if (!terminalOpened) {
    term.open(terminalEl);
    terminalOpened = true;
  }
  setTimeout(sendResize, 0);
}

function showLogin(message = '') {
  terminalScreen.hidden = true;
  loginScreen.hidden = false;
  loginError.textContent = message;
  passwordInput.focus();
}

async function login(password) {
  loginError.textContent = '';
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) throw new Error('Invalid password');
  const body = await response.json();
  authToken = body.token;
  sessionStorage.setItem('terminalViewToken', authToken);
  showTerminal();
  connect();
}

function connect() {
  if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
  term.clear();
  setStatus('Connecting…');
  socket = new WebSocket(socketUrl());

  socket.addEventListener('open', () => {
    setStatus('Connected');
    sendResize();
  });

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'auth_required') {
      sessionStorage.removeItem('terminalViewToken');
      authToken = '';
      showLogin('Password required');
      return;
    }
    if (msg.type === 'ready') setStatus(`Connected · ${msg.cwd}`);
    if (msg.type === 'data') term.write(msg.data);
    if (msg.type === 'exit') setStatus(`Shell exited (${msg.exitCode ?? msg.signal ?? 'unknown'})`);
  });

  socket.addEventListener('close', () => {
    if (!loginScreen.hidden) return;
    setStatus('Disconnected');
  });
  socket.addEventListener('error', () => setStatus('Connection error'));
}

function sendResize() {
  if (!terminalOpened) return;
  fitAddon.fit();
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  }
}

term.onData((data) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'data', data }));
});

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(sendResize, 80);
});
reconnectButton.addEventListener('click', connect);
loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await login(passwordInput.value);
    passwordInput.value = '';
  } catch {
    showLogin('Invalid password');
    passwordInput.select();
  }
});

if (authToken) {
  showTerminal();
  connect();
} else {
  showLogin();
}
