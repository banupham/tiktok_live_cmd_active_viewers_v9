TIKTOK LIVE CMD - ACTIVE VIEWERS V9
====================================

THAY ĐỔI SO VỚI V8
------------------
- Không còn hiển thị JOIN EVENT.
- JOIN vẫn được dùng nội bộ để thêm người vào danh sách viewer.
- COMMENT / GIFT / FOLLOW / LIKE vẫn giữ nguyên.
- Danh sách ID hiện tại được ghi liên tục vào:
    current-viewers.json
- Khi danh sách thay đổi, CMD hiển thị:
    [VIEWERS UPDATE]
    [VIEWER IDS]

GIỚI HẠN QUAN TRỌNG
-------------------
TikTok DOM không cung cấp đầy đủ event "người dùng đã rời LIVE".

Vì vậy đây là danh sách người dùng ĐANG HOẠT ĐỘNG ƯỚC TÍNH:
- thêm/cập nhật khi có JOIN, COMMENT, GIFT, FOLLOW hoặc LIKE;
- xóa khi không có hoạt động trong một khoảng thời gian.

Mặc định:
  120 giây

Đổi thời gian trước khi chạy:
  set VIEWER_TTL_SECONDS=60
  start_live.bat alana.phng.trinh

Người vẫn xem nhưng im lặng lâu hơn TTL cũng có thể bị xóa khỏi danh sách.
Người đã thoát sẽ được xóa sau khi hết TTL, không phải ngay lập tức.

ID
--
Khi DOM có đường dẫn hồ sơ, chương trình lưu ID dạng:
  @uniqueId

Khi TikTok chỉ hiển thị nickname mà không đưa ID vào DOM:
  nickname:Tên hiển thị

Nếu người đó bình luận sau này và DOM lộ @uniqueId, bản ghi nickname
sẽ được gộp sang ID thật.

CÀI MỘT LẦN
-----------
install.bat

SAO CHÉP PROFILE 1 MỘT LẦN
--------------------------
Đóng toàn bộ Chrome rồi chạy:
  sync_profile.bat

CHẠY ẨN
-------
start_live.bat alana.phng.trinh

CHẠY HIỆN CỬA SỔ
----------------
start_visible.bat alana.phng.trinh

FILE KẾT QUẢ
------------
tiktok-events.jsonl
  Chỉ chứa COMMENT / GIFT / FOLLOW / LIKE.

current-viewers.json
  Danh sách viewer hoạt động ước tính tại thời điểm hiện tại.

DỪNG
----
Ctrl + C
