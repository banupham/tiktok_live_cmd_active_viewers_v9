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
share
like
gift
```

Middleware không phát `leave`. Ứng dụng nhận tự quản lý timeout hoặc trạng thái rời phòng.

## Collector đã được tách riêng

Middleware không còn dùng collector cũ quét chung toàn bộ text để đoán nhiều loại event. Luồng hiện tại:

```text
[data-e2e="chat-message"]
    → COMMENT

[data-e2e="enter-message"] + "đã tham gia"
    → JOIN

[data-e2e="social-message"] + "đã follow chủ phòng" / "đã theo dõi"
    → FOLLOW

[data-e2e="social-message"] + "đã chia sẻ phiên LIVE"
    → SHARE

activity row thường + "đã thích phiên LIVE"
    → LIKE có user

activity row thường + "đã gửi <gift> × N"
    → GIFT

hiệu ứng tim bay, nằm ngoài các structured event row
    → LIKE anonymous
```

COMMENT không được đi qua collector GIFT. Collector tim bay cũng loại trừ toàn bộ row COMMENT/JOIN/FOLLOW/SHARE/LIKE-user/GIFT để icon SVG trong các row này không thể bị tính thành tim LIKE.

## Hai nguồn LIKE

Để giữ tương thích với game cũ, cả hai vẫn dùng:

```text
eventType = like
```

Nhưng phân biệt bằng `payload.source`:

```text
user-activity
    → TikTok hiển thị "<user> đã thích phiên LIVE"
    → có user.displayName
    → anonymous = false

heart-animation
    → hiệu ứng tim bay
    → không biết user cụ thể
    → anonymous = true
```

## Kết nối tự động với server game — mở hai CMD

### CMD thứ nhất: mở server game

```cmd
python examples\game_event_server.py
```

Bản hiện tại phải hiện phiên bản `1.5` và hỗ trợ:

```text
join / comment / follow / share / like / gift
```

### CMD thứ hai: mở middleware

```cmd
start_middleware_to_game.bat ten_tiktok
```

Ví dụ:

```cmd
start_middleware_to_game.bat ngocky.ne
```

Luồng:

```text
TikTok LIVE
    ↓
DOM collectors riêng biệt
    ↓
Event normalizer kiểm tra source
    ↓
Webhook / SSE / JSONL
```

## API mặc định

```text
http://127.0.0.1:8787/api/health
http://127.0.0.1:8787/api/events
http://127.0.0.1:8787/api/recent?limit=50
http://127.0.0.1:8787/api/schema
```

`GET /api/schema` trả về event types và source hợp lệ cho từng loại event.

## Kiểm tra

```cmd
npm install
npm run check
npm run test:smoke
```

Smoke test hiện kiểm tra riêng các trường hợp:

- comment chứa chữ `gửi` không thể trở thành gift;
- join chỉ nhận từ `join-message`;
- follow/share chỉ nhận từ `social-message`;
- gift chỉ nhận từ `gift-activity`;
- LIKE user và LIKE tim bay có source khác nhau;
- `share` có trong schema middleware.

## CAPTCHA

Khi TikTok hiện CAPTCHA, middleware tự phát hiện, dừng toàn bộ collector, đưa Chrome ra màn hình, chờ người dùng xác minh rồi tự nạp lại collector. Middleware không tự giải CAPTCHA.

## Cấu trúc collector chính

```text
src/collector/
├── direct_comment_collector.mjs   # COMMENT
├── activity_collector.mjs         # JOIN/FOLLOW/SHARE/LIKE user/GIFT
├── like_activity_collector.mjs    # tim LIKE anonymous
└── dom_collector.mjs              # legacy, không còn được index.mjs chạy
```

Game nhận JSON rồi tự ánh xạ `comment`, `gift`, `follow`, `share`, `like`, `join` thành hành động riêng.
