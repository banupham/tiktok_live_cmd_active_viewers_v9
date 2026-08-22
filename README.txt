TIKTOK LIVE EVENT MIDDLEWARE
============================

Repo đã được chuyển từ script ACTIVE VIEWERS V9 thành middleware sự kiện dùng chung.

SỰ KIỆN HỖ TRỢ
---------------
- JOIN
- COMMENT
- FOLLOW
- SHARE
- LIKE
- GIFT

KHÔNG HỖ TRỢ
-------------
- LEAVE / người dùng đã rời LIVE
- current-viewers.json
- VIEWER_TTL_SECONDS

Ứng dụng hoặc game nhận event tự quản lý trạng thái người dùng và thời gian không hoạt động.

CHẠY NHANH - WINDOWS
--------------------
  install.bat
  run.bat ten_tiktok

DOM/Chrome chỉ khi cần:
  install.bat dom
  sync_profile.bat
  run.bat dom ten_tiktok

LINUX / TERMUX
--------------
Ưu tiên DIRECT mode, không dùng các file .bat:
  npm install --omit=optional
  python -m pip install -r requirements-direct.txt
  sh run.sh ten_tiktok

Xem hướng dẫn chi tiết và ghi chú Linux/Termux trong README.md.

API mặc định:
  http://127.0.0.1:8787/api/health
  http://127.0.0.1:8787/api/events
  http://127.0.0.1:8787/api/recent?limit=50
  http://127.0.0.1:8787/api/schema
