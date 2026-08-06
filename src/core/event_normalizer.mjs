import { randomUUID } from "node:crypto";

export const SUPPORTED_EVENT_TYPES = Object.freeze([
  "join",
  "comment",
  "follow",
  "like",
  "gift",
]);

const SUPPORTED_EVENT_SET = new Set(SUPPORTED_EVENT_TYPES);

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

  if (
    /^(?:đã|gửi|đã\s+gửi|sent|gift|quà)$/i.test(senderKey)
  ) {
    return true;
  }

  // TikTok thường dựng DOM theo nhiều bước. Ở bước đầu, hàng quà có thể chỉ
  // chứa "đã gửi Hoa hồng x1" và regex cũ hiểu nhầm "đã" là tên người gửi.
  // Chờ lần cập nhật sau có nickname/uniqueId đầy đủ rồi mới phát event.
  if (
    /^(?:(?:đã\s+)?gửi|sent)\b/i.test(raw)
  ) {
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

  normalize(rawEvent) {
    const eventType = cleanText(rawEvent?.type).toLowerCase();
    if (!SUPPORTED_EVENT_SET.has(eventType)) return null;

    if (eventType === "gift" && isIncompleteGiftIdentity(rawEvent)) {
      return null;
    }

    const user = this.resolveUser(rawEvent);
    const payload = {};

    if (eventType === "comment") {
      const text = cleanText(rawEvent.comment);
      payload.text = text;
      payload.normalizedText = text.toLocaleUpperCase("vi");
    }

    if (eventType === "gift") {
      const giftName = cleanText(rawEvent.gift || "gift");
      const count = Math.max(1, Math.floor(Number(rawEvent.count) || 1));

      payload.giftName = giftName;
      payload.giftKey = normalizeGiftKey(giftName) || "gift";
      payload.count = count;

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
      payload.suspected = true;
    }

    if (eventType === "follow" || eventType === "join") {
      payload.action = cleanText(rawEvent.action) || null;
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
