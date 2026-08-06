from __future__ import annotations

import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen


def build_health_url(webhook_url: str) -> str:
    parts = urlsplit(webhook_url)
    return urlunsplit((parts.scheme, parts.netloc, "/health", "", ""))


def check_health(webhook_url: str, timeout: float) -> bool:
    health_url = build_health_url(webhook_url)
    expected_token = os.environ.get("GAME_EVENT_INSTANCE_TOKEN", "").strip()

    request = Request(
        health_url,
        method="GET",
        headers={
            "Accept": "application/json",
            "User-Agent": "tiktok-live-event-middleware-handshake/4.0",
            "X-TikTok-Middleware-Handshake": "1",
            "X-TikTok-Webhook-Url": webhook_url,
        },
    )

    try:
        with urlopen(request, timeout=timeout) as response:
            response_body = response.read().decode("utf-8", errors="replace")

            if not 200 <= response.status < 300:
                print(f"[HANDSHAKE] THẤT BẠI {health_url}: HTTP {response.status}")
                return False

            try:
                payload = json.loads(response_body)
            except json.JSONDecodeError:
                print(f"[HANDSHAKE] THẤT BẠI {health_url}: server không trả JSON hợp lệ")
                return False

            if payload.get("ok") is not True:
                print(f"[HANDSHAKE] THẤT BẠI {health_url}: server trả ok != true")
                return False

            if payload.get("service") != "game-event-server":
                print(
                    f"[HANDSHAKE] THẤT BẠI {health_url}: "
                    f"sai service {payload.get('service')!r}"
                )
                return False

            instance_id = str(payload.get("instanceId") or "").strip()
            actual_token = str(payload.get("instanceToken") or "").strip()
            pid = payload.get("pid")
            version = str(payload.get("version") or "không rõ")
            event_path = str(payload.get("eventPath") or "")

            if not instance_id:
                print(f"[HANDSHAKE] THẤT BẠI {health_url}: server quá cũ")
                return False

            if expected_token and actual_token != expected_token:
                print("[HANDSHAKE] THẤT BẠI: đang kết nối nhầm process server cũ.")
                print(f"[HANDSHAKE] Token cần : {expected_token}")
                print(f"[HANDSHAKE] Token nhận: {actual_token or 'không có'}")
                print(f"[HANDSHAKE] PID nhầm  : {pid}")
                return False

            if event_path != urlsplit(webhook_url).path:
                print(
                    f"[HANDSHAKE] THẤT BẠI: eventPath server={event_path!r}, "
                    f"webhook={urlsplit(webhook_url).path!r}"
                )
                return False

            print(f"[HANDSHAKE] KẾT NỐI OK: {webhook_url}")
            print(f"[HANDSHAKE] Server version : {version}")
            print(f"[HANDSHAKE] Server instance: {instance_id}")
            print(f"[HANDSHAKE] Server PID     : {pid}")
            print(f"[HANDSHAKE] Session token  : {actual_token or 'không cấu hình'}")
            print(f"[HANDSHAKE] Health         : {health_url}")
            return True

    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        print(f"[HANDSHAKE] THẤT BẠI {health_url}: HTTP {error.code} {detail}")
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

    print("[HANDSHAKE] Đang xác nhận đúng process game server...")
    results = [check_health(url, timeout) for url in urls]

    if all(results):
        print("[HANDSHAKE] TẤT CẢ WEBHOOK ĐÃ THÔNG NHAU.")
        return 0

    print("[HANDSHAKE] Có webhook chưa kết nối đúng server. Middleware chưa khởi động.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
