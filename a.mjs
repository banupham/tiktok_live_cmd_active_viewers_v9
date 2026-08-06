import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

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

const showBrowser = process.env.SHOW_BROWSER === "1";

if (!process.env.LOCALAPPDATA) {
  console.error("Không tìm thấy biến môi trường LOCALAPPDATA của Windows.");
  process.exit(1);
}

/*
 * Chrome 136+ không cho Playwright điều khiển trực tiếp hồ sơ Chrome chính.
 *
 * Bản V8 sử dụng BẢN SAO của Profile 1 tại:
 *   %LOCALAPPDATA%\TikTokLiveCollectorChrome\Profile 1
 *
 * sync_profile.bat sẽ sao chép trạng thái đăng nhập từ Profile 1 đang dùng.
 * Sau khi đồng bộ lần đầu, Chrome thường có thể mở song song với collector.
 */
const sourceChromeUserDataDir = path.join(
  process.env.LOCALAPPDATA,
  "Google",
  "Chrome",
  "User Data"
);

const chromeUserDataDir = path.join(
  process.env.LOCALAPPDATA,
  "TikTokLiveCollectorChrome"
);

const chromeProfileDirectory =
  process.env.CHROME_PROFILE?.trim() || "Profile 1";

const clonedProfilePath = path.join(
  chromeUserDataDir,
  chromeProfileDirectory
);

const logPath = path.resolve("tiktok-events.jsonl");
const currentViewersPath = path.resolve("current-viewers.json");

/*
 * TikTok không phát event "viewer left" đầy đủ.
 * Vì vậy danh sách này là DANH SÁCH ID ĐANG HOẠT ĐỘNG ƯỚC TÍNH:
 * - thêm/cập nhật khi có JOIN, COMMENT, GIFT, FOLLOW hoặc LIKE;
 * - xóa khi không nhìn thấy hoạt động trong VIEWER_TTL_SECONDS.
 *
 * Có thể đổi thời gian trước khi chạy:
 *   set VIEWER_TTL_SECONDS=120
 */
const VIEWER_TTL_SECONDS = Math.max(
  15,
  Number(process.env.VIEWER_TTL_SECONDS || 120)
);

const VIEWER_TTL_MS = VIEWER_TTL_SECONDS * 1000;
const activeViewers = new Map();

let viewerSweepTimer = null;

let context;
let page;
let stopping = false;
let eventCount = 0;
let collectorInstalled = false;

function normalizeUniqueId(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/^@/, "");

  if (!text) return null;

  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function viewerKey(event) {
  const uniqueId = normalizeUniqueId(event?.uniqueId);

  if (uniqueId) {
    return `@${uniqueId.toLowerCase()}`;
  }

  const sender = String(event?.sender ?? "").trim();
  return sender ? `nickname:${sender.toLowerCase()}` : null;
}

function viewerDisplayId(viewer) {
  return viewer.uniqueId
    ? `@${viewer.uniqueId}`
    : `nickname:${viewer.nickname}`;
}

function getViewerSnapshot() {
  const viewers = [...activeViewers.values()]
    .sort((a, b) => {
      const aId = viewerDisplayId(a);
      const bId = viewerDisplayId(b);
      return aId.localeCompare(bId, "vi");
    })
    .map(viewer => ({
      id: viewerDisplayId(viewer),
      uniqueId: viewer.uniqueId,
      nickname: viewer.nickname,
      firstSeen: new Date(viewer.firstSeen).toISOString(),
      lastSeen: new Date(viewer.lastSeen).toISOString(),
      sources: [...viewer.sources].sort(),
    }));

  return {
    mode: "activity-based-estimate",
    exactCurrentRoster: false,
    ttlSeconds: VIEWER_TTL_SECONDS,
    updatedAt: new Date().toISOString(),
    count: viewers.length,
    viewers,
  };
}

function saveViewerSnapshot() {
  const snapshot = getViewerSnapshot();

  fs.writeFileSync(
    currentViewersPath,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8"
  );

  return snapshot;
}

