import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  EventBus,
  HttpEventGateway,
  JsonlWriter,
  TikTokEventNormalizer,
  WebhookDispatcher,
  installTikTokLiveDomCollector,
} from "./src/index.mjs";
import { DirectWebcastProcess } from "./src/collector/direct_webcast_process.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const input = process.argv[2]?.trim();

if (!input) {
  console.log("Cách chạy:");
  console.log("  node a.mjs username");
  console.log("  node a.mjs @username");
  console.log("  node a.mjs https://www.tiktok.com/@username/live");
  process.exit(1);
}

function inputToUniqueId(value) {
  const text = String(value || "").trim();
  if (!/^https?:\/\//i.test(text)) return text.replace(/^@/, "");
  try {
    const url = new URL(text);
    const match = url.pathname.match(/\/@([^/]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
}

const uniqueId = inputToUniqueId(input);
if (!uniqueId) {
  console.error("Không lấy được TikTok username từ tham số đầu vào.");
  process.exit(1);
}

const liveUrl = /^https?:\/\//i.test(input)
  ? input
  : `https://www.tiktok.com/@${uniqueId}/live`;

const collectorMode = String(process.env.COLLECTOR_MODE || "direct")
  .trim()
  .toLowerCase();
if (!new Set(["direct", "dom"]).has(collectorMode)) {
  console.error(`COLLECTOR_MODE không hợp lệ: ${collectorMode}. Dùng direct hoặc dom.`);
  process.exit(1);
}

const showBrowser = process.env.SHOW_BROWSER !== "0";
const verboseEvents = process.env.VERBOSE_EVENTS === "1";
const includeRaw = process.env.INCLUDE_RAW !== "0";
const apiHost = process.env.API_HOST?.trim() || "127.0.0.1";
const apiPort = Math.max(1, Number(process.env.API_PORT || 8787));
const maxRecent = Math.max(1, Number(process.env.MAX_RECENT_EVENTS || 500));
const captchaCheckMs = Math.max(1000, Number(process.env.CAPTCHA_CHECK_MS || 2000));
const webhookUrls = String(process.env.WEBHOOK_URLS || "")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);

const localAppData = process.env.LOCALAPPDATA || "";
const sourceChromeUserDataDir = localAppData
  ? path.join(localAppData, "Google", "Chrome", "User Data")
  : "";
const chromeUserDataDir =
  process.env.COLLECTOR_USER_DATA_DIR?.trim() ||
  (localAppData ? path.join(localAppData, "TikTokLiveCollectorChrome") : "");
const chromeProfileDirectory = process.env.CHROME_PROFILE?.trim() || "Profile 1";
const clonedProfilePath = chromeUserDataDir
  ? path.join(chromeUserDataDir, chromeProfileDirectory)
  : "";

const defaultLogPath = path.join(SCRIPT_DIR, "data", "events.jsonl");
const eventLogPath =
  process.env.EVENT_LOG_PATH === "0"
    ? null
    : process.env.EVENT_LOG_PATH?.trim() || defaultLogPath;

const eventBus = new EventBus({ maxRecent });
const normalizer = new TikTokEventNormalizer({ liveUrl, includeRaw });
const eventWriter = new JsonlWriter({ filePath: eventLogPath });
const webhookDispatcher = new WebhookDispatcher({
  urls: webhookUrls,
  timeoutMs: Number(process.env.WEBHOOK_TIMEOUT_MS || 3000),
  retryCount: Number(process.env.WEBHOOK_RETRY_COUNT || 1),
});
const httpGateway = new HttpEventGateway({ eventBus, host: apiHost, port: apiPort });

let context = null;
let page = null;
let directCollector = null;
let stopping = false;
let collectorInstalled = false;
let eventCount = 0;
let reinjectTimer = null;
let challengeTimer = null;
let challengeActive = false;
let challengeCheckRunning = false;
let challengeDetectedAt = null;

function formatEvent(event) {
  const time = new Date(event.timestamp).toLocaleTimeString("vi-VN");
  const sender = event.user.displayName;
  const payload = event.payload || {};
  switch (event.eventType) {
    case "comment":
      return `[${time}] COMMENT | ${sender}: ${payload.text}`;
    case "gift":
      return `[${time}] GIFT | ${sender} gửi ${payload.giftName} x${payload.count}`;
    case "follow":
      return `[${time}] FOLLOW | ${sender}`;
    case "share":
      return `[${time}] SHARE | ${sender}`;
    case "like":
      return `[${time}] LIKE | ${sender} x${payload.count || 1}`;
    case "join":
      return `[${time}] JOIN | ${sender}`;
    default:
      return `[${time}] ${event.eventType.toUpperCase()} | ${sender}`;
  }
}

function receiveRawEvent(rawEvent) {
  if (collectorMode === "dom" && challengeActive) return null;
  const event = normalizer.normalize(rawEvent);
  if (!event) return null;

  eventCount += 1;
  eventWriter.write(event);
  eventBus.publish(event);
  webhookDispatcher.dispatch(event);

  console.log(formatEvent(event));
  if (verboseEvents) console.log(JSON.stringify(event, null, 2));
  return event;
}

function isBenignWasmError(message) {
  const text = String(message || "");
  return text.includes("WebAssembly.instantiate()") && text.includes("expected magic word");
}

async function positionChromeWindow(forceVisible = false) {
  if (!page || page.isClosed() || !context) return;
  try {
    const session = await context.newCDPSession(page);
    const { windowId } = await session.send("Browser.getWindowForTarget");
    const visible = forceVisible || showBrowser;
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: visible
        ? { windowState: "normal", left: 80, top: 60, width: 1365, height: 900 }
        : { windowState: "normal", left: -32000, top: -32000, width: 1365, height: 900 },
    });
    await session.detach();
  } catch (error) {
    console.warn(`[CHROME] Không đổi được vị trí cửa sổ: ${error?.message || error}`);
  }
}

async function detectTikTokChallenge() {
  if (!page || page.isClosed()) return { detected: false, reason: null };
  try {
    return await page.evaluate(() => {
      const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
      const isVisible = element => {
        if (!(element instanceof Element)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) > 0
        );
      };
      const matchesChallengeText = value => {
        const text = clean(value);
        return (
          /chọn\s*2\s*đối\s*tượng/i.test(text) ||
          /hình\s*dạng\s*giống\s*nhau/i.test(text) ||
          /hoàn\s*tất\s*xác\s*minh/i.test(text) ||
          /security\s*(?:check|verification)/i.test(text) ||
          /verify\s*(?:to\s*continue|you\s*are\s*human)/i.test(text) ||
          /select\s*2\s*objects/i.test(text)
        );
      };
      const selectors = [
        'iframe[src*="captcha" i]',
        'iframe[src*="verify" i]',
        '[id*="captcha" i]',
        '[class*="captcha" i]',
        '[data-e2e*="captcha" i]',
        '[role="dialog"]',
      ];
      for (const selector of selectors) {
        for (const element of document.querySelectorAll(selector)) {
          if (!isVisible(element)) continue;
          const text = clean(element.innerText || element.textContent || "");
          const structuralCaptcha = /captcha|verify/i.test(
            `${element.id} ${element.className} ${element.getAttribute("src") || ""}`
          );
          if (structuralCaptcha || matchesChallengeText(text)) {
            return { detected: true, reason: text.slice(0, 180) || selector };
          }
        }
      }
      const bodyText = clean(document.body?.innerText || "");
      if (matchesChallengeText(bodyText)) return { detected: true, reason: bodyText.slice(0, 180) };
      return { detected: false, reason: null };
    });
  } catch {
    return { detected: false, reason: null };
  }
}

