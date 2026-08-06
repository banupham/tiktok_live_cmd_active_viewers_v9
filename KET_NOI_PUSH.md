# KẾT NỐI TỰ ĐỘNG VỚI TIKTOK LIVE EVENT MIDDLEWARE

Tài liệu này hướng dẫn game hoặc ứng dụng nhận event TikTok LIVE **ngay khi middleware bắt được**.

Game không phải gọi `/api/recent` theo vòng lặp và không phải hỏi middleware xem có event mới hay chưa.

## 1. Luồng nhận tự động

```text
TikTok LIVE
    ↓
DOM collector bắt event
    ↓
Middleware chuẩn hóa JSON
    ↓ HTTP POST tự động
Server game / ứng dụng
    ↓
Đưa event vào queue
    ↓
Logic game xử lý
```

Cơ chế phù hợp nhất trong hệ thống nội bộ là **Webhook**:

```text
POST http://127.0.0.1:9000/tiktok-event
Content-Type: application/json
```

Mỗi khi có `join`, `comment`, `follow`, `gift` hoặc `like`, middleware tự gửi một request POST mới tới server game.

## 2. Chạy nhanh trên cùng một máy

### CMD thứ nhất — mở server game

```cmd
python examples\game_event_server.py
```

Kết quả:

```text
TIKTOK GAME EVENT SERVER
Nhận event : http://127.0.0.1:9000/tiktok-event
Health     : http://127.0.0.1:9000/health

Server đang đứng chờ. Middleware sẽ tự POST event tới đây.
Game không cần gọi /api/recent hoặc polling middleware.
```

### CMD thứ hai — chạy middleware và trỏ tới server game

Cách nhanh nhất:

```cmd
start_middleware_to_game.bat ten_tiktok
```

File BAT đã cấu hình sẵn:

```cmd
set "WEBHOOK_URLS=http://127.0.0.1:9000/tiktok-event"
set "WEBHOOK_TIMEOUT_MS=3000"
set "WEBHOOK_RETRY_COUNT=1"
```

Hoặc chạy thủ công:

```cmd
set "WEBHOOK_URLS=http://127.0.0.1:9000/tiktok-event"
start_visible.bat ten_tiktok
```

Từ thời điểm đó, server game chỉ đứng chờ. Middleware chủ động bắn event sang.

## 3. Kết quả nhận tự động

Khi có comment:

```text
[COMMENT] Nguyễn Văn A: đánh
```

Khi có quà:

```text
[GIFT] Nguyễn Văn B gửi Hoa Hồng x1 | key=hoa_hong
```

Khi có tim LIKE:

```text
[LIKE] x1 | source=heart-animation
[LIKE] x1 | source=heart-animation
[LIKE] x1 | source=heart-animation
```

LIKE hiện hoạt động theo nguyên tắc:

```text
Một phần tử tim DOM bắt được
        ↓
Một event LIKE
        ↓
payload.count = 1
        ↓
Một webhook POST riêng
```

Không gom nhiều tim thành một event và không xác định người đã like.

## 4. File mẫu `examples/game_event_server.py`

File này chỉ dùng thư viện chuẩn của Python, không cần cài Flask hoặc FastAPI.

Nó có các chức năng:

- mở `POST /tiktok-event`;
- nhận JSON do middleware tự gửi;
- chống xử lý trùng bằng `eventId`;
- đưa event vào `queue.Queue`;
- trả HTTP ngay để middleware không phải chờ logic game chạy xong;
- worker tự lấy event trong queue và gọi logic game;
- mở `GET /health` để kiểm tra server;
- mặc định chỉ lắng nghe `127.0.0.1`.

Toàn bộ mã:

```python
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
        except Exception as error:
            print(f"[GAME ERROR] {error}")
        finally:
            EVENT_QUEUE.task_done()


class GameEventHandler(BaseHTTPRequestHandler):
    server_version = "TikTokGameEventServer/1.0"

    def log_message(self, format: str, *args: object) -> None:
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
```

## 5. Chỗ cần sửa khi tích hợp vào game thật

Không sửa phần HTTP nếu không cần thiết. Chủ yếu thay code trong năm hàm:

```python
on_join(event)
on_comment(event)
on_follow(event)
on_like(event)
on_gift(event)
```

Ví dụ:

