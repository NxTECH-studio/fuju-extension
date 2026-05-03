import processTweetElement from './userData';

const TWEET_SELECTOR = '[data-testid="tweet"]';

const x = () => {
  const scanTweets = () => {
    const elems = document.querySelectorAll(TWEET_SELECTOR);
    for (const elem of elems) {
      void processTweetElement(elem);
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

export default x;
