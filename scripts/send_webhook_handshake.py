from __future__ import annotations

import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen


def build_health_url(webhook_url: str) -> str:
    """Đổi URL webhook thành endpoint /health trên cùng server."""
    parts = urlsplit(webhook_url)
    return urlunsplit((parts.scheme, parts.netloc, "/health", "", ""))


def check_health(webhook_url: str, timeout: float) -> bool:
    health_url = build_health_url(webhook_url)
    request = Request(
        health_url,
        method="GET",
        headers={
            "Accept": "application/json",
            "User-Agent": "tiktok-live-event-middleware-handshake/2.0",
            "X-TikTok-Middleware-Handshake": "1",
            "X-TikTok-Webhook-Url": webhook_url,
        },
    )

    try:
        with urlopen(request, timeout=timeout) as response:
            response_body = response.read().decode("utf-8", errors="replace")

            if not 200 <= response.status < 300:
                print(
                    f"[HANDSHAKE] THẤT BẠI {health_url}: "
                    f"HTTP {response.status}"
                )
                return False

            if response_body:
                try:
                    payload = json.loads(response_body)
                except json.JSONDecodeError:
                    payload = None

                if isinstance(payload, dict) and payload.get("ok") is False:
                    print(
                        f"[HANDSHAKE] THẤT BẠI {health_url}: "
                        f"server trả về ok=false"
                    )
                    return False

            print(f"[HANDSHAKE] KẾT NỐI OK: {webhook_url}")
            print(f"[HANDSHAKE] Health phản hồi: {health_url}")
            return True

    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        print(
            f"[HANDSHAKE] THẤT BẠI {health_url}: "
            f"HTTP {error.code} {detail}"
        )
    except URLError as error:
        print(f"[HANDSHAKE] THẤT BẠI {health_url}: {error.reason}")
    except TimeoutError:
        print(f"[HANDSHAKE] THẤT BẠI {health_url}: hết thời gian chờ")
    except OSError as error:
        print(f"[HANDSHAKE] THẤT BẠI {health_url}: {error}")

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

    print("[HANDSHAKE] Đang kiểm tra GET /health của server game...")
    results = [check_health(url, timeout) for url in urls]

    if all(results):
        print("[HANDSHAKE] TẤT CẢ WEBHOOK ĐÃ THÔNG NHAU.")
        return 0

    print("[HANDSHAKE] Có webhook chưa kết nối được. Middleware chưa được khởi động.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
