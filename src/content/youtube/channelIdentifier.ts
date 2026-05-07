/**
 * 現在閲覧中の YouTube チャンネルの identifier 抽出。
 *
 * YouTube は SPA で動くうえ DOM の class / tag セレクタが頻繁に変わるため、
 * - URL 経路 (`location.pathname`)
 * - DOM 経路 (anchor の `href`)
 * の二段構えで identifier を抽出する。どちらも取れない場合は `null` を返し、
 * 呼び出し側は MutationObserver で再試行する。
 */

export interface ChannelIdentifier {
  // `@` を剥がした handle (例: `mrbeast`)。
  handle?: string;
  // `UC` で始まる 24 文字の channel ID。
  channelId?: string;
}

export type PageKind = 'watch' | 'channel' | 'shorts' | 'other';

const HANDLE_RE = /^\/@([\w][\w._-]{2,29})/;
const CHANNEL_ID_RE = /^\/channel\/(UC[\w-]{22})/;

/**
 * `/@handle` / `/channel/UC…` を含む URL string から identifier を抽出する。
 * 絶対 URL でも相対 URL でも動くよう、まず pathname に正規化してから判定する。
 */
export function parseChannelHrefToIdentifier(href: string): ChannelIdentifier | null {
  if (!href) return null;

  let pathname: string;
  try {
    // 相対 URL のとき URL コンストラクタは投げるので base を補う。
    pathname = new URL(href, 'https://www.youtube.com').pathname;
  } catch {
    return null;
  }

  const handleMatch = pathname.match(HANDLE_RE);
  if (handleMatch) {
    return { handle: handleMatch[1].toLowerCase() };
  }
  const channelIdMatch = pathname.match(CHANNEL_ID_RE);
  if (channelIdMatch) {
    return { channelId: channelIdMatch[1] };
  }
  return null;
}

export function getPageKind(): PageKind {
  const pathname = location.pathname;
  if (pathname === '/watch' || pathname.startsWith('/watch/')) return 'watch';
  if (pathname.startsWith('/shorts/')) return 'shorts';
  if (pathname.startsWith('/@') || pathname.startsWith('/channel/') || pathname.startsWith('/c/')) {
    return 'channel';
  }
  return 'other';
}

/**
 * 共同投稿 (collab) の secondary channel が DOM 上に存在するか観察ログだけ残す。
 * UI 反映は次タスクで扱うので、ここでは debug ログのみ。
 */
function logCollabIfPresent(): void {
  const secondary = document.querySelectorAll(
    'ytd-watch-metadata #secondary-info-renderer ytd-channel-name a, ytd-watch-metadata ytd-metadata-row-renderer a[href^="/@"], ytd-watch-metadata ytd-metadata-row-renderer a[href^="/channel/"]',
  );
  if (secondary.length === 0) return;
  const collabs: string[] = [];
  secondary.forEach((node) => {
    const href = (node as HTMLAnchorElement).getAttribute('href');
    if (href) collabs.push(href);
  });
  if (collabs.length > 0) {
    console.debug('[fuju/youtube] collab detected', collabs);
  }
}

function extractFromWatch(): ChannelIdentifier | null {
  // メインの owner anchor。`ytd-video-owner-renderer` 配下の最初の a タグ。
  const anchor =
    document.querySelector<HTMLAnchorElement>(
      'ytd-watch-metadata #owner ytd-video-owner-renderer a',
    ) ?? document.querySelector<HTMLAnchorElement>('ytd-video-owner-renderer a');
  if (!anchor) return null;
  const ident = parseChannelHrefToIdentifier(anchor.getAttribute('href') ?? '');
  if (ident) {
    logCollabIfPresent();
  }
  return ident;
}

function extractFromChannelPage(): ChannelIdentifier | null {
  // まず URL から取れる場合はそれが最も確実。
  const fromUrl = parseChannelHrefToIdentifier(location.pathname);
  // SPA navigation 直後で URL がまだ反映されていないケースに備えて
  // ページヘッダの anchor も合わせて取り、両方をマージする。
  const headerAnchor = document.querySelector<HTMLAnchorElement>(
    'ytd-channel-name a, #channel-header ytd-channel-name a',
  );
  const fromHeader = headerAnchor
    ? parseChannelHrefToIdentifier(headerAnchor.getAttribute('href') ?? '')
    : null;

  if (!fromUrl && !fromHeader) return null;
  return {
    handle: fromUrl?.handle ?? fromHeader?.handle,
    channelId: fromUrl?.channelId ?? fromHeader?.channelId,
  };
}

function extractFromShorts(): ChannelIdentifier | null {
  // shorts overlay の投稿者リンク。複数の DOM 構造をフォールバックする。
  const candidates: (HTMLAnchorElement | null)[] = [
    document.querySelector<HTMLAnchorElement>(
      'ytd-reel-player-header-renderer a[href^="/@"]',
    ),
    document.querySelector<HTMLAnchorElement>(
      'ytd-reel-video-renderer ytd-channel-name a',
    ),
    document.querySelector<HTMLAnchorElement>(
      'ytd-reel-player-header-renderer a[href^="/channel/"]',
    ),
  ];
  for (const anchor of candidates) {
    if (!anchor) continue;
    const ident = parseChannelHrefToIdentifier(anchor.getAttribute('href') ?? '');
    if (ident) return ident;
  }
  return null;
}

/**
 * 現在のページから「閲覧中チャンネル」の identifier を抽出する。
 *
 * - handle 優先 / channel ID は fallback。両方取れる場合は両方返す。
 * - 何も取れない場合は `null` (DOM hydration 待ちの可能性)。
 */
export function extractCurrentChannel(): ChannelIdentifier | null {
  const kind = getPageKind();
  switch (kind) {
    case 'watch':
      return extractFromWatch();
    case 'channel':
      return extractFromChannelPage();
    case 'shorts':
      return extractFromShorts();
    case 'other':
    default:
      return null;
  }
}