function printViewerUpdate({ added = [], removed = [], renamed = [] } = {}) {
  const snapshot = saveViewerSnapshot();
  const changes = [];

  if (added.length) {
    changes.push(`+${added.join(", +")}`);
  }

  if (removed.length) {
    changes.push(`-${removed.join(", -")}`);
  }

  if (renamed.length) {
    changes.push(`ID:${renamed.join(", ")}`);
  }

  console.log(
    `[VIEWERS UPDATE] total=${snapshot.count}` +
    (changes.length ? ` | ${changes.join(" | ")}` : "")
  );

  const ids = snapshot.viewers.map(viewer => viewer.id);
  const visibleIds = ids.slice(0, 80);
  const remaining = ids.length - visibleIds.length;

  console.log(
    `[VIEWER IDS] ${visibleIds.length ? visibleIds.join(", ") : "(trống)"}` +
    (remaining > 0 ? ` ... và ${remaining} ID khác` : "")
  );
}

function touchViewer(event) {
  const key = viewerKey(event);
  if (!key) return;

  const now = Date.now();
  const uniqueId = normalizeUniqueId(event.uniqueId);
  const nickname = String(event.sender ?? "").trim() || uniqueId || "Không rõ";
  const source = String(event.type ?? "unknown");

  /*
   * Trước đó người dùng có thể chỉ có nickname từ JOIN/LIKE.
   * Khi COMMENT cung cấp @uniqueId, gộp bản ghi nickname cũ vào ID thật.
   */
  const nicknameKey = nickname
    ? `nickname:${nickname.toLowerCase()}`
    : null;

  let renamed = [];
  let existing = activeViewers.get(key);

  if (
    uniqueId &&
    nicknameKey &&
    nicknameKey !== key &&
    activeViewers.has(nicknameKey)
  ) {
    const nicknameViewer = activeViewers.get(nicknameKey);

    if (!existing) {
      existing = nicknameViewer;
      activeViewers.set(key, existing);
    } else {
      existing.firstSeen = Math.min(
        existing.firstSeen,
        nicknameViewer.firstSeen
      );

      for (const item of nicknameViewer.sources) {
        existing.sources.add(item);
      }
    }

    activeViewers.delete(nicknameKey);
    renamed.push(`${nickname}→@${uniqueId}`);
  }

  if (!existing) {
    activeViewers.set(key, {
      uniqueId,
      nickname,
      firstSeen: now,
      lastSeen: now,
      sources: new Set([source]),
    });

    printViewerUpdate({
      added: [uniqueId ? `@${uniqueId}` : `nickname:${nickname}`],
      renamed,
    });

    return;
  }

  existing.uniqueId = uniqueId || existing.uniqueId;
  existing.nickname = nickname || existing.nickname;
  existing.lastSeen = now;
  existing.sources.add(source);

  if (renamed.length) {
    printViewerUpdate({ renamed });
  } else {
    /*
     * Vẫn cập nhật lastSeen trong file nhưng không spam CMD
     * trên từng comment/like/gift.
     */
    saveViewerSnapshot();
  }
}

function removeExpiredViewers() {
  const now = Date.now();
  const removed = [];

  for (const [key, viewer] of activeViewers) {
    if (now - viewer.lastSeen <= VIEWER_TTL_MS) continue;

    removed.push(viewerDisplayId(viewer));
    activeViewers.delete(key);
  }

  if (removed.length) {
    printViewerUpdate({ removed });
  }
}

function plainEvent(event) {
  const { element, ...plain } = event ?? {};
  return plain;
}

function formatEvent(event) {
  const time = new Date(event.timestamp ?? Date.now()).toLocaleTimeString("vi-VN");
  const sender = event.sender || "Không rõ người dùng";

  switch (event.type) {
    case "comment":
      return `[${time}] COMMENT EVENT | ${sender}: ${event.comment}`;
    case "gift":
      return `[${time}] GIFT EVENT | ${sender} gửi ${event.gift} x${event.count ?? 1}`;
    case "join":
      return `[${time}] JOIN EVENT | ${sender} ${event.action || "đã tham gia"}`;
    case "follow":
      return `[${time}] FOLLOW EVENT | ${sender} ${event.action || "đã theo dõi"}`;
    case "like":
      return `[${time}] LIKE EVENT | ${sender} ${event.action || "đã thích phiên LIVE"}`;
    default:
      return `[${time}] ${String(event.type || "event").toUpperCase()} EVENT`;
  }
}

