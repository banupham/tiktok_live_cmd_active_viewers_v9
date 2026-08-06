import { chromium } from "playwright";
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

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const input = process.argv[2]?.trim();

if (!input) {
  console.log("Cách chạy:");
  console.log("  node a.mjs username");
  console.log("  node a.mjs @username");
  console.log("  node a.mjs https://www.tiktok.com/@username/live");
  process.exit(1);
}

const liveUrl = /^https?:\/\//i.test(input)
  ? input
  : `https://www.tiktok.com/@${input.replace(/^@/, "")}/live`;

if (!process.env.LOCALAPPDATA) {
  console.error("Không tìm thấy biến môi trường LOCALAPPDATA của Windows.");
  process.exit(1);
}

const showBrowser = process.env.SHOW_BROWSER !== "0";
const verboseEvents = process.env.VERBOSE_EVENTS === "1";
const includeRaw = process.env.INCLUDE_RAW !== "0";
const apiHost = process.env.API_HOST?.trim() || "127.0.0.1";
const apiPort = Math.max(1, Number(process.env.API_PORT || 8787));
const maxRecent = Math.max(1, Number(process.env.MAX_RECENT_EVENTS || 500));
const webhookUrls = String(process.env.WEBHOOK_URLS || "")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);

const sourceChromeUserDataDir = path.join(
  process.env.LOCALAPPDATA,
  "Google",
  "Chrome",
  "User Data"
);

const chromeUserDataDir =
  process.env.COLLECTOR_USER_DATA_DIR?.trim() ||
  path.join(process.env.LOCALAPPDATA, "TikTokLiveCollectorChrome");

const chromeProfileDirectory =
  process.env.CHROME_PROFILE?.trim() || "Profile 1";

const clonedProfilePath = path.join(
  chromeUserDataDir,
  chromeProfileDirectory
);

const defaultLogPath = path.join(SCRIPT_DIR, "data", "events.jsonl");
const eventLogPath =
  process.env.EVENT_LOG_PATH === "0"
    ? null
    : process.env.EVENT_LOG_PATH?.trim() || defaultLogPath;

const eventBus = new EventBus({ maxRecent });
const normalizer = new TikTokEventNormalizer({
  liveUrl,
  includeRaw,
});
const eventWriter = new JsonlWriter({ filePath: eventLogPath });
const webhookDispatcher = new WebhookDispatcher({
  urls: webhookUrls,
  timeoutMs: Number(process.env.WEBHOOK_TIMEOUT_MS || 3000),
  retryCount: Number(process.env.WEBHOOK_RETRY_COUNT || 1),
});
const httpGateway = new HttpEventGateway({
  eventBus,
  host: apiHost,
  port: apiPort,
});

let context = null;
let page = null;
let stopping = false;
let collectorInstalled = false;
let eventCount = 0;
let reinjectTimer = null;

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
    case "like":
      return `[${time}] LIKE | ${sender} x${payload.count || 1}`;
    case "join":
      return `[${time}] JOIN | ${sender}`;
    default:
      return `[${time}] ${event.eventType.toUpperCase()} | ${sender}`;
  }
}

function receiveRawEvent(rawEvent) {
  const event = normalizer.normalize(rawEvent);
  if (!event) return null;

  eventCount += 1;
  eventWriter.write(event);
  eventBus.publish(event);
  webhookDispatcher.dispatch(event);

  console.log(formatEvent(event));
  if (verboseEvents) {
    console.log(JSON.stringify(event, null, 2));
  }

  return event;
}

function isBenignWasmError(message) {
  const text = String(message || "");
  return (
    text.includes("WebAssembly.instantiate()") &&
    text.includes("expected magic word")
  );
}

async function positionChromeWindow() {
  if (!page || page.isClosed() || !context) return;

  try {
    const session = await context.newCDPSession(page);
    const { windowId } = await session.send("Browser.getWindowForTarget");

    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: showBrowser
        ? {
            windowState: "normal",
            left: 80,
            top: 60,
            width: 1365,
            height: 900,
          }
        : {
            windowState: "normal",
            left: -32000,
            top: -32000,
            width: 1365,
            height: 900,
          },
    });

    await session.detach();
  } catch (error) {
    console.warn(
      `[CHROME] Không đổi được vị trí cửa sổ: ${error?.message || error}`
    );
  }
}

