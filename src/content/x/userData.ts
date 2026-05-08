import { createLoadingIcon } from '../shared/img/loadingIcon';
import { createRegisteredIcon } from '../shared/img/registeredIcon';
import { createUnregisteredIcon } from '../shared/img/unregisteredIcon';
import { fujuData } from '../shared/api/fujuUserCache';
import type { FujuLookupResult } from '../shared/api/fujuUserCache';

const extractUserId = (href: string): string => {
  return href.split('/').findLast(Boolean) ?? '';
};

const getFujuIcon = (username: Element): HTMLElement | null => {
  return Array.from(username.children).find(
    (child) => (child as HTMLElement).dataset.inserted === 'true',
  ) as HTMLElement | null;
};

const replaceFujuIcon = (oldIcon: HTMLElement, result: FujuLookupResult | null): void => {
  if (result === null) {
    // API 失敗時は loading アイコンのまま薄く表示する。
    // 将来的に専用エラーアイコンへ差し替える可能性あり。
    oldIcon.dataset.loading = 'false';
    oldIcon.dataset.fujuUserId = 'error';
    oldIcon.style.opacity = '0.3';
    return;
  }

  const newIcon = result.exists ? createRegisteredIcon() : createUnregisteredIcon();
  newIcon.dataset.inserted = 'true';
  newIcon.dataset.loading = 'false';
  newIcon.dataset.fujuUserId = result.exists ? 'true' : 'false';
  oldIcon.replaceWith(newIcon);
};

const insertIcon = async (username: Element) => {
  if (getFujuIcon(username)) {
    // 既に挿入済み or 処理中。dataset.inserted を即時セットしているので
    // 同期的な再エントリでもここで弾ける。
    return;
  }

  const a = username.querySelector('a');
  const userHref = a?.href;
  if (!userHref) return;

  const userId = extractUserId(userHref);
  if (!userId) return;

  // ローディングアイコンを作成し、挿入の前に dataset を確定させる。
  // こうすることで insertBefore 直後の MutationObserver 再発火が
  // getFujuIcon() で「挿入済み」と認識でき、二重挿入を防げる。
  const fujuIcon = createLoadingIcon();
  fujuIcon.dataset.inserted = 'true';
  fujuIcon.dataset.loading = 'true';
  fujuIcon.style.opacity = '0.5';

  const anchor = username.children[1] ?? null;
  username.insertBefore(fujuIcon, anchor);

  const result = await fujuData('x', userId);
  replaceFujuIcon(fujuIcon, result);
};

const processTweetElement = async (elem: Element): Promise<void> => {
  const usernames = elem.querySelectorAll('[data-testid="User-Name"]');
  usernames.forEach((username) => {
    void insertIcon(username);
  });
};

export default processTweetElement;
