/**
 * Cài bộ quan sát TikTok LIVE vào bên trong trang đang mở bằng Playwright.
 *
 * Hàm này phải hoàn toàn tự chứa vì được truyền qua page.evaluate().
 * Không tạo sự kiện "leave" và không suy đoán người dùng đã rời LIVE.
 */
export function installTikTokLiveDomCollector(userConfig = {}) {
  window.TikTokLiveDOM?.stop?.();

  const CONFIG = {
    dedupeMs: 1500,
    maxRowText: 320,
    maxDescendantsPerMutation: 250,
    maxStoredEvents: 2000,
    commentSelectors: [
      ".text-UIText1 > div:nth-child(2)",
      '[data-e2e="comment-message"]',
      '[data-e2e="chat-message"]',
    ],
    ...userConfig,
  };

  const state = {
    observer: null,
    recent: new Map(),
    systemRowValue: new WeakMap(),
    giftRowValue: new WeakMap(),
    commentRowValue: new WeakMap(),
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

  function extractUniqueId(element) {
    if (!(element instanceof Element)) return null;

    const link =
      element.closest?.('a[href*="/@"]') ||
      element.querySelector?.('a[href*="/@"]');

    const href = link?.getAttribute("href") || "";
    return href.match(/\/@([^/?#]+)/)?.[1] || null;
  }

  function sendStatus(message, details = undefined) {
    try {
      window.__sendTikTokStatus?.({ message, details });
    } catch {
      // Không để lỗi bridge làm dừng observer.
    }
  }

  function emit(type, payload, element) {
    const now = Date.now();
    const key = [
      type,
      payload.sender ?? "",
      payload.uniqueId ?? "",
      payload.comment ?? "",
      payload.gift ?? "",
      payload.action ?? "",
      payload.count ?? "",
      payload.totalCount ?? "",
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
    if (state.events.length > CONFIG.maxStoredEvents) {
      state.events.splice(0, state.events.length - CONFIG.maxStoredEvents);
    }

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
    if (!(row instanceof Element)) return null;

    const ownerElement = row.querySelector(
      [
        '[data-e2e="message-owner-name"]',
        '[data-e2e="comment-username"]',
        'a[href^="/@"]',
        'a[href*="tiktok.com/@"]',
      ].join(",")
    );

    if (!(ownerElement instanceof Element)) return null;

    const sender = clean(
      ownerElement.getAttribute("title") ||
      ownerElement.innerText ||
      ownerElement.textContent ||
      ""
    );

    if (!sender) return null;

    return {
      sender,
      uniqueId:
        extractUniqueId(ownerElement) ||
        extractUniqueId(row) ||
        null,
    };
  }

  function classifySystemAction(action) {
    const text = clean(action);

    if (
      /đã\s+thích\s+(?:phiên\s+)?live/i.test(text) ||
      /liked\s+(?:the\s+)?live/i.test(text)
    ) {
      return "like";
    }

    if (
      /đã\s+theo\s+dõi/i.test(text) ||
      /started\s+following/i.test(text) ||
      /followed\s+(?:the\s+host)?/i.test(text)
    ) {
      return "follow";
    }

    if (
      /đã\s+tham\s+gia/i.test(text) ||
      /joined\s+(?:the\s+)?live/i.test(text)
    ) {
      return "join";
    }

    return null;
  }

  function processSystemRow(row, emitExisting = true) {
    if (!(row instanceof Element)) return;

    const owner = extractOwner(row);
    if (!owner) return;

    const raw = elementText(row);
    if (!raw || raw.length > CONFIG.maxRowText) return;

    const action = clean(raw.replace(owner.sender, ""));
    const type = classifySystemAction(action);
    if (!type) return;

    const rowValue = `${type}|${owner.uniqueId || owner.sender}|${action}`;
    const previous = state.systemRowValue.get(row);
    state.systemRowValue.set(row, rowValue);

    if (!emitExisting || previous === rowValue) return;

    emit(
      type,
      {
        sender: owner.sender,
        uniqueId: owner.uniqueId,
        action,
        raw,
      },
      row
    );
  }

  function collectSystemRows(node, output) {
    const element = getElement(node);
    if (!element) return;

    const closest = element.closest('[data-e2e="enter-message"]');
    if (closest) output.add(closest);

    if (element.matches('[data-e2e="enter-message"]')) {
      output.add(element);
    }

    for (const row of element.querySelectorAll('[data-e2e="enter-message"]')) {
      output.add(row);
    }
  }

  function parseGift(text) {
    const value = clean(text);

    const match = value.match(
      /^(.+?)\s+(?:(?:đã\s+)?gửi|sent)\s+(.+?)(?:\s*[x×]\s*(\d+))?\s*$/i
    );

    if (!match) return null;

    const sender = clean(match[1]);
    const gift = clean(match[2]);
    const totalCount = Math.max(1, Number(match[3]) || 1);

    if (!sender || !gift) return null;

    return {
      sender,
      gift,
      totalCount,
      raw: value,
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

  function processGiftRow(row, emitExisting = true) {
    const parsed = parseGift(elementText(row));
    if (!parsed) return;

    const uniqueId = extractUniqueId(row);
    const signature = `${uniqueId || parsed.sender}|${parsed.gift}`;
    const previous = state.giftRowValue.get(row);

    let count = parsed.totalCount;
    if (previous?.signature === signature) {
      if (parsed.totalCount > previous.totalCount) {
        count = parsed.totalCount - previous.totalCount;
      } else if (parsed.totalCount === previous.totalCount) {
        count = 0;
      }
    }

    state.giftRowValue.set(row, {
      signature,
      totalCount: parsed.totalCount,
    });

    if (!emitExisting || count <= 0) return;

    emit(
      "gift",
      {
        sender: parsed.sender,
        uniqueId,
        gift: parsed.gift,
        count,
        totalCount: parsed.totalCount,
        raw: parsed.raw,
      },
      row
    );
  }

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

    const uniqueId =
      extractUniqueId(ownerElement) ||
      extractUniqueId(row) ||
      null;

    const raw = elementText(row);
    if (!raw || raw.length > CONFIG.maxRowText) return null;

    if (
      classifySystemAction(clean(raw.replace(sender, ""))) ||
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

    const rowValue = `${parsed.uniqueId || parsed.sender}|${parsed.comment}`;
    const previous = state.commentRowValue.get(item);
    state.commentRowValue.set(item, rowValue);

    if (!emitExisting || previous === rowValue) return;

    emit("comment", parsed, getCommentRow(item) || item);
  }

  function markExistingRows() {
    const systemRows = new Set();
    const giftRows = new Set();
    const commentItems = new Set();

    collectSystemRows(document.body, systemRows);
    collectGiftRows(document.body, giftRows);
    collectCommentItems(document.body, commentItems);

    for (const row of systemRows) processSystemRow(row, false);
    for (const row of giftRows) processGiftRow(row, false);
    for (const item of commentItems) processCommentItem(item, false);

    sendStatus("EXISTING DOM MARKED", {
      systemRows: systemRows.size,
      giftRows: giftRows.size,
      commentItems: commentItems.size,
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
      for (const row of systemRows) processSystemRow(row, true);
      for (const row of giftRows) processGiftRow(row, true);
      for (const item of commentItems) processCommentItem(item, true);
    });
  });

  markExistingRows();

  state.observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

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
        running: Boolean(state.observer),
        eventCount: state.events.length,
        enterMessageCount: document.querySelectorAll(
          '[data-e2e="enter-message"]'
        ).length,
        commentUsernameCount: document.querySelectorAll(
          '[data-e2e="comment-username"]'
        ).length,
        commentItemCount: commentItems.size,
      };
    },
  };

  sendStatus("TIKTOK LIVE DOM STARTED", {
    supportedEvents: ["join", "comment", "follow", "like", "gift"],
    unsupportedEvents: ["leave"],
    giftMode: "name-and-delta-count",
    mode: "dom-observer",
  });
}