async function injectCollector() {
  if (!page || page.isClosed()) return;

  await page.waitForSelector("body", { timeout: 30_000 });
  await page.evaluate(installTikTokLiveDomCollector, {
    dedupeMs: Math.max(250, Number(process.env.DEDUPE_MS || 1500)),
    maxRowText: Math.max(100, Number(process.env.MAX_ROW_TEXT || 320)),
    maxDescendantsPerMutation: Math.max(
      50,
      Number(process.env.MAX_DESCENDANTS_PER_MUTATION || 250)
    ),
  });

  collectorInstalled = true;
}

function scheduleCollectorReinject() {
  if (!collectorInstalled || stopping) return;
  clearTimeout(reinjectTimer);

  reinjectTimer = setTimeout(() => {
    injectCollector().catch(error => {
      console.warn(
        `[COLLECTOR] Không thể nạp lại sau điều hướng: ${
          error?.message || error
        }`
      );
    });
  }, 1500);
}

async function startBrowser() {
  if (!fs.existsSync(path.join(chromeUserDataDir, "Local State"))) {
    throw new Error(
      [
        "Chưa có hồ sơ Chrome dành cho collector.",
        "Hãy đóng Google Chrome rồi chạy sync_profile.bat một lần.",
        `Nguồn: ${path.join(sourceChromeUserDataDir, chromeProfileDirectory)}`,
        `Đích: ${clonedProfilePath}`,
      ].join("\n")
    );
  }

  if (!fs.existsSync(clonedProfilePath)) {
    throw new Error(
      [
        `Không tìm thấy bản sao ${chromeProfileDirectory}.`,
        "Hãy đóng Google Chrome rồi chạy sync_profile.bat.",
        `Đường dẫn cần có: ${clonedProfilePath}`,
      ].join("\n")
    );
  }

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
    if (oldPage !== page && oldPage.url() === "about:blank") {
      await oldPage.close().catch(() => {});
    }
  }

  await page.exposeFunction("__sendTikTokDomEvent", receiveRawEvent);
  await page.exposeFunction("__sendTikTokStatus", status => {
    if (status?.message) {
      console.log(`[COLLECTOR] ${status.message}`);
    }
  });

  page.on("pageerror", error => {
    if (isBenignWasmError(error?.message)) return;
    console.error(`[PAGE ERROR] ${error?.message || error}`);
  });

  page.on("crash", () => {
    console.error("[PAGE CRASH] Trang TikTok đã crash.");
  });

  page.on("framenavigated", frame => {
    if (frame === page?.mainFrame()) scheduleCollectorReinject();
  });

  await positionChromeWindow();

  console.log(`Đang mở LIVE: ${liveUrl}`);
  await page.goto(liveUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  await positionChromeWindow();
  await page.waitForTimeout(8000);
  await injectCollector();
}

async function start() {
  const apiBaseUrl = await httpGateway.start();

  console.log("");
  console.log("TIKTOK LIVE EVENT MIDDLEWARE");
  console.log(`API health : ${apiBaseUrl}/api/health`);
  console.log(`SSE events : ${apiBaseUrl}/api/events`);
  console.log(`Recent     : ${apiBaseUrl}/api/recent?limit=50`);
  console.log(`Schema     : ${apiBaseUrl}/api/schema`);
  console.log(
    `Webhook    : ${webhookUrls.length ? webhookUrls.join(", ") : "không cấu hình"}`
  );
  console.log(`Event log  : ${eventLogPath || "đã tắt"}`);
  console.log("Sự kiện    : JOIN / COMMENT / FOLLOW / LIKE / GIFT");
  console.log("Không phát : LEAVE / người dùng rời LIVE");
  console.log("");

  await startBrowser();

  console.log("Middleware đã sẵn sàng. Nhấn Ctrl + C để dừng.");
}

async function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(reinjectTimer);

  console.log(`\nĐang dừng middleware... Tổng event: ${eventCount}`);

  try {
    if (collectorInstalled && page && !page.isClosed()) {
      await page.evaluate(() => window.TikTokLiveDOM?.stop?.()).catch(() => {});
    }

    await webhookDispatcher.flush();
    await httpGateway.stop();
    await context?.close();
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

start().catch(async error => {
  const message = String(error?.stack ?? error);
  console.error("\nKHÔNG KHỞI ĐỘNG ĐƯỢC:");

  if (
    /processSingleton|SingletonLock|user data directory is already in use|profile.*in use/i.test(
      message
    )
  ) {
    console.error(
      "Hồ sơ collector đang bị một tiến trình Chrome khác sử dụng. " +
        "Đóng cửa sổ Chrome collector cũ rồi chạy lại."
    );
  }

  console.error(message);
  await httpGateway.stop().catch(() => {});
  await context?.close().catch(() => {});
  process.exit(1);
});
