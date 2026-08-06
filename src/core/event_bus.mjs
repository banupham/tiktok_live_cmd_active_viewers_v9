export class EventBus {
  constructor({ maxRecent = 500, logger = console } = {}) {
    this.maxRecent = Math.max(1, Number(maxRecent) || 500);
    this.logger = logger;
    this.subscribers = new Set();
    this.recent = [];
    this.eventCount = 0;
    this.lastEventAt = null;
  }

  publish(event) {
    if (!event || typeof event !== "object") {
      throw new TypeError("event phải là object");
    }

    this.eventCount += 1;
    this.lastEventAt = Date.now();
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

  getStats() {
    return {
      eventCount: this.eventCount,
      recentCount: this.recent.length,
      subscriberCount: this.subscribers.size,
      lastEventAt: this.lastEventAt,
    };
  }
}
