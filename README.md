# TikTok LIVE Event Middleware

Bộ trung gian lấy sự kiện từ giao diện TikTok LIVE, chuẩn hóa thành JSON ổn định và phân phối cho game hoặc ứng dụng khác qua:

- **SSE**: ứng dụng kết nối `GET /api/events` để nhận sự kiện thời gian thực.
- **Webhook**: middleware gửi `POST` tới một hoặc nhiều URL do ứng dụng cung cấp.
- **JSONL**: lưu lịch sử sự kiện vào `data/events.jsonl` để kiểm tra và phát lại khi cần.

Middleware hiện hỗ trợ:

- `join`
- `comment`
- `follow`
- `like`
- `gift`

Middleware **không phát event `leave` và không suy đoán người dùng đã rời LIVE**. Ứng dụng nhận tự quản lý timeout, trạng thái online hoặc logic rời phòng.

## Chạy nhanh trên Windows

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

Kiểm tra cú pháp:

```cmd
npm run check
```

Tài liệu đầy đủ: [HUONG_DAN_TICH_HOP.md](HUONG_DAN_TICH_HOP.md)

## Cấu trúc

```text
.
├── a.mjs                         file chạy middleware
├── src/
│   ├── collector/
│   │   └── dom_collector.mjs     đọc DOM TikTok LIVE
│   ├── core/
│   │   ├── event_normalizer.mjs  chuẩn hóa schema JSON
│   │   └── event_bus.mjs         phân phối event nội bộ
│   ├── transports/
│   │   ├── http_gateway.mjs      API SSE/health/recent/schema
│   │   └── webhook_dispatcher.mjs gửi webhook
│   ├── storage/
│   │   └── jsonl_writer.mjs      ghi JSONL
│   └── index.mjs                 export module dùng lại
├── examples/
│   ├── node_sse_client.mjs
│   └── python_webhook_receiver.py
└── HUONG_DAN_TICH_HOP.md
```

## Nguyên tắc tách lớp

```text
TikTok LIVE DOM
      ↓ raw event
TikTokEventNormalizer
      ↓ canonical event
EventBus
      ├── SSE clients
      ├── recent-event API
      ├── webhook URLs
      └── JSONL log
```

Luật game không được đặt trong middleware. Game chỉ nhận JSON rồi tự ánh xạ `comment`, `gift`, `follow`, `like`, `join` thành hành động riêng.
