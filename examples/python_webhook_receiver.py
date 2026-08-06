from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return

    def do_POST(self) -> None:
        if self.path != "/tiktok-event":
            self.send_error(404)
            return

        try:
            size = int(self.headers.get("Content-Length", "0"))
            event = json.loads(self.rfile.read(size) or b"{}")

            print(
                f"[{event.get('eventType')}] "
                f"{event.get('user', {}).get('displayName')} "
                f"{event.get('payload', {})}"
            )

            body = json.dumps({"ok": True}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ValueError, json.JSONDecodeError) as error:
            body = json.dumps({"ok": False, "error": str(error)}).encode("utf-8")
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)


server = ThreadingHTTPServer(("127.0.0.1", 9000), Handler)
print("Webhook receiver: http://127.0.0.1:9000/tiktok-event")
server.serve_forever()
