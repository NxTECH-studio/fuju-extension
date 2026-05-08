import processTweetElement from './userData';
import { trackTweet } from './impressionTracker';
import { extractTweetId } from './tweetId';

console.log('[content/x] loaded on', location.href);

const TWEET_SELECTOR = '[data-testid="tweet"]';

const x = () => {
  const scanTweets = () => {
    const elems = document.querySelectorAll(TWEET_SELECTOR);
    for (const elem of elems) {
      void processTweetElement(elem);
      // impression tracker は WeakSet で重複登録を弾くので、scan 毎に呼んで OK。
      // tweet ID が抽出できない (= permalink anchor が未レンダー) ノードは
      // 次回 scan で再評価される。
      const tweetId = extractTweetId(elem);
      if (tweetId) {
        trackTweet(elem, tweetId);
      }
    }
  };

  scanTweets();

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scanTweets();
    });
  });

  const config: MutationObserverInit = {
    childList: true,
    subtree: true,
  };

  const start = () => {
    observer.observe(document.body, config);
    console.log('[fuju] ツイート要素の監視を開始しました');
  };

  if (document.body) {
    start();
  } else {
    globalThis.addEventListener('DOMContentLoaded', start, { once: true });
  }

  return () => {
    observer.disconnect();
  };
};

x();
