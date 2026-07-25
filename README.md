# AgentRouter Dashboard

A local, single-file web dashboard that turns [AgentRouter](https://agentrouter.org) into an agentic coding assistant with real command execution — a lightweight, self-hostable take on tools like Cursor, Claude Code, or Kimi.

The agent can propose and run shell commands on the host, read files, and interpret results — all through a clean chat UI with a collapsible "Thinking" panel.

## Features

- **Streaming chat** through any model AgentRouter exposes (Claude, GPT, Kimi, GLM, …) — picked from a dropdown, loaded dynamically
- **Agentic command execution** — the model proposes commands, they run in a real shell, and it interprets the output automatically
- **Collapsible "Thinking" panel** — reasoning and command steps are grouped and hidden until you expand them; the final answer shows clean
- **Command approval + safety layer** — dangerous commands are blocked; mutating ones require explicit approval
- **Clickable command chips** — expand any command to see its full logs and exit code
- **Markdown rendering** with syntax highlighting and copy buttons
- **File browser** + `@filename` context injection
- **Session history** — recent conversations saved locally, searchable, deletable
- **Edit & regenerate** messages, **system-prompt / persona editor**, **prompt library**, **markdown export**, **token counter**
- **Stop button** to interrupt a running turn
- **No build step** — the frontend is a single self-contained HTML file served by the backend

## Setup

```bash
git clone <your-repo-url>
cd agentrouter-dashboard
cp .env.example .env
# Edit .env and set your AGENT_ROUTER_TOKEN
npm install
npm start
```

Then open **http://localhost:3365**

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `AGENT_ROUTER_TOKEN` | Your AgentRouter API key (**required**) | — |
| `PORT` | Server port | `3365` |
| `OPENAI_BASE_URL` | OpenAI-compatible base URL to route through | AgentRouter proxy |
| `WORK_DIR` | Working directory for commands & file browser | project root |

## Architecture

```
Browser (web/index.html — single file, no build)
  ├─ Chat        →  POST /api/chat     →  AgentRouter (streaming SSE)
  ├─ Commands    →  POST /api/exec     →  bash -lc (non-interactive)
  ├─ Safety      →  POST /api/safety   →  command classifier
  ├─ Models      →  GET  /api/models   →  proxied model list
  └─ Files       →  GET  /api/files, /api/filelist, /api/file
```

Commands run via `execFile("bash", ["-lc", cmd])` — a fresh non-interactive shell per command, giving clean stdout/stderr and an exit code with no PTY echo noise.

## ⚠️ Security — read before running

**This app gives a web page the ability to run shell commands on the machine hosting it.** Treat it accordingly:

- **Never expose it to the public internet without authentication.** There is no built-in auth. Anyone who can reach the URL can run commands as the user running the server.
- The safety layer blocks obviously destructive commands (`rm -rf /`, `sudo`, `dd`, `mkfs`, fork bombs, …) and requires approval for mutating ones, but it is a **guardrail, not a sandbox**. Do not rely on it against a determined user.
- For real isolation, run it inside a **container or VM** and set `WORK_DIR` to a scratch directory.
- Your `AGENT_ROUTER_TOKEN` stays on the backend and is never sent to the browser. Keep `.env` out of version control (it's gitignored).
- If you tunnel it (ngrok, cloudflared, etc.) you are publishing shell access — put auth in front of it first.
