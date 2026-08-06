from __future__ import annotations

import json
import os
import queue
import threading
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

# Mặc định chỉ nhận kết nối nội bộ trên chính máy này.
# Muốn nhận từ máy khác trong LAN: set GAME_EVENT_HOST=0.0.0.0
HOST = os.environ.get("GAME_EVENT_HOST", "127.0.0.1").strip()
PORT = int(os.environ.get("GAME_EVENT_PORT", "9000"))
EVENT_PATH = os.environ.get("GAME_EVENT_PATH", "/tiktok-event").strip()
MAX_BODY_BYTES = int(os.environ.get("GAME_EVENT_MAX_BODY", str(2 * 1024 * 1024)))
MAX_QUEUE_SIZE = int(os.environ.get("GAME_EVENT_QUEUE_SIZE", "5000"))
MAX_REMEMBERED_EVENT_IDS = int(os.environ.get("GAME_EVENT_ID_CACHE", "10000"))

EVENT_QUEUE: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=MAX_QUEUE_SIZE)

_event_ids: set[str] = set()
_event_id_order: deque[str] = deque()
_event_id_lock = threading.Lock()


def register_event_id(event_id: str) -> bool:
    """Trả về False nếu eventId đã được xử lý trước đó."""
    if not event_id:
        return True

    with _event_id_lock:
        if event_id in _event_ids:
            return False

        _event_ids.add(event_id)
        _event_id_order.append(event_id)

        while len(_event_id_order) > MAX_REMEMBERED_EVENT_IDS:
            expired = _event_id_order.popleft()
            _event_ids.discard(expired)

    return True


def unregister_event_id(event_id: str) -> None:
    """Hủy đăng ký nếu chưa thể đưa event vào queue."""
    if not event_id:
        return

    with _event_id_lock:
        _event_ids.discard(event_id)
        try:
            _event_id_order.remove(event_id)
        except ValueError:
            pass


def on_join(event: dict[str, Any]) -> None:
    user = event.get("user") or {}
    print(f"[JOIN] {user.get('displayName')}")

    # Ví dụ tích hợp game:
    # game.ensure_player(user)


def on_comment(event: dict[str, Any]) -> None:
    user = event.get("user") or {}
    payload = event.get("payload") or {}

    print(
        f"[COMMENT] {user.get('displayName')}: "
        f"{payload.get('text')}"
    )

    # Ví dụ tích hợp game:
    # game.execute_command(
    #     user_id=user.get("id"),
    #     command=payload.get("normalizedText"),
    # )


def on_follow(event: dict[str, Any]) -> None:
    user = event.get("user") or {}
    print(f"[FOLLOW] {user.get('displayName')}")

    # Ví dụ tích hợp game:
    # game.reward_follow(user.get("id"))


def on_like(event: dict[str, Any]) -> None:
    payload = event.get("payload") or {}
    count = max(1, int(payload.get("count") or 1))

    # LIKE hiện là hoạt động tim ẩn danh.
    # Mỗi tim DOM bắt được tạo một event riêng với count=1.
    print(f"[LIKE] x{count} | source={payload.get('source')}")

    # Ví dụ tích hợp game:
    # game.add_global_energy(count)


def on_gift(event: dict[str, Any]) -> None:
    user = event.get("user") or {}
    payload = event.get("payload") or {}

    print(
        f"[GIFT] {user.get('displayName')} gửi "
        f"{payload.get('giftName')} x{payload.get('count', 1)} "
        f"| key={payload.get('giftKey')}"
    )

    # Ví dụ tích hợp game:
    # game.apply_gift(
    #     user_id=user.get("id"),
    #     gift_key=payload.get("giftKey"),
    #     count=payload.get("count", 1),
    # )


