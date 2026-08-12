import assert from "node:assert/strict";
import { EventBus } from "../src/core/event_bus.mjs";
import { SUPPORTED_EVENT_TYPES, TikTokEventNormalizer } from "../src/core/event_normalizer.mjs";
import { HttpEventGateway } from "../src/transports/http_gateway.mjs";

const normalizer = new TikTokEventNormalizer({ liveUrl: "https://www.tiktok.com/@example/live" });
assert.deepEqual(SUPPORTED_EVENT_TYPES, ["join", "comment", "follow", "share", "like", "gift"]);

// DOM compatibility tests.
assert.equal(normalizer.normalize({ type: "comment", sender: "Dương", comment: "gửi Hoa hồng × 1", raw: "Dương gửi Hoa hồng × 1" }), null);
const comment = normalizer.normalize({ type: "comment", sender: "Lienq", comment: "he", raw: "he", source: "direct-comment-elements", timestamp: 123 });
assert.equal(comment.eventType, "comment");
assert.equal(comment.payload.source, "direct-comment-elements");

const join = normalizer.normalize({ type: "join", sender: "Lienq", action: "đã tham gia", raw: "Lienq đã tham gia", source: "join-message" });
assert.equal(join.eventType, "join");
assert.equal(normalizer.normalize({ type: "join", sender: "Lienq", action: "đã tham gia", source: "social-message" }), null);

const follow = normalizer.normalize({ type: "follow", sender: ".", action: "đã follow chủ phòng", raw: ". đã follow chủ phòng", source: "social-message" });
const share = normalizer.normalize({ type: "share", sender: "Đ a N G", action: "đã chia sẻ phiên LIVE", raw: "Đ a N G đã chia sẻ phiên LIVE", source: "social-message" });
assert.equal(follow.eventType, "follow");
assert.equal(share.eventType, "share");

const gift = normalizer.normalize({ type: "gift", sender: "Đ a N G", gift: "Hoa hồng", count: 1, totalCount: 1, action: "đã gửi Hoa hồng × 1", raw: "Đ a N G đã gửi Hoa hồng × 1", source: "gift-activity" });
assert.equal(gift.payload.giftKey, "hoa_hong");

const userLike = normalizer.normalize({ type: "like", sender: "Đ a N G", count: 1, action: "đã thích phiên LIVE", source: "user-activity", anonymous: false, suspected: false });
const anonymousLike = normalizer.normalize({ type: "like", sender: null, uniqueId: null, count: 1, action: "heart-animation", source: "heart-animation", anonymous: true, suspected: true });
assert.equal(userLike.user.identityType, "nickname");
assert.equal(anonymousLike.user.id, "anonymous:like");
assert.equal(normalizer.normalize({ type: "leave", sender: "Dương" }), null);

// Direct Webcast normalization tests from the standalone probe shape.
const directComment = normalizer.normalize({
  type: "comment",
  source: "webcast-direct",
  eventId: "7673153711426259728",
  roomId: "7673122677293501204",
  timestamp: 1786545325315,
  userId: "6883828740700521474",
  uniqueId: "quachen2022",
  sender: "QUÁ CHÉN",
  comment: "direct comment test",
});
assert.equal(directComment.eventId, "7673153711426259728");
assert.equal(directComment.source.collector, "webcast-direct");
assert.equal(directComment.source.roomId, "7673122677293501204");
assert.equal(directComment.user.id, "6883828740700521474");
assert.equal(directComment.user.identityType, "userId");
assert.equal(directComment.payload.text, "direct comment test");

const directJoin = normalizer.normalize({ type: "join", source: "webcast-direct", eventId: "j1", roomId: "r1", userId: "10", uniqueId: "u10", sender: "U10", memberCount: 200, enterType: 1, action: "join" });
assert.equal(directJoin.payload.memberCount, 200);

const directLike = normalizer.normalize({ type: "like", source: "webcast-direct", eventId: "l1", userId: "11", uniqueId: "u11", sender: "U11", count: 6, totalCount: 1200, anonymous: false, suspected: false });
assert.equal(directLike.payload.count, 6);
assert.equal(directLike.payload.totalCount, 1200);

const directFollow = normalizer.normalize({ type: "follow", source: "webcast-direct", eventId: "f1", userId: "12", uniqueId: "u12", sender: "U12", followCount: 10, followType: 1, action: "follow" });
assert.equal(directFollow.payload.followCount, 10);

const directShare = normalizer.normalize({ type: "share", source: "webcast-direct", eventId: "s1", userId: "13", uniqueId: "u13", sender: "U13", shareCount: 2, shareType: 1, action: "share" });
assert.equal(directShare.payload.shareCount, 2);

const directGift = normalizer.normalize({ type: "gift", source: "webcast-direct", eventId: "g1", userId: "14", uniqueId: "u14", sender: "U14", gift: "Rose", giftId: 5655, count: 2, totalCount: 3, comboCount: 3, repeatEnd: true, streaking: false, diamondCount: 1, action: "gift" });
assert.equal(directGift.payload.count, 2);
assert.equal(directGift.payload.totalCount, 3);
assert.equal(directGift.payload.giftId, 5655);

const eventBus = new EventBus({ maxRecent: 20 });
const gateway = new HttpEventGateway({ eventBus, host: "127.0.0.1", port: 18787 });
await gateway.start();
for (const event of [comment, join, follow, share, gift, userLike, anonymousLike, directComment, directJoin, directLike, directFollow, directShare, directGift]) {
  eventBus.publish(event);
}

const health = await fetch("http://127.0.0.1:18787/api/health").then(response => response.json());
assert.equal(health.ok, true);
assert.equal(health.eventCount, 13);

const schema = await fetch("http://127.0.0.1:18787/api/schema").then(response => response.json());
assert.equal(schema.supportedEventTypes.includes("share"), true);
assert.equal(schema.eventShape.source.collector, "webcast-direct|dom");
assert.equal(schema.collectorModes.direct.browserRequired, false);
assert.deepEqual(schema.unsupportedEventTypes, ["leave"]);

await gateway.stop();
console.log("Smoke test passed: DOM compatibility + Direct Webcast normalization.");
