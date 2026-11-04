# Development

**English** | [한국어](DEVELOPMENT.ko.md)

Build, run and deploy OctoBooks from source. Back to [README](../README.md).

## Requirements

- Node.js 22+, pnpm 10 (`corepack enable`)
- Optional: official `claude` / `codex` CLI (subscription use), Xcode (iOS), Android Studio (Android)

```bash
git clone https://github.com/lafin716/octobooks.git
cd octobooks
pnpm install
```

## Repository layout

| Path | Contents |
|---|---|
| `packages/core` | Domain model, anchors, context building, tree, Zustand store, provider interface (platform-agnostic) |
| `packages/ui` | Vite + React + Tailwind SPA shared by every platform (also the web build) |
| `packages/bridge` | Runs official CLIs + WebSocket server (embedded in desktop / headless) |
| `packages/server` | `octobooks serve` — headless host without the desktop app |
| `packages/relay` | Outbound WebSocket relay (end-to-end encrypted payloads) |
| `apps/desktop` | Electron (bridge embedded in the main process) |
| `apps/mobile` | Capacitor (iOS / Android) |
| `e2e/` | Playwright end-to-end tests + mock Anthropic SSE server |

## Web

```bash
pnpm dev          # http://0.0.0.0:5173 (LAN and Tailscale *.ts.net allowed)
```

- From a phone: `http://<PC LAN IP>:5173` on the same Wi-Fi, or `http://<host>.<tailnet>.ts.net:5173` over Tailscale.
- On the start screen pick a profile: **this device** (local IndexedDB + API key) or a paired PC (mirror). Add `?platform=desktop` on the dev server to force the local desktop mode.
- Demo mode: the scenario menu on the dev server (or `#scenario=home` etc.) shows seeded screens with a mock provider.
- Static build: `pnpm --filter @branch/ui build` → host `packages/ui/dist/` anywhere. Preview with `pnpm --filter @branch/ui preview`.
- Optional build-time env vars:
  - `VITE_GOOGLE_CLIENT_ID` — OAuth client ID for Google Drive backup (mock drive if missing)
  - `VITE_ANTHROPIC_BASE_URL`, `VITE_OPENAI_BASE_URL` — override API endpoints (proxies, tests)

## Desktop (Electron)

```bash
pnpm dev                                   # terminal 1: Vite dev server
pnpm --filter @branch/desktop dev          # terminal 2: Electron (loads the dev server)

pnpm --filter @branch/desktop build        # renderer + main bundle → apps/desktop/dist
pnpm --filter @branch/desktop start        # run the build
```

Packaging (electron-builder, output in `apps/desktop/release/`):

```bash
pnpm --filter @branch/desktop package:dir  # app folder only (quick check) → release/mac-arm64/OctoBooks.app
pnpm --filter @branch/desktop package      # installers for the current OS: mac dmg/zip · win nsis · linux AppImage/deb
```

- Build installers for each OS on that OS (or a CI runner).
- Code signing / notarization isn't configured by default (BLOCKERS B-03). To build unsigned on macOS set `CSC_IDENTITY_AUTO_DISCOVERY=false`. To sign, provide `CSC_LINK` / `CSC_KEY_PASSWORD` (+ `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for notarization) as CI secrets.
- **Background mode**: with remote pairing on, closing the window keeps OctoBooks in the tray / menu bar so paired phones and browsers keep working. Quit fully from the tray menu (or ⌘Q on macOS).
- The desktop app embeds the bridge, so it uses the `claude` / `codex` CLI installed and logged in on your PC. API keys are stored in the OS secure storage (safeStorage).

## Mobile (Capacitor)

```bash
pnpm --filter @branch/mobile build:android   # Android debug APK (Android Studio / SDK required)
pnpm --filter @branch/mobile build:ios-sim   # iOS simulator build (Xcode, unsigned)
pnpm --filter @branch/mobile android         # open in Android Studio
pnpm --filter @branch/mobile ios             # open in Xcode
```

- Use the phone on its own with an API key, or pair it with your PC: the PC's studies are mirrored and the PC answers with its own CLI.
- Pairing: on the PC, Settings › Connection › **Open remote pairing** → **Connect phone / web**, then **Scan QR** on the phone, or enter the link / address + 6-digit code. Scanning with the OS camera opens the app via the `branch://pair` deep link.
- Store distribution and signing: BLOCKERS B-07.

## Headless host `octobooks serve`

Run this on a server or PC instead of the desktop app; mobile and web apps pair with it exactly like with the desktop. Studies, questions, branches, summaries and formatting are synced, and answers are generated with that machine's `claude` / `codex` CLI (or an API key).

```bash
pnpm octobooks -- serve --pair          # build and run. :7777, shows QR / link / one-time code (5 min)
pnpm octobooks -- serve                 # only already-paired devices can connect
pnpm octobooks -- devices               # list paired devices
pnpm octobooks -- unpair <id|all>       # unpair (restart a running serve to disconnect)
# Single build artifact: node packages/server/dist/rhymebook.cjs serve --pair
```

