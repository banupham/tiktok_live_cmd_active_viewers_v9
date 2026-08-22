export class EventBus {
  constructor({ maxRecent = 500, maxAvatars = 10000, logger = console } = {}) {
    this.maxRecent = Math.max(1, Number(maxRecent) || 500);
    this.maxAvatars = Math.max(100, Number(maxAvatars) || 10000);
    this.logger = logger;
    this.subscribers = new Set();
    this.recent = [];
    this.avatarCache = new Map();
    this.avatarAliases = new Map();
    this.eventCount = 0;
    this.lastEventAt = null;
  }

  cacheAvatar(event) {
    if (event?.eventType !== "avatar") return;
    const user = event.user || {};
    const avatarUrl = String(event.payload?.avatarUrl || "").trim();
    const avatarPath = String(event.payload?.avatarPath || "").trim();
    if (!avatarUrl || !avatarPath) return;

    const canonicalKey = String(user.id || user.uniqueId || "").trim();
    if (!canonicalKey) return;

    const previous = this.avatarCache.get(canonicalKey);
    const record = {
      userId: user.id || null,
      uniqueId: user.uniqueId || null,
      displayName: user.displayName || null,
      avatarUrl,
      avatarPath,
      mimeType: event.payload?.mimeType || null,
      bytes: Number.isFinite(Number(event.payload?.bytes)) ? Number(event.payload.bytes) : null,
      cachedAt: previous?.cachedAt || event.receivedAt || Date.now(),
      updatedAt: event.receivedAt || Date.now(),
    };

    this.avatarCache.delete(canonicalKey);
    this.avatarCache.set(canonicalKey, record);
    this.avatarAliases.set(`id:${canonicalKey}`, canonicalKey);
    if (user.uniqueId) this.avatarAliases.set(`unique:${String(user.uniqueId).toLowerCase()}`, canonicalKey);

    while (this.avatarCache.size > this.maxAvatars) {
      const oldestKey = this.avatarCache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.avatarCache.get(oldestKey);
      this.avatarCache.delete(oldestKey);
      this.avatarAliases.delete(`id:${oldestKey}`);
      if (oldest?.uniqueId) this.avatarAliases.delete(`unique:${String(oldest.uniqueId).toLowerCase()}`);
    }
  }

  publish(event) {
    if (!event || typeof event !== "object") {
      throw new TypeError("event phải là object");
    }

    this.eventCount += 1;
    this.lastEventAt = Date.now();
    this.cacheAvatar(event);
    this.recent.push(event);

    if (this.recent.length > this.maxRecent) {
      this.recent.splice(0, this.recent.length - this.maxRecent);
    }

    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch (error) {
        this.logger.error?.(
          `[EVENT BUS] Subscriber lỗi: ${error?.message || error}`
        );
      }
    }

    return event;
  }

  subscribe(subscriber) {
    if (typeof subscriber !== "function") {
      throw new TypeError("subscriber phải là function");
    }

    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  getRecent(limit = 50) {
    const safeLimit = Math.min(
      this.maxRecent,
      Math.max(0, Math.floor(Number(limit) || 0))
    );

    return safeLimit > 0 ? this.recent.slice(-safeLimit) : [];
  }

  getAvatar(identifier) {
    const value = String(identifier || "").trim();
    if (!value) return null;
    const directKey = this.avatarAliases.get(`id:${value}`) || value;
    if (this.avatarCache.has(directKey)) return this.avatarCache.get(directKey);
    const uniqueKey = this.avatarAliases.get(`unique:${value.replace(/^@/, "").toLowerCase()}`);
    return uniqueKey ? this.avatarCache.get(uniqueKey) || null : null;
  }

  getAvatars(limit = 0) {
    const values = Array.from(this.avatarCache.values());
    const safeLimit = Math.max(0, Math.floor(Number(limit) || 0));
    return safeLimit > 0 ? values.slice(-safeLimit) : values;
  }

  getStats() {
    return {
      eventCount: this.eventCount,
      recentCount: this.recent.length,
      avatarCount: this.avatarCache.size,
      subscriberCount: this.subscribers.size,
      lastEventAt: this.lastEventAt,
    };
  }
}
