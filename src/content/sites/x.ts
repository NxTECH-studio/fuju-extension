import type { SiteContext, SiteHandler } from '../site-handler';

const PREFIX = '[fuju:x]';

const log = {
  info: (...args: unknown[]) => console.log(PREFIX, ...args),
  warn: (...args: unknown[]) => console.warn(PREFIX, ...args),
  error: (...args: unknown[]) => console.error(PREFIX, ...args),
};

const handler: SiteHandler = {
  name: 'x',
  hosts: ['x.com', 'twitter.com'],
  onLoad(ctx: SiteContext) {
    log.info('content script loaded on X', {
      url: ctx.url,
      host: ctx.host,
      readyState: ctx.readyState,
    });
  },
  onUrlChange(ctx: SiteContext) {
    log.info('url changed', { url: ctx.url });
  },
};

export default handler;
