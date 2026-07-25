// Command safety classification layer.
// Every command the AI proposes or the user runs passes through here before execution.

const dangerousPatterns = [
  /\brm\s+-rf\s+\//,
  /\bsudo\b/,
  /\bdd\s+if=/,
  /\bmkfs\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bchmod\s+-R\s+777\s+\//,
  /\bchown\s+-R\b/,
  />\s*\/dev\/sd[a-z]/,
  /:\(\)\s*\{.*\}\s*;/, // fork bomb
];

const mutatingPatterns = [
  /\bnpm\s+install\b/,
  /\bpnpm\s+install\b/,
  /\byarn\s+add\b/,
  /\brm\b/,
  /\bmv\b/,
  /\bcp\b/,
  /\bgit\s+commit\b/,
  /\bgit\s+push\b/,
  /\bgit\s+reset\b/,
  /\bgit\s+checkout\b/,
];

export function classifyCommand(command) {
  const trimmed = (command ?? "").trim();

  if (!trimmed) {
    return { allowed: false, requiresApproval: false, reason: "Empty command." };
  }

  if (dangerousPatterns.some((pattern) => pattern.test(trimmed))) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "Command matches a dangerous pattern and is blocked by default.",
    };
  }

  if (mutatingPatterns.some((pattern) => pattern.test(trimmed))) {
    return {
      allowed: true,
      requiresApproval: true,
      reason: "Command may modify files or external state.",
    };
  }

  return {
    allowed: true,
    requiresApproval: false,
    reason: "Command appears read-only or low risk.",
  };
}