```python
def on_like(event: dict) -> None:
    payload = event.get("payload") or {}
    game.add_global_energy(payload.get("count", 1))
```

```python
def on_comment(event: dict) -> None:
    user = event.get("user") or {}
    payload = event.get("payload") or {}

    game.execute_command(
        user_id=user.get("id"),
        command=payload.get("normalizedText"),
    )
```

```python
def on_gift(event: dict) -> None:
    user = event.get("user") or {}
    payload = event.get("payload") or {}

    game.apply_gift(
        user_id=user.get("id"),
        gift_key=payload.get("giftKey"),
        count=payload.get("count", 1),
    )
```

Nếu engine yêu cầu thay đổi trạng thái trên main thread, giữ nguyên HTTP receiver nhưng để main loop của game lấy dữ liệu từ `EVENT_QUEUE` thay vì gọi trực tiếp object game trong thread HTTP.

## 6. Schema event chung

```json
{
  "schemaVersion": 1,
  "eventId": "3dbde00f458b4100ba7af055f35f1404",
  "eventType": "comment",
  "timestamp": 1786000000000,
  "receivedAt": 1786000000010,
  "source": {
    "platform": "tiktok",
    "collector": "dom",
    "liveUrl": "https://www.tiktok.com/@username/live"
  },
  "user": {
    "id": "duong123",
    "uniqueId": "duong123",
    "displayName": "Dương",
    "identityType": "uniqueId"
  },
  "payload": {},
  "raw": {
    "text": null
  }
}
```

Các loại:

```text
join
comment
follow
like
gift
```

Middleware không phát `leave`.

### COMMENT

```json
{
  "eventType": "comment",
  "user": {
    "id": "duong123",
    "displayName": "Dương"
  },
  "payload": {
    "text": "đánh",
    "normalizedText": "ĐÁNH"
  }
}
```

### GIFT

```json
{
  "eventType": "gift",
  "user": {
    "id": "duong123",
    "displayName": "Dương"
  },
  "payload": {
    "giftName": "Hoa Hồng",
    "giftKey": "hoa_hong",
    "count": 1,
    "totalCount": 3
  }
}
```

### LIKE mới nhất

```json
{
  "eventType": "like",
  "user": {
    "id": "anonymous:like",
    "uniqueId": null,
    "displayName": "LIKE",
    "identityType": "anonymous"
  },
  "payload": {
    "count": 1,
    "action": "heart-animation",
    "source": "heart-animation",
    "anonymous": true,
    "suspected": true
  }
}
```

Mỗi tim được gửi riêng, vì vậy game không cần chia `count` hoặc chờ một gói tổng hợp.

## 7. Vì sao dùng queue?

Webhook có thể tới rất nhanh, đặc biệt khi LIVE có nhiều tim.

Nếu xử lý trực tiếp logic nặng trong `do_POST()`:

```text
Request đến
    ↓
Chờ hiệu ứng game chạy xong
    ↓
Mới trả HTTP
```

middleware có thể timeout và retry.

Server mẫu dùng:

```text
Request đến
    ↓
Kiểm tra eventId
    ↓
Đưa vào queue
    ↓
Trả HTTP 202 ngay
    ↓
Worker tự xử lý game
```

## 8. Chống xử lý trùng

Middleware mặc định thử gửi lại một lần nếu webhook lỗi hoặc timeout.

Mỗi event có `eventId` riêng. Server mẫu lưu tối đa 10.000 ID gần nhất:

```python
if not register_event_id(event_id):
    return duplicate_response
```

Nếu nhận lại cùng `eventId`, server trả:

```json
{
  "ok": true,
  "duplicate": true
}
```

nhưng không chạy logic game lần thứ hai.

## 9. Kiểm tra server game

Sau khi chạy `game_event_server.py`:

```cmd
curl http://127.0.0.1:9000/health
```

Kết quả:

```json
{
  "ok": true,
  "service": "game-event-server",
  "eventPath": "/tiktok-event",
  "queueSize": 0,
  "queueCapacity": 5000
}
```

## 10. Gửi thử event thủ công

Có thể kiểm tra server game mà chưa mở TikTok:

```cmd
curl -X POST http://127.0.0.1:9000/tiktok-event ^
  -H "Content-Type: application/json" ^
  -d "{\"schemaVersion\":1,\"eventId\":\"test-like-001\",\"eventType\":\"like\",\"user\":{\"id\":\"anonymous:like\",\"displayName\":\"LIKE\"},\"payload\":{\"count\":1,\"source\":\"heart-animation\",\"anonymous\":true}}"
```

