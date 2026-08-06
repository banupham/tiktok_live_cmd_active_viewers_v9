# TikTok LIVE Event Middleware

Bộ trung gian lấy sự kiện từ giao diện TikTok LIVE, chuẩn hóa thành JSON và phân phối cho game hoặc ứng dụng khác qua:

- **Webhook**: middleware tự `POST` từng event tới server game.
- **SSE**: ứng dụng mở `GET /api/events` một lần và nhận luồng liên tục.
- **JSONL**: lưu lịch sử vào `data/events.jsonl`.

Ứng dụng không cần polling `/api/recent`.

## Event hỗ trợ

```text
join
comment
follow
like
gift
```

Middleware không phát `leave`. Ứng dụng nhận tự quản lý timeout hoặc trạng thái rời phòng.

LIKE được lấy từ hiệu ứng tim DOM:

```text
Mỗi tim bắt được → một event LIKE → payload.count = 1
```

LIKE không gắn với người dùng cụ thể.

## Kết nối tự động với server game — mở hai CMD

### CMD thứ nhất: mở server game

```cmd
python examples\game_event_server.py
```

Bản đúng phải hiện:

```text
TIKTOK GAME EVENT SERVER
Phiên bản  : 1.3
Instance   : <mã instance>
PID        : <PID>
Nhận event : http://127.0.0.1:9000/tiktok-event
Health     : http://127.0.0.1:9000/health
```

Giữ nguyên cửa sổ này.

### CMD thứ hai: mở middleware

```cmd
start_middleware_to_game.bat ten_tiktok
```

Ví dụ:

```cmd
start_middleware_to_game.bat ngocky.ne
```

File BAT chỉ kiểm tra server đã chạy, xác nhận bằng `GET /health`, sau đó mới mở TikTok LIVE. File BAT **không tự mở CMD mới**.

Luồng:

```text
TikTok LIVE
    ↓
Middleware chuẩn hóa event
    ↓ tự động POST
http://127.0.0.1:9000/tiktok-event
    ↓
Queue của server game
    ↓
Hàm xử lý game tự chạy
```

## Dấu hiệu kết nối đúng

Server game:

```text
[HANDSHAKE] GET /health từ 127.0.0.1
[KẾT NỐI OK] TIKTOK LIVE EVENT MIDDLEWARE → SERVER GAME
```

Middleware:

```text
[HANDSHAKE] Server version : 1.3
[HANDSHAKE] Server instance: <instanceId>
[HANDSHAKE] Server PID     : <PID>
[KET NOI OK] Game server va middleware da thong nhau.
```

Khi có event, server game in:

```text
[WEBHOOK NHẬN #1] ... | type=like | eventId=...
[LIKE] x1 | source=heart-animation
```

## Cài đặt và chạy middleware thông thường

```cmd
npm install
sync_profile.bat
start_visible.bat ten_tiktok
```

API mặc định:

```text
http://127.0.0.1:8787/api/health
http://127.0.0.1:8787/api/events
http://127.0.0.1:8787/api/recent?limit=50
http://127.0.0.1:8787/api/schema
```

Kiểm tra:

```cmd
npm run check
npm run test:smoke
```

## CAPTCHA

Khi TikTok hiện CAPTCHA, middleware tự phát hiện, dừng collector, đưa Chrome ra màn hình, chờ người dùng xác minh rồi tự nạp lại collector. Middleware không tự giải CAPTCHA.

## Tài liệu

- [HUONG_DAN_TICH_HOP.md](HUONG_DAN_TICH_HOP.md): cài đặt, schema và API tổng thể.
- [KET_NOI_PUSH.md](KET_NOI_PUSH.md): webhook nội bộ, server game, handshake, queue, LAN và cách nhận event tự động.

## Cấu trúc chính

```text
.
├── a.mjs
├── start_middleware_to_game.bat
├── src/
├── examples/
│   ├── game_event_server.py
│   ├── python_webhook_receiver.py
│   ├── node_webhook_receiver.mjs
│   ├── node_sse_client.mjs
│   └── browser_sse_client.html
├── scripts/
│   ├── send_webhook_handshake.py
│   ├── check.mjs
│   └── smoke_test.mjs
├── HUONG_DAN_TICH_HOP.md
└── KET_NOI_PUSH.md
```

Luật game không đặt trong middleware. Game nhận JSON rồi tự ánh xạ `comment`, `gift`, `follow`, `like`, `join` thành hành động riêng.
