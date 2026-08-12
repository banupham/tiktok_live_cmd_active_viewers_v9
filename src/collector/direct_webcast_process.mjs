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
    this.debug = Boolean(debug);
    this.child = null;
    this.stopping = false;
  }

  start() {
    if (this.child) return this.child;
    const scriptPath = path.join(this.scriptDir, "scripts", "direct_webcast_collector.py");
    const args = [scriptPath, this.username, "--connect-attempts", String(this.connectAttempts), "--retry-wait", String(this.retryWait)];
    if (this.debug) args.push("--debug");
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
      this.logger.error?.(`[DIRECT] Không chạy được Python: ${error?.message || error}`);
    });
    child.once("exit", (code, signal) => {
      this.child = null;
      stdout.close();
      stderr.close();
      this.onExit({ code, signal, stopping: this.stopping });
    });
    return child;
  }

  #handleLine(line) {
    const text = String(line || "").trim();
    if (!text) return;
    if (text.startsWith(EVENT_PREFIX)) {
      try { this.onEvent(JSON.parse(text.slice(EVENT_PREFIX.length))); }
      catch (error) { this.logger.warn?.(`[DIRECT] Event JSON lỗi: ${error?.message || error}`); }
      return;
    }
    if (text.startsWith(STATUS_PREFIX)) {
      try { this.onStatus(JSON.parse(text.slice(STATUS_PREFIX.length))); }
      catch (error) { this.logger.warn?.(`[DIRECT] Status JSON lỗi: ${error?.message || error}`); }
      return;
    }
    if (this.debug) this.logger.log?.(`[DIRECT PY] ${text}`);
  }

  async stop() {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        resolve();
      }, 2500);
      timer.unref?.();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      try { child.kill("SIGTERM"); }
      catch { clearTimeout(timer); resolve(); }
    });
  }
}
