import x from './x'

console.log('[content] loaded on', location.href);

const parse = location.href.split('/');
const page = parse[2];

switch (page) {
  case 'x.com':
  case 'twitter.com':
    x();
    break
  default:
    console.log('NOT SUPPORTED');
}
