# TikTok LIVE Event Middleware

Middleware nhận sự kiện TikTok LIVE, chuẩn hóa thành JSON rồi phân phối cho game/ứng dụng qua **Webhook**, **SSE** và **JSONL**.

## Hai chế độ collector

### 1. `direct` — mặc định, khuyên dùng

Không mở Chrome, không Puppeteer/Playwright browser, không DOM, không MutationObserver.

```text
TikTok LIVE
    ↓
HTTP bootstrap + Webcast WebSocket
    ↓
TikTokLive protobuf events
    ↓
Python direct_webcast_collector.py
    ↓ JSON lines nội bộ
Node middleware
    ↓
Normalizer → Webhook / SSE / JSONL
```

Các event direct hiện nối vào cùng schema middleware:

```text
WebcastChatMessage   → comment
WebcastMemberMessage → join
WebcastLikeMessage   → like
WebcastSocialMessage → follow / share
WebcastGiftMessage   → gift
```

Direct mode dùng thư viện Python `TikTokLive` không chính thức. TikTok có thể thay đổi Webcast protocol theo thời gian.

### 2. `dom` — lựa chọn dự phòng/so sánh

Giữ nguyên collector Chrome + DOM đã có trước đây. DOM mode vẫn giữ xử lý CAPTCHA thủ công: middleware chỉ phát hiện, đưa cửa sổ Chrome ra màn hình và chờ người dùng tự xác minh; không tự giải CAPTCHA.

## Event hỗ trợ

```text
join
comment
follow
share
like
gift
```

Middleware chưa phát `leave`.

## Cài đặt

```cmd
install.bat
```

Lệnh này cài npm dependencies và `TikTokLive` cho Python direct collector. Direct mode cần `python` có trong PATH.

## Chạy direct — mặc định

```cmd
start_live.bat ten_tiktok
```

Ví dụ:

```cmd
start_live.bat nhuquynh230794
```

Sau khi kết nối, middleware chạy liên tục tới khi LIVE kết thúc hoặc bạn nhấn `Ctrl+C`.

Direct mode có retry khởi động giới hạn:

```text
DIRECT_CONNECT_ATTEMPTS=3
DIRECT_RETRY_WAIT=4
```

HTTP `403/429` không bị retry liên tục.

## Chạy DOM riêng

```cmd
start_visible.bat ten_tiktok
start_hidden.bat ten_tiktok
```

Hai file trên luôn ép `COLLECTOR_MODE=dom`, nên collector DOM cũ vẫn là một lựa chọn độc lập. DOM mode vẫn cần Chrome profile collector và `sync_profile.bat` như trước.

## Kết nối server game

CMD 1:

```cmd
python examples\game_event_server.py
```

CMD 2 — direct mặc định:

```cmd
start_middleware_to_game.bat ten_tiktok
```

Muốn dùng DOM:

```cmd
start_middleware_to_game_dom.bat ten_tiktok
```

Webhook mặc định:

```text
http://127.0.0.1:9000/tiktok-event
```

Cả hai collector cùng đi qua `TikTokEventNormalizer`, nên phía game không cần đổi cách nhận event.

Direct event có:

```text
source.collector = webcast-direct
payload.source   = webcast-direct
```

DOM event vẫn có:

```text
source.collector = dom
```

## LIKE direct

Direct `LikeEvent` có user cụ thể và số lượng:

```text
payload.count
payload.totalCount
```

DOM mode vẫn giữ hai nguồn LIKE cũ `user-activity` và `heart-animation`.

## GIFT direct và combo

Webcast có thể gửi nhiều cập nhật cho cùng một streak. Direct collector theo dõi `repeat_count` và chỉ phát **phần tăng thêm** vào `payload.count`, tránh combo `1 → 2 → 3` bị game cộng thành `6`.

Metadata direct gift giữ thêm:

```text
payload.totalCount
payload.comboCount
payload.repeatEnd
payload.streaking
payload.giftId
payload.diamondCount
```

## Lỗi protobuf `HashtagNamespace`

Trong test thực tế đã gặp lỗi schema upstream ở `WebcastLinkLayerMessage`:

```text
'bytes' object has no attribute 'HashtagNamespace'
```

Direct collector chỉ đưa đúng fingerprint này vào `parse_error_ignorelist`. Không bật bỏ qua toàn bộ payload lỗi, nên lỗi parser mới ở các event quan trọng vẫn được nhìn thấy.

## API middleware

```text
http://127.0.0.1:8787/api/health
http://127.0.0.1:8787/api/events
http://127.0.0.1:8787/api/recent?limit=50
http://127.0.0.1:8787/api/schema
```

## Cấu hình

Sao chép `config.example.cmd` rồi chỉnh:

```cmd
set "COLLECTOR_MODE=direct"
set "PYTHON_BIN=python"
set "DIRECT_CONNECT_ATTEMPTS=3"
set "DIRECT_RETRY_WAIT=4"
set "DIRECT_DEBUG=0"
```

Đổi sang DOM:

```cmd
set "COLLECTOR_MODE=dom"
set "SHOW_BROWSER=1"
```

## Kiểm tra

```cmd
npm run check
npm run test:smoke
```

Direct collector Python: `scripts/direct_webcast_collector.py`.
Node sidecar adapter: `src/collector/direct_webcast_process.mjs`.
Collector DOM cũ vẫn nằm nguyên trong `src/collector/` và chỉ chạy khi chọn `COLLECTOR_MODE=dom`.
