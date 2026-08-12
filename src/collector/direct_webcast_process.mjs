import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";

const EVENT_PREFIX = "@@TIKTOK_EVENT@@";
const STATUS_PREFIX = "@@TIKTOK_STATUS@@";

export class DirectWebcastProcess {
  constructor({
    scriptDir,
    username,
    onEvent,
    onStatus = () => {},
    onExit = () => {},
    logger = console,
    pythonBin = process.env.PYTHON_BIN?.trim() || "python",
    connectAttempts = Number(process.env.DIRECT_CONNECT_ATTEMPTS || 3),
    retryWait = Number(process.env.DIRECT_RETRY_WAIT || 4),
    runtimeRestarts = Number(process.env.DIRECT_RUNTIME_RESTARTS || 5),
    runtimeRestartWait = Number(process.env.DIRECT_RUNTIME_RESTART_WAIT || 4),
    runtimeRestartMaxWait = Number(process.env.DIRECT_RUNTIME_RESTART_MAX_WAIT || 20),
    debug = process.env.DIRECT_DEBUG === "1",
  } = {}) {
    if (!scriptDir) throw new Error("Thiếu scriptDir");
    if (!username) throw new Error("Thiếu username");
    if (typeof onEvent !== "function") throw new Error("Thiếu onEvent");

    this.scriptDir = scriptDir;
    this.username = username;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.onExit = onExit;
    this.logger = logger;
    this.pythonBin = pythonBin;
    this.connectAttempts = Math.max(1, Math.min(5, Math.floor(connectAttempts || 3)));
    this.retryWait = Math.max(1, Number(retryWait) || 4);
    this.runtimeRestarts = Math.max(0, Math.min(20, Math.floor(runtimeRestarts || 5)));
    this.runtimeRestartWait = Math.max(1, Number(runtimeRestartWait) || 4);
    this.runtimeRestartMaxWait = Math.max(
      this.runtimeRestartWait,
      Number(runtimeRestartMaxWait) || 20
    );
    this.debug = Boolean(debug);

    this.child = null;
    this.stopping = false;
    this.restartTimer = null;
    this.restartCount = 0;
    this.everConnected = false;
    this.connectedAt = null;
    this.lastStatus = null;

    // Giữ dedupe ở tiến trình Node để event replay sau khi Python sidecar
    // reconnect/restart không bị phát lại xuống webhook/SSE/game.
    this.seenEventIds = new Set();
    this.seenEventOrder = [];
    this.maxSeenEventIds = 30000;
  }

  start() {
    if (this.child || this.restartTimer || this.stopping) return this.child;
    return this.#spawnChild();
  }

  #spawnChild() {
    if (this.stopping) return null;

    const scriptPath = path.join(
      this.scriptDir,
      "scripts",
      "direct_webcast_collector.py"
    );
    const args = [
      scriptPath,
      this.username,
      "--connect-attempts",
      String(this.connectAttempts),
      "--retry-wait",
      String(this.retryWait),
    ];
    if (this.debug) args.push("--debug");

    this.lastStatus = null;
    this.connectedAt = null;

