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
  const sender = cleanText(rawEvent?.sender);
  const uniqueId = normalizeUniqueId(rawEvent?.uniqueId);
  const raw = cleanText(rawEvent?.raw);

  if (!sender) return true;
  if (uniqueId) return false;

  const senderKey = sender.toLocaleLowerCase("vi");

  if (/^(?:đã|gửi|đã\s+gửi|sent|gift|quà)$/i.test(senderKey)) {
    return true;
  }

  if (/^(?:(?:đã\s+)?gửi|sent)\b/i.test(raw)) {
    return true;
  }

  return false;
}

export class TikTokEventNormalizer {
  constructor({ liveUrl = null, includeRaw = true } = {}) {
    this.liveUrl = liveUrl;
    this.includeRaw = Boolean(includeRaw);
  }

  resolveUser(rawEvent) {
    const eventType = cleanText(rawEvent?.type).toLowerCase();

    if (eventType === "like" && rawEvent?.anonymous) {
      return {
        id: "anonymous:like",
        uniqueId: null,
        displayName: "LIKE",
        identityType: "anonymous",
      };
    }

    const displayName = cleanText(rawEvent?.sender) || "Không rõ";
    const uniqueId = normalizeUniqueId(rawEvent?.uniqueId);
    const nicknameKey = displayName.toLocaleLowerCase("vi");

    return {
      id: uniqueId || `nickname:${nicknameKey}`,
      uniqueId,
      displayName,
      identityType: uniqueId ? "uniqueId" : "nickname",
    };
  }

  hasValidSource(eventType, rawEvent) {
    const source = cleanText(rawEvent?.source);

    switch (eventType) {
      case "comment":
        return source === "direct-comment-elements";
      case "join":
        return source === "join-message";
      case "follow":
      case "share":
        return source === "social-message";
      case "gift":
        return source === "gift-activity";
      case "like":
        return LIKE_SOURCES.has(source);
      default:
        return false;
    }
  }

  normalize(rawEvent) {
    const eventType = cleanText(rawEvent?.type).toLowerCase();
    if (!SUPPORTED_EVENT_SET.has(eventType)) return null;
    if (!this.hasValidSource(eventType, rawEvent)) return null;

    if (eventType === "gift" && isIncompleteGiftIdentity(rawEvent)) {
      return null;
    }

    const user = this.resolveUser(rawEvent);
    const payload = {};
    const rawSource = cleanText(rawEvent?.source) || null;

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

      if (Number.isFinite(Number(rawEvent.totalCount))) {
        payload.totalCount = Math.max(
          count,
          Math.floor(Number(rawEvent.totalCount))
        );
      }
    }

    if (eventType === "like") {
      payload.count = Math.max(1, Math.floor(Number(rawEvent.count) || 1));
      payload.action = cleanText(rawEvent.action) || null;
      payload.source = rawSource;
      payload.anonymous = Boolean(rawEvent.anonymous);
      payload.suspected = Boolean(rawEvent.suspected);
    }

    if (
      eventType === "follow" ||
      eventType === "share" ||
      eventType === "join"
    ) {
      payload.action = cleanText(rawEvent.action) || null;
      payload.source = rawSource;
    }

    const timestamp = Number(rawEvent.timestamp) || Date.now();
    const event = {
      schemaVersion: 1,
      eventId: randomUUID().replaceAll("-", ""),
      eventType,
      timestamp,
      receivedAt: Date.now(),
      source: {
        platform: "tiktok",
        collector: "dom",
        liveUrl: this.liveUrl,
      },
      user,
      payload,
    };

    if (this.includeRaw) {
      event.raw = {
        text: cleanText(rawEvent.raw) || null,
      };
    }

    return event;
  }
}