function receiveEvent(event) {
  const cleanEvent = plainEvent(event);

  /*
   * Mọi tương tác đều làm mới lastSeen của người dùng.
   * JOIN chỉ dùng nội bộ để thêm vào danh sách viewer,
   * không còn in JOIN EVENT và không ghi vào tiktok-events.jsonl.
   */
  touchViewer(cleanEvent);

  if (cleanEvent.type === "join") {
    return;
  }

  eventCount += 1;

  console.log(formatEvent(cleanEvent));
  console.log(JSON.stringify(cleanEvent, null, 2));

  fs.appendFileSync(
    logPath,
    `${JSON.stringify(cleanEvent)}\n`,
    "utf8"
  );
}

/*
 * Collector này giữ nguyên logic đã pass trên Console:
 * - System row: [data-e2e="enter-message"]
 * - Sender:     [data-e2e="message-owner-name"]
 * - Gift:       dòng nhỏ nhất khớp "<tên> gửi <quà> xN"
 * - Comment:    học fingerprint của hàng comment
 *
 * Điểm thêm duy nhất cho headless:
 * - Tự học fingerprint từ comment mới đầu tiên, không cần DOMTEST987.
 * - Không quét toàn trang bằng regex, không dùng timer phát lại event.
 */
function installExactPassedCollector() {
  "use strict";

  window.TikTokLiveDOM?.stop?.();

  const CONFIG = {
    dedupeMs: 1500,
    maxRowText: 320,
    maxDescendantsPerMutation: 250,
    commentSelectors: [
      ".text-UIText1 > div:nth-child(2)",
      '[data-e2e="comment-message"]',
      '[data-e2e="chat-message"]',
    ],
  };

  const state = {
    observer: null,
    recent: new Map(),
    rowLastValue: new WeakMap(),
    commentLastValue: new WeakMap(),
    events: [],
    listeners: new Set(),
  };

  function clean(value) {
    return String(value ?? "")
      .replace(/\u200B/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getElement(node) {
    if (node instanceof Element) return node;
    return node?.parentElement instanceof Element ? node.parentElement : null;
  }

  function elementText(element) {
    return clean(element?.innerText || element?.textContent || "");
  }

  function sendStatus(message, details = undefined) {
    try {
      window.__sendTikTokStatus?.({ message, details });
    } catch {
      // Không để lỗi cầu nối làm dừng observer.
    }
  }

  function emit(type, payload, element) {
    const now = Date.now();
    const key = [
      type,
      payload.sender ?? "",
      payload.comment ?? "",
      payload.gift ?? "",
      payload.action ?? "",
      payload.count ?? "",
      payload.raw ?? "",
    ].join("|");

    const previous = state.recent.get(key) ?? 0;
    if (now - previous < CONFIG.dedupeMs) return;
    state.recent.set(key, now);

    if (state.recent.size > 3000) {
      const cutoff = now - 120_000;
      for (const [cacheKey, timestamp] of state.recent) {
        if (timestamp < cutoff) state.recent.delete(cacheKey);
      }
    }

    const event = {
      type,
      ...payload,
      timestamp: now,
      time: new Date(now).toLocaleTimeString(),
      element,
    };

    state.events.push(event);

    for (const listener of state.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("TikTokLiveDOM listener error:", error);
      }
    }

    try {
      const { element: ignored, ...serializable } = event;
      window.__sendTikTokDomEvent?.(serializable);
    } catch (error) {
      console.error("Không gửi được event về Node.js:", error);
    }
  }

  function extractOwner(row) {
    const ownerElement = row.querySelector(
      '[data-e2e="message-owner-name"]'
    );

    const sender = clean(
      ownerElement?.getAttribute("title") ||
      ownerElement?.textContent ||
      ""
    ) || null;

    if (!sender) return null;

    const linkElement =
      ownerElement?.closest('a[href*="/@"]') ||
      ownerElement?.querySelector?.('a[href*="/@"]') ||
      row.querySelector('a[href*="/@"]');

    const href = linkElement?.getAttribute("href") || "";
    const uniqueId = href.match(/\/@([^/?#]+)/)?.[1] || null;

    return {
      sender,
      uniqueId,
    };
  }

  function classifySystemAction(action) {
    if (
      /đã\s+thích\s+(?:phiên\s+)?live/i.test(action) ||
      /liked\s+(?:the\s+)?live/i.test(action)
    ) {
      return "like";
    }

    if (
      /đã\s+theo\s+dõi/i.test(action) ||
      /started\s+following/i.test(action) ||
      /followed\s+(?:the\s+host)?/i.test(action)
    ) {
      return "follow";
    }

    if (
      /đã\s+tham\s+gia/i.test(action) ||
      /joined\s+(?:the\s+)?live/i.test(action)
    ) {
      return "join";
    }

    return null;
  }

  function processSystemRow(row) {
    if (!(row instanceof Element)) return;

    const owner = extractOwner(row);
    if (!owner) return;

    const { sender, uniqueId } = owner;

    const raw = elementText(row);
    if (!raw || raw.length > CONFIG.maxRowText) return;

    const action = clean(raw.replace(sender, ""));
    const type = classifySystemAction(action);
    if (!type) return;

    const rowValue = `${type}|${uniqueId || sender}|${action}`;
    if (state.rowLastValue.get(row) === rowValue) return;
    state.rowLastValue.set(row, rowValue);

    emit(type, { sender, uniqueId, action, raw }, row);
  }

  function collectSystemRows(node, output) {
    const element = getElement(node);
    if (!element) return;

    const closest = element.closest('[data-e2e="enter-message"]');
    if (closest) output.add(closest);

    if (element.matches('[data-e2e="enter-message"]')) {
      output.add(element);
    }

    for (const row of element.querySelectorAll(
      '[data-e2e="enter-message"]'
    )) {
      output.add(row);
    }
  }

  function parseGift(text) {
    text = clean(text);

    const match = text.match(
      /^(.+?)\s+(?:đã\s+)?gửi\s+(.+?)\s*[x×]\s*(\d+)\s*$/i
    );

    if (!match) return null;

    return {
      sender: clean(match[1]),
      gift: clean(match[2]),
      count: Number(match[3]),
      raw: text,
    };
  }

  function isSmallestMatchingElement(element, parser) {
    const text = elementText(element);
    if (!parser(text)) return false;

    return ![...element.children].some(child =>
      Boolean(parser(elementText(child)))
    );
  }

  function collectGiftRows(node, output) {
    const element = getElement(node);
    if (!element) return;

    let scanned = 0;
    const candidates = [element, ...element.querySelectorAll("*")];

    for (const candidate of candidates) {
      if (scanned++ >= CONFIG.maxDescendantsPerMutation) break;
      if (!(candidate instanceof Element)) continue;

      const text = elementText(candidate);
      if (!text || text.length > CONFIG.maxRowText) continue;

      if (isSmallestMatchingElement(candidate, parseGift)) {
        output.add(candidate);
      }
    }
  }

  function processGiftRow(row) {
    const gift = parseGift(elementText(row));
    if (!gift) return;

    const linkElement =
      row.closest('a[href*="/@"]') ||
      row.querySelector('a[href*="/@"]') ||
      row.parentElement?.querySelector?.('a[href*="/@"]');

    const href = linkElement?.getAttribute("href") || "";
    const uniqueId = href.match(/\/@([^/?#]+)/)?.[1] || null;

    emit("gift", { ...gift, uniqueId }, row);
  }

  /* =========================================================
     COMMENT: KHÔNG CÒN AUTO-FINGERPRINT

     V5 đã nhận nhầm menu "Quay lại / Khám phá phiên LIVE..."
     làm fingerprint comment. V6 chỉ chấp nhận phần tử comment
     đúng selector và bắt buộc hàng đó có phần tử tên người dùng.
  ========================================================= */

  function getCommentRow(item) {
    if (!(item instanceof Element)) return null;

    const row = item.closest(".text-UIText1") || item.parentElement;
    if (!(row instanceof Element)) return null;

    if (row.getAttribute("data-e2e") === "enter-message") return null;
    if (row.closest('[data-e2e="enter-message"]')) return null;
    if (row.closest('[data-e2e="comment-input"]')) return null;

    return row;
  }

  function getCommentOwnerElement(row) {
    return row.querySelector(
      [
        '[data-e2e="comment-username"]',
        '[data-e2e="message-owner-name"]',
        'a[href^="/@"]',
        'a[href*="tiktok.com/@"]',
      ].join(",")
    );
  }

  function parseCommentItem(item) {
    const row = getCommentRow(item);
    if (!row) return null;

    const ownerElement = getCommentOwnerElement(row);
    if (!(ownerElement instanceof Element)) return null;

    const sender = clean(
      ownerElement.getAttribute("title") ||
      ownerElement.innerText ||
      ownerElement.textContent ||
      ""
    );
    if (!sender) return null;

    const href = ownerElement.getAttribute("href") || "";
    const uniqueId = href.match(/\/@([^/?#]+)/)?.[1] || null;

    const raw = elementText(row);
    if (!raw || raw.length > CONFIG.maxRowText) return null;

    if (
      classifySystemAction(clean(raw.replace(sender, ""))) ||
      row.closest('[data-e2e="enter-message"]') ||
      parseGift(raw)
    ) {
      return null;
    }

    const clone = item.cloneNode(true);
    clone
      .querySelectorAll(
        [
          '[data-e2e="comment-username"]',
          '[data-e2e="message-owner-name"]',
          'svg',
          'img',
          'button',
        ].join(",")
      )
      .forEach(element => element.remove());

    const lines = String(clone.innerText || clone.textContent || "")
      .split(/\n+/)
      .map(clean)
      .filter(Boolean)
      .filter(line => line !== sender);

    let comment = clean(lines.at(-1) || "");

    if (!comment) {
      const rowLines = String(row.innerText || row.textContent || "")
        .split(/\n+/)
        .map(clean)
        .filter(Boolean)
        .filter(line => line !== sender);
      comment = clean(rowLines.at(-1) || "");
    }

    if (!comment || comment === sender) return null;
    if (classifySystemAction(comment) || parseGift(comment)) return null;

    return {
      sender,
      uniqueId,
      comment,
      raw,
    };
  }

  function isCommentItem(element) {
    if (!(element instanceof Element)) return false;
    return CONFIG.commentSelectors.some(selector => element.matches(selector));
  }

  function collectCommentItems(node, output) {
    const element = getElement(node);
    if (!element) return;

    if (isCommentItem(element)) output.add(element);

    const row = element.closest(".text-UIText1");
    if (row?.children?.[1] instanceof Element) {
      output.add(row.children[1]);
    }

    for (const selector of CONFIG.commentSelectors) {
      for (const item of element.querySelectorAll(selector)) {
        output.add(item);
      }
    }
  }

  function processCommentItem(item, emitExisting = true) {
    const parsed = parseCommentItem(item);
    if (!parsed) return;

    const rowValue = `${parsed.sender}|${parsed.uniqueId || ""}|${parsed.comment}`;
    const previous = state.commentLastValue.get(item);
    state.commentLastValue.set(item, rowValue);

    if (!emitExisting || previous === rowValue) return;

    emit("comment", parsed, getCommentRow(item) || item);
  }

  function markExistingComments() {
    const existing = new Set();
    collectCommentItems(document.body, existing);

    for (const item of existing) {
      processCommentItem(item, false);
    }

    sendStatus("COMMENT SELECTOR READY", {
      existingRows: existing.size,
      validRows: [...existing].filter(item => Boolean(parseCommentItem(item))).length,
      selectors: CONFIG.commentSelectors,
    });
  }

  state.observer = new MutationObserver(records => {
    const systemRows = new Set();
    const giftRows = new Set();
    const commentItems = new Set();

    for (const record of records) {
      collectSystemRows(record.target, systemRows);
      collectGiftRows(record.target, giftRows);
      collectCommentItems(record.target, commentItems);

      if (record.type === "childList") {
        for (const node of record.addedNodes) {
          collectSystemRows(node, systemRows);
          collectGiftRows(node, giftRows);
          collectCommentItems(node, commentItems);
        }
      }

      if (record.type === "characterData") {
        collectCommentItems(record.target, commentItems);
      }
    }

    requestAnimationFrame(() => {
      for (const row of systemRows) processSystemRow(row);
      for (const row of giftRows) processGiftRow(row);
      for (const item of commentItems) processCommentItem(item, true);
    });
  });

  state.observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  for (const row of document.querySelectorAll(
    '[data-e2e="enter-message"]'
  )) {
    processSystemRow(row);
  }

  markExistingComments();

  window.TikTokLiveDOM = {
    stop() {
      state.observer?.disconnect();
      state.observer = null;
      sendStatus("TIKTOK LIVE DOM STOPPED");
    },

    onEvent(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("listener phải là function");
      }

      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },

    getEvents() {
      return [...state.events];
    },

    clearEvents() {
      state.events.length = 0;
      state.recent.clear();
    },

    getState() {
      const commentItems = new Set();
      collectCommentItems(document.body, commentItems);

      return {
        eventCount: state.events.length,
        enterMessageCount: document.querySelectorAll(
          '[data-e2e="enter-message"]'
        ).length,
        commentUsernameCount: document.querySelectorAll(
          '[data-e2e="comment-username"]'
        ).length,
        commentItemCount: commentItems.size,
        validCommentCount: [...commentItems].filter(
          item => Boolean(parseCommentItem(item))
        ).length,
      };
    },
  };

  sendStatus("TIKTOK LIVE DOM STARTED", {
    passedEvents: ["gift", "comment", "follow", "like"],
    joinMode: "viewer-list-only",
    mode: "exact-comment-selector-no-auto-fingerprint",
  });
}

function isBenignWasmError(message) {
  const text = String(message || "");
  return (
    text.includes("WebAssembly.instantiate()") &&
    text.includes("expected magic word") &&
    text.includes("found 3c 21 44 4f")
  );
}

async function injectCollector() {
  if (!page || page.isClosed()) return;

  await page.waitForSelector("body", { timeout: 30_000 });
  await page.evaluate(installExactPassedCollector);
  collectorInstalled = true;
}


async function positionChromeWindow() {
  if (!page || page.isClosed()) return;

  try {
    const session = await context.newCDPSession(page);
    const { windowId } = await session.send("Browser.getWindowForTarget");

    if (showBrowser) {
      await session.send("Browser.setWindowBounds", {
        windowId,
        bounds: {
          windowState: "normal",
          left: 80,
          top: 60,
          width: 1365,
          height: 900,
        },
      });
    } else {
      /*
       * Vẫn dùng Chrome thật để TikTok dựng đủ LIVE/chat,
       * nhưng đưa cửa sổ ra ngoài vùng nhìn thấy.
       */
      await session.send("Browser.setWindowBounds", {
        windowId,
        bounds: {
          windowState: "normal",
          left: -32000,
          top: -32000,
          width: 1365,
          height: 900,
        },
      });
    }

    await session.detach();
  } catch (error) {
    console.warn(
      `[CẢNH BÁO] Không đổi được vị trí cửa sổ Chrome: ${error?.message || error}`
    );
  }
}

async function start() {
  if (!fs.existsSync(path.join(chromeUserDataDir, "Local State"))) {
    throw new Error(
      [
        "Chưa có hồ sơ collector.",
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

  console.log(`Chrome nguồn: ${sourceChromeUserDataDir}`);
  console.log(`Profile nguồn: ${chromeProfileDirectory}`);
  console.log(`Hồ sơ collector: ${chromeUserDataDir}`);

  context = await chromium.launchPersistentContext(chromeUserDataDir, {
    /*
     * Dùng Google Chrome thật với user-data-dir riêng.
     * Không điều khiển trực tiếp "Google\Chrome\User Data".
     */
    channel: "chrome",
    headless: false,
    bypassCSP: true,
    timeout: 45_000,

    /*
     * Loại cờ --no-sandbox mặc định để không còn thanh cảnh báo
     * "unsupported command-line flag: --no-sandbox" trên Windows.
     */
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

  /*
   * Luôn tạo trang mới do profile sao chép có thể chứa tab about:blank
   * hoặc trạng thái phiên cũ.
   */
  const oldPages = context.pages();
  page = await context.newPage();

  for (const oldPage of oldPages) {
    if (oldPage !== page && oldPage.url() === "about:blank") {
      await oldPage.close().catch(() => {});
    }
  }

  await positionChromeWindow();

  await page.exposeFunction("__sendTikTokDomEvent", receiveEvent);
  await page.exposeFunction("__sendTikTokStatus", status => {
    if (status?.message === "COMMENT SELECTOR READY") {
      const valid = status?.details?.validRows ?? 0;
      const total = status?.details?.existingRows ?? 0;
      console.log(`[COMMENT] Selector sẵn sàng: valid=${valid}, total=${total}`);
      return;
    }

    if (status?.message) {
      console.log(`[COLLECTOR] ${status.message}`);
    }
  });

  page.on("pageerror", error => {
    if (isBenignWasmError(error?.message)) return;
    console.error(`[PAGE ERROR] ${error?.message || error}`);
  });

  page.on("crash", () => {
    console.error("[PAGE CRASH] Trang TikTok trong Chromium chạy nền đã crash.");
  });

  console.log(`Đang mở: ${liveUrl}`);
  console.log(
    `Chế độ: Chrome thật dùng bản sao Profile 1, ${
      showBrowser ? "hiện cửa sổ" : "đưa cửa sổ ra ngoài màn hình"
    }`
  );

  await page.goto(liveUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  await positionChromeWindow();
  await page.waitForTimeout(8_000);
  await injectCollector();

  saveViewerSnapshot();

  viewerSweepTimer = setInterval(
    removeExpiredViewers,
    5_000
  );

  viewerSweepTimer.unref?.();

  console.log("");
  console.log("ĐÃ KHỞI ĐỘNG THEO DÕI LIVE");
  console.log("Logic: selector comment trực tiếp; đã bỏ hoàn toàn auto-fingerprint.");
  console.log("Không nhận menu/sidebar làm comment; không quét regex toàn trang.");
  console.log("Đang nhận event: COMMENT / GIFT / FOLLOW / LIKE");
  console.log("JOIN không còn hiển thị; chỉ dùng để cập nhật danh sách viewer.");
  console.log(
    `Viewer TTL: ${VIEWER_TTL_SECONDS} giây | Danh sách: ${currentViewersPath}`
  );
  console.log(`Log: ${logPath}`);
  console.log(`URL thực tế: ${page.url()}`);
  console.log("Nhấn Ctrl + C để dừng.");
  console.log("");

  // Chỉ kiểm tra trạng thái, tuyệt đối không quét hoặc phát event.
  setTimeout(async () => {
    if (!page || page.isClosed()) return;

    try {
      const status = await page.evaluate(() => ({
        collector: Boolean(window.TikTokLiveDOM),
        state: window.TikTokLiveDOM?.getState?.() ?? null,
        title: document.title,
        bodyTextLength: (document.body?.innerText || "").length,
        captcha: /captcha|xác minh|verify/i.test(
          document.body?.innerText || ""
        ),
      }));

      console.log("[TRẠNG THÁI]", JSON.stringify(status));

      if (status.captcha) {
        console.log("[CẢNH BÁO] Chrome collector đang gặp CAPTCHA/xác minh.");
      }

      const state = status.state || {};
      const hasChatDom =
        (state.enterMessageCount || 0) > 0 ||
        (state.commentItemCount || 0) > 0 ||
        (state.commentUsernameCount || 0) > 0;

      if (!hasChatDom) {
        const loginState = await page.evaluate(() => {
          const text = document.body?.innerText || "";
          return {
            loginRequired:
              /(^|\n)\s*Đăng nhập\s*(\n|$)/i.test(text) ||
              /log in/i.test(text),
            textSample: text.replace(/\s+/g, " ").slice(0, 240),
          };
        });

        console.log("[DOM CHAT] Chưa tìm thấy khung chat.");

        if (loginState.loginRequired) {
          console.log(
            "[CẢNH BÁO] Bản sao Profile 1 chưa giữ được đăng nhập TikTok."
          );
          console.log(
            "Chạy: start_visible.bat " + input +
            " rồi đăng nhập một lần trong hồ sơ collector."
          );
        }

        console.log("[NỘI DUNG TRANG]", loginState.textSample);
      }
    } catch (error) {
      console.error(`[KIỂM TRA LỖI] ${error?.message || error}`);
    }
  }, 15_000);
}

async function stop() {
  if (stopping) return;
  stopping = true;

  console.log(`\nĐang đóng Chromium chạy nền... Tổng event: ${eventCount}`);

  if (viewerSweepTimer) {
    clearInterval(viewerSweepTimer);
    viewerSweepTimer = null;
  }

  saveViewerSnapshot();

  try {
    if (collectorInstalled && page && !page.isClosed()) {
      await page.evaluate(() => window.TikTokLiveDOM?.stop?.()).catch(() => {});
    }
    await context?.close();
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

start().catch(error => {
  const message = String(error?.stack ?? error);

  console.error("\nKHÔNG KHỞI ĐỘNG ĐƯỢC:");

  if (
    /processSingleton|SingletonLock|user data directory is already in use|profile.*in use/i
      .test(message)
  ) {
    console.error(
      "Hồ sơ collector đang bị một tiến trình Chrome khác sử dụng. " +
      "Đóng cửa sổ Chrome collector cũ hoặc kết thúc chrome.exe rồi chạy lại."
    );
  }

  if (/DevToolsActivePort|remote debugging|ProcessSingleton/i.test(message)) {
    console.error(
      "Chrome không mở được hồ sơ collector. Chạy sync_profile.bat để tạo lại bản sao Profile 1."
    );
  }

  console.error(message);
  process.exit(1);
});
