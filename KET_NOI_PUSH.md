# KẾT NỐI TỰ ĐỘNG VỚI TIKTOK LIVE EVENT MIDDLEWARE

Tài liệu này hướng dẫn game hoặc ứng dụng nhận event TikTok LIVE ngay khi middleware bắt được.

Game **không cần polling**, không cần gọi `/api/recent` theo vòng lặp và không cần hỏi middleware xem có event mới hay chưa.

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

Mỗi `join`, `comment`, `follow`, `gift` hoặc `like` mới được middleware tự gửi bằng một HTTP POST riêng.

## 2. Cách chạy nhanh nhất

Sau khi cài đặt và đồng bộ Chrome Profile, chỉ cần chạy:

```cmd
start_middleware_to_game.bat ten_tiktok
```

Ví dụ:

```cmd
start_middleware_to_game.bat ngocky.ne
```

File BAT sẽ tự làm theo thứ tự:

1. kiểm tra có game server hợp lệ đang chạy trên port `9000` hay chưa;
2. nếu đã chạy thì dùng luôn server đó;
3. nếu chưa chạy thì tự mở một cửa sổ mới chạy `examples\game_event_server.py`;
4. gọi `GET /health` để xác nhận đúng server, đúng version, đúng `instanceId` và đúng `eventPath`;
5. chỉ khi xác nhận thành công mới mở TikTok LIVE;
6. tự đặt `WEBHOOK_URLS=http://127.0.0.1:9000/tiktok-event`;
7. middleware tự POST từng event sang server game.

Không cần mở `start_visible.bat` riêng khi đã dùng file BAT này.

## 3. Cách chạy thủ công bằng hai CMD

### CMD thứ nhất — mở server game

```cmd
python examples\game_event_server.py
```

Bản đúng phải hiện ít nhất:

```text
TIKTOK GAME EVENT SERVER
Phiên bản  : 1.3
Instance   : <mã 12 ký tự>
PID        : <PID>
Nhận event : http://127.0.0.1:9000/tiktok-event
Health     : http://127.0.0.1:9000/health
```

Giữ nguyên cửa sổ này.

### CMD thứ hai — chạy middleware

```cmd
start_middleware_to_game.bat ten_tiktok
```

BAT sẽ phát hiện server đang chạy và không mở thêm server thứ hai.

## 4. Dấu hiệu hai bên đã thông nhau

Cửa sổ server game phải hiện:

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

Cửa sổ middleware phải hiện:

```text
[HANDSHAKE] KẾT NỐI OK: http://127.0.0.1:9000/tiktok-event
[HANDSHAKE] Server version : 1.3
[HANDSHAKE] Server instance: <instanceId>
[HANDSHAKE] Server PID     : <PID>
[HANDSHAKE] TẤT CẢ WEBHOOK ĐÃ THÔNG NHAU.

[KET NOI OK] Game server va middleware da thong nhau.
```

Hai cửa sổ phải hiện cùng `instanceId` và PID của server.

## 5. Khi nhận event thật

Mỗi request được in ngay khi server nhận được:

```text
[17:08:16] [WEBHOOK NHẬN #1] instance=abc123def456 | từ 127.0.0.1 | type=like | eventId=...
[LIKE] x1 | source=heart-animation
```

Ví dụ khác:

```text
[WEBHOOK NHẬN #2] ... | type=comment | eventId=...
[COMMENT] Nguyễn Văn A: đánh

[WEBHOOK NHẬN #3] ... | type=gift | eventId=...
[GIFT] Đ a N G gửi Hoa Hồng x1 | key=hoa_hong
```

Phía middleware cũng in một lần khi gửi thành công tới URL:

```text
[WEBHOOK] KẾT NỐI OK - đã gửi thành công tới http://127.0.0.1:9000/tiktok-event
```

## 6. Mã đầy đủ của server game

Mã mẫu đầy đủ và luôn được cập nhật tại:

```text
examples/game_event_server.py
```

Đây là file chuẩn để chạy và tích hợp. Không dùng bản mã sao chép từ tài liệu cũ.

Server hiện có:

