import assert from "node:assert/strict";
import { EventBus } from "../src/core/event_bus.mjs";
import { TikTokEventNormalizer } from "../src/core/event_normalizer.mjs";
import { HttpEventGateway } from "../src/transports/http_gateway.mjs";

const normalizer = new TikTokEventNormalizer({
  liveUrl: "https://www.tiktok.com/@example/live",
});

const comment = normalizer.normalize({
  type: "comment",
  sender: "Dương",
  uniqueId: "duong123",
  comment: "đánh",
  raw: "Dương đánh",
  timestamp: 123,
});

assert.equal(comment.eventType, "comment");
assert.equal(comment.payload.normalizedText, "ĐÁNH");
assert.equal(comment.user.id, "duong123");

const gift = normalizer.normalize({
  type: "gift",
  sender: "Dương",
  gift: "Hoa Hồng",
  count: 1,
  totalCount: 3,
});

assert.equal(gift.payload.giftKey, "hoa_hong");
assert.equal(gift.payload.totalCount, 3);
assert.equal(normalizer.normalize({ type: "leave", sender: "Dương" }), null);

const eventBus = new EventBus({ maxRecent: 5 });
const gateway = new HttpEventGateway({
  eventBus,
  host: "127.0.0.1",
  port: 18787,
});

await gateway.start();
eventBus.publish(comment);

const health = await fetch("http://127.0.0.1:18787/api/health").then(
  response => response.json()
);
assert.equal(health.ok, true);
assert.equal(health.eventCount, 1);

const recent = await fetch(
  "http://127.0.0.1:18787/api/recent?limit=1"
).then(response => response.json());
assert.equal(recent.events[0].eventId, comment.eventId);

const schema = await fetch("http://127.0.0.1:18787/api/schema").then(
  response => response.json()
);
assert.deepEqual(schema.unsupportedEventTypes, ["leave"]);

await gateway.stop();
console.log("Smoke test passed.");
