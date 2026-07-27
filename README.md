# AgentRouter Dashboard

A local, single-file web dashboard that turns [AgentRouter](https://agentrouter.org) into an agentic coding assistant with real command execution — a lightweight, self-hostable take on tools like Cursor, Claude Code, or Kimi.

The agent can propose and run shell commands, build files in a per-chat workspace, read files, and interpret results — all through a clean chat UI with a collapsible "Thinking" panel.

## Features

- **Streaming chat** through any model AgentRouter exposes (Claude, GPT, Kimi, GLM, …) — picked from a dropdown, loaded dynamically
- **Agentic command execution** — the model proposes commands, they run in a real shell, and it interprets the output automatically
- **Per-chat workspaces** — each conversation gets its own directory; files the agent builds (scripts, dashboards, etc.) show in a Files panel and HTML can be previewed
- **Collapsible "Thinking" panel** — reasoning and command steps are grouped and hidden until you expand them; the final answer shows clean
- **Command approval + safety layer** — dangerous commands are blocked; mutating ones require explicit approval
- **Clickable command chips** — expand any command to see its full logs and exit code
- **Markdown rendering** with syntax highlighting and copy buttons
- **File browser** + `@filename` context injection
- **Session history** — recent conversations saved locally, searchable, deletable
- **Edit & regenerate** messages, **system-prompt / persona editor**, **prompt library**, **markdown export**, **token counter**
- **Stop button** to interrupt a running turn
- **No build step** — the frontend is a single self-contained HTML file served by the backend

## Requirements

- **Node.js 18+** (uses the built-in `fetch`)
- An **AgentRouter API key** — get one at [agentrouter.org](https://agentrouter.org)
- **bash** available on the host (commands run via `bash -lc`)

## Quick start

```bash
git clone https://github.com/clickdot/agentrouter-dashboard.git
cd agentrouter-dashboard
cp .env.example .env
# Edit .env and set your AGENT_ROUTER_TOKEN (see below)
npm install
npm start
```

Then open **http://localhost:3365**

### Configure `.env`

```ini
# Required — your AgentRouter API key
AGENT_ROUTER_TOKEN=sk-your-key-here

# Optional
PORT=3365
# OpenAI-compatible endpoint the backend calls. Defaults to AgentRouter's API.
OPENAI_BASE_URL=https://agentrouter.org/v1
# Working directory root for per-chat workspaces (defaults to ./workspaces)
# WORKSPACES_ROOT=/path/to/workspaces
```

> **Note:** if you run AgentRouter through a local proxy, point `OPENAI_BASE_URL` at it (e.g. `http://127.0.0.1:8787/v1`).

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `AGENT_ROUTER_TOKEN` | Your AgentRouter API key (**required**) | — |
| `PORT` | Server port | `3365` |
| `OPENAI_BASE_URL` | OpenAI-compatible base URL to route through | `https://agentrouter.org/v1` |
| `WORKSPACES_ROOT` | Directory that holds per-chat workspaces | `./workspaces` |

## Remote access with Cloudflare Tunnel

To reach the dashboard from another device (or share it), expose the local port with a Cloudflare Tunnel. This does **not** require a Cloudflare account for a quick tunnel.

### 1. Install cloudflared

```bash
# Debian/Ubuntu
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# macOS
brew install cloudflared
```

### 2. Start the dashboard, then the tunnel

```bash
# terminal 1 — run the app
npm start                      # serves on http://localhost:3365

# terminal 2 — expose it
cloudflared tunnel --url http://localhost:3365 --no-autoupdate
```

cloudflared prints a public URL like:

```
https://random-words-here.trycloudflare.com
```

Open that URL from anywhere. **Quick tunnels get a new random URL each time they start** and have no uptime guarantee.

### Stable URL (optional, needs a free Cloudflare account)

```bash
cloudflared login
cloudflared tunnel create agentrouter
cloudflared tunnel route dns agentrouter dash.yourdomain.com
cloudflared tunnel run --url http://localhost:3365 agentrouter
```

> ⚠️ **Exposing this app publicly = exposing shell access.** See the Security section before you do this.

## Architecture

```
Browser (web/index.html — single file, no build)
  ├─ Chat        →  POST /api/chat      →  AgentRouter (streaming SSE)
  ├─ Commands    →  POST /api/exec      →  bash -lc in the chat's workspace
  ├─ Safety      →  POST /api/safety    →  command classifier
  ├─ Models      →  GET  /api/models    →  proxied model list
  ├─ Files       →  GET  /api/files, /api/filelist, /api/file
  └─ Preview     →  GET  /workspace/<session>/<file>   (raw static serve)
```

- Commands run via `execFile("bash", ["-lc", cmd])` — a fresh non-interactive shell per command, giving clean stdout/stderr and an exit code with no PTY echo noise.
- Each chat session gets an isolated directory under `workspaces/<sessionId>/`. Commands run there, the file browser is scoped to it, and HTML files can be previewed in the browser.

## ⚠️ Security — read before running

**This app gives a web page the ability to run shell commands on the machine hosting it.** Treat it accordingly:

- **Never expose it to the public internet without authentication.** There is no built-in auth. Anyone who can reach the URL (including a shared Cloudflare Tunnel link) can run commands as the user running the server.
- The safety layer blocks obviously destructive commands (`rm -rf /`, `sudo`, `dd`, `mkfs`, fork bombs, …) and requires approval for mutating ones, but it is a **guardrail, not a sandbox**. Do not rely on it against a determined user.
- For real isolation, run it inside a **container or VM**.
- Your `AGENT_ROUTER_TOKEN` stays on the backend and is never sent to the browser. Keep `.env` out of version control (it's gitignored).
- Per-chat workspaces (`workspaces/`) are gitignored so agent-generated files never get committed.

## License

No license yet — all rights reserved by default. Open an issue if you'd like one added.