Server phải hiện:

```text
[LIKE] x1 | source=heart-animation
```

## 11. Gửi tới nhiều game hoặc ứng dụng

Phân cách URL bằng dấu phẩy:

```cmd
set "WEBHOOK_URLS=http://127.0.0.1:9000/tiktok-event,http://127.0.0.1:9001/tiktok-event"
start_visible.bat ten_tiktok
```

Một event sẽ được gửi đồng thời tới cả hai URL.

## 12. Game ở máy khác trong mạng LAN

Ví dụ:

```text
Máy middleware: 192.168.1.10
Máy game      : 192.168.1.20
```

Trên máy game:

```cmd
set "GAME_EVENT_HOST=0.0.0.0"
python examples\game_event_server.py
```

Trên máy middleware:

```cmd
set "WEBHOOK_URLS=http://192.168.1.20:9000/tiktok-event"
start_visible.bat ten_tiktok
```

Nếu Windows Firewall chặn port 9000, mở CMD bằng quyền Administrator:

```cmd
netsh advfirewall firewall add rule name="TikTok Game Event 9000" dir=in action=allow protocol=TCP localport=9000
```

Không cần mở port router vì kết nối chỉ nằm trong LAN.

## 13. Các biến cấu hình server game

```cmd
set "GAME_EVENT_HOST=127.0.0.1"
set "GAME_EVENT_PORT=9000"
set "GAME_EVENT_PATH=/tiktok-event"
set "GAME_EVENT_QUEUE_SIZE=5000"
set "GAME_EVENT_ID_CACHE=10000"
python examples\game_event_server.py
```

Mặc định:

| Biến | Giá trị |
|---|---:|
| `GAME_EVENT_HOST` | `127.0.0.1` |
| `GAME_EVENT_PORT` | `9000` |
| `GAME_EVENT_PATH` | `/tiktok-event` |
| `GAME_EVENT_QUEUE_SIZE` | `5000` |
| `GAME_EVENT_ID_CACHE` | `10000` |

## 14. Cấu hình webhook middleware

```cmd
set "WEBHOOK_URLS=http://127.0.0.1:9000/tiktok-event"
set "WEBHOOK_TIMEOUT_MS=3000"
set "WEBHOOK_RETRY_COUNT=1"
start_visible.bat ten_tiktok
```

Middleware coi mọi phản hồi HTTP `2xx` là thành công.

Server mẫu trả:

- `202`: event mới đã được đưa vào queue;
- `200`: event trùng đã được nhận trước đó;
- `400`: JSON hoặc `eventType` không hợp lệ;
- `413`: body quá lớn;
- `503`: queue đang đầy.

## 15. SSE là lựa chọn thứ hai

Webhook là kiểu middleware chủ động gọi server game.

SSE là kiểu ứng dụng mở một kết nối lâu dài tới middleware:

```javascript
const source = new EventSource(
  "http://127.0.0.1:8787/api/events"
);

source.addEventListener("tiktok-event", message => {
  const event = JSON.parse(message.data);
  handleTikTokEvent(event);
});
```

SSE cũng không polling, nhưng ứng dụng phải chủ động mở kết nối một lần.

Các ví dụ có sẵn:

```text
examples/node_sse_client.mjs
examples/browser_sse_client.html
```

## 16. Không dùng `/api/recent` làm realtime

Không nên:

```javascript
setInterval(async () => {
  const events = await fetch("http://127.0.0.1:8787/api/recent");
}, 1000);
```

Cách đúng với game server nội bộ:

```text
Game mở POST /tiktok-event
Middleware tự POST mỗi event mới
Game nhận và xử lý ngay
```

## 17. Trình tự chạy chuẩn

```text
Bước 1: python examples\game_event_server.py
Bước 2: start_middleware_to_game.bat ten_tiktok
Bước 3: TikTok có event
Bước 4: middleware tự POST
Bước 5: server đưa event vào queue
Bước 6: hàm on_join/on_comment/on_follow/on_like/on_gift tự chạy
```

Đây là cơ chế nhận tự động hoàn toàn trong mạng nội bộ. Chỉ trình duyệt của middleware cần Internet để mở TikTok LIVE.
