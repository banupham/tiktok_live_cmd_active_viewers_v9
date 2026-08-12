import { randomUUID } from "node:crypto";

export const SUPPORTED_EVENT_TYPES = Object.freeze([
  "join",
  "comment",
  "follow",
  "share",
  "like",
  "gift",
]);

const SUPPORTED_EVENT_SET = new Set(SUPPORTED_EVENT_TYPES);
const LIKE_SOURCES = new Set(["user-activity", "heart-animation"]);
const DIRECT_SOURCE = "webcast-direct";

export function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeUniqueId(value) {
  const text = cleanText(value).replace(/^@/, "");
  if (!text) return null;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function normalizeGiftKey(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

export function isIncompleteGiftIdentity(rawEvent) {
  if (cleanText(rawEvent?.source) === DIRECT_SOURCE) return false;
  const sender = cleanText(rawEvent?.sender);
  const uniqueId = normalizeUniqueId(rawEvent?.uniqueId);
  const raw = cleanText(rawEvent?.raw);
  if (!sender) return true;
  if (uniqueId) return false;
  const senderKey = sender.toLocaleLowerCase("vi");
  if (/^(?:đã|gửi|đã\s+gửi|sent|gift|quà)$/i.test(senderKey)) return true;
  if (/^(?:(?:đã\s+)?gửi|sent)\b/i.test(raw)) return true;
  return false;
}

function normalizeTimestamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return n < 10_000_000_000 ? Math.floor(n * 1000) : Math.floor(n);
}

export class TikTokEventNormalizer {
  constructor({ liveUrl = null, includeRaw = true } = {}) {
    this.liveUrl = liveUrl;
    this.includeRaw = Boolean(includeRaw);
  }

  resolveUser(rawEvent) {
    const eventType = cleanText(rawEvent?.type).toLowerCase();
    if (eventType === "like" && rawEvent?.anonymous) {
      return { id: "anonymous:like", uniqueId: null, displayName: "LIKE", identityType: "anonymous" };
    }
    const displayName = cleanText(rawEvent?.sender) || "Không rõ";
    const uniqueId = normalizeUniqueId(rawEvent?.uniqueId);
    const userId = cleanText(rawEvent?.userId) || null;
    const nicknameKey = displayName.toLocaleLowerCase("vi");
    return {
      id: userId || uniqueId || `nickname:${nicknameKey}`,
      uniqueId,
      displayName,
      identityType: userId ? "userId" : uniqueId ? "uniqueId" : "nickname",
    };
  }

  hasValidSource(eventType, rawEvent) {
    const source = cleanText(rawEvent?.source);
    if (source === DIRECT_SOURCE) return SUPPORTED_EVENT_SET.has(eventType);
    switch (eventType) {
      case "comment": return source === "direct-comment-elements";
      case "join": return source === "join-message";
      case "follow":
      case "share": return source === "social-message";
      case "gift": return source === "gift-activity";
      case "like": return LIKE_SOURCES.has(source);
      default: return false;
    }
  }

  normalize(rawEvent) {
    const eventType = cleanText(rawEvent?.type).toLowerCase();
    if (!SUPPORTED_EVENT_SET.has(eventType)) return null;
    if (!this.hasValidSource(eventType, rawEvent)) return null;
    if (eventType === "gift" && isIncompleteGiftIdentity(rawEvent)) return null;

    const user = this.resolveUser(rawEvent);
    const payload = {};
    const rawSource = cleanText(rawEvent?.source) || null;
    const direct = rawSource === DIRECT_SOURCE;

    if (eventType === "comment") {
      const text = cleanText(rawEvent.comment);
      if (!text) return null;
      payload.text = text;
      payload.normalizedText = text.toLocaleUpperCase("vi");
      payload.source = rawSource;
    }

    if (eventType === "gift") {
      const giftName = cleanText(rawEvent.gift || "gift");
      const count = Math.max(1, Math.floor(Number(rawEvent.count) || 1));
      payload.giftName = giftName;
      payload.giftKey = normalizeGiftKey(giftName) || "gift";
      payload.count = count;
      payload.action = cleanText(rawEvent.action) || null;
      payload.source = rawSource;
      if (Number.isFinite(Number(rawEvent.totalCount))) payload.totalCount = Math.max(count, Math.floor(Number(rawEvent.totalCount)));
      if (direct) {
        payload.giftId = rawEvent.giftId ?? null;
        payload.comboCount = Number.isFinite(Number(rawEvent.comboCount)) ? Number(rawEvent.comboCount) : null;
        payload.repeatEnd = Boolean(rawEvent.repeatEnd);
        payload.streaking = Boolean(rawEvent.streaking);
        payload.diamondCount = Number.isFinite(Number(rawEvent.diamondCount)) ? Number(rawEvent.diamondCount) : null;
      }
    }

    if (eventType === "like") {
      payload.count = Math.max(1, Math.floor(Number(rawEvent.count) || 1));
      payload.action = cleanText(rawEvent.action) || null;
      payload.source = rawSource;
      payload.anonymous = Boolean(rawEvent.anonymous);
      payload.suspected = Boolean(rawEvent.suspected);
      if (Number.isFinite(Number(rawEvent.totalCount))) payload.totalCount = Math.max(0, Math.floor(Number(rawEvent.totalCount)));
    }

    if (eventType === "follow") {
      payload.action = cleanText(rawEvent.action) || null;
      payload.source = rawSource;
      if (direct) {
        payload.followCount = Number.isFinite(Number(rawEvent.followCount)) ? Number(rawEvent.followCount) : null;
        payload.followType = rawEvent.followType ?? null;
      }
    }

    if (eventType === "share") {
      payload.action = cleanText(rawEvent.action) || null;
      payload.source = rawSource;
      if (direct) {
        payload.shareCount = Number.isFinite(Number(rawEvent.shareCount)) ? Number(rawEvent.shareCount) : null;
        payload.shareType = rawEvent.shareType ?? null;
      }
    }

    if (eventType === "join") {
      payload.action = cleanText(rawEvent.action) || null;
      payload.source = rawSource;
      if (direct) {
        payload.memberCount = Number.isFinite(Number(rawEvent.memberCount)) ? Number(rawEvent.memberCount) : null;
        payload.enterType = rawEvent.enterType ?? null;
      }
    }

    const requestedEventId = cleanText(rawEvent?.eventId);
    const event = {
      schemaVersion: 1,
      eventId: requestedEventId || randomUUID().replaceAll("-", ""),
      eventType,
      timestamp: normalizeTimestamp(rawEvent.timestamp),
      receivedAt: Date.now(),
      source: {
        platform: "tiktok",
        collector: direct ? DIRECT_SOURCE : "dom",
        liveUrl: this.liveUrl,
        roomId: direct ? cleanText(rawEvent?.roomId) || null : null,
      },
      user,
      payload,
    };
    if (this.includeRaw) event.raw = { text: cleanText(rawEvent.raw) || null, source: rawSource };
    return event;
  }
}
