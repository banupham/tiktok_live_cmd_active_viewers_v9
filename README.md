# TikTok LIVE Event Middleware

Middleware nhận sự kiện TikTok LIVE, chuẩn hóa thành JSON rồi phân phối cho game/ứng dụng qua **Webhook**, **SSE** và **JSONL**.

## Chạy nhanh

### Windows — cách đơn giản nhất

Direct mode là mặc định, không cần Chrome/DOM.

```cmd
install.bat
run.bat ten_tiktok
```

Ví dụ:

```cmd
run.bat nhuquynh230794
```

Có thể truyền port API:

```cmd
run.bat nhuquynh230794 8788
```

Các lựa chọn khác:

```cmd
run.bat direct ten_tiktok
run.bat dom ten_tiktok
run.bat dom-hidden ten_tiktok
run.bat game ten_tiktok
```

> **Windows / DOM:** chỉ khi thật sự cần collector DOM/Chrome mới chạy `install.bat dom`. Sau đó đóng Chrome và chạy `sync_profile.bat` một lần để tạo profile collector.

Các file cũ như `start_live.bat`, `start_visible.bat`, `start_hidden.bat`, `start_middleware_to_game.bat` vẫn được giữ để tương thích.

---

### Linux — direct mode

Cần Node.js, npm và Python 3.

```sh
npm install --omit=optional
python3 -m pip install -r requirements-direct.txt
PYTHON_BIN=python3 sh run.sh ten_tiktok
```

Nếu máy có lệnh `python` trỏ tới Python 3:

```sh
npm install --omit=optional
python -m pip install -r requirements-direct.txt
sh run.sh ten_tiktok
```

> **Linux:** nên dùng `direct`. DOM mode hiện chưa được repo hỗ trợ trên Linux vì phần DOM đang dùng `LOCALAPPDATA` và Chrome profile theo Windows.

---

### Termux — direct mode

Cài gói cần thiết:

```sh
pkg update
pkg install nodejs python git
```

Sau khi clone repo:

```sh
npm install --omit=optional
python -m pip install -r requirements-direct.txt
sh run.sh ten_tiktok
```

Ví dụ:

```sh
sh run.sh nhuquynh230794
```

> **Termux:** dùng `direct` mode. Không dùng các file `.bat`, `sync_profile.bat` hoặc DOM/Chrome profile của Windows.

---

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

### 2. `dom` — dự phòng, hiện dành cho Windows

Collector DOM dùng Chrome + Playwright và Chrome profile riêng. DOM mode vẫn giữ xử lý CAPTCHA thủ công: middleware chỉ phát hiện, đưa cửa sổ Chrome ra màn hình và chờ người dùng tự xác minh; không tự giải CAPTCHA.

Cài phần DOM:

```cmd
install.bat dom
sync_profile.bat
run.bat dom ten_tiktok
```

Ẩn cửa sổ Chrome:

```cmd
run.bat dom-hidden ten_tiktok
```

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

## Kết nối server game

### Windows

CMD 1:

```cmd
python examples\game_event_server.py
```

CMD 2:

```cmd
run.bat game ten_tiktok
```

### Linux / Termux

Terminal 1:

```sh
python3 examples/game_event_server.py
```

Terminal 2:

```sh
PYTHON_BIN=python3 sh run.sh game ten_tiktok
```

Trên Termux thường chỉ cần:

```sh
python examples/game_event_server.py
sh run.sh game ten_tiktok
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

DOM event có:

```text
source.collector = dom
```

## API middleware

```text
http://127.0.0.1:8787/api/health
http://127.0.0.1:8787/api/events
http://127.0.0.1:8787/api/recent?limit=50
http://127.0.0.1:8787/api/schema
```

## Cấu hình nhanh

Direct mode dùng biến môi trường chung trên mọi hệ điều hành:

```text
COLLECTOR_MODE=direct
PYTHON_BIN=python
DIRECT_CONNECT_ATTEMPTS=3
DIRECT_RETRY_WAIT=4
DIRECT_RUNTIME_RESTARTS=5
DIRECT_RUNTIME_RESTART_WAIT=4
DIRECT_RUNTIME_RESTART_MAX_WAIT=20
DIRECT_DEBUG=0
API_HOST=127.0.0.1
API_PORT=8787
```

Windows có thể tham khảo `config.example.cmd`.

Linux / Termux đặt biến ngay trước lệnh chạy, ví dụ:

```sh
API_PORT=8788 PYTHON_BIN=python3 sh run.sh ten_tiktok
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

## Kiểm tra code

```sh
npm run check
npm run test:smoke
```

Direct collector Python: `scripts/direct_webcast_collector.py`.
Node sidecar adapter: `src/collector/direct_webcast_process.mjs`.
Collector DOM nằm trong `src/collector/` và chỉ chạy khi chọn `COLLECTOR_MODE=dom`.
