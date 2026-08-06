# KẾT NỐI TỰ ĐỘNG VỚI TIKTOK LIVE EVENT MIDDLEWARE

Tài liệu này hướng dẫn game hoặc ứng dụng nhận event TikTok LIVE ngay khi middleware bắt được.

Game **không polling**, không cần gọi `/api/recent` liên tục.

## 1. Luồng hoạt động

```text
TikTok LIVE
    ↓
DOM collector bắt event
    ↓
Middleware chuẩn hóa JSON
    ↓ HTTP POST tự động
POST /tiktok-event của server game
    ↓
Đưa event vào queue
    ↓
Logic game tự xử lý
```

Webhook nội bộ mặc định:

```text
http://127.0.0.1:9000/tiktok-event
```

Mỗi `join`, `comment`, `follow`, `gift` hoặc `like` mới được middleware gửi bằng một HTTP POST riêng.

## 2. Trình tự mở đúng — hai cửa sổ CMD

### CMD thứ nhất: mở server game

Mở CMD tại thư mục repo:

```cmd
python examples\game_event_server.py
```

Bản đúng phải hiện:

```text
TIKTOK GAME EVENT SERVER
Phiên bản  : 1.3
Instance   : <mã 12 ký tự>
PID        : <PID>
Nhận event : http://127.0.0.1:9000/tiktok-event
Health     : http://127.0.0.1:9000/health
```

Giữ nguyên cửa sổ này.

### CMD thứ hai: mở middleware

Mở CMD khác tại cùng thư mục repo:

```cmd
start_middleware_to_game.bat ten_tiktok
```

Ví dụ:

```cmd
start_middleware_to_game.bat ngocky.ne
```

File BAT sẽ:

1. gọi `GET /health` để kiểm tra server game;
2. xác nhận đúng `service`, version, `instanceId`, PID và `eventPath`;
3. nếu server chưa chạy thì báo lệnh cần chạy ở CMD thứ nhất rồi dừng;
4. nếu kết nối đúng thì đặt `WEBHOOK_URLS`;
5. mở TikTok LIVE và tự POST từng event sang server game.

File BAT **không tự mở thêm cửa sổ CMD**.

## 3. Dấu hiệu hai bên đã thông nhau

Cửa sổ server game:

```text
[HANDSHAKE] GET /health từ 127.0.0.1

============================================================
[KẾT NỐI OK] TIKTOK LIVE EVENT MIDDLEWARE → SERVER GAME
[SERVER INSTANCE] <instanceId>
[SERVER PID] <PID>
[KIỂM TRA] GET /health thành công
[WEBHOOK] http://127.0.0.1:9000/tiktok-event
============================================================
```

Cửa sổ middleware:

```text
[HANDSHAKE] KẾT NỐI OK: http://127.0.0.1:9000/tiktok-event
[HANDSHAKE] Server version : 1.3
[HANDSHAKE] Server instance: <instanceId>
[HANDSHAKE] Server PID     : <PID>
[HANDSHAKE] TẤT CẢ WEBHOOK ĐÃ THÔNG NHAU.

[KET NOI OK] Game server va middleware da thong nhau.
```

Hai cửa sổ phải hiện cùng `instanceId` và PID.

## 4. Khi nhận event thật

Ví dụ LIKE:

```text
[17:08:16] [WEBHOOK NHẬN #1] instance=abc123def456 | từ 127.0.0.1 | type=like | eventId=...
[LIKE] x1 | source=heart-animation
```

Ví dụ comment:

```text
[WEBHOOK NHẬN #2] ... | type=comment | eventId=...
[COMMENT] Nguyễn Văn A: đánh
```

Ví dụ gift:

```text
[WEBHOOK NHẬN #3] ... | type=gift | eventId=...
[GIFT] Đ a N G gửi Hoa Hồng x1 | key=hoa_hong
```

Phía middleware in một lần khi gửi thành công tới URL:

```text
[WEBHOOK] KẾT NỐI OK - đã gửi thành công tới http://127.0.0.1:9000/tiktok-event
```

## 5. Server game mẫu

File chuẩn:

```text
examples/game_event_server.py
```

Server có:

