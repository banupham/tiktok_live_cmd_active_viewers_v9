/**
 * Bắt hiệu ứng tim LIKE trong DOM TikTok LIVE.
 *
 * Không xác định người dùng. Mỗi phần tử tim bay bắt được phát một event
 * `like` với `source: heart-animation` và `count: 1`.
 *
 * Các row event có cấu trúc (comment/join/social/user-like/gift) bị loại trừ
 * hoàn toàn để icon SVG của chúng không bị nhận nhầm thành tim bay.
 *
 * Hàm phải tự chứa vì được truyền vào page.evaluate().
 */
export function installTikTokLikeActivityCollector(userConfig = {}) {
  window.TikTokLikeActivityDOM?.stop?.();

  const CONFIG = {
    likeElementDedupeMs: 350,
    likeWarmupMs: 2000,
    likeMaxDescendants: 100,
    ...userConfig,
  };

  const state = {
    observer: null,
    elementLastSeen: new WeakMap(),
    startedAt: Date.now(),
    likeCount: 0,
  };

  const POSITIVE_PATTERN =
    /heart|like|reaction|digg|floating-heart|like-animation|like_animation|tym|thích/i;

  const NEGATIVE_PATTERN =
    /gift|share|comment|follow|avatar|captcha|verify|sticker|profile/i;

  const STRUCTURED_EVENT_SELECTOR = [
    '[data-e2e="chat-message"]',
    '[data-e2e="enter-message"]',
    '[data-e2e="social-message"]',
    "div.relative.flex.py-4.px-12.P4-Regular.text-UIText1",
  ].join(",");

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

  function isInsideStructuredEventRow(element) {
    if (!(element instanceof Element)) return false;
    return Boolean(element.closest(STRUCTURED_EVENT_SELECTOR));
  }

  function getMeta(element) {
    if (!(element instanceof Element)) return "";

    return clean(
      [
        element.tagName,
        element.id,
        element.getAttribute("class"),
        element.getAttribute("data-e2e"),
        element.getAttribute("data-testid"),
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("role"),
        element.getAttribute("style"),
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  function isVisible(element) {
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
  }

  function isSemanticHeart(element) {
    if (isInsideStructuredEventRow(element)) return false;

    const meta = getMeta(element);
    if (!meta || NEGATIVE_PATTERN.test(meta)) return false;
    return POSITIVE_PATTERN.test(meta);
  }

  function isAnimatedGraphic(element) {
    if (!(element instanceof Element) || !isVisible(element)) return false;
    if (isInsideStructuredEventRow(element)) return false;

    const rect = element.getBoundingClientRect();
    if (
      rect.width < 5 ||
      rect.height < 5 ||
      rect.width > 180 ||
      rect.height > 180
    ) {
      return false;
    }

    const style = getComputedStyle(element);
    const meta = getMeta(element);
    if (NEGATIVE_PATTERN.test(meta)) return false;

    const animated =
      style.animationName !== "none" ||
      style.transform !== "none" ||
      style.position === "absolute" ||
      style.position === "fixed";

    const hasGraphic =
      element.matches("svg, img") || Boolean(element.querySelector("svg, img"));

    return animated && hasGraphic;
  }

  function findHeartRoot(element) {
    if (!(element instanceof Element)) return null;
    if (isInsideStructuredEventRow(element)) return null;

    let current = element;

    for (let depth = 0; current && depth < 6; depth += 1) {
      if (isInsideStructuredEventRow(current)) return null;

      if (isSemanticHeart(current) || isAnimatedGraphic(current)) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  function emitLike(element) {
    const now = Date.now();

    if (now - state.startedAt < CONFIG.likeWarmupMs) return;
    if (isInsideStructuredEventRow(element)) return;

    const previous = state.elementLastSeen.get(element) || 0;
    if (now - previous < CONFIG.likeElementDedupeMs) return;
    state.elementLastSeen.set(element, now);

    state.likeCount += 1;

    const event = {
      type: "like",
      sender: null,
      uniqueId: null,
      count: 1,
      action: "heart-animation",
      source: "heart-animation",
      anonymous: true,
      suspected: true,
      raw: null,
      timestamp: now,
      time: new Date(now).toLocaleTimeString(),
    };

    try {
      window.__sendTikTokDomEvent?.(event);
    } catch (error) {
      console.error("Không gửi được LIKE event về Node.js:", error);
    }
  }

  function inspectNode(node, output) {
    const element = getElement(node);
    if (!element) return;
    if (isInsideStructuredEventRow(element)) return;

    const candidates = [element];
    let scanned = 0;

    for (const child of element.querySelectorAll("*")) {
      if (scanned++ >= CONFIG.likeMaxDescendants) break;
      candidates.push(child);
    }

    for (const candidate of candidates) {
      const root = findHeartRoot(candidate);
      if (root) output.add(root);
    }
  }

  state.observer = new MutationObserver(records => {
    const hearts = new Set();

    for (const record of records) {
      if (record.type === "attributes") {
        inspectNode(record.target, hearts);
      }

      if (record.type === "childList") {
        for (const node of record.addedNodes) {
          inspectNode(node, hearts);
        }
      }
    }

    requestAnimationFrame(() => {
      for (const heart of hearts) {
        emitLike(heart);
      }
    });
  });

  state.observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "data-e2e", "aria-label"],
  });

  window.TikTokLikeActivityDOM = {
    stop() {
      state.observer?.disconnect();
      state.observer = null;
    },

    getState() {
      return {
        running: Boolean(state.observer),
        likeCount: state.likeCount,
        mode: "heart-animation-immediate",
        structuredRowsExcluded: true,
      };
    },
  };

  try {
    window.__sendTikTokStatus?.({
      message: "TIKTOK LIKE HEART DOM STARTED",
      details: {
        mode: "heart-animation-immediate",
        countPerEvent: 1,
        anonymous: true,
        structuredRowsExcluded: true,
      },
    });
  } catch {
    // Không để lỗi status làm dừng observer.
  }
}
