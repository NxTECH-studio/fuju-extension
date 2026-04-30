import type { SiteContext, SiteHandler } from './site-handler';
import { onUrlChange } from './url-change';

/**
 * `host` が `hosts` のいずれかと「完全一致」もしくは「サフィックス一致」するかを判定する。
 * 比較は小文字化した hostname (ポートなし) 同士で行う。
 * 例: `hosts: ['x.com']` のとき、`x.com` / `mobile.x.com` はマッチ、`notx.com` はアンマッチ。
 */
export function matchHost(hostname: string, hosts: string[]): boolean {
  const target = hostname.toLowerCase();
  return hosts.some((entry) => {
    const normalized = entry.toLowerCase();
    return target === normalized || target.endsWith('.' + normalized);
  });
}

function buildContext(): SiteContext {
  return {
    url: location.href,
    host: location.hostname,
    readyState: document.readyState,
  };
}

function safeCall(
  handlerName: string,
  phase: string,
  fn: () => void,
): void {
  try {
    fn();
  } catch (e) {
    console.error('[site-router]', handlerName, phase, e);
  }
}

let started = false;

/**
 * 現在の `location.hostname` にマッチする最初のハンドラを起動する。
 * 起動済みのハンドラに対して、SPA URL 変化を `onUrlChange` として転送する。
 * 多重起動は防止される。ハンドラ内の例外は他に波及せず console.error に流す。
 */
export function startSiteRouter(handlers: SiteHandler[]): void {
  if (started) {
    return;
  }
  started = true;

  const handler = handlers.find((h) => matchHost(location.hostname, h.hosts));
  if (!handler) {
    return;
  }

  safeCall(handler.name, 'onLoad', () => handler.onLoad(buildContext()));

  const onChange = handler.onUrlChange;
  if (onChange) {
    onUrlChange(() => {
      safeCall(handler.name, 'onUrlChange', () =>
        onChange.call(handler, buildContext()),
      );
    });
  }
}
