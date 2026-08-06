# KẾT NỐI PUSH VỚI TIKTOK LIVE EVENT MIDDLEWARE

Tài liệu này hướng dẫn ứng dụng hoặc game nhận event mới **ngay khi middleware bắt được**, không phải gọi `/api/recent` liên tục để kiểm tra.

## 1. Hai kiểu đẩy tự động

### Webhook — middleware chủ động POST sang ứng dụng

```text
TikTok LIVE
    ↓
Middleware
    ↓ POST JSON mỗi khi có event
API của ứng dụng
```

Ứng dụng chỉ cần mở một endpoint, ví dụ:

```text
POST http://127.0.0.1:9000/tiktok-event
```

Sau đó cấu hình URL đó trước khi chạy middleware:

```cmd
set "WEBHOOK_URLS=http://127.0.0.1:9000/tiktok-event"
start_visible.bat ten_tiktok
```

Từ thời điểm đó, mỗi `join`, `comment`, `follow`, `like`, `gift` mới sẽ được middleware tự POST sang ứng dụng. Ứng dụng không phải gọi ngược lại middleware.

### SSE — ứng dụng mở một kết nối lâu dài

```text
Ứng dụng mở GET /api/events một lần
                ↓
Middleware giữ kết nối
                ↓
Middleware ghi event mới vào cùng kết nối
```

Endpoint:

```text
GET http://127.0.0.1:8787/api/events
Accept: text/event-stream
```

Đây không phải polling. Ứng dụng chỉ kết nối một lần; middleware tự đẩy dữ liệu mới. Trình duyệt `EventSource` còn tự kết nối lại khi mạng bị ngắt.

## 2. Nên chọn kiểu nào?

| Trường hợp | Nên dùng |
|---|---|
| Game web chạy trong trình duyệt | SSE |
| Node.js/Python muốn nhận đơn giản | Webhook hoặc SSE |
| Ứng dụng có sẵn HTTP server | Webhook |
| Một middleware gửi tới nhiều ứng dụng | Webhook nhiều URL |
| Giao diện chỉ cần nghe event trực tiếp | SSE |

`GET /api/recent` chỉ nên dùng để debug hoặc khôi phục một số event gần nhất. Không nên gọi endpoint đó lặp lại để làm realtime.

## 3. Schema event chung

Mỗi event được gửi theo dạng:

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
  "payload": {
    "text": "đánh",
    "normalizedText": "ĐÁNH"
  },
  "raw": {
    "text": "Dương đánh"
  }
}
```

Các `eventType`:

```text
join
comment
follow
like
gift
```

Middleware không phát `leave`. Ứng dụng nhận tự quản lý việc người dùng rời hoặc hết thời gian hoạt động.

## 4. Webhook với Node.js

Repo có file:

```text
examples/node_webhook_receiver.mjs
```

Chạy receiver trước:

```cmd
npm run example:webhook
```

Receiver mở:

```text
http://127.0.0.1:9000/tiktok-event
```

Mở CMD khác, cấu hình middleware:

```cmd
set "WEBHOOK_URLS=http://127.0.0.1:9000/tiktok-event"
start_visible.bat ten_tiktok
```

Mỗi event mới sẽ xuất hiện ngay tại CMD receiver.

Phần cốt lõi của receiver:

```javascript
const server = http.createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/tiktok-event") {
    response.writeHead(404).end();
    return;
  }

  const chunks = [];
  request.on("data", chunk => chunks.push(chunk));

  request.on("end", () => {
    const event = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    handleTikTokEvent(event);

    response.writeHead(200, {
      "Content-Type": "application/json",
    });
    response.end(JSON.stringify({ ok: true }));
  });
});
```

Hàm xử lý:

```javascript
function handleTikTokEvent(event) {
  const payload = event.payload || {};

  switch (event.eventType) {
    case "comment":
      app.runCommand(event.user.id, payload.normalizedText);
      break;

    case "gift":
      app.applyGift(event.user.id, payload.giftKey, payload.count);
      break;

    case "follow":
      app.rewardFollow(event.user.id);
      break;

    case "like":
      app.addLike(event.user.id, payload.count || 1);
      break;

    case "join":
      app.ensureUser(event.user);
      break;
  }
}
```

## 5. Webhook với Python

Repo có file:

```text
examples/python_webhook_receiver.py
```

Chạy:

```cmd
python examples\python_webhook_receiver.py
```

Sau đó chạy middleware:

```cmd
set "WEBHOOK_URLS=http://127.0.0.1:9000/tiktok-event"
start_visible.bat ten_tiktok
```

Python chỉ đứng chờ request. Middleware chủ động gửi event mới tới.

## 6. Gửi tới nhiều ứng dụng cùng lúc

Phân cách URL bằng dấu phẩy:

```cmd
set "WEBHOOK_URLS=http://127.0.0.1:9000/tiktok-event,http://127.0.0.1:9001/live-event"
start_visible.bat ten_tiktok
```

Mỗi event sẽ được gửi tới cả hai URL.

Webhook mặc định:

- timeout: `3000 ms`;
- thử lại: `1` lần;
- chấp nhận mọi phản hồi HTTP `2xx` là thành công.

Có thể đổi:

```cmd
set "WEBHOOK_TIMEOUT_MS=5000"
set "WEBHOOK_RETRY_COUNT=2"
```

Do có retry, ứng dụng nên dùng `eventId` để chống xử lý trùng. Ví dụ receiver Node trong repo đã có bộ nhớ `eventId` gần nhất.

## 7. SSE với trình duyệt

Repo có file:

```text
examples/browser_sse_client.html
```

Mở file đó trong trình duyệt và bấm **Kết nối**.

Mã tối thiểu:

```javascript
const source = new EventSource(
  "http://127.0.0.1:8787/api/events"
);

