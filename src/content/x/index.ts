import processTweetElement from './userData';


const x = () => {
  // ツイート要素を取得する関数
  const getTweetElements = async () => {
    const elems = document.querySelectorAll('[data-testId="tweet"]');
    console.log(`ツイート数: ${elems.length}`);
    
    for (const elem of elems) {
      await processTweetElement(elem);
    }
    return elems;
  };

  // 初期取得
  getTweetElements();

  // DOM変更を監視するMutationObserverを設定
  const observer = new MutationObserver((mutations) => {
    // 変更が検出されたら新しいツイート要素を取得
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        console.log('DOM変更を検出しました');
        getTweetElements();
      }
    });
  });

  // observerの設定
  const config = {
    childList: true,      // 子要素の追加/削除を監視
    subtree: true,        // 全ての子孫要素の変更を監視
    attributes: true,    // 属性変更は監視しない
  };

  // document.bodyの変更を監視開始
  if (document.body) {
    observer.observe(document.body, config);
    console.log('ツイート要素の監視を開始しました');
  } else {
    // bodyが未作成の場合、DOMContentLoadedで実行
    globalThis.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, config);
      console.log('ツイート要素の監視を開始しました');
    });
  }

  // クリーンアップ関数を返す（必要に応じて監視を停止）
  return () => {
    observer.disconnect();
    console.log('ツイート要素の監視を停止しました');
  };
};

export default x;