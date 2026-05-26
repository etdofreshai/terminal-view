# terminal-view

A tiny web app that opens an interactive shell in the browser.

## Configuration

- `STARTING_DIRECTORY`: directory where new terminal sessions start. Defaults to exactly `~/workspace`.
- `PORT`: HTTP port. Defaults to `3000`.
- `SHELL`: shell executable. Defaults to `$SHELL`, then `/bin/bash`.
- `TERMINAL_PASSWORD`: optional web unlock password. If set, the browser shows a password screen before opening a shell.

`STARTING_DIRECTORY` supports `~` expansion and is created if it does not exist.

## Run locally

Most of the time, just run it directly with npm:

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

Example:

```bash
STARTING_DIRECTORY=/srv/projects PORT=8080 npm start
```

## Docker / Dokploy

The Docker image includes the AI coding harness CLIs ET commonly uses in terminal sessions:

- `claude` — Claude Code
- `codex` — OpenAI Codex CLI
- `opencode` — OpenCode CLI
- `gemini` — Google Gemini CLI
- `pi` — Pi Coding Agent

Build and run:

```bash
docker build -t terminal-view .
docker run --rm -p 3000:3000 \
  -e STARTING_DIRECTORY='~/workspace' \
  -v "$HOME/workspace:/root/workspace" \
  terminal-view
```

For Dokploy, set at least:

```env
STARTING_DIRECTORY=~/workspace
PORT=3000
```

Mount the directory you want exposed as `/root/workspace`; terminal sessions start from `~/workspace`, which resolves to `/root/workspace` inside the container. CLI auth files and provider API keys are not baked into the image; pass them as environment variables or mount the relevant home-directory auth files when needed.

## Security note

This app exposes a real shell to anyone who can reach the website. Put it behind trusted network controls/authentication before exposing it beyond localhost/private infrastructure.
