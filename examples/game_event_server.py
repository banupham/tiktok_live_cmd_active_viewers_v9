from __future__ import annotations

import json
import os
import queue
import threading
from collections import deque
from datetime import datetime
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

SUPPORTED_EVENT_TYPES = {
    "middleware_status",
    "join",
    "comment",
    "follow",
    "like",
    "gift",
}

EVENT_QUEUE: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=MAX_QUEUE_SIZE)

_event_ids: set[str] = set()
_event_id_order: deque[str] = deque()
_event_id_lock = threading.Lock()

_connection_lock = threading.Lock()
_connection_state: dict[str, Any] = {
    "connected": False,
    "lastWebhookAt": None,
    "lastClientIp": None,
    "lastEventType": None,
    "receivedRequests": 0,
}


def time_text() -> str:
    return datetime.now().strftime("%H:%M:%S")


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


def mark_webhook_received(
    client_ip: str,
    event_type: str,
    event_id: str,
) -> None:
    with _connection_lock:
        _connection_state["connected"] = True
        _connection_state["lastWebhookAt"] = datetime.now().isoformat(timespec="seconds")
        _connection_state["lastClientIp"] = client_ip
        _connection_state["lastEventType"] = event_type
        _connection_state["receivedRequests"] += 1
        request_number = _connection_state["receivedRequests"]

    event_id_text = event_id or "không có"
    print(
        f"[{time_text()}] [WEBHOOK NHẬN #{request_number}] "
        f"từ {client_ip} | type={event_type} | eventId={event_id_text}",
        flush=True,
    )


def on_middleware_status(event: dict[str, Any]) -> None:
    payload = event.get("payload") or {}

    print("")
    print("============================================================")
    print("[KẾT NỐI OK] TIKTOK LIVE EVENT MIDDLEWARE → SERVER GAME")
    print(f"[THỜI GIAN] {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
    print(f"[TRẠNG THÁI] {payload.get('status', 'connected')}")
    print(f"[THÔNG BÁO] {payload.get('message', 'Đã nhận được webhook')}")
    if payload.get("webhookUrl"):
        print(f"[ĐỊA CHỈ] {payload.get('webhookUrl')}")
    print("============================================================")
    print("")


def on_join(event: dict[str, Any]) -> None:
    user = event.get("user") or {}
    print(f"[JOIN] {user.get('displayName')}", flush=True)

    # Ví dụ tích hợp game:
    # game.ensure_player(user)


def on_comment(event: dict[str, Any]) -> None:
    user = event.get("user") or {}
    payload = event.get("payload") or {}

    print(
        f"[COMMENT] {user.get('displayName')}: {payload.get('text')}",
        flush=True,
    )

    # Ví dụ tích hợp game:
    # game.execute_command(
    #     user_id=user.get("id"),
    #     command=payload.get("normalizedText"),
    # )


def on_follow(event: dict[str, Any]) -> None:
    user = event.get("user") or {}
    print(f"[FOLLOW] {user.get('displayName')}", flush=True)

    # Ví dụ tích hợp game:
    # game.reward_follow(user.get("id"))


def on_like(event: dict[str, Any]) -> None:
    payload = event.get("payload") or {}
    count = max(1, int(payload.get("count") or 1))

    # LIKE hiện là hoạt động tim ẩn danh.
    # Mỗi tim DOM bắt được tạo một event riêng với count=1.
    print(
        f"[LIKE] x{count} | source={payload.get('source')}",
        flush=True,
    )

    # Ví dụ tích hợp game:
    # game.add_global_energy(count)


def on_gift(event: dict[str, Any]) -> None:
    user = event.get("user") or {}
    payload = event.get("payload") or {}

    print(
        f"[GIFT] {user.get('displayName')} gửi "
        f"{payload.get('giftName')} x{payload.get('count', 1)} "
        f"| key={payload.get('giftKey')}",
        flush=True,
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
        "middleware_status": on_middleware_status,
        "join": on_join,
        "comment": on_comment,
        "follow": on_follow,
        "like": on_like,
        "gift": on_gift,
    }

    handler = handlers.get(event_type)
    if handler is None:
        print(f"[BỎ QUA] eventType không hỗ trợ: {event_type!r}", flush=True)
        return

    handler(event)


def event_worker() -> None:
    """Tự lấy event trong queue và gọi logic game."""
    while True:
        event = EVENT_QUEUE.get()

        try:
            handle_tiktok_event(event)
        except Exception as error:  # noqa: BLE001 - server mẫu phải tiếp tục chạy
            print(f"[GAME ERROR] {error}", flush=True)
        finally:
            EVENT_QUEUE.task_done()


class GameEventHandler(BaseHTTPRequestHandler):
    server_version = "TikTokGameEventServer/1.1"

    def log_message(self, format: str, *args: object) -> None:
        # Tắt access log mặc định; dùng log webhook rõ ràng ở mark_webhook_received().
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
            with _connection_lock:
                connection = dict(_connection_state)

            self.send_json(
                200,
                {
                    "ok": True,
                    "service": "game-event-server",
                    "eventPath": EVENT_PATH,
                    "queueSize": EVENT_QUEUE.qsize(),
                    "queueCapacity": MAX_QUEUE_SIZE,
                    "connection": connection,
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
        if event_type not in SUPPORTED_EVENT_TYPES:
            self.send_json(
                400,
                {
                    "ok": False,
                    "error": f"eventType không hỗ trợ: {event_type!r}",
                },
            )
            return

        event_id = str(event.get("eventId") or "")
        client_ip = self.client_address[0] if self.client_address else "không rõ"

        mark_webhook_received(client_ip, event_type, event_id)

        if not register_event_id(event_id):
            print(
                f"[{time_text()}] [WEBHOOK TRÙNG] eventId={event_id}",
                flush=True,
            )
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
    print("[ĐANG CHỜ] Chưa có middleware kết nối.")
    print("Hãy mở CMD khác và chạy:")
    print("  start_middleware_to_game.bat ten_tiktok")
    print("")
    print("Khi hai bên thông nhau, màn hình này sẽ hiện [KẾT NỐI OK].")
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
