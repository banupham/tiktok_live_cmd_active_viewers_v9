import http from "node:http";
import { URL } from "node:url";
import { SUPPORTED_EVENT_TYPES } from "../core/event_normalizer.mjs";

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
  response.statusCode = statusCode;
  setCorsHeaders(response);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", body.length);
  response.end(body);
}

export class HttpEventGateway {
  constructor({
    eventBus,
    host = "127.0.0.1",
    port = 8787,
    logger = console,
  } = {}) {
    if (!eventBus) throw new Error("Thiếu eventBus");
    this.eventBus = eventBus;
    this.host = host;
    this.port = Math.max(1, Number(port) || 8787);
    this.logger = logger;
    this.server = null;
    this.sseClients = new Set();
    this.startedAt = null;
  }

  getBaseUrl() {
    return `http://${this.host}:${this.port}`;
  }

  getSchemaDocument() {
    return {
      schemaVersion: 1,
      service: "tiktok-live-event-middleware",
      collectorModes: {
        direct: {
          collector: "webcast-direct",
          transport: "TikTok Webcast HTTP + WebSocket",
          browserRequired: false,
        },
        dom: {
          collector: "dom",
          transport: "Chrome + DOM collectors",
          browserRequired: true,
        },
      },
      supportedEventTypes: SUPPORTED_EVENT_TYPES,
      unsupportedEventTypes: ["leave"],
      transport: {
        realtime: {
          method: "GET",
          path: "/api/events",
          contentType: "text/event-stream",
          sseEventName: "tiktok-event",
        },
        recent: {
          method: "GET",
          path: "/api/recent?limit=50",
        },
      },
      eventShape: {
        schemaVersion: "number",
        eventId: "string; direct ưu tiên TikTok msg_id khi có",
        eventType: SUPPORTED_EVENT_TYPES,
        timestamp: "number (Unix milliseconds)",
        receivedAt: "number (Unix milliseconds tại middleware)",
        source: {
          platform: "tiktok",
          collector: "webcast-direct|dom",
          liveUrl: "string|null",
          roomId: "string|null; direct mode khi có",
        },
        user: {
          id: "string; direct ưu tiên TikTok numeric user id",
          uniqueId: "string|null",
          displayName: "string",
          identityType: "userId|uniqueId|nickname|anonymous",
        },
        payload: "object phụ thuộc eventType",
        raw: "object tùy cấu hình",
      },
      payloads: {
        join: {
          action: "string|null",
          source: "webcast-direct|join-message",
          memberCount: "number|null; direct",
          enterType: "number|string|null; direct",
        },
        comment: {
          text: "string",
          normalizedText: "string",
          source: "webcast-direct|direct-comment-elements",
        },
        follow: {
          action: "string|null",
          source: "webcast-direct|social-message",
          followCount: "number|null; direct",
          followType: "number|string|null; direct",
        },
        share: {
          action: "string|null",
          source: "webcast-direct|social-message",
          shareCount: "number|null; direct",
          shareType: "number|string|null; direct",
        },
        like: {
          count: "number",
          totalCount: "number|undefined",
          action: "string|null",
          source: "webcast-direct|user-activity|heart-animation",
          anonymous: "boolean",
          suspected: "boolean",
        },
        gift: {
          giftName: "string",
          giftKey: "string",
          count: "number; direct mode là delta của combo",
          totalCount: "number|undefined",
          action: "string|null",
          source: "webcast-direct|gift-activity",
          giftId: "number|string|null; direct",
          comboCount: "number|null; direct",
          repeatEnd: "boolean|undefined; direct",
          streaking: "boolean|undefined; direct",
          diamondCount: "number|null; direct",
        },
      },
      notes: [
        "Direct Webcast là mode mặc định và không cần Chrome/DOM.",
        "DOM collector cũ vẫn giữ riêng để fallback/đối chiếu.",
        "Cả hai mode dùng chung normalizer và schema event downstream.",
        "LIKE DOM có user dùng user-activity; tim bay dùng heart-animation.",
        "Direct LIKE lấy user/count trực tiếp từ WebcastLikeMessage.",
        "Direct GIFT phát delta của repeat_count để tránh cộng lặp combo.",
        "Middleware không phát sự kiện leave.",
      ],
    };
  }

  handleRequest(request, response) {
    const method = request.method || "GET";
    const url = new URL(request.url || "/", this.getBaseUrl());

    if (method === "OPTIONS") {
      response.statusCode = 204;
      setCorsHeaders(response);
      response.end();
      return;
    }
    if (method !== "GET") {
      sendJson(response, 405, { ok: false, error: "Method not allowed" });
      return;
    }
    if (url.pathname === "/" || url.pathname === "/api") {
      sendJson(response, 200, {
        ok: true,
        service: "tiktok-live-event-middleware",
        endpoints: {
          health: "/api/health",
          events: "/api/events",
          recent: "/api/recent?limit=50",
          schema: "/api/schema",
        },
      });
      return;
    }
    if (url.pathname === "/api/health") {
      const stats = this.eventBus.getStats();
      sendJson(response, 200, {
        ok: true,
        service: "tiktok-live-event-middleware",
        schemaVersion: 1,
        uptimeSeconds: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
        sseClients: this.sseClients.size,
        ...stats,
      });
      return;
    }
    if (url.pathname === "/api/schema") {
      sendJson(response, 200, this.getSchemaDocument());
      return;
    }
    if (url.pathname === "/api/recent") {
      const limit = Math.min(
        500,
        Math.max(1, Math.floor(Number(url.searchParams.get("limit")) || 50))
      );
      const events = this.eventBus.getRecent(limit);
      sendJson(response, 200, { ok: true, count: events.length, events });
      return;
    }
    if (url.pathname === "/api/events") {
      this.openSse(request, response);
      return;
    }
    sendJson(response, 404, { ok: false, error: "Endpoint not found" });
  }

  openSse(request, response) {
    response.statusCode = 200;
    setCorsHeaders(response);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders?.();

    const client = { response };
    this.sseClients.add(client);
    response.write("retry: 2000\n");
    response.write("event: connected\n");
    response.write(`data: ${JSON.stringify({ ok: true, service: "tiktok-live-event-middleware", schemaVersion: 1 })}\n\n`);

    let cleaned = false;
    let pingTimer = null;
    let unsubscribe = () => {};
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (pingTimer) clearInterval(pingTimer);
      unsubscribe();
      this.sseClients.delete(client);
    };

    unsubscribe = this.eventBus.subscribe(event => {
      try {
        response.write(`id: ${event.eventId}\n`);
        response.write("event: tiktok-event\n");
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        cleanup();
      }
    });

    pingTimer = setInterval(() => {
      try {
        response.write(`: ping ${Date.now()}\n\n`);
      } catch {
        cleanup();
      }
    }, 15_000);
    pingTimer.unref?.();

    request.once("close", cleanup);
    request.once("aborted", cleanup);
    response.once("close", cleanup);
  }

  async start() {
    if (this.server) return this.getBaseUrl();
    this.server = http.createServer((request, response) => {
      try {
        this.handleRequest(request, response);
      } catch (error) {
        this.logger.error?.(`[HTTP API] ${error?.stack || error?.message || error}`);
        if (!response.headersSent) {
          sendJson(response, 500, { ok: false, error: "Internal server error" });
        } else {
          response.destroy();
        }
      }
    });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    this.startedAt = Date.now();
    return this.getBaseUrl();
  }

  async stop() {
    for (const client of this.sseClients) {
      try {
        client.response.end();
      } catch {}
    }
    this.sseClients.clear();
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise(resolve => server.close(() => resolve()));
  }
}
