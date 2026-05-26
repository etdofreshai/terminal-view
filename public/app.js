import { Terminal } from '/vendor/xterm.js';
import { FitAddon } from '/vendor/xterm-addon-fit.js';

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
term.open(terminalEl);
fitAddon.fit();

let socket;
let resizeTimer;

function socketUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/terminal`;
}

function setStatus(text) {
  statusEl.textContent = text;
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
    if (msg.type === 'ready') setStatus(`Connected · ${msg.cwd}`);
    if (msg.type === 'data') term.write(msg.data);
    if (msg.type === 'exit') setStatus(`Shell exited (${msg.exitCode ?? msg.signal ?? 'unknown'})`);
  });

  socket.addEventListener('close', () => setStatus('Disconnected'));
  socket.addEventListener('error', () => setStatus('Connection error'));
}

function sendResize() {
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

connect();
