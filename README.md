# fuju-extension

Browser extension (Manifest V3) that drives auto form-input flows for the Fuju
ecosystem. The popup ships a login screen backed by [AuthCore](../auth/README.md);
tokens are persisted across browser restarts via `chrome.storage.local` and the
service worker handles refresh / logout transparently.

## Prerequisites

- Node.js (matching `package.json`'s engines, see `npm` for current toolchain).
- A running AuthCore instance reachable from the browser. Locally:

  ```sh
  cd ../auth && docker-compose up
  ```

## Setup

1. Install dependencies: `npm install`
2. Copy the env template and adjust as needed:

   ```sh
   cp .env.example .env
   # edit VITE_AUTHCORE_BASE_URL if AuthCore is not on http://localhost:8080
   ```

3. Build the extension: `npm run build` (outputs to `dist/`).
4. Open `chrome://extensions`, enable Developer Mode, and load `dist/` as an
   unpacked extension.

## Scripts

- `npm run dev` — Vite watch build for iterative development.
- `npm run build` — Type-check (`tsc -b`) and bundle.
- `npm run lint` / `npm run lint:fix` — ESLint.
- `npm run format` — Prettier + ESLint fix.

## Release / Web Store 公開

`main` へのマージから Chrome Web Store への自動 publish までは
[`docs/release.md`](./docs/release.md) を参照してください。コミットメッセージ規約
(Conventional Commits) と GitHub Actions secrets のセットアップ手順をまとめています。

## AuthCore integration notes

The extension talks to AuthCore over HTTPS (`fetch` with `credentials: 'include'`).
A few cross-origin specifics apply:

- **CORS**: AuthCore's `ALLOWED_ORIGINS` must include the extension's origin
  (`chrome-extension://<extension-id>`). The extension ID changes between
  unpacked installs and the published version, so add every origin you need.
- **Refresh token cookie**: AuthCore returns the refresh token as an HttpOnly
  `refresh_token` cookie scoped to `/v1/auth`. The background service worker
  reads it via `chrome.cookies.get` and stores a backup copy in
  `chrome.storage.local` so refresh continues to work even when the cookie is
  not auto-attached (e.g. across certain MV3 worker lifecycles).
- **Permissions**: `manifest.json` declares `cookies` (cookie read), `alarms`
  (token auto-refresh scheduling), and `host_permissions` for the AuthCore
  origins. Update `host_permissions` whenever you point at a new AuthCore
  deployment.

## Project layout

```
src/
  background/         service worker entry, auth manager, message dispatcher
  content/            content script entry
  popup/              React popup UI (login form, dashboard)
    auth/             AuthProvider, useAuth, LoginForm, Dashboard
  shared/
    config.ts         AUTHCORE_BASE_URL and cookie constants
    auth/             API client, storage wrapper, message protocol, types
public/manifest.json  Manifest V3 declaration
popup.html            Vite entry for the popup
```

For a project-wide tour (features, layout, message protocol, storage), see
[`docs/overview.md`](./docs/overview.md).

## MFA

The current implementation refuses MFA-protected accounts and surfaces a
dedicated error message. MFA verification (`/v1/auth/mfa/verify`) is tracked as
a follow-up task.