async function injectCollector({ allowDuringChallenge = false } = {}) {
  if (!page || page.isClosed()) return;
  if (challengeActive && !allowDuringChallenge) return;
  await page.waitForSelector("body", { timeout: 30_000 });
  await page.evaluate(installTikTokLiveDomCollector, {
    dedupeMs: Math.max(250, Number(process.env.DEDUPE_MS || 1500)),
    maxRowText: Math.max(100, Number(process.env.MAX_ROW_TEXT || 320)),
    maxDescendantsPerMutation: Math.max(50, Number(process.env.MAX_DESCENDANTS_PER_MUTATION || 250)),
  });
  collectorInstalled = true;
}

async function enterChallengeMode(details = {}) {
  if (challengeActive || stopping) return;
  challengeActive = true;
  challengeDetectedAt = Date.now();
  collectorInstalled = false;
  clearTimeout(reinjectTimer);
  console.log("");
  console.log("====================================================");
  console.log("[CAPTCHA] TikTok yêu cầu xác minh người thật.");
  console.log("[CAPTCHA] Collector DOM đã tạm dừng, không phát event.");
  console.log("[CAPTCHA] Chrome đã được đưa ra màn hình.");
  console.log("[CAPTCHA] Hãy tự chọn đáp án và bấm Xác nhận.");
  console.log("[CAPTCHA] Middleware sẽ tự nối lại sau khi popup biến mất.");
  if (details.reason) console.log(`[CAPTCHA] Dấu hiệu: ${details.reason}`);
  console.log("====================================================");
  console.log("");
  process.stdout.write("\x07");
  await page?.evaluate(() => window.TikTokLiveDOM?.stop?.()).catch(() => {});
  await positionChromeWindow(true);
}

