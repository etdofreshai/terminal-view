FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    STARTING_DIRECTORY=~/workspace \
    SHELL=/bin/bash \
    NPM_CONFIG_PREFIX=/usr/local

# Base terminal tooling plus the AI coding harness CLIs ET uses:
# - claude: Claude Code
# - codex: OpenAI Codex CLI
# - opencode: OpenCode CLI
# - gemini: Google Gemini CLI
# - pi: Pi Coding Agent
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      git \
      openssh-client \
      python3 \
      procps \
      ripgrep \
      tmux \
      unzip \
      vim-tiny \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g \
      @anthropic-ai/claude-code@latest \
      @openai/codex@latest \
      opencode-ai@latest \
      @google/gemini-cli@latest \
      @earendil-works/pi-coding-agent@latest \
    && npm cache clean --force

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY server.js README.md ./

RUN mkdir -p /root/workspace
VOLUME ["/root/workspace"]

EXPOSE 3000

CMD ["npm", "start"]