- `POST /tiktok-event` nhận event tự động;
- `GET /health` kiểm tra trạng thái;
- version `1.3`;
- `instanceId` riêng cho mỗi process;
- PID của process;
- khóa độc quyền port trên Windows bằng `SO_EXCLUSIVEADDRUSE`;
- chống hai process cùng giữ port `9000`;
- log mọi handshake và webhook nhận được;
- `queue.Queue` tách HTTP receiver khỏi logic game;
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

HTTP server tự nhận và gọi các hàm này. Game không cần chủ động gọi middleware.

## 7. Mã handshake

File:

```text
scripts/send_webhook_handshake.py
```

Handshake không gửi event giả. Nó gọi:

```text
GET http://127.0.0.1:9000/health
```

Sau đó kiểm tra JSON phản hồi phải có:

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

## 8. Schema LIKE hiện tại

LIKE là hoạt động chung, không xác định người dùng.

Mỗi phần tử tim DOM bắt được tạo một event riêng:

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

Luồng:

```text
Tim 1 → POST 1 → count=1
Tim 2 → POST 2 → count=1
Tim 3 → POST 3 → count=1
```

Không gom nhiều tim thành một event.

## 9. Schema các event khác

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

### Follow và Join

```json
{
  "eventType": "follow",
  "user": {
    "id": "username",
    "displayName": "Tên người dùng"
  },
  "payload": {
    "action": "đã theo dõi"
  }
}
```

Middleware không phát `leave`. Game tự quản lý timeout hoặc trạng thái rời phòng.

## 10. Chống event trùng

Webhook có retry khi timeout. Server lưu các `eventId` gần nhất.

Nếu nhận lại cùng `eventId`, server trả `200` nhưng không đưa event vào queue lần thứ hai:

```text
[WEBHOOK TRÙNG] eventId=...
```

## 11. Lỗi process cũ giữ port 9000

Bản server cũ từng cho phép tái sử dụng địa chỉ. Trên Windows có thể xảy ra trường hợp nhiều process cùng liên quan đến port `9000`, làm middleware gửi event vào process khác với cửa sổ đang nhìn.

Bản `1.3` đã sửa bằng:

```python
allow_reuse_address = False
```

và:

```python
socket.SO_EXCLUSIVEADDRUSE
```

Nếu port đã bị giữ, server mới phải báo lỗi ngay thay vì âm thầm chạy.

Kiểm tra PID giữ port:

```cmd
netstat -ano | findstr LISTENING | findstr :9000
```

Dừng PID cũ:

```cmd
taskkill /PID 1234 /F
```

Sau đó chạy lại:

```cmd
start_middleware_to_game.bat ten_tiktok
```

## 12. Kiểm tra phiên bản local

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

Sau khi pull, phải đóng các cửa sổ Python/Node cũ rồi chạy lại, vì process đang chạy không tự nạp code mới.

## 13. Gửi tới server ở máy khác trong LAN

Trên máy game:

```cmd
set "GAME_EVENT_HOST=0.0.0.0"
python examples\game_event_server.py
```

Trên máy middleware, đặt IP máy game:

```cmd
set "WEBHOOK_URLS=http://192.168.1.60:9000/tiktok-event"
start_visible.bat ten_tiktok
```

Mở firewall trên máy game nếu cần:

```cmd
netsh advfirewall firewall add rule name="TikTok Game Event 9000" dir=in action=allow protocol=TCP localport=9000
```

Không cần mở port router nếu chỉ dùng trong LAN.

## 14. Webhook khác SSE thế nào?

Webhook:

```text
Middleware chủ động POST sang game
```

SSE:

```text
Game mở một kết nối GET /api/events một lần
Middleware đẩy event xuống kết nối đó
```

Với yêu cầu server game nhận tự động trong hệ thống nội bộ, webhook là lựa chọn chính.

## 15. Tóm tắt

Cách ngắn nhất:

```cmd
start_middleware_to_game.bat ten_tiktok
```

Kết quả đúng:

```text
Game server version 1.3
Có instanceId và PID
Handshake GET /health thành công
Middleware mở TikTok LIVE
Mỗi event được tự POST tới /tiktok-event
Server in [WEBHOOK NHẬN]
Worker tự gọi logic game
```
