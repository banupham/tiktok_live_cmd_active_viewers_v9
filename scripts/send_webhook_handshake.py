from __future__ import annotations

import json
import os
import sys
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def build_payload(url: str) -> dict:
    now = int(time.time() * 1000)
    return {
        "schemaVersion": 1,
        "eventId": f"handshake_{uuid.uuid4().hex}",
        "eventType": "middleware_status",
        "timestamp": now,
        "receivedAt": now,
        "source": {
            "platform": "middleware",
            "collector": "startup-handshake",
            "liveUrl": None,
        },
        "user": {
            "id": "middleware",
            "uniqueId": None,
            "displayName": "TikTok LIVE Event Middleware",
            "identityType": "system",
        },
        "payload": {
            "status": "connected",
            "message": "Middleware có thể gửi POST tới server game",
            "webhookUrl": url,
        },
        "raw": {"text": None},
    }


def send_handshake(url: str, timeout: float) -> bool:
    body = json.dumps(build_payload(url), ensure_ascii=False).encode("utf-8")
    request = Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "tiktok-live-event-middleware-handshake/1.0",
        },
    )

    try:
        with urlopen(request, timeout=timeout) as response:
            response_body = response.read().decode("utf-8", errors="replace")
            if not 200 <= response.status < 300:
                print(f"[HANDSHAKE] THẤT BẠI {url}: HTTP {response.status}")
                return False

            print(f"[HANDSHAKE] KẾT NỐI OK: {url}")
            if response_body:
                print(f"[HANDSHAKE] Server trả lời: {response_body}")
            return True

    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        print(f"[HANDSHAKE] THẤT BẠI {url}: HTTP {error.code} {detail}")
    except URLError as error:
        print(f"[HANDSHAKE] THẤT BẠI {url}: {error.reason}")
    except TimeoutError:
        print(f"[HANDSHAKE] THẤT BẠI {url}: hết thời gian chờ")
    except OSError as error:
        print(f"[HANDSHAKE] THẤT BẠI {url}: {error}")

    return False


def main() -> int:
    urls = [
        value.strip()
        for value in os.environ.get("WEBHOOK_URLS", "").split(",")
        if value.strip()
    ]

    if not urls:
        print("[HANDSHAKE] Chưa cấu hình WEBHOOK_URLS.")
        return 1

    timeout_ms = max(250, int(os.environ.get("WEBHOOK_TIMEOUT_MS", "3000")))
    timeout = timeout_ms / 1000

    print("[HANDSHAKE] Đang kiểm tra đường truyền middleware → server game...")
    results = [send_handshake(url, timeout) for url in urls]

    if all(results):
        print("[HANDSHAKE] TẤT CẢ WEBHOOK ĐÃ THÔNG NHAU.")
        return 0

    print("[HANDSHAKE] Có webhook chưa kết nối được. Middleware chưa được khởi động.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
