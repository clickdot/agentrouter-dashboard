import { spawn } from "child_process";
import { createConnection } from "net";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROXY_PORT = parseInt(process.env.AR_PROXY_PORT || "8787");

function isPortInUse(port) {
  return new Promise((resolve) => {
    const s = createConnection(port, "127.0.0.1");
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
  });
}

let proxyProc = null;

async function startProxy() {
  if (await isPortInUse(PROXY_PORT)) {
    console.log(`AgentRouter proxy already running on port ${PROXY_PORT}, reusing it.`);
    return;
  }
  proxyProc = spawn("python3", [path.join(__dirname, "agentrouter-proxy.py")], {
    stdio: "inherit",
    env: { ...process.env, AR_PROXY_PORT: String(PROXY_PORT) },
  });
  proxyProc.on("error", (err) => {
    console.error("Failed to start proxy:", err.message);
    process.exit(1);
  });
  // Give it a moment to bind
  await new Promise((r) => setTimeout(r, 500));
}

async function main() {
  await startProxy();

  const server = spawn("node", [path.join(__dirname, "server.js")], {
    stdio: "inherit",
    env: { ...process.env, OPENAI_BASE_URL: `http://127.0.0.1:${PROXY_PORT}/v1` },
  });

  server.on("error", (err) => {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  });

  server.on("exit", (code) => process.exit(code ?? 0));
}

main();

process.on("exit", () => proxyProc?.kill());
process.on("SIGINT", () => process.exit());
process.on("SIGTERM", () => process.exit());
