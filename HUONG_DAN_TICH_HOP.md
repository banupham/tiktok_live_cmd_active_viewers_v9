# HƯỚNG DẪN TÍCH HỢP TIKTOK LIVE EVENT MIDDLEWARE

## 1. Mục tiêu

Repo này không còn là một script chỉ in event ra CMD. Nó được tổ chức thành một **middleware trung gian độc lập với game**:

```text
TikTok LIVE
    ↓
DOM Collector
    ↓ raw event
Event Normalizer
    ↓ JSON chuẩn
Event Bus
    ├── SSE cho game web/Node/Python
    ├── Webhook POST cho server ứng dụng
    ├── API xem event gần nhất
    └── JSONL để debug
```

Game hoặc ứng dụng phía sau không cần biết selector DOM TikTok. Khi TikTok thay đổi giao diện, chỉ sửa phần `src/collector/dom_collector.mjs`; schema mà ứng dụng nhận vẫn được giữ ổn định.

## 2. Những event middleware xuất ra

Chỉ có 5 loại:

```text
join
comment
follow
like
gift
```

Không có:

```text
leave
viewer_left
user_timeout
```

Middleware không suy đoán người dùng đã rời LIVE. Phía ứng dụng nhận tự quyết định:

- người dùng hết hoạt động sau bao lâu;
- có xóa nhân vật hay không;
- có giữ người chơi tới hết trận hay không;
- có xem comment/gift gần nhất là dấu hiệu còn online hay không.

## 3. Cài đặt lần đầu

Yêu cầu:

- Windows 10/11;
- Node.js 20 trở lên;
- Google Chrome;
- tài khoản TikTok đã đăng nhập trong Chrome Profile 1.

Mở CMD tại repo:

```cmd
npm install
```

Đóng toàn bộ Chrome rồi chạy:

```cmd
sync_profile.bat
```

Lệnh này tạo bản sao profile tại:

```text
%LOCALAPPDATA%\TikTokLiveCollectorChrome
```

## 4. Khởi động middleware

Hiện cửa sổ Chrome:

```cmd
start_visible.bat ten_tiktok
```

Ví dụ:

```cmd
start_visible.bat alana.phng.trinh
```

Hoặc dùng URL đầy đủ:

```cmd
start_visible.bat https://www.tiktok.com/@alana.phng.trinh/live
```

Ẩn cửa sổ ra ngoài màn hình:

```cmd
start_hidden.bat ten_tiktok
```

Khi chạy thành công, CMD hiển thị:

```text
API health : http://127.0.0.1:8787/api/health
SSE events : http://127.0.0.1:8787/api/events
Recent     : http://127.0.0.1:8787/api/recent?limit=50
Schema     : http://127.0.0.1:8787/api/schema
```

## 5. API middleware cung cấp

### 5.1 `GET /api/health`

Kiểm tra middleware còn chạy hay không.

```cmd
curl http://127.0.0.1:8787/api/health
```

Ví dụ phản hồi:

```json
{
  "ok": true,
  "service": "tiktok-live-event-middleware",
  "schemaVersion": 1,
  "uptimeSeconds": 125,
  "sseClients": 2,
  "eventCount": 37,
  "recentCount": 37,
  "subscriberCount": 2,
  "lastEventAt": 1786000000000
}
```

### 5.2 `GET /api/events`

Kết nối SSE để nhận event thời gian thực.

```text
GET http://127.0.0.1:8787/api/events
Accept: text/event-stream
```

Mỗi sự kiện được phát với tên:

```text
event: tiktok-event
```

Ví dụ frame SSE:

```text
id: 3dbde00f458b4100ba7af055f35f1404
event: tiktok-event
data: {"schemaVersion":1,"eventType":"comment",...}
```

Kết nối bị ngắt có thể nối lại. Server gửi ping khoảng 15 giây một lần.

### 5.3 `GET /api/recent?limit=50`

