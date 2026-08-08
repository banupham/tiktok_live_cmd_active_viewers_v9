/**
 * Bắt COMMENT TikTok LIVE trực tiếp từ đúng các element chứa dữ liệu.
 *
 * Không đọc toàn bộ innerText của row chat. Chỉ lấy:
 * - tên hiển thị: [data-e2e="message-owner-name"][title]
 * - nội dung:     div.w-full.break-words.align-middle
 *
 * Hàm phải tự chứa vì được truyền vào page.evaluate().
 */
export function installTikTokDirectCommentCollector(userConfig = {}) {
  window.TikTokDirectCommentDOM?.stop?.();

  const CONFIG = {
    maxCommentLength: 2000,
    ...userConfig,
  };

  const state = {
    observer: null,
    rowValue: new WeakMap(),
    commentCount: 0,
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

  function extractUniqueId(element) {
    if (!(element instanceof Element)) return null;

    const link =
      element.closest?.('a[href*="/@"]') ||
      element.querySelector?.('a[href*="/@"]');

    const href = link?.getAttribute("href") || "";
    return href.match(/\/@([^/?#]+)/)?.[1] || null;
  }

  function parseCommentRow(row) {
    if (!(row instanceof Element)) return null;
    if (row.getAttribute("data-e2e") !== "chat-message") return null;

    const ownerElement = row.querySelector(
      '[data-e2e="message-owner-name"][title]'
    );
    const commentElement = row.querySelector(
      'div.w-full.break-words.align-middle'
    );

    if (!(ownerElement instanceof Element)) return null;
    if (!(commentElement instanceof Element)) return null;

    const sender = clean(ownerElement.getAttribute("title"));
    const comment = clean(commentElement.textContent);

    if (!sender || !comment) return null;
    if (comment.length > CONFIG.maxCommentLength) return null;

    return {
      type: "comment",
      sender,
      uniqueId:
        extractUniqueId(ownerElement) ||
        extractUniqueId(row) ||
        null,
      comment,
      raw: comment,
      source: "direct-comment-elements",
      timestamp: Date.now(),
      time: new Date().toLocaleTimeString(),
    };
  }

  function processRow(row, emitExisting = true) {
    const event = parseCommentRow(row);
    if (!event) return;

    const signature = `${event.uniqueId || event.sender}|${event.comment}`;
    const previous = state.rowValue.get(row);
    state.rowValue.set(row, signature);

    if (!emitExisting || previous === signature) return;

    state.commentCount += 1;

    try {
      window.__sendTikTokDomEvent?.(event);
    } catch (error) {
      console.error("Không gửi được COMMENT trực tiếp về Node.js:", error);
    }
  }

  function collectRows(node, output) {
    const element = getElement(node);
    if (!element) return;

    const closest = element.closest('[data-e2e="chat-message"]');
    if (closest) output.add(closest);

    if (element.matches('[data-e2e="chat-message"]')) {
      output.add(element);
    }

    for (const row of element.querySelectorAll('[data-e2e="chat-message"]')) {
      output.add(row);
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

  window.TikTokDirectCommentDOM = {
    stop() {
      state.observer?.disconnect();
      state.observer = null;
    },

    getState() {
      return {
        running: Boolean(state.observer),
        commentCount: state.commentCount,
        mode: "direct-comment-elements",
      };
    },
  };

  try {
    window.__sendTikTokStatus?.({
      message: "TIKTOK DIRECT COMMENT DOM STARTED",
      details: {
        mode: "direct-comment-elements",
        ownerSelector: '[data-e2e="message-owner-name"][title]',
        commentSelector: 'div.w-full.break-words.align-middle',
      },
    });
  } catch {
    // Không để lỗi status làm dừng observer.
  }
}