def handle_tiktok_event(event: dict[str, Any]) -> None:
    """
    Đây là hàm trung tâm cần thay đổi khi tích hợp vào game thật.

    HTTP server chỉ nhận JSON và đưa vào EVENT_QUEUE. Worker gọi hàm này
    tự động ngay khi có event mới; game không cần gọi middleware để hỏi.
    """
    event_type = str(event.get("eventType") or "").lower()

    handlers = {
        "join": on_join,
        "comment": on_comment,
        "follow": on_follow,
        "like": on_like,
        "gift": on_gift,
    }

    handler = handlers.get(event_type)
    if handler is None:
        print(f"[BỎ QUA] eventType không hỗ trợ: {event_type!r}")
        return

    handler(event)


def event_worker() -> None:
    """Tự lấy event trong queue và gọi logic game."""
    while True:
        event = EVENT_QUEUE.get()

        try:
            handle_tiktok_event(event)
        except Exception as error:  # noqa: BLE001 - server mẫu phải tiếp tục chạy
            print(f"[GAME ERROR] {error}")
        finally:
            EVENT_QUEUE.task_done()


class GameEventHandler(BaseHTTPRequestHandler):
    server_version = "TikTokGameEventServer/1.0"

    def log_message(self, format: str, *args: object) -> None:
        # Tắt access log mặc định để chỉ nhìn thấy event.
        return

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(
                200,
                {
                    "ok": True,
                    "service": "game-event-server",
                    "eventPath": EVENT_PATH,
                    "queueSize": EVENT_QUEUE.qsize(),
                    "queueCapacity": MAX_QUEUE_SIZE,
                },
            )
            return

        self.send_json(404, {"ok": False, "error": "Not found"})

    def do_POST(self) -> None:
        if self.path != EVENT_PATH:
            self.send_json(404, {"ok": False, "error": "Not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"ok": False, "error": "Content-Length không hợp lệ"})
            return

        if content_length <= 0:
            self.send_json(400, {"ok": False, "error": "Body rỗng"})
            return

        if content_length > MAX_BODY_BYTES:
            self.send_json(413, {"ok": False, "error": "Body quá lớn"})
            return

        try:
            raw_body = self.rfile.read(content_length)
            event = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            self.send_json(400, {"ok": False, "error": f"JSON không hợp lệ: {error}"})
            return

        if not isinstance(event, dict):
            self.send_json(400, {"ok": False, "error": "Event phải là JSON object"})
            return

        event_type = str(event.get("eventType") or "").lower()
        if event_type not in {"join", "comment", "follow", "like", "gift"}:
            self.send_json(
                400,
                {
                    "ok": False,
                    "error": f"eventType không hỗ trợ: {event_type!r}",
                },
            )
            return

        event_id = str(event.get("eventId") or "")

        if not register_event_id(event_id):
            # Webhook có thể retry khi timeout. Event trùng vẫn trả 200 để
            # middleware biết rằng server đã nhận event này trước đó.
            self.send_json(
                200,
                {
                    "ok": True,
                    "duplicate": True,
                    "eventId": event_id or None,
                },
            )
            return

        try:
            EVENT_QUEUE.put_nowait(event)
        except queue.Full:
            unregister_event_id(event_id)
            self.send_json(
                503,
                {
                    "ok": False,
                    "error": "Hàng đợi game đang đầy",
                },
            )
            return

        # Trả lời ngay sau khi đã đưa vào queue. Worker sẽ tự xử lý tiếp.
        self.send_json(
            202,
            {
                "ok": True,
                "accepted": True,
                "eventId": event_id or None,
                "queueSize": EVENT_QUEUE.qsize(),
            },
        )


class GameEventHttpServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    worker = threading.Thread(
        target=event_worker,
        name="tiktok-game-event-worker",
        daemon=True,
    )
    worker.start()

    server = GameEventHttpServer((HOST, PORT), GameEventHandler)

    print("TIKTOK GAME EVENT SERVER")
    print(f"Nhận event : http://{HOST}:{PORT}{EVENT_PATH}")
    print(f"Health     : http://{HOST}:{PORT}/health")
    print("")
    print("Server đang đứng chờ. Middleware sẽ tự POST event tới đây.")
    print("Game không cần gọi /api/recent hoặc polling middleware.")
    print("Nhấn Ctrl + C để dừng.")

    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\nĐang dừng game event server...")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
