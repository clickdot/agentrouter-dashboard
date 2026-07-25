import "dotenv/config";
import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import pty from "node-pty";
import { execFile } from "child_process";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { classifyCommand } from "./safety.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(path.join(__dirname, "../web")));

const BASE_URL = "http://127.0.0.1:8787/v1";
const API_KEY  = process.env.AGENT_ROUTER_TOKEN;

// Chat endpoint — proxies to AgentRouter via raw fetch (no SDK extra headers)
app.post("/api/chat", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: "Missing AGENT_ROUTER_TOKEN in .env" });
  }

  const { messages, model = "gpt-5.5" } = req.body;

  // Retry a few times on transient upstream blocks (e.g. WAF 405 HTML pages)
  async function callUpstream(attempt = 0) {
    const upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ model, messages, stream: true }),
    });
    const ctype = upstream.headers.get("content-type") || "";
    // A WAF block returns HTML instead of an event-stream — retry
    if (!upstream.ok || ctype.includes("text/html")) {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
        return callUpstream(attempt + 1);
      }
      const text = await upstream.text();
      const clean = ctype.includes("text/html")
        ? `Upstream returned an HTML error page (status ${upstream.status}). The proxy or WAF likely blocked the request. Try again.`
        : text.slice(0, 500);
      const e = new Error(clean); e.status = upstream.status || 502; throw e;
    }
    return upstream;
  }

  try {
    const upstream = await callUpstream();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      // Forward SSE lines, rewriting "data: {...}" to extract just the delta
      for (const line of text.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") { res.write("data: [DONE]\n\n"); continue; }
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        } catch (_) {}
      }
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(err.status || 500).json({ error: err.message });
    else res.end();
  }
});

// Models endpoint — proxies from local AgentRouter proxy
app.get("/api/models", async (req, res) => {
  try {
    const r = await fetch(`${BASE_URL}/models`, {
      headers: { "Authorization": `Bearer ${API_KEY}` }
    });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Command safety check endpoint
app.post("/api/safety", (req, res) => {
  const { command } = req.body;
  res.json(classifyCommand(command));
});

// Command execution endpoint — runs non-interactively via bash -lc.
// Clean stdout/stderr + exit code, no PTY echo noise or prompt.
const WORK_DIR = process.env.WORK_DIR || path.join(__dirname, "..");

// Resolve a client-supplied relative path safely inside WORK_DIR (no traversal).
function safeResolve(rel) {
  const clean = (rel || "").replace(/^\/+/, "");
  const abs = path.resolve(WORK_DIR, clean);
  if (abs !== WORK_DIR && !abs.startsWith(WORK_DIR + path.sep)) return null;
  return abs;
}

const IGNORE_DIRS = new Set(["node_modules", ".git", ".cache", "dist", "build", ".next", "__pycache__", ".venv", "venv"]);

// File tree endpoint — one directory level at a time
app.get("/api/files", async (req, res) => {
  const dir = safeResolve(req.query.path || "");
  if (!dir) return res.status(400).json({ error: "Invalid path" });
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const items = entries
      .filter(e => !IGNORE_DIRS.has(e.name) && !e.name.startsWith(".DS"))
      .map(e => ({
        name: e.name,
        dir: e.isDirectory(),
        path: path.relative(WORK_DIR, path.join(dir, e.name)),
      }))
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Flat file list for @mention autocomplete (capped)
app.get("/api/filelist", async (req, res) => {
  const results = [];
  async function walk(dir, depth) {
    if (depth > 6 || results.length > 2000) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (IGNORE_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs, depth + 1);
      else results.push(path.relative(WORK_DIR, abs));
    }
  }
  await walk(WORK_DIR, 0);
  res.json({ files: results });
});

// Read a single file's contents
app.get("/api/file", async (req, res) => {
  const abs = safeResolve(req.query.path || "");
  if (!abs) return res.status(400).json({ error: "Invalid path" });
  try {
    const stat = await fs.stat(abs);
    if (stat.isDirectory()) return res.status(400).json({ error: "Is a directory" });
    if (stat.size > 2 * 1024 * 1024) return res.status(413).json({ error: "File too large (>2MB)" });
    const content = await fs.readFile(abs, "utf8");
    res.json({ content, path: path.relative(WORK_DIR, abs) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/exec", (req, res) => {
  const { command } = req.body;
  if (!command || typeof command !== "string") {
    return res.status(400).json({ error: "Missing command" });
  }
  execFile("bash", ["-lc", command], {
    cwd: WORK_DIR,
    env: process.env,
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024, // 10 MB
  }, (err, stdout, stderr) => {
    const exitCode = err && typeof err.code === "number" ? err.code : (err ? 1 : 0);
    const timedOut = err && err.killed === true;
    res.json({
      stdout: stdout || "",
      stderr: stderr || "",
      exitCode,
      timedOut: !!timedOut,
    });
  });
});

// Terminal WebSocket — one PTY per connection
const terminalWss = new WebSocketServer({ server, path: "/terminal" });

terminalWss.on("connection", (socket) => {
  const shell = process.platform === "win32" ? "powershell.exe" : "bash";

  const term = pty.spawn(shell, [], {
    name: "xterm-color",
    cols: 120,
    rows: 30,
    cwd: process.env.WORK_DIR || process.cwd(),
    env: process.env,
  });

  term.onData((data) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "output", data }));
    }
  });

  term.onExit(() => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "exit" }));
      socket.close();
    }
  });

  socket.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "input") term.write(msg.data);
      if (msg.type === "resize") term.resize(msg.cols, msg.rows);
      if (msg.type === "kill") { term.kill(); socket.close(); }
    } catch (_) {}
  });

  socket.on("close", () => term.kill());
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`AgentRouter Dashboard running → http://localhost:${PORT}`);
});
