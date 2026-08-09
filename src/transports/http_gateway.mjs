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
        eventId: "string",
        eventType: SUPPORTED_EVENT_TYPES,
        timestamp: "number (Unix milliseconds từ trang TikTok)",
        receivedAt: "number (Unix milliseconds tại middleware)",
        source: {
          platform: "tiktok",
          collector: "dom",
          liveUrl: "string|null",
        },
        user: {
          id: "string",
          uniqueId: "string|null",
          displayName: "string",
          identityType: "uniqueId|nickname|anonymous",
        },
        payload: "object phụ thuộc eventType",
        raw: "object tùy cấu hình",
      },
      payloads: {
        join: {
          action: "string|null",
          source: "join-message",
        },
        comment: {
          text: "string",
          normalizedText: "string",
          source: "direct-comment-elements",
        },
        follow: {
          action: "string|null",
          source: "social-message",
        },
        share: {
          action: "string|null",
          source: "social-message",
        },
        like: {
          count: "number",
          action: "string|null",
          source: "user-activity|heart-animation",
          anonymous: "boolean",
          suspected: "boolean",
        },
        gift: {
          giftName: "string",
          giftKey: "string",
          count: "number",
          totalCount: "number|undefined",
          action: "string|null",
          source: "gift-activity",
        },
      },
      notes: [
        "Mỗi nhóm DOM được collector riêng xử lý để tránh event chồng chéo.",
        "LIKE có user dùng payload.source=user-activity; tim bay dùng payload.source=heart-animation.",
        "Middleware không phát sự kiện leave.",
        "Ứng dụng nhận tự quản lý việc người dùng rời hoặc hết thời gian hoạt động.",
        "Danh sách viewer chính xác không được TikTok DOM cung cấp đầy đủ.",
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
      sendJson(response, 405, {
        ok: false,
        error: "Method not allowed",
      });
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
        uptimeSeconds: this.startedAt
          ? Math.floor((Date.now() - this.startedAt) / 1000)
          : 0,
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

      sendJson(response, 200, {
        ok: true,
        count: events.length,
        events,
      });
      return;
    }

    if (url.pathname === "/api/events") {
      this.openSse(request, response);
      return;
    }

    sendJson(response, 404, {
      ok: false,
      error: "Endpoint not found",
    });
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
    response.write(
      `data: ${JSON.stringify({
        ok: true,
        service: "tiktok-live-event-middleware",
        schemaVersion: 1,
      })}\n\n`
    );

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
        this.logger.error?.(
          `[HTTP API] ${error?.stack || error?.message || error}`
        );

        if (!response.headersSent) {
          sendJson(response, 500, {
            ok: false,
            error: "Internal server error",
          });
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
      } catch {
        // Bỏ qua client đã đóng.
      }
    }
    this.sseClients.clear();

    if (!this.server) return;
    const server = this.server;
    this.server = null;

    await new Promise(resolve => server.close(() => resolve()));
  }
}