    const child = spawn(this.pythonBin, args, {
      cwd: this.scriptDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: "1" },
    });

    this.child = child;

    const stdout = readline.createInterface({ input: child.stdout });
    stdout.on("line", line => this.#handleLine(line));

    const stderr = readline.createInterface({ input: child.stderr });
    stderr.on("line", line => {
      if (line.trim()) this.logger.warn?.(`[DIRECT PY] ${line}`);
    });

    child.once("error", error => {
      this.logger.error?.(
        `[DIRECT] Không chạy được Python: ${error?.message || error}`
      );
    });

    child.once("exit", (code, signal) => {
      this.child = null;
      stdout.close();
      stderr.close();
      this.#handleChildExit({ code, signal });
    });

    return child;
  }

  #rememberEvent(event) {
    const eventId = event?.eventId;
    const eventType = event?.type;
    if (eventId == null || eventId === "" || !eventType) return true;

    const key = `${eventType}:${eventId}`;
    if (this.seenEventIds.has(key)) return false;

    this.seenEventIds.add(key);
    this.seenEventOrder.push(key);

    while (this.seenEventOrder.length > this.maxSeenEventIds) {
      const old = this.seenEventOrder.shift();
      if (old) this.seenEventIds.delete(old);
    }

    return true;
  }

  #handleLine(line) {
    const text = String(line || "").trim();
    if (!text) return;

    if (text.startsWith(EVENT_PREFIX)) {
      try {
        const event = JSON.parse(text.slice(EVENT_PREFIX.length));
        if (this.#rememberEvent(event)) this.onEvent(event);
        else if (this.debug) {
          this.logger.log?.(
            `[DIRECT] Bỏ event replay ${event.type}:${event.eventId}`
          );
        }
      } catch (error) {
        this.logger.warn?.(
          `[DIRECT] Event JSON lỗi: ${error?.message || error}`
        );
      }
      return;
    }

    if (text.startsWith(STATUS_PREFIX)) {
      try {
        const status = JSON.parse(text.slice(STATUS_PREFIX.length));
        this.lastStatus = status;
        if (status?.message === "CONNECTED") {
          this.everConnected = true;
          this.connectedAt = Date.now();
        }
        this.onStatus(status);
      } catch (error) {
        this.logger.warn?.(
          `[DIRECT] Status JSON lỗi: ${error?.message || error}`
        );
      }
      return;
    }

    if (this.debug) this.logger.log?.(`[DIRECT PY] ${text}`);
  }

  #shouldStopAfterExit(code) {
    if (this.stopping) return true;

    // Python direct collector dùng code=2 khi gặp 403/429. Không tự restart
    // trong trường hợp block/rate-limit.
    if (code === 2) return true;

    const status = this.lastStatus || {};
    if (
      status.message === "CONNECT_ERROR" &&
      new Set(["UserOfflineError", "UserNotFoundError"]).has(status.errorType)
    ) {
      return true;
    }

    return false;
  }

  #handleChildExit({ code, signal }) {
    if (this.#shouldStopAfterExit(code)) {
      this.onExit({ code, signal, stopping: this.stopping });
      return;
    }

    // Chỉ auto-restart khi sidecar đã từng CONNECTED. Startup fail ban đầu vẫn
    // do Python xử lý bằng DIRECT_CONNECT_ATTEMPTS rồi trả lỗi cho middleware.
    if (!this.everConnected || this.runtimeRestarts <= 0) {
      this.onExit({ code, signal, stopping: this.stopping });
      return;
    }

    const connectedForMs = this.connectedAt
      ? Math.max(0, Date.now() - this.connectedAt)
      : 0;

    // Một connection sống >=60s được coi là ổn định; lần ngắt kế tiếp bắt đầu
    // lại chu kỳ reconnect từ mức 1 thay vì cộng dồn từ lỗi cũ.
    if (connectedForMs >= 60_000) this.restartCount = 0;

    if (this.restartCount >= this.runtimeRestarts) {
      this.logger.warn?.(
        `[DIRECT] Đã hết ${this.runtimeRestarts} lần reconnect sau disconnect.`
      );
      this.onExit({ code, signal, stopping: this.stopping });
      return;
    }

    this.restartCount += 1;
    const waitSeconds = Math.min(
      this.runtimeRestartMaxWait,
      this.runtimeRestartWait * this.restartCount
    );

    this.logger.warn?.(
      `[DIRECT] Kết nối đã ngắt (code=${code}, signal=${signal || "-"}, ` +
      `sống=${(connectedForMs / 1000).toFixed(1)}s). ` +
      `Reconnect ${this.restartCount}/${this.runtimeRestarts} sau ${waitSeconds}s...`
    );

    this.onStatus({
      message: "RECONNECT_WAIT",
      seconds: waitSeconds,
      reconnectAttempt: this.restartCount,
      reconnectAttempts: this.runtimeRestarts,
      reason: "sidecar_exit_after_connected",
    });

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopping) this.#spawnChild();
    }, waitSeconds * 1000);
    this.restartTimer.unref?.();
  }

  async stop() {
    this.stopping = true;

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    const child = this.child;
    if (!child) return;

    await new Promise(resolve => {
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {}
        resolve();
      }, 2500);
      timer.unref?.();

      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });

      try {
        child.kill("SIGTERM");
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }
}