Shortcut scripts at the repo root install dependencies on first run and rebuild the server each time (1–2 s, skip with `RHYMEBOOK_NO_BUILD=1`). Without arguments they run `serve`; arguments starting with an option get `serve` prepended.

```bash
./rhymebook.sh --pair          # macOS / Linux (= serve --pair)
./rhymebook.sh devices
rhymebook.cmd --pair           # Windows (double-click in Explorer runs serve)
```

| Option | Description |
|---|---|
| `--port` / `--host` | default `7777` (`RHYMEBOOK_PORT`) / `0.0.0.0` |
| `--name` | name shown in the apps (defaults to the computer name on first run) |
| `--dir` | data folder (default `$RHYMEBOOK_HOME` → `~/.config/rhymebook`, Windows `%APPDATA%\rhymebook`) |
| `--agent auto\|claude-cli\|codex-cli` | agent for new studies (auto: ready claude → codex → API key) |
| `--no-delete` | prevent remote devices from deleting studies / questions |
| `--relay <url>` / `--relay-only` | accept connections through a relay when behind NAT |
| `--whisper-cli <path>` | whisper-cli for voice input (default: `BRANCH_WHISPER_CLI` → PATH / Homebrew) |
| `-v` | verbose logs |

- Data folder: `data.json` (studies, 0600), `skills/<name>/SKILL.md`, `bridge/` (pairing), `stt/` (voice settings and models).
- Provide API keys via `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (kept in memory only, never written to files or logs).
- It does not share data with the desktop app (separate host). Ctrl+C stops in-progress answers, saves and exits.

## Headless bridge & relay

Run only the bridge on a PC where a CLI is logged in, and use that PC's CLI from the desktop app ("Connect to another PC").

```bash
pnpm bridge -- --pair                 # :7777, QR / link / one-time code (5 min)
pnpm bridge -- devices
pnpm bridge -- unpair <id|all>

pnpm relay                                                          # relay on :8787
pnpm bridge -- --pair --relay ws://<relay-host>:8787                 # direct + relay
pnpm bridge -- --pair --relay wss://relay.example.com --relay-only   # no open ports
```

- Check that the bridge fingerprint shown in the app matches the one in the terminal.
- The relay only forwards ciphertext. For public deployments run it behind a TLS proxy (Caddy / nginx) as `wss://` (B-09).

## Providers & policy

| Provider | Where | Notes |
|---|---|---|
| Anthropic API / OpenAI API | all platforms | bring your own key; default provider for public builds |
| Claude CLI / Codex CLI | desktop, headless bridge / host | runs **your own logged-in official CLI** only; tools limited (read-only), stateless calls |
| Remote bridge | desktop | through a paired bridge (direct or relay) |
| PC remote study | web, mobile | mirrors the PC store; the PC runs the CLI |
| Mock | demo mode | fake streaming |

- OctoBooks never reads or extracts OAuth tokens or CLI auth files and never spoofs client headers. Login status is checked only with the CLI's official status command.
- Subscription use is limited to your own CLI on your own devices — don't share subscriptions.
- API keys and pairing keys live only in the OS secure storage (web: tab memory only). They are never written to logs, commits or relay plaintext.

## Development

```bash
pnpm typecheck && pnpm lint && pnpm test     # TypeScript · ESLint · Vitest

pnpm exec playwright install chromium        # once
pnpm e2e                                     # Playwright E2E (desktop 1440×900 · mobile 390×844)
```

E2E starts a mock Anthropic SSE server (`e2e/mock-anthropic.mjs`, :8799) and Vite (:5191) automatically — no real API key needed.

App icon: the source is `assets/icon/glyph.svg`; run `node scripts/gen-icons.mjs` to regenerate desktop, iOS, Android and web icons.

### CI / releases (GitHub Actions)

- `.github/workflows/ci.yml` — push to main / PRs: typecheck, lint, unit tests, Playwright E2E.
- `.github/workflows/release.yml` — tag `v*` or manual: desktop installers on macOS / Windows / Linux runners and an Android debug APK, attached to a draft GitHub Release for tags.
- Signing is applied only when repository secrets (`MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`) exist. Never commit certificates (B-10).

## Naming & compatibility

The project started as **Branch Learn**, was renamed **rhymebook**, and has been **OctoBooks** since v0.20.0 (repository: `lafin716/octobooks`). Updating an existing install keeps studies, settings and API keys. For compatibility these are unchanged: the app ID, the desktop data folder (`<appData>/rhymebook`), `branch://` pairing links, `@branch/*` packages, `RHYMEBOOK_*` env vars, the `rhymebook` CLI alias and the backup format. Rebrand notes: [docs/rebrand/](rebrand).