Lấy một số event gần nhất đang giữ trong RAM.

```cmd
curl "http://127.0.0.1:8787/api/recent?limit=20"
```

`limit` tối đa 500.

### 5.4 `GET /api/schema`

Trả về danh sách event, payload và ghi chú schema hiện tại.

```cmd
curl http://127.0.0.1:8787/api/schema
```

Ứng dụng có thể dùng endpoint này để kiểm tra phiên bản tương thích.

### 5.5 Webhook `POST`

Middleware có thể chủ động gửi event tới server ứng dụng.

Trước khi chạy:

```cmd
set "WEBHOOK_URLS=http://127.0.0.1:9000/tiktok-event"
start_visible.bat ten_tiktok
```

Nhiều webhook cách nhau bằng dấu phẩy:

```cmd
set "WEBHOOK_URLS=http://127.0.0.1:9000/tiktok-event,http://127.0.0.1:9001/event"
```

Middleware gửi:

```text
POST /tiktok-event
Content-Type: application/json
```

Ứng dụng chỉ cần trả mã HTTP `2xx`. Nội dung phản hồi có thể là:

```json
{"ok": true}
```

## 6. Schema chung của mọi event

```json
{
  "schemaVersion": 1,
  "eventId": "3dbde00f458b4100ba7af055f35f1404",
  "eventType": "comment",
  "timestamp": 1786000000000,
  "receivedAt": 1786000000015,
  "source": {
    "platform": "tiktok",
    "collector": "dom",
    "liveUrl": "https://www.tiktok.com/@username/live"
  },
  "user": {
    "id": "username",
    "uniqueId": "username",
    "displayName": "Tên hiển thị",
    "identityType": "uniqueId"
  },
  "payload": {},
  "raw": {
    "text": "nội dung DOM gốc"
  }
}
```

Ý nghĩa:

- `schemaVersion`: phiên bản cấu trúc JSON.
- `eventId`: ID duy nhất cho event, dùng chống xử lý lặp.
- `eventType`: loại event.
- `timestamp`: thời điểm collector nhìn thấy event trên trang TikTok.
- `receivedAt`: thời điểm middleware chuẩn hóa event.
- `source.liveUrl`: LIVE đang theo dõi.
- `user.id`: ưu tiên TikTok unique ID; nếu chưa lấy được thì có dạng `nickname:<tên>`.
- `user.uniqueId`: TikTok ID nếu DOM cung cấp được, nếu không là `null`.
- `payload`: dữ liệu riêng theo event.
- `raw.text`: chuỗi DOM phục vụ debug; đặt `INCLUDE_RAW=0` để bỏ.

## 7. Chi tiết từng event

### 7.1 JOIN

```json
{
  "eventType": "join",
  "user": {
    "id": "duong123",
    "uniqueId": "duong123",
    "displayName": "Dương",
    "identityType": "uniqueId"
  },
  "payload": {
    "action": "đã tham gia"
  }
}
```

JOIN chỉ được phát khi dòng tham gia xuất hiện trong DOM. Ứng dụng không nên bắt buộc phải chờ JOIN; khi nhận COMMENT/GIFT/FOLLOW/LIKE của ID chưa tồn tại, ứng dụng có thể tự tạo người chơi.

### 7.2 COMMENT

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

- `text`: giữ nội dung người dùng nhập.
- `normalizedText`: chữ in hoa để xử lý lệnh game.

Ví dụ:

```javascript
if (event.payload.normalizedText === "ĐÁNH") {
  game.attack(event.user.id);
}
```

### 7.3 FOLLOW

```json
{
  "eventType": "follow",
  "payload": {
    "action": "đã theo dõi"
  }
}
```

Nên chống thưởng lặp phía ứng dụng bằng `user.id` hoặc `eventId`.

### 7.4 LIKE

