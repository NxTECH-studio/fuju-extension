import { createLoadingIcon } from '../img/loadingIcon';
import { fujuData } from '../api/fujuUserCache';

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

const insertFujuIcon = (username: Element, fujuUserId: string | null): void => {
  let fujuIcon = getFujuIcon(username);

  // 既存のアイコンがなければ新規作成
  if (!fujuIcon) {
    fujuIcon = createLoadingIcon();
    fujuIcon.dataset.inserted = 'true';
    username.insertBefore(fujuIcon, username.children[1]);
  }

  // アイコンの状態を更新
  fujuIcon.dataset.loading = 'false';

  if (fujuUserId) {
    fujuIcon.dataset.fujuUserId = fujuUserId;
    fujuIcon.style.opacity = '1';
  } else {
    fujuIcon.dataset.fujuUserId = 'null';
    fujuIcon.style.opacity = '0.3';
  }
};

const processTweetElement = async (elem: Element): Promise<void> => {
  const username = elem.querySelector('[data-testid="User-Name"]');
  console.log(username != null);

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
  const fujuUserId = await fujuData(userId);
  console.log(`ユーザー: ${userId}, fujuUserId: ${fujuUserId}`);
  insertFujuIcon(username, fujuUserId);
};

export default processTweetElement;
