import { startSiteRouter } from './site-router';
import { siteHandlers } from './sites';

console.log('[content] loaded on', location.href);

startSiteRouter(siteHandlers);
