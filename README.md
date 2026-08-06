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

## CAPTCHA

Khi TikTok hiện CAPTCHA, middleware sẽ tự:

1. phát hiện popup;
2. dừng collector và ngừng phát event;
3. phát âm báo;
4. đưa Chrome ra màn hình;
5. chờ người dùng tự hoàn thành xác minh;
6. nạp lại collector và tiếp tục chạy khi popup biến mất.

Middleware không tự giải CAPTCHA.

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

Kiểm tra cú pháp và API:

```cmd
npm run check
npm run test:smoke
```

## Nhận event tự động bằng webhook

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
- [KET_NOI_PUSH.md](KET_NOI_PUSH.md): webhook, SSE và code mẫu nhận event tự động.

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
│   ├── node_webhook_receiver.mjs
│   ├── browser_sse_client.html
│   └── python_webhook_receiver.py
├── scripts/
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
      ├── SSE clients
      ├── recent-event API
      ├── webhook URLs
      └── JSONL log
```

Luật game không được đặt trong middleware. Game chỉ nhận JSON rồi tự ánh xạ `comment`, `gift`, `follow`, `like`, `join` thành hành động riêng.
