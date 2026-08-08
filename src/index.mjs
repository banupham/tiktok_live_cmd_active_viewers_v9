import {
  installTikTokLiveDomCollector as installBaseTikTokLiveDomCollector,
} from "./collector/dom_collector.mjs";
import {
  installTikTokLikeActivityCollector,
} from "./collector/like_activity_collector.mjs";
import {
  installTikTokDirectCommentCollector,
} from "./collector/direct_comment_collector.mjs";

/*
 * a.mjs truyền hàm này qua page.evaluate(), nên hàm phải tự chứa hoàn toàn.
 * Tạo một hàm mới có source của các collector được nhúng trực tiếp vào thân hàm;
 * không phụ thuộc closure khi chạy trong trang TikTok.
 */
const combinedCollectorSource = `
  return function installTikTokLiveDomCollector(userConfig = {}) {
    const installBaseCollector = ${installBaseTikTokLiveDomCollector.toString()};
    const installHeartCollector = ${installTikTokLikeActivityCollector.toString()};
    const installDirectCommentCollector = ${installTikTokDirectCommentCollector.toString()};

    installBaseCollector(userConfig);
    installDirectCommentCollector(userConfig);
    installHeartCollector(userConfig);

    const stopBase = window.TikTokLiveDOM?.stop?.bind(window.TikTokLiveDOM);
    const stopDirectComments = window.TikTokDirectCommentDOM?.stop?.bind(
      window.TikTokDirectCommentDOM
    );
    const stopHearts = window.TikTokLikeActivityDOM?.stop?.bind(
      window.TikTokLikeActivityDOM
    );

    if (window.TikTokLiveDOM) {
      window.TikTokLiveDOM.stop = () => {
        stopDirectComments?.();
        stopHearts?.();
        stopBase?.();
      };
    }
  };
`;

export const installTikTokLiveDomCollector = new Function(
  combinedCollectorSource
)();

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