```json
{
  "eventType": "like",
  "payload": {
    "count": 1,
    "action": "đã thích phiên LIVE",
    "suspected": true
  }
}
```

`like` lấy từ DOM nên việc xác định chính xác người gửi có thể không tuyệt đối. Trường `suspected: true` nhắc ứng dụng không nên dùng like cho phần thưởng giá trị cao.

### 7.5 GIFT

```json
{
  "eventType": "gift",
  "payload": {
    "giftName": "Hoa Hồng",
    "giftKey": "hoa_hong",
    "count": 1,
    "totalCount": 5
  }
}
```

- `giftName`: tên hiển thị thật lấy từ TikTok.
- `giftKey`: tên đã bỏ dấu, chuyển thường và thay khoảng trắng bằng `_`; dùng làm khóa trong game.
- `count`: lượng quà tăng thêm ở event hiện tại.
- `totalCount`: tổng combo TikTok đang hiển thị.

Ví dụ DOM lần lượt đổi `x1 → x2 → x3`, middleware phát ba event `count=1`, tránh tính sai thành 6.

Bảng quà của game:

```javascript
const GIFT_RULES = {
  hoa_hong: { effect: "heal", power: 5 },
  lion: { effect: "boss_damage", power: 5000 },
};

function handleGift(event) {
  const rule = GIFT_RULES[event.payload.giftKey];
  if (!rule) return;

  game.applyGiftEffect(
    event.user.id,
    rule,
    event.payload.count
  );
}
```

## 8. Kết nối ứng dụng bằng SSE

### JavaScript trong trình duyệt

```javascript
const stream = new EventSource(
  "http://127.0.0.1:8787/api/events"
);

stream.addEventListener("tiktok-event", message => {
  const event = JSON.parse(message.data);
  handleTikTokEvent(event);
});

stream.onerror = error => {
  console.error("Mất kết nối TikTok middleware", error);
};
```

### Node.js

Có ví dụ sẵn:

```cmd
npm run example:sse
```

Hoặc:

```cmd
node examples\node_sse_client.mjs
```

Đổi URL:

```cmd
set "TIKTOK_SSE_URL=http://127.0.0.1:8787/api/events"
node examples\node_sse_client.mjs
```

## 9. Kết nối ứng dụng bằng webhook

Chạy receiver Python mẫu:

```cmd
python examples\python_webhook_receiver.py
```

Mở CMD khác:

```cmd
set "WEBHOOK_URLS=http://127.0.0.1:9000/tiktok-event"
start_visible.bat ten_tiktok
```

Webhook phù hợp khi:

- ứng dụng đã có HTTP server;
- game engine không tiện giữ kết nối SSE;
- cần gửi cùng event sang nhiều dịch vụ.

SSE phù hợp khi:

- game web hoặc ứng dụng desktop cần nhận realtime;
- không muốn mở endpoint POST trong ứng dụng;
- muốn tự động nối lại khi middleware khởi động lại.

## 10. Hàm xử lý chung phía ứng dụng

```javascript
function handleTikTokEvent(event) {
  const payload = event.payload || {};

  switch (event.eventType) {
    case "join":
      game.ensurePlayer(event.user);
      break;

    case "comment":
      game.ensurePlayer(event.user);
      game.executeCommand(
        event.user.id,
        payload.normalizedText
      );
      break;

    case "follow":
      game.ensurePlayer(event.user);
      game.rewardFollow(event.user.id);
      break;

    case "like":
      game.ensurePlayer(event.user);
      game.addLikeEnergy(
        event.user.id,
        payload.count
      );
      break;

    case "gift":
      game.ensurePlayer(event.user);
      game.applyGift(
        event.user.id,
        payload.giftKey,
        payload.count
      );
      break;
  }
}
```

Ứng dụng tự quản lý rời LIVE, ví dụ:

