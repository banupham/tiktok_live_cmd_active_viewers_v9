/**
 * Bắt các activity row TikTok LIVE theo từng cấu trúc DOM riêng biệt.
 *
 * Event được xử lý tại đây:
 * - join   : [data-e2e="enter-message"] + action "đã tham gia"
 * - share  : [data-e2e="social-message"] + action "đã chia sẻ phiên LIVE"
 * - follow : [data-e2e="social-message"] + action "đã follow chủ phòng" / "đã theo dõi"
 * - like   : activity row thường + action "đã thích phiên LIVE"
 * - gift   : activity row thường + action "đã gửi <gift> × N"
 *
 * COMMENT không được xử lý ở file này. COMMENT có collector riêng.
 * LIKE tim bay cũng có collector riêng.
 *
 * Hàm phải tự chứa vì được truyền qua page.evaluate().
 */
export function installTikTokActivityCollector(userConfig = {}) {
  window.TikTokActivityDOM?.stop?.();

  const CONFIG = {
    maxRowText: 500,
    ...userConfig,
  };

  const GENERIC_ACTIVITY_SELECTOR =
    "div.relative.flex.py-4.px-12.P4-Regular.text-UIText1";

  const state = {
    observer: null,
    rowValue: new WeakMap(),
    giftValue: new WeakMap(),
    counts: {
      join: 0,
      follow: 0,
      share: 0,
      like: 0,
      gift: 0,
    },
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

  function getOwner(row) {
    if (!(row instanceof Element)) return null;

    const ownerElement = row.querySelector(
      '[data-e2e="message-owner-name"][title]'
    );
    if (!(ownerElement instanceof Element)) return null;

    const sender = clean(ownerElement.getAttribute("title"));
    if (!sender) return null;

    return {
      sender,
      uniqueId:
        extractUniqueId(ownerElement) ||
        extractUniqueId(row) ||
        null,
    };
  }

  function getAction(row, sender) {
    const raw = elementText(row);
    if (!raw || raw.length > CONFIG.maxRowText) return null;

    const ownerIndex = raw.indexOf(sender);
    const action = clean(
      ownerIndex >= 0
        ? raw.slice(ownerIndex + sender.length)
        : raw.replace(sender, "")
    );

    return { raw, action };
  }

  function classifyJoin(action) {
    return (
      /đã\s+tham\s+gia/i.test(action) ||
      /joined\s+(?:the\s+)?live/i.test(action)
    );
  }

  function classifyShare(action) {
    return (
      /đã\s+chia\s+sẻ\s+(?:phiên\s+)?live/i.test(action) ||
      /shared\s+(?:the\s+)?live/i.test(action)
    );
  }

  function classifyFollow(action) {
    return (
      /đã\s+follow\s+chủ\s+phòng/i.test(action) ||
      /đã\s+theo\s+dõi/i.test(action) ||
      /started\s+following/i.test(action) ||
      /followed\s+(?:the\s+host)?/i.test(action)
    );
  }

  function classifyUserLike(action) {
    return (
      /đã\s+thích\s+(?:phiên\s+)?live/i.test(action) ||
      /liked\s+(?:the\s+)?live/i.test(action)
    );
  }

  function parseGiftAction(action) {
    const match = clean(action).match(
      /^(?:(?:đã\s+)?gửi|sent)\s+(.+?)\s*[x×]\s*(\d+)\s*$/i
    );

    if (!match) return null;

    const gift = clean(match[1]);
    const totalCount = Math.max(1, Number(match[2]) || 1);
    if (!gift) return null;

    return { gift, totalCount };
  }

  function emit(event, row) {
    state.counts[event.type] = (state.counts[event.type] || 0) + 1;

    try {
      window.__sendTikTokDomEvent?.({
        ...event,
        timestamp: Date.now(),
        time: new Date().toLocaleTimeString(),
      });
    } catch (error) {
      console.error("Không gửi được TikTok activity event về Node.js:", error);
    }
  }

  function emitOnce(row, event, emitExisting) {
    const signature = [
      event.type,
      event.sender || "",
      event.uniqueId || "",
      event.action || "",
      event.raw || "",
    ].join("|");

    const previous = state.rowValue.get(row);
    state.rowValue.set(row, signature);

    if (!emitExisting || previous === signature) return;
    emit(event, row);
  }

  function processGift(row, owner, details, parsedGift, emitExisting) {
    const signature = `${owner.uniqueId || owner.sender}|${parsedGift.gift}`;
    const previous = state.giftValue.get(row);

    let count = parsedGift.totalCount;

    if (previous?.signature === signature) {
      if (parsedGift.totalCount > previous.totalCount) {
        count = parsedGift.totalCount - previous.totalCount;
      } else {
        count = 0;
      }
    }

    state.giftValue.set(row, {
      signature,
      totalCount: parsedGift.totalCount,
    });

    if (!emitExisting || count <= 0) return;

    emit(
      {
        type: "gift",
        sender: owner.sender,
        uniqueId: owner.uniqueId,
        gift: parsedGift.gift,
        count,
        totalCount: parsedGift.totalCount,
        action: details.action,
        raw: details.raw,
        source: "gift-activity",
      },
      row
    );
  }

  function processRow(row, emitExisting = true) {
    if (!(row instanceof Element)) return;

    // COMMENT tuyệt đối không đi qua activity collector này.
    if (
      row.getAttribute("data-e2e") === "chat-message" ||
      row.closest('[data-e2e="chat-message"]')
    ) {
      return;
    }

    const owner = getOwner(row);
    if (!owner) return;

    const details = getAction(row, owner.sender);
    if (!details?.action) return;

    const e2e = row.getAttribute("data-e2e") || "";

    if (e2e === "enter-message") {
      if (!classifyJoin(details.action)) return;

      emitOnce(
        row,
        {
          type: "join",
          sender: owner.sender,
          uniqueId: owner.uniqueId,
          action: details.action,
          raw: details.raw,
          source: "join-message",
        },
        emitExisting
      );
      return;
    }

    if (e2e === "social-message") {
      if (classifyShare(details.action)) {
        emitOnce(
          row,
          {
            type: "share",
            sender: owner.sender,
            uniqueId: owner.uniqueId,
            action: details.action,
            raw: details.raw,
            source: "social-message",
          },
          emitExisting
        );
        return;
      }

      if (classifyFollow(details.action)) {
        emitOnce(
          row,
          {
            type: "follow",
            sender: owner.sender,
            uniqueId: owner.uniqueId,
            action: details.action,
            raw: details.raw,
            source: "social-message",
          },
          emitExisting
        );
      }
      return;
    }

    // Generic activity row chỉ dành cho LIKE có user và GIFT.
    // Các row có data-e2e khác không được đoán loại bằng text.
    if (e2e) return;
    if (!row.matches(GENERIC_ACTIVITY_SELECTOR)) return;

    if (classifyUserLike(details.action)) {
      emitOnce(
        row,
        {
          type: "like",
          sender: owner.sender,
          uniqueId: owner.uniqueId,
          count: 1,
          action: details.action,
          raw: details.raw,
          source: "user-activity",
          anonymous: false,
          suspected: false,
        },
        emitExisting
      );
      return;
    }

    const parsedGift = parseGiftAction(details.action);
    if (parsedGift) {
      processGift(row, owner, details, parsedGift, emitExisting);
    }
  }

  function collectRows(node, output) {
    const element = getElement(node);
    if (!element) return;

    const selectors = [
      '[data-e2e="enter-message"]',
      '[data-e2e="social-message"]',
      GENERIC_ACTIVITY_SELECTOR,
    ];

    for (const selector of selectors) {
      const closest = element.closest(selector);
      if (closest) output.add(closest);

      if (element.matches(selector)) output.add(element);

      for (const row of element.querySelectorAll(selector)) {
        output.add(row);
      }
    }
  }

  function markExistingRows() {
    const rows = new Set();
    collectRows(document.body, rows);

    for (const row of rows) {
      processRow(row, false);
    }
  }

  state.observer = new MutationObserver(records => {
    const rows = new Set();

    for (const record of records) {
      collectRows(record.target, rows);

      if (record.type === "childList") {
        for (const node of record.addedNodes) {
          collectRows(node, rows);
        }
      }

      if (record.type === "characterData") {
        collectRows(record.target, rows);
      }
    }

    requestAnimationFrame(() => {
      for (const row of rows) {
        processRow(row, true);
      }
    });
  });

  markExistingRows();

  state.observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  window.TikTokActivityDOM = {
    stop() {
      state.observer?.disconnect();
      state.observer = null;
    },

    getState() {
      return {
        running: Boolean(state.observer),
        counts: { ...state.counts },
        mode: "separate-activity-events",
      };
    },
  };

  try {
    window.__sendTikTokStatus?.({
      message: "TIKTOK ACTIVITY DOM STARTED",
      details: {
        mode: "separate-activity-events",
        joinSelector: '[data-e2e="enter-message"]',
        socialSelector: '[data-e2e="social-message"]',
        genericActivitySelector: GENERIC_ACTIVITY_SELECTOR,
        commentExcluded: true,
      },
    });
  } catch {
    // Không để lỗi status làm dừng observer.
  }
}
