#!/usr/bin/env python3
"""Reverse proxy for AgentRouter that strips non-standard billing stream events."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.request, os, sys

UPSTREAM = os.environ.get("AR_UPSTREAM", "https://agentrouter.org")
PORT = int(os.environ.get("AR_PROXY_PORT", "8787"))

class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _proxy(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        path = self.path
        # Anthropic SDK sometimes hits /messages; AgentRouter needs /v1/messages
        if path == "/messages" or path.startswith("/messages?"):
            path = "/v1" + path
        url = UPSTREAM.rstrip("/") + path
        headers = {k: v for k, v in self.headers.items()
                   if k.lower() not in ("host", "content-length", "transfer-encoding", "connection")}
        headers.setdefault("User-Agent", "codex_cli_rs/0.80.0")
        headers.setdefault("originator", "codex_cli_rs")
        req = urllib.request.Request(url, data=body, headers=headers, method=self.command)
        try:
            resp = urllib.request.urlopen(req, timeout=300)
        except Exception as e:
            data = e.read() if hasattr(e, "read") else str(e).encode()
            code = getattr(e, "code", 502)
            sys.stderr.write("UPSTREAM_ERR %s %s %s\n" % (self.command, self.path, data[:500]))
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        ctype = resp.headers.get("Content-Type", "application/json")
        self.send_response(resp.status)
        for hk in ("Content-Type", "Cache-Control"):
            if resp.headers.get(hk):
                self.send_header(hk, resp.headers.get(hk))
        if "text/event-stream" in ctype:
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()
            buf = b""
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                buf += chunk
                while b"\n\n" in buf:
                    event, buf = buf.split(b"\n\n", 1)
                    if b"billing_summary" in event or b"billing.summary" in event or b'"object":"billing.summary"' in event:
                        continue
                    # Claude-via-OpenAI streams sometimes emit bare null payloads that crash clients
                    stripped = event.strip()
                    if stripped in (b"data: null", b"data:null", b"data: null\n", b"null"):
                        continue
                    if b"data: null" in event and b"choices" not in event:
                        continue
                    # Drop empty-choice chunks (AgentRouter trailing usage stubs break AI SDK)
                    if b'"choices":[]' in event or b'"choices": []' in event:
                        continue
                    try:
                        self.wfile.write(event + b"\n\n")
                        self.wfile.flush()
                    except BrokenPipeError:
                        return
            if buf and b"billing" not in buf:
                try:
                    self.wfile.write(buf)
                except BrokenPipeError:
                    pass
        else:
            data = resp.read()
            # Strip AgentRouter non-standard billing field that breaks AI SDK JSON schemas
            try:
                import json as _json
                obj = _json.loads(data.decode("utf-8", "replace"))
                if isinstance(obj, dict) and "billing" in obj:
                    obj.pop("billing", None)
                    data = _json.dumps(obj).encode()
            except Exception:
                pass
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    def do_GET(self): self._proxy()
    def do_POST(self): self._proxy()
    def do_PUT(self): self._proxy()
    def do_DELETE(self): self._proxy()

if __name__ == "__main__":
    print(f"AgentRouter proxy on 127.0.0.1:{PORT} -> {UPSTREAM}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
