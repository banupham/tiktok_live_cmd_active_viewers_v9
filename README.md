# TikTok LIVE Event Middleware

Bộ trung gian lấy sự kiện từ giao diện TikTok LIVE, chuẩn hóa thành JSON ổn định và phân phối cho game hoặc ứng dụng khác qua:

- **Webhook**: middleware tự gửi `POST` tới một hoặc nhiều URL mỗi khi có event mới.
- **SSE**: ứng dụng mở `GET /api/events` một lần và nhận luồng event liên tục.
- **JSONL**: lưu lịch sử sự kiện vào `data/events.jsonl` để kiểm tra và phát lại khi cần.

Webhook và SSE đều là kiểu **push realtime**. Ứng dụng không phải gọi `/api/recent` liên tục để kiểm tra có event mới hay chưa.

Middleware hiện hỗ trợ:

- `join`
- `comment`
- `follow`
- `like`
- `gift`

Middleware **không phát event `leave` và không suy đoán người dùng đã rời LIVE**. Ứng dụng nhận tự quản lý timeout, trạng thái online hoặc logic rời phòng.

LIKE được lấy từ hiệu ứng tim trong DOM:

```text
Mỗi tim bắt được → một event LIKE → payload.count = 1
```

LIKE không gắn với người dùng cụ thể.

## Nhận tự động trong server game

Cách nhanh nhất trên cùng một máy:

```cmd
start_middleware_to_game.bat ten_tiktok
```

Ví dụ:

```cmd
start_middleware_to_game.bat ngocky.ne
```

File BAT sẽ:

1. kiểm tra server game hợp lệ đang chạy trên port `9000`;
2. nếu đã chạy thì dùng luôn;
3. nếu chưa chạy thì tự mở `examples\game_event_server.py` trong cửa sổ mới;
4. xác nhận đúng server bằng `GET /health`, version, `instanceId`, PID và `eventPath`;
5. chỉ khi kết nối thành công mới mở TikTok LIVE;
6. tự POST mọi event tới `http://127.0.0.1:9000/tiktok-event`.

Luồng hoạt động:

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

Game không phải polling và không phải gọi API hỏi xem có event mới hay chưa.

Server mẫu đầy đủ:

```text
examples/game_event_server.py
```

Server hiện dùng version `1.3`, có `instanceId`, PID và khóa độc quyền port trên Windows để tránh gửi nhầm event sang process cũ.

Hướng dẫn đầy đủ, cấu hình LAN, chẩn đoán port và schema event:

```text
KET_NOI_PUSH.md
```

## CAPTCHA

Khi TikTok hiện CAPTCHA, middleware sẽ tự:

1. phát hiện popup;
2. dừng collector và ngừng phát event;
3. phát âm báo;
4. đưa Chrome ra màn hình;
5. chờ người dùng tự hoàn thành xác minh;
6. nạp lại collector và tiếp tục chạy khi popup biến mất.

Middleware không tự giải CAPTCHA.

## Chạy middleware thông thường

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

Kiểm tra cú pháp và API:

```cmd
npm run check
npm run test:smoke
```

## Nhận event tự động bằng webhook Node.js

CMD thứ nhất:

```cmd
npm run example:webhook
```

CMD thứ hai:

```cmd
set "WEBHOOK_URLS=http://127.0.0.1:9000/tiktok-event"
start_visible.bat ten_tiktok
```

Middleware sẽ tự POST từng event mới tới receiver.

## Nhận event tự động bằng SSE

Sau khi middleware đang chạy:

```cmd
npm run example:sse
```

Hoặc mở:

```text
examples/browser_sse_client.html
```

Ứng dụng chỉ mở một kết nối lâu dài; middleware tự đẩy event mới qua kết nối đó.

## Tài liệu

- [HUONG_DAN_TICH_HOP.md](HUONG_DAN_TICH_HOP.md): cài đặt, schema và API tổng thể.
- [KET_NOI_PUSH.md](KET_NOI_PUSH.md): webhook nội bộ, game server `1.3`, handshake, queue, SSE và cách nhận event tự động.

## Cấu trúc

```text
.
├── a.mjs
├── start_middleware_to_game.bat
├── src/
│   ├── collector/
│   │   ├── dom_collector.mjs
│   │   └── like_activity_collector.mjs
│   ├── core/
│   │   ├── event_normalizer.mjs
│   │   └── event_bus.mjs
│   ├── transports/
│   │   ├── http_gateway.mjs
│   │   └── webhook_dispatcher.mjs
│   ├── storage/
│   │   └── jsonl_writer.mjs
│   └── index.mjs
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

## Nguyên tắc tách lớp

```text
TikTok LIVE DOM
      ↓ raw event
TikTokEventNormalizer
      ↓ canonical event
EventBus
      ├── webhook tự POST
      ├── SSE clients
      ├── recent-event API
      └── JSONL log
```

Luật game không đặt trong middleware. Game nhận JSON rồi tự ánh xạ `comment`, `gift`, `follow`, `like`, `join` thành hành động riêng.
