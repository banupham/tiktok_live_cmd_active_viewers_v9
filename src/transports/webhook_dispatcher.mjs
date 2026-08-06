function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export class WebhookDispatcher {
  constructor({
    urls = [],
    fetchImpl = globalThis.fetch,
    timeoutMs = 3000,
    retryCount = 1,
    logger = console,
  } = {}) {
    this.urls = [...new Set(urls.map(String).map(url => url.trim()).filter(Boolean))];
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(250, Number(timeoutMs) || 3000);
    this.retryCount = Math.max(0, Math.floor(Number(retryCount) || 0));
    this.logger = logger;
    this.queue = Promise.resolve();
    this.lastErrorAt = new Map();
  }

  dispatch(event) {
    if (!this.urls.length) return;

    this.queue = this.queue.then(async () => {
      await Promise.all(this.urls.map(url => this.postWithRetry(url, event)));
    });
  }

  async postWithRetry(url, event) {
    let lastError = null;

    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "tiktok-live-event-middleware/1.0",
          },
          body: JSON.stringify(event),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return true;
      } catch (error) {
        lastError = error;
        if (attempt < this.retryCount) {
          await sleep(300 * (attempt + 1));
        }
      } finally {
        clearTimeout(timer);
      }
    }

    const now = Date.now();
    const previous = this.lastErrorAt.get(url) || 0;
    if (now - previous > 10_000) {
      this.lastErrorAt.set(url, now);
      this.logger.warn?.(
        `[WEBHOOK] Không gửi được tới ${url}: ${lastError?.message || lastError}`
      );
    }

    return false;
  }

  async flush(timeoutMs = this.timeoutMs + 500) {
    await Promise.race([
      this.queue,
      new Promise(resolve => setTimeout(resolve, timeoutMs)),
    ]);
  }
}
