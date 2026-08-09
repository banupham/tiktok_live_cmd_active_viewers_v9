import {
  installTikTokActivityCollector,
} from "./collector/activity_collector.mjs";
import {
  installTikTokLikeActivityCollector,
} from "./collector/like_activity_collector.mjs";
import {
  installTikTokDirectCommentCollector,
} from "./collector/direct_comment_collector.mjs";

/*
 * a.mjs truyền hàm này qua page.evaluate(), nên hàm phải tự chứa hoàn toàn.
 * Mỗi nhóm event dùng collector riêng để tránh quét chồng chéo:
 * - direct comment: comment
 * - activity: join/follow/share/user-like/gift
 * - heart activity: anonymous like từ tim bay
 */
const combinedCollectorSource = `
  return function installTikTokLiveDomCollector(userConfig = {}) {
    window.TikTokLiveDOM?.stop?.();

    const installActivityCollector = ${installTikTokActivityCollector.toString()};
    const installHeartCollector = ${installTikTokLikeActivityCollector.toString()};
    const installDirectCommentCollector = ${installTikTokDirectCommentCollector.toString()};

    installDirectCommentCollector(userConfig);
    installActivityCollector(userConfig);
    installHeartCollector(userConfig);

    const stopDirectComments = window.TikTokDirectCommentDOM?.stop?.bind(
      window.TikTokDirectCommentDOM
    );
    const stopActivity = window.TikTokActivityDOM?.stop?.bind(
      window.TikTokActivityDOM
    );
    const stopHearts = window.TikTokLikeActivityDOM?.stop?.bind(
      window.TikTokLikeActivityDOM
    );

    window.TikTokLiveDOM = {
      stop() {
        stopDirectComments?.();
        stopActivity?.();
        stopHearts?.();
      },

      getState() {
        return {
          comment: window.TikTokDirectCommentDOM?.getState?.() || null,
          activity: window.TikTokActivityDOM?.getState?.() || null,
          heartLike: window.TikTokLikeActivityDOM?.getState?.() || null,
        };
      },
    };

    try {
      window.__sendTikTokStatus?.({
        message: "TIKTOK LIVE COLLECTORS STARTED",
        details: {
          mode: "separated-event-collectors",
          supportedEvents: [
            "comment",
            "join",
            "follow",
            "share",
            "like:user-activity",
            "like:heart-animation",
            "gift",
          ],
          legacyCollectorEnabled: false,
        },
      });
    } catch {
      // Không để lỗi status làm dừng collector.
    }
  };
`;

export const installTikTokLiveDomCollector = new Function(
  combinedCollectorSource
)();

export { installTikTokActivityCollector };
export { installTikTokLikeActivityCollector };
export { installTikTokDirectCommentCollector };
export {
  SUPPORTED_EVENT_TYPES,
  TikTokEventNormalizer,
  cleanText,
  normalizeGiftKey,
  normalizeUniqueId,
} from "./core/event_normalizer.mjs";
export { EventBus } from "./core/event_bus.mjs";
export { HttpEventGateway } from "./transports/http_gateway.mjs";
export { WebhookDispatcher } from "./transports/webhook_dispatcher.mjs";
export { JsonlWriter } from "./storage/jsonl_writer.mjs";
