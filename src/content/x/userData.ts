import { createLoadingIcon } from '../img/loadingIcon';
import { fujuData } from '../api/fujuUserCache';
import type { FujuLookupResult } from '../api/fujuUserCache';

const extractUserId = (href: string): string => {
  return href.split('/').findLast(Boolean) ?? '';
};

const getFujuIcon = (username: Element): HTMLElement | null => {
  return Array.from(username.children).find(
    (child) => (child as HTMLElement).dataset.inserted === 'true',
  ) as HTMLElement | null;
};

const setFujuIconLoading = (fujuIcon: HTMLElement): void => {
  fujuIcon.dataset.inserted = 'true';
  fujuIcon.dataset.loading = 'true';
  fujuIcon.style.opacity = '0.5';
};

const insertFujuIcon = (username: Element, result: FujuLookupResult | null): void => {
  const fujuIcon = getFujuIcon(username);

  // 呼び出し元の insertIcon() が必ず先にローディングアイコンを挿入する前提
  if (!fujuIcon) {
    return;
  }

  // アイコンの状態を更新
  fujuIcon.dataset.loading = 'false';

  if (result === null) {
    // API 失敗時の分岐: 現状はローディングアイコンのまま薄く表示する
    // （将来的に専用エラーアイコンへ差し替える可能性あり）
    fujuIcon.dataset.fujuUserId = 'error';
    fujuIcon.style.opacity = '0.3';
    return;
  }

  // dataset.fujuUserId は旧来のフィールド名を維持しつつ、
  // 値の意味を「Fuju ユーザーかどうかの真偽値文字列」に切り替えている。
  fujuIcon.dataset.fujuUserId = result.exists ? 'true' : 'false';
  fujuIcon.style.opacity = result.exists ? '1' : '0.3';
};

const insertIcon = async (username: Element) => {
  if (!username || username.children.length < 2) {
    return;
  }

  // 既にアイコンが挿入済みならスキップ
  const existingIcon = getFujuIcon(username);
  if (existingIcon?.dataset.loading !== 'true') {
    // 既に処理完了している
    if (existingIcon) {
      return;
    }
  }

  // 処理中の場合もスキップ（既に別のリクエストが進行中）
  if (existingIcon?.dataset.loading === 'true') {
    return;
  }

  const a = username.querySelector('a');
  const userHref = a?.href;

  if (!userHref) {
    return;
  }

  const userId = extractUserId(userHref);

  if (!userId) {
    return;
  }

  // ローディング用のアイコンを作成・挿入
  let fujuIcon = getFujuIcon(username);
  if (!fujuIcon) {
    fujuIcon = createLoadingIcon();
    username.insertBefore(fujuIcon, username.children[1]);
  }
  setFujuIconLoading(fujuIcon);

  // API リクエスト実行
  const result = await fujuData(userId);
  console.log(`ユーザー: ${userId}, fuju exists: ${result === null ? 'unknown' : result.exists}`);
  insertFujuIcon(username, result);
};

const processTweetElement = async (elem: Element): Promise<void> => {
  const usernames = elem.querySelectorAll('[data-testid="User-Name"]');
  console.log(usernames != null);
  usernames.forEach((username) => {
    insertIcon(username);
  });
};

export default processTweetElement;