async function leaveChallengeMode() {
  if (!challengeActive || stopping || !page || page.isClosed()) return;
  console.log("[CAPTCHA] Popup đã biến mất. Đang khôi phục collector DOM...");
  await page.waitForTimeout(3000);
  try {
    await injectCollector({ allowDuringChallenge: true });
    challengeActive = false;
    challengeDetectedAt = null;
    if (!showBrowser) await positionChromeWindow(false);
    console.log("[CAPTCHA] Collector DOM đã hoạt động trở lại.");
  } catch (error) {
    console.warn(`[CAPTCHA] Chưa khôi phục được collector: ${error?.message || error}`);
  }
}

function startChallengeMonitor() {
  if (challengeTimer) return;
  challengeTimer = setInterval(async () => {
    if (stopping || challengeCheckRunning || !page || page.isClosed()) return;
    challengeCheckRunning = true;
    try {
      const details = await detectTikTokChallenge();
      if (details.detected && !challengeActive) {
        await enterChallengeMode(details);
        return;
      }
      if (!details.detected && challengeActive) await leaveChallengeMode();
    } finally {
      challengeCheckRunning = false;
    }
  }, captchaCheckMs);
  challengeTimer.unref?.();
}

function scheduleCollectorReinject() {
  if (!collectorInstalled || stopping || challengeActive) return;
  clearTimeout(reinjectTimer);
  reinjectTimer = setTimeout(() => {
    injectCollector().catch(error => {
      console.warn(`[COLLECTOR] Không thể nạp lại sau điều hướng: ${error?.message || error}`);
    });
  }, 1500);
}