```javascript
const lastSeen = new Map();

function onTikTokEvent(event) {
  lastSeen.set(event.user.id, Date.now());
  handleTikTokEvent(event);
}

function removeInactivePlayers() {
  const timeoutMs = 10 * 60 * 1000;
  const now = Date.now();

  for (const [userId, timestamp] of lastSeen) {
    if (now - timestamp > timeoutMs) {
      game.removePlayer(userId);
      lastSeen.delete(userId);
    }
  }
}
```

Đây là logic của ứng dụng, không nằm trong middleware.

## 11. Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---:|---|
| `API_HOST` | `127.0.0.1` | địa chỉ API lắng nghe |
| `API_PORT` | `8787` | cổng API |
| `SHOW_BROWSER` | `1` | `0` để đưa Chrome ra ngoài màn hình |
| `CHROME_PROFILE` | `Profile 1` | profile Chrome nguồn/collector |
| `COLLECTOR_USER_DATA_DIR` | `%LOCALAPPDATA%\TikTokLiveCollectorChrome` | thư mục hồ sơ collector |
| `WEBHOOK_URLS` | rỗng | danh sách webhook phân cách dấu phẩy |
| `WEBHOOK_TIMEOUT_MS` | `3000` | timeout mỗi lần POST |
| `WEBHOOK_RETRY_COUNT` | `1` | số lần thử lại |
| `MAX_RECENT_EVENTS` | `500` | số event giữ trong RAM |
| `EVENT_LOG_PATH` | `data\events.jsonl` | file JSONL; đặt `0` để tắt |
| `INCLUDE_RAW` | `1` | `0` để bỏ `raw` khỏi event |
| `VERBOSE_EVENTS` | `0` | `1` để in toàn bộ JSON ra CMD |
| `DEDUPE_MS` | `1500` | thời gian chống trùng DOM |

Có file mẫu:

```text
config.example.cmd
```

Sao chép thành `start_custom.cmd`, sửa biến rồi chạy:

```cmd
start_custom.cmd ten_tiktok
```

## 12. Các module có thể import trực tiếp

```javascript
import {
  EventBus,
  HttpEventGateway,
  JsonlWriter,
  TikTokEventNormalizer,
  WebhookDispatcher,
  installTikTokLiveDomCollector,
  normalizeGiftKey,
} from "./src/index.mjs";
```

### `installTikTokLiveDomCollector(config)`

Đưa vào `page.evaluate()` để theo dõi DOM TikTok.

### `TikTokEventNormalizer`

Chuyển raw event thành schema chuẩn.

### `EventBus`

Phát event tới nhiều subscriber nội bộ.

### `HttpEventGateway`

Mở API health, SSE, recent và schema.

### `WebhookDispatcher`

Gửi event theo thứ tự tới webhook.

### `JsonlWriter`

Ghi từng event thành một dòng JSON.

## 13. Giới hạn kỹ thuật

- TikTok có thể thay đổi DOM, selector cần cập nhật theo thời gian.
- LIKE theo từng người không đảm bảo chính xác tuyệt đối.
- JOIN có thể không xuất hiện cho mọi người xem.
- Middleware không có danh sách viewer chính xác.
- Middleware không phát LEAVE.
- TikTok có thể yêu cầu đăng nhập hoặc CAPTCHA.
- Tên quà phụ thuộc ngôn ngữ giao diện TikTok; dùng `giftKey` và alias phía game khi cần.

## 14. Quy tắc phát triển về sau

Khi nâng cấp:

1. Không đặt luật game vào `src/collector`.
2. Không đổi tên trường JSON cũ trong cùng `schemaVersion`.
3. Nếu đổi schema không tương thích, tăng `schemaVersion`.
4. Chỉ collector được phép phụ thuộc DOM TikTok.
5. Transport không được tự sửa nội dung event.
6. Không tạo event `leave` giả ở middleware.
7. Ứng dụng phải chống xử lý lặp bằng `eventId` nếu phần thưởng có giá trị.
