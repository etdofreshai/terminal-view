# terminal-view

A tiny web app that opens an interactive shell in the browser.

## Configuration

- `STARTING_DIRECTORY`: directory where new terminal sessions start. Defaults to `~/workspace`.
- `PORT`: HTTP port. Defaults to `3000`.
- `SHELL`: shell executable. Defaults to `$SHELL`, then `/bin/bash`.

`STARTING_DIRECTORY` supports `~` expansion and is created if it does not exist.

## Run

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

Example:

```bash
STARTING_DIRECTORY=/srv/projects PORT=8080 npm start
```

## Security note

This app exposes a real shell to anyone who can reach the website. Put it behind trusted network controls/authentication before exposing it beyond localhost/private infrastructure.
