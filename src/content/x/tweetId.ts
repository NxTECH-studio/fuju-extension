// `[data-testid="tweet"]` 要素から tweet (status) ID を取り出す。
//
// Twitter / X の DOM では tweet 内に必ず `/<handle>/status/<id>` 形式の
// permalink anchor が含まれる (timestamp `<time>` を包む anchor 等)。
// IDは数字のみで構成される 19 桁前後の Snowflake ID。
//
// 失敗時は null を返し、呼び出し側は telemetry 登録をスキップする。
// (item_id が決められない event を送っても model 側で集計できないため。)

const STATUS_HREF_PATTERN = /\/status\/(\d+)(?:[/?#]|$)/;

export function extractTweetId(tweet: Element): string | null {
  const anchors = tweet.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]');
  for (const a of anchors) {
    const match = STATUS_HREF_PATTERN.exec(a.getAttribute('href') ?? '');
    if (match) {
      return match[1];
    }
  }
  return null;
}
