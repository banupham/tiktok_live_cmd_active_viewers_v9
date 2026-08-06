TIKTOK LIVE EVENT MIDDLEWARE
============================

Repo đã được chuyển từ script ACTIVE VIEWERS V9 thành middleware sự kiện dùng chung.

SỰ KIỆN HỖ TRỢ
---------------
- JOIN
- COMMENT
- FOLLOW
- LIKE
- GIFT

KHÔNG HỖ TRỢ
-------------
- LEAVE / người dùng đã rời LIVE
- current-viewers.json
- VIEWER_TTL_SECONDS

Ứng dụng hoặc game nhận event tự quản lý trạng thái người dùng và thời gian không hoạt động.

HƯỚNG DẪN
----------
Xem:
  README.md
  HUONG_DAN_TICH_HOP.md

CHẠY NHANH
----------
  npm install
  sync_profile.bat
  start_visible.bat ten_tiktok

API mặc định:
  http://127.0.0.1:8787/api/health
  http://127.0.0.1:8787/api/events
  http://127.0.0.1:8787/api/recent?limit=50
  http://127.0.0.1:8787/api/schema
