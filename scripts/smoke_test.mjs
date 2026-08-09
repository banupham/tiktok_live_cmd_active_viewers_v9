import assert from "node:assert/strict";
import { EventBus } from "../src/core/event_bus.mjs";
import {
  SUPPORTED_EVENT_TYPES,
  TikTokEventNormalizer,
} from "../src/core/event_normalizer.mjs";
import { HttpEventGateway } from "../src/transports/http_gateway.mjs";

const normalizer = new TikTokEventNormalizer({
  liveUrl: "https://www.tiktok.com/@example/live",
});

assert.deepEqual(SUPPORTED_EVENT_TYPES, [
  "join",
  "comment",
  "follow",
  "share",
  "like",
  "gift",
]);

// COMMENT chỉ được nhận từ collector comment riêng.
assert.equal(
  normalizer.normalize({
    type: "comment",
    sender: "Dương",
    comment: "gửi Hoa hồng × 1",
    raw: "Dương gửi Hoa hồng × 1",
  }),
  null
);

const comment = normalizer.normalize({
  type: "comment",
  sender: "Lienq",
  comment: "he",
  raw: "he",
  source: "direct-comment-elements",
  timestamp: 123,
});
assert.equal(comment.eventType, "comment");
assert.equal(comment.payload.text, "he");
assert.equal(comment.payload.source, "direct-comment-elements");

// JOIN có nguồn riêng, không dùng social/generic activity.
const join = normalizer.normalize({
  type: "join",
  sender: "Lienq",
  action: "đã tham gia",
  raw: "Lienq đã tham gia",
  source: "join-message",
});
assert.equal(join.eventType, "join");
assert.equal(join.payload.source, "join-message");
assert.equal(
  normalizer.normalize({
    type: "join",
    sender: "Lienq",
    action: "đã tham gia",
    source: "social-message",
  }),
  null
);

// FOLLOW và SHARE dùng chung social-message nhưng là hai eventType riêng.
const follow = normalizer.normalize({
  type: "follow",
  sender: ".",
  action: "đã follow chủ phòng",
  raw: ". đã follow chủ phòng",
  source: "social-message",
});
assert.equal(follow.eventType, "follow");

const share = normalizer.normalize({
  type: "share",
  sender: "Đ a N G",
  action: "đã chia sẻ phiên LIVE",
  raw: "Đ a N G đã chia sẻ phiên LIVE",
  source: "social-message",
});
assert.equal(share.eventType, "share");
assert.equal(share.user.displayName, "Đ a N G");

// GIFT chỉ được nhận từ gift-activity. COMMENT chứa chữ "gửi" không thể thành gift.
assert.equal(
  normalizer.normalize({
    type: "gift",
    sender: "Lienq",
    gift: "Hoa hồng",
    count: 1,
    totalCount: 1,
    raw: "Lienq gửi Hoa hồng × 1",
    source: "direct-comment-elements",
  }),
  null
);

const gift = normalizer.normalize({
  type: "gift",
  sender: "Đ a N G",
  gift: "Hoa hồng",
  count: 1,
  totalCount: 1,
  action: "đã gửi Hoa hồng × 1",
  raw: "Đ a N G đã gửi Hoa hồng × 1",
  source: "gift-activity",
});
assert.equal(gift.eventType, "gift");
assert.equal(gift.payload.giftKey, "hoa_hong");
assert.equal(gift.payload.count, 1);
assert.equal(gift.payload.source, "gift-activity");

// LIKE có user và tim bay vẫn cùng eventType=like nhưng source khác nhau.
const userLike = normalizer.normalize({
  type: "like",
  sender: "Đ a N G",
  count: 1,
  action: "đã thích phiên LIVE",
  raw: "Đ a N G đã thích phiên LIVE",
  source: "user-activity",
  anonymous: false,
  suspected: false,
});
assert.equal(userLike.eventType, "like");
assert.equal(userLike.user.displayName, "Đ a N G");
assert.equal(userLike.user.identityType, "nickname");
assert.equal(userLike.payload.source, "user-activity");
assert.equal(userLike.payload.anonymous, false);
assert.equal(userLike.payload.suspected, false);

const anonymousLike = normalizer.normalize({
  type: "like",
  sender: null,
  uniqueId: null,
  count: 1,
  action: "heart-animation",
  source: "heart-animation",
  anonymous: true,
  suspected: true,
});
assert.equal(anonymousLike.eventType, "like");
assert.equal(anonymousLike.user.id, "anonymous:like");
assert.equal(anonymousLike.user.identityType, "anonymous");
assert.equal(anonymousLike.payload.source, "heart-animation");
assert.equal(anonymousLike.payload.anonymous, true);
assert.equal(anonymousLike.payload.suspected, true);

assert.equal(
  normalizer.normalize({
    type: "like",
    sender: "Sai nguồn",
    source: "social-message",
  }),
  null
);
assert.equal(normalizer.normalize({ type: "leave", sender: "Dương" }), null);

const eventBus = new EventBus({ maxRecent: 10 });
const gateway = new HttpEventGateway({
  eventBus,
  host: "127.0.0.1",
  port: 18787,
});

await gateway.start();
for (const event of [comment, join, follow, share, gift, userLike, anonymousLike]) {
  eventBus.publish(event);
}

const health = await fetch("http://127.0.0.1:18787/api/health").then(
  response => response.json()
);
assert.equal(health.ok, true);
assert.equal(health.eventCount, 7);

const recent = await fetch(
  "http://127.0.0.1:18787/api/recent?limit=2"
).then(response => response.json());
assert.equal(recent.events.length, 2);
assert.equal(recent.events.at(-1).payload.source, "heart-animation");

const schema = await fetch("http://127.0.0.1:18787/api/schema").then(
  response => response.json()
);
assert.equal(schema.supportedEventTypes.includes("share"), true);
assert.deepEqual(schema.unsupportedEventTypes, ["leave"]);

await gateway.stop();
console.log("Smoke test passed: TikTok events are separated by source.");
