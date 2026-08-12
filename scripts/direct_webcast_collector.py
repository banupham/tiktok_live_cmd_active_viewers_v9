#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import sys
from collections import deque
from typing import Any

from TikTokLive import TikTokLiveClient
from TikTokLive.events import CommentEvent, ConnectEvent, DisconnectEvent, FollowEvent, GiftEvent, JoinEvent, LikeEvent, ShareEvent

EVENT_PREFIX = "@@TIKTOK_EVENT@@"
STATUS_PREFIX = "@@TIKTOK_STATUS@@"
HTTP_STATUS_RE = re.compile(r"HTTP\s+(\d{3})", re.I)


def emit(prefix: str, payload: dict[str, Any]) -> None:
    print(prefix + json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


def status(message: str, **details: Any) -> None:
    emit(STATUS_PREFIX, {"message": message, **details})


def first_not_none(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    try:
        return str(value)
    except Exception:
        return None


def get_room_id(client: TikTokLiveClient) -> int | None:
    value = first_not_none(getattr(client, "room_id", None), getattr(client, "_room_id", None))
    try:
        return int(value) if value else None
    except Exception:
        return None


def common_msg_id(event: Any) -> Any:
    common = getattr(event, "common", None)
    return first_not_none(getattr(common, "msg_id", None), getattr(common, "message_id", None), getattr(event, "msg_id", None))


def common_room_id(event: Any, client: TikTokLiveClient) -> Any:
    common = getattr(event, "common", None)
    return first_not_none(getattr(common, "room_id", None), get_room_id(client))


def common_timestamp(event: Any) -> Any:
    common = getattr(event, "common", None)
    return first_not_none(getattr(common, "create_time", None), getattr(common, "timestamp", None))


def extract_user(user: Any) -> dict[str, Any]:
    if user is None:
        return {"userId": None, "uniqueId": None, "sender": None}
    return {
        "userId": safe(first_not_none(getattr(user, "id", None), getattr(user, "id_str", None))),
        "uniqueId": safe(first_not_none(getattr(user, "unique_id", None), getattr(user, "display_id", None))),
        "sender": safe(first_not_none(getattr(user, "nickname", None), getattr(user, "display_name", None))),
    }


def http_status(exc: BaseException) -> int | None:
    value = getattr(exc, "status_code", None)
    try:
        if value is not None:
            return int(value)
    except Exception:
        pass
    match = HTTP_STATUS_RE.search(str(exc))
    return int(match.group(1)) if match else None


class Dedupe:
    def __init__(self, limit: int = 30000) -> None:
        self.limit = limit
        self.seen: set[str] = set()
        self.order: deque[str] = deque()

    def first(self, event_type: str, msg_id: Any) -> bool:
        key = f"{event_type}:{msg_id}" if msg_id not in (None, "") else ""
        if not key:
            return True
        if key in self.seen:
            return False
        self.seen.add(key)
        self.order.append(key)
        while len(self.order) > self.limit:
            self.seen.discard(self.order.popleft())
        return True


class DirectCollector:
    def __init__(self, username: str, attempts: int, retry_wait: float, debug: bool) -> None:
        self.username = username.lstrip("@")
        self.attempts = max(1, min(int(attempts), 5))
        self.retry_wait = max(1.0, float(retry_wait))
        self.debug = bool(debug)
        self.client: TikTokLiveClient | None = None
        self.room_id: int | None = None
        self.dedupe = Dedupe()
        self.gift_streak_totals: dict[str, int] = {}

    def emit_event(self, event_type: str, event: Any, payload: dict[str, Any]) -> None:
        assert self.client is not None
        msg_id = common_msg_id(event)
        if not self.dedupe.first(event_type, msg_id):
            return
        user = extract_user(getattr(event, "user", None))
        raw = {
            "type": event_type,
            "source": "webcast-direct",
            "eventId": safe(msg_id),
            "roomId": safe(common_room_id(event, self.client)),
            "timestamp": safe(common_timestamp(event)),
            **user,
            **payload,
        }
        emit(EVENT_PREFIX, raw)

    def gift_delta(self, event: GiftEvent) -> tuple[int, int]:
        user = extract_user(getattr(event, "user", None))
        user_key = str(user.get("userId") or user.get("uniqueId") or user.get("sender") or "unknown")
        gift_id = int(getattr(event, "gift_id", 0) or 0)
        group_id = int(getattr(event, "group_id", 0) or 0)
        total = max(1, int(getattr(event, "repeat_count", 1) or 1))
        key = f"{user_key}:{gift_id}:{group_id or 'nogroup'}"
        previous = self.gift_streak_totals.get(key, 0)
        delta = max(0, total - previous)
        if delta == 0 and total <= 1:
            delta = 1
        self.gift_streak_totals[key] = total
        repeat_end = bool(getattr(event, "repeat_end", 0))
        try:
            streaking = bool(event.streaking)
        except Exception:
            streaking = not repeat_end
        if repeat_end or not streaking:
            self.gift_streak_totals.pop(key, None)
        return delta, total

    def make_client(self) -> TikTokLiveClient:
        client = TikTokLiveClient(unique_id=f"@{self.username}")
        try:
            client.logger.setLevel(logging.DEBUG if self.debug else logging.ERROR)
        except Exception:
            pass
        try:
            fingerprint = "'bytes' object has no attribute 'HashtagNamespace'"
            if fingerprint not in client.parse_error_ignorelist:
                client.parse_error_ignorelist.append(fingerprint)
        except Exception:
            pass

        @client.on(ConnectEvent)
        async def on_connect(event: ConnectEvent) -> None:
            self.room_id = get_room_id(client) or int(getattr(event, "room_id", 0) or 0) or None
            status("CONNECTED", uniqueId=self.username, roomId=self.room_id)

        @client.on(CommentEvent)
        async def on_comment(event: CommentEvent) -> None:
            text = first_not_none(getattr(event, "content", None), getattr(event, "comment", None))
            self.emit_event("comment", event, {"comment": safe(text)})

        @client.on(JoinEvent)
        async def on_join(event: JoinEvent) -> None:
            self.emit_event("join", event, {"action": "join", "memberCount": safe(getattr(event, "member_count", None)), "enterType": safe(getattr(event, "enter_type", None))})

        @client.on(LikeEvent)
        async def on_like(event: LikeEvent) -> None:
            self.emit_event("like", event, {"count": max(1, int(getattr(event, "count", 1) or 1)), "totalCount": safe(getattr(event, "total", None)), "action": "like", "anonymous": False, "suspected": False})

        @client.on(FollowEvent)
        async def on_follow(event: FollowEvent) -> None:
            self.emit_event("follow", event, {"action": "follow", "followCount": safe(getattr(event, "follow_count", None)), "followType": safe(getattr(event, "follow_type", None))})

        @client.on(ShareEvent)
        async def on_share(event: ShareEvent) -> None:
            self.emit_event("share", event, {"action": "share", "shareCount": safe(getattr(event, "share_count", None)), "shareType": safe(getattr(event, "share_type", None))})

        @client.on(GiftEvent)
        async def on_gift(event: GiftEvent) -> None:
            gift = getattr(event, "gift", None)
            gift_name = first_not_none(getattr(gift, "name", None), getattr(gift, "gift_name", None), "gift")
            delta, total = self.gift_delta(event)
            if delta <= 0:
                return
            try:
                streaking = bool(event.streaking)
            except Exception:
                streaking = not bool(getattr(event, "repeat_end", 0))
            self.emit_event("gift", event, {
                "gift": safe(gift_name),
                "giftId": safe(getattr(event, "gift_id", None)),
                "count": delta,
                "totalCount": total,
                "comboCount": safe(getattr(event, "combo_count", None)),
                "repeatEnd": bool(getattr(event, "repeat_end", 0)),
                "streaking": streaking,
                "diamondCount": safe(getattr(gift, "diamond_count", None)),
                "action": "gift",
            })

        @client.on(DisconnectEvent)
        async def on_disconnect(event: DisconnectEvent) -> None:
            status("DISCONNECTED", roomId=get_room_id(client) or self.room_id)

        return client

    async def one_attempt(self, cached_room_id: int | None) -> tuple[bool, BaseException | None]:
        self.client = self.make_client()
        try:
            task = await self.client.start(
                process_connect_events=True,
                fetch_room_info=False,
                fetch_gift_info=True,
                fetch_live_check=True,
                room_id=cached_room_id,
            )
            await task
            return True, None
        except asyncio.CancelledError:
            raise
        except BaseException as exc:
            resolved = get_room_id(self.client)
            if resolved:
                self.room_id = resolved
            return False, exc
        finally:
            try:
                if self.client and getattr(self.client, "connected", False):
                    await self.client.disconnect()
            except Exception:
                pass

    async def run(self) -> int:
        cached_room_id = self.room_id
        for attempt in range(1, self.attempts + 1):
            status("CONNECTING", attempt=attempt, attempts=self.attempts, roomId=cached_room_id)
            ok, exc = await self.one_attempt(cached_room_id)
            if ok:
                return 0
            assert exc is not None
            code = http_status(exc)
            status("CONNECT_ERROR", attempt=attempt, errorType=type(exc).__name__, error=str(exc), httpStatus=code, roomId=self.room_id)
            if self.room_id:
                cached_room_id = self.room_id
            if code in (403, 429):
                return 2
            if attempt < self.attempts:
                wait = self.retry_wait * attempt
                status("RETRY_WAIT", seconds=wait)
                await asyncio.sleep(wait)
        return 1


async def async_main(args: argparse.Namespace) -> int:
    return await DirectCollector(args.username, args.connect_attempts, args.retry_wait, args.debug).run()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("username")
    parser.add_argument("--connect-attempts", type=int, default=3)
    parser.add_argument("--retry-wait", type=float, default=4.0)
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()
    args.username = args.username.strip().lstrip("@")
    if not args.username:
        return 2
    if sys.platform == "win32":
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        except Exception:
            pass
    try:
        return asyncio.run(async_main(args))
    except KeyboardInterrupt:
        status("STOPPED")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