- `POST /tiktok-event` nhận event tự động;
- `GET /health` kiểm tra trạng thái;
- version `1.3`;
- `instanceId` và PID;
- khóa độc quyền port trên Windows;
- log mọi handshake và webhook;
- `queue.Queue` tách phần HTTP khỏi logic game;
- worker tự gọi hàm xử lý;
- chống event trùng bằng `eventId`;
- chỉ dùng thư viện chuẩn Python.

Các hàm cần sửa khi nối với game thật:

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

Game không cần gọi middleware; server HTTP tự nhận event và worker tự gọi các hàm trên.

## 6. Handshake

File:

```text
scripts/send_webhook_handshake.py
```

Handshake gọi:

```text
GET http://127.0.0.1:9000/health
```

Phản hồi phải có:

```json
{
  "ok": true,
  "service": "game-event-server",
  "version": "1.3",
  "instanceId": "abc123def456",
  "pid": 1234,
  "eventPath": "/tiktok-event"
}
```

Nếu server quá cũ, sai service hoặc sai đường dẫn, middleware không khởi động.

## 7. Schema LIKE

LIKE là hoạt động chung, không xác định người dùng.

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

```text
Tim 1 → POST 1 → count=1
Tim 2 → POST 2 → count=1
Tim 3 → POST 3 → count=1
```

Không gom nhiều tim thành một event.

## 8. Schema event khác

### Comment

```json
{
  "eventType": "comment",
  "user": {
    "id": "username",
    "displayName": "Tên người dùng"
  },
  "payload": {
    "text": "đánh",
    "normalizedText": "ĐÁNH"
  }
}
```

### Gift

```json
{
  "eventType": "gift",
  "user": {
    "id": "username",
    "displayName": "Tên người gửi"
  },
  "payload": {
    "giftName": "Hoa Hồng",
    "giftKey": "hoa_hong",
    "count": 1,
    "totalCount": 1
  }
}
```

Middleware không phát `leave`. Game tự quản lý timeout hoặc trạng thái rời phòng.

## 9. Chống event trùng

Webhook có retry khi timeout. Server lưu các `eventId` gần nhất.

Nếu nhận lại cùng `eventId`, server trả `200` nhưng không đưa vào queue lần thứ hai:

```text
[WEBHOOK TRÙNG] eventId=...
```

## 10. Lỗi port 9000 đang bị giữ

Kiểm tra:

```cmd
netstat -ano | findstr LISTENING | findstr :9000
```

Dừng PID cũ:

```cmd
taskkill /PID 1234 /F
```

Sau đó mở lại theo đúng thứ tự:

```text
CMD 1: python examples\game_event_server.py
CMD 2: start_middleware_to_game.bat ten_tiktok
```

## 11. Kiểm tra phiên bản local

```cmd
findstr /C:"SERVER_VERSION = \"1.3\"" examples\game_event_server.py
```

```cmd
findstr /C:"handshake/3.0" scripts\send_webhook_handshake.py
```

Cập nhật:

```cmd
git pull origin main
```

Sau khi pull, phải đóng các process Python/Node cũ rồi chạy lại.

## 12. Server ở máy khác trong LAN

Máy game:

```cmd
set "GAME_EVENT_HOST=0.0.0.0"
python examples\game_event_server.py
```

Máy middleware:

```cmd
set "WEBHOOK_URLS=http://192.168.1.60:9000/tiktok-event"
start_visible.bat ten_tiktok
```

Mở firewall trên máy game nếu cần:

```cmd
netsh advfirewall firewall add rule name="TikTok Game Event 9000" dir=in action=allow protocol=TCP localport=9000
```

Không cần mở port router nếu chỉ dùng trong LAN.

## 13. Webhook và SSE

Webhook:

```text
Middleware chủ động POST sang game
```

SSE:

```text
Game mở một kết nối GET /api/events một lần
Middleware đẩy event xuống kết nối đó
```

Với server game nội bộ, webhook là cách chính.

## 14. Tóm tắt

```text
CMD 1: python examples\game_event_server.py
CMD 2: start_middleware_to_game.bat ten_tiktok
```

Kết quả đúng:

```text
Game server version 1.3
Có instanceId và PID
Handshake GET /health thành công
Middleware mở TikTok LIVE
Mỗi event tự POST tới /tiktok-event
Server in [WEBHOOK NHẬN]
Worker tự gọi logic game
```
