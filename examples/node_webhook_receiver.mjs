import http from "node:http";

const host = process.env.WEBHOOK_HOST || "127.0.0.1";
const port = Math.max(1, Number(process.env.WEBHOOK_PORT || 9000));
const path = process.env.WEBHOOK_PATH || "/tiktok-event";

const seenEventIds = new Set();
const seenOrder = [];

function rememberEvent(eventId) {
  if (!eventId || seenEventIds.has(eventId)) return false;

  seenEventIds.add(eventId);
  seenOrder.push(eventId);

  while (seenOrder.length > 5000) {
    const oldest = seenOrder.shift();
    if (oldest) seenEventIds.delete(oldest);
  }

  return true;
}

function sendJson(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", body.length);
  response.end(body);
}

function handleTikTokEvent(event) {
  const user = event.user || {};
  const payload = event.payload || {};

  switch (event.eventType) {
    case "join":
      console.log(`[JOIN] ${user.displayName}`);
      break;

    case "comment":
      console.log(
        `[COMMENT] ${user.displayName}: ${payload.text}`
      );
      break;

    case "follow":
      console.log(`[FOLLOW] ${user.displayName}`);
      break;

    case "like":
      console.log(
        `[LIKE] ${user.displayName} x${payload.count || 1}`
      );
      break;

    case "gift":
      console.log(
        `[GIFT] ${user.displayName} gửi ${payload.giftName} ` +
          `x${payload.count || 1} | key=${payload.giftKey}`
      );
      break;

    default:
      console.log("[UNKNOWN]", event);
  }
}

const server = http.createServer((request, response) => {
  if (request.method !== "POST" || request.url !== path) {
    sendJson(response, 404, {
      ok: false,
      error: "Endpoint not found",
    });
    return;
  }

  const chunks = [];
  let totalBytes = 0;

  request.on("data", chunk => {
    totalBytes += chunk.length;

    if (totalBytes > 1024 * 1024) {
      request.destroy(new Error("Payload quá lớn"));
      return;
    }

    chunks.push(chunk);
  });

  request.on("end", () => {
    try {
      const event = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const isNew = rememberEvent(event.eventId);

      if (isNew) {
        handleTikTokEvent(event);
      } else {
        console.log(`[DUPLICATE] Bỏ qua eventId=${event.eventId}`);
      }

      sendJson(response, 200, {
        ok: true,
        accepted: isNew,
        eventId: event.eventId || null,
      });
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: error?.message || String(error),
      });
    }
  });

  request.on("error", error => {
    if (!response.headersSent) {
      sendJson(response, 400, {
        ok: false,
        error: error?.message || String(error),
      });
    }
  });
});

server.listen(port, host, () => {
  console.log(`Webhook receiver: http://${host}:${port}${path}`);
  console.log("Đang chờ middleware tự POST event tới đây...");
});