async function startBrowser() {
  if (!localAppData) throw new Error("DOM mode yêu cầu Windows/LOCALAPPDATA để dùng Chrome profile.");
  if (!fs.existsSync(path.join(chromeUserDataDir, "Local State"))) {
    throw new Error([
      "Chưa có hồ sơ Chrome dành cho collector.",
      "Hãy đóng Google Chrome rồi chạy sync_profile.bat một lần.",
      `Nguồn: ${path.join(sourceChromeUserDataDir, chromeProfileDirectory)}`,
      `Đích: ${clonedProfilePath}`,
    ].join("\n"));
  }
  if (!fs.existsSync(clonedProfilePath)) {
    throw new Error([
      `Không tìm thấy bản sao ${chromeProfileDirectory}.`,
      "Hãy đóng Google Chrome rồi chạy sync_profile.bat.",
      `Đường dẫn cần có: ${clonedProfilePath}`,
    ].join("\n"));
  }

  const { chromium } = await import("playwright");
  context = await chromium.launchPersistentContext(chromeUserDataDir, {
    channel: "chrome",
    headless: false,
    bypassCSP: true,
    timeout: 45_000,
    ignoreDefaultArgs: ["--no-sandbox"],
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1365, height: 900 },
    args: [
      `--profile-directory=${chromeProfileDirectory}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=CalculateNativeWinOcclusion",
      "--disable-blink-features=AutomationControlled",
      "--autoplay-policy=no-user-gesture-required",
      "--window-size=1365,900",
    ],
  });
  const oldPages = context.pages();
  page = await context.newPage();
  for (const oldPage of oldPages) {
    if (oldPage !== page && oldPage.url() === "about:blank") await oldPage.close().catch(() => {});
  }
  await page.exposeFunction("__sendTikTokDomEvent", receiveRawEvent);
  await page.exposeFunction("__sendTikTokStatus", status => {
    if (status?.message) console.log(`[COLLECTOR] ${status.message}`);
  });
  page.on("pageerror", error => {
    if (isBenignWasmError(error?.message)) return;
    console.error(`[PAGE ERROR] ${error?.message || error}`);
  });
  page.on("crash", () => console.error("[PAGE CRASH] Trang TikTok đã crash."));
  page.on("framenavigated", frame => {
    if (frame === page?.mainFrame()) scheduleCollectorReinject();
  });
  await positionChromeWindow();
  console.log(`Đang mở LIVE bằng DOM: ${liveUrl}`);
  await page.goto(liveUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await positionChromeWindow();
  await page.waitForTimeout(8000);
  const challenge = await detectTikTokChallenge();
  if (challenge.detected) await enterChallengeMode(challenge);
  else await injectCollector();
}

function handleDirectStatus(status) {
  const message = status?.message || "STATUS";
  if (message === "CONNECTED") {
    console.log(`[DIRECT] CONNECTED | room_id=${status.roomId || "?"} | @${status.uniqueId || uniqueId}`);
  } else if (message === "CONNECT_ERROR") {
    console.warn(`[DIRECT] CONNECT ERROR ${status.httpStatus || ""} | ${status.errorType || ""}: ${status.error || ""}`);
  } else if (message === "RETRY_WAIT") {
    console.log(`[DIRECT] Retry sau ${status.seconds}s...`);
  } else {
    console.log(`[DIRECT] ${message}`);
  }
}

function startDirectCollector() {
  directCollector = new DirectWebcastProcess({
    scriptDir: SCRIPT_DIR,
    username: uniqueId,
    onEvent: receiveRawEvent,
    onStatus: handleDirectStatus,
    onExit: ({ code, signal, stopping: childStopping }) => {
      if (stopping || childStopping) return;
      const exitCode = Number.isInteger(code) ? code : signal ? 1 : 0;
      console.log(`[DIRECT] Collector đã dừng (code=${code}, signal=${signal || "-"}).`);
      stop(exitCode).catch(error => {
        console.error(`[STOP ERROR] ${error?.stack || error}`);
        process.exit(exitCode || 1);
      });
    },
  });
  directCollector.start();
}

async function start() {
  const apiBaseUrl = await httpGateway.start();
  console.log("");
  console.log("TIKTOK LIVE EVENT MIDDLEWARE");
  console.log(`Collector   : ${collectorMode === "direct" ? "DIRECT WEBCAST (không browser/DOM)" : "DOM / Chrome"}`);
  console.log(`API health  : ${apiBaseUrl}/api/health`);
  console.log(`SSE events  : ${apiBaseUrl}/api/events`);
  console.log(`Recent      : ${apiBaseUrl}/api/recent?limit=50`);
  console.log(`Schema      : ${apiBaseUrl}/api/schema`);
  console.log(`Webhook     : ${webhookUrls.length ? webhookUrls.join(", ") : "không cấu hình"}`);
  console.log(`Event log   : ${eventLogPath || "đã tắt"}`);
  console.log("Sự kiện     : JOIN / COMMENT / FOLLOW / SHARE / LIKE / GIFT");
  console.log("Không phát  : LEAVE / người dùng rời LIVE");
  if (collectorMode === "dom") console.log(`CAPTCHA      : kiểm tra mỗi ${captchaCheckMs} ms, chờ người dùng xác minh`);
  console.log("");
  if (collectorMode === "direct") startDirectCollector();
  else {
    await startBrowser();
    startChallengeMonitor();
  }
  console.log("Middleware đã sẵn sàng. Nhấn Ctrl + C để dừng.");
}

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(reinjectTimer);
  if (challengeTimer) {
    clearInterval(challengeTimer);
    challengeTimer = null;
  }
  console.log(`\nĐang dừng middleware... Tổng event: ${eventCount}`);
  if (challengeActive && challengeDetectedAt) {
    const seconds = Math.floor((Date.now() - challengeDetectedAt) / 1000);
    console.log(`[CAPTCHA] Đã chờ xác minh ${seconds} giây trước khi dừng.`);
  }
  try {
    if (collectorInstalled && page && !page.isClosed()) {
      await page.evaluate(() => window.TikTokLiveDOM?.stop?.()).catch(() => {});
    }
    await directCollector?.stop?.();
    await webhookDispatcher.flush();
    await httpGateway.stop();
    await context?.close();
  } finally {
    process.exit(exitCode);
  }
}

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));

start().catch(async error => {
  const message = String(error?.stack ?? error);
  console.error("\nKHÔNG KHỞI ĐỘNG ĐƯỢC:");
  if (/processSingleton|SingletonLock|user data directory is already in use|profile.*in use/i.test(message)) {
    console.error("Hồ sơ collector đang bị một tiến trình Chrome khác sử dụng. Đóng cửa sổ Chrome collector cũ rồi chạy lại.");
  }
  console.error(message);
  await directCollector?.stop?.().catch(() => {});
  await httpGateway.stop().catch(() => {});
  await context?.close().catch(() => {});
  process.exit(1);
});