source.addEventListener("tiktok-event", message => {
  const event = JSON.parse(message.data);
  handleTikTokEvent(event);
});
```

`EventSource` giữ kết nối mở. Mỗi event mới sẽ gọi callback ngay lập tức.

## 8. SSE với Node.js

Repo có file:

```text
examples/node_sse_client.mjs
```

Chạy:

```cmd
npm run example:sse
```

Client kết nối một lần và đọc luồng liên tục. Không gọi `/api/recent` lặp lại.

## 9. Ứng dụng nằm ở máy khác

### SSE trong mạng LAN

Cho middleware lắng nghe mọi card mạng:

```cmd
set "API_HOST=0.0.0.0"
start_visible.bat ten_tiktok
```

Ứng dụng dùng IP của máy chạy middleware:

```text
http://192.168.1.50:8787/api/events
```

Cần mở port `8787` trong Windows Firewall nếu bị chặn.

### Webhook trong mạng LAN

Ứng dụng nhận mở endpoint tại IP của nó, ví dụ:

```text
http://192.168.1.60:9000/tiktok-event
```

Máy middleware cấu hình:

```cmd
set "WEBHOOK_URLS=http://192.168.1.60:9000/tiktok-event"
start_visible.bat ten_tiktok
```

Không nên mở API công khai ra Internet khi chưa bổ sung xác thực, HTTPS và giới hạn IP.

## 10. Xử lý CAPTCHA

Middleware tự kiểm tra CAPTCHA theo chu kỳ mặc định `2000 ms`.

Khi phát hiện:

1. dừng collector;
2. ngừng phát event;
3. phát âm báo;
4. đưa Chrome ra màn hình kể cả đang chạy chế độ ẩn;
5. chờ người dùng tự hoàn thành xác minh;
6. tự nạp lại collector sau khi popup biến mất;
7. nếu ban đầu chạy ẩn thì tự đưa Chrome ra ngoài màn hình lại.

Có thể đổi chu kỳ phát hiện:

```cmd
set "CAPTCHA_CHECK_MS=1500"
```

Middleware không tự chọn đáp án CAPTCHA.

## 11. Luồng khởi động chuẩn với webhook

CMD thứ nhất — ứng dụng nhận:

```cmd
npm run example:webhook
```

CMD thứ hai — middleware:

```cmd
set "WEBHOOK_URLS=http://127.0.0.1:9000/tiktok-event"
start_visible.bat ten_tiktok
```

Kết quả:

```text
TikTok có event
      ↓
Middleware chuẩn hóa JSON
      ↓ POST tự động
Ứng dụng nhận và xử lý ngay
```

Ứng dụng không cần gọi API kiểm tra event mới.
