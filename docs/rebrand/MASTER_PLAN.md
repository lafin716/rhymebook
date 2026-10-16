# octobooks preview beta

Target: rebrand this branching learning app as **octobooks**, an ocean-inspired personal learning space where curiosity extends into many branches like octopus arms. All changes live in `/private/tmp/octobooks-preview`, branch `preview/octobooks`, based on main `e0a9a6259685cb03c949477be606bbe3ccce0430`. Never merge into, checkout, commit to, or push main.

## Requirements and completion
- R1: separate worktree/branch; prove main ref and source checkout remain unchanged.
- R2: coherent identity across shell, empty/onboarding states, desktop/mobile labels, web metadata, export branding, approved canonical icon and generated platform assets.
- R3: ocean default plus Coral, Lagoon, Abyss, Pearl color palettes; independent system/light/dark appearance; accessible settings selection on desktop and remote web/mobile; immediate update and reload persistence.
- R4: preserve sessions, branches, annotations, backups, pairing protocol, provider settings and internal @branch package names. Preview uses separate app identity/data directory for coexistence. Stable data can be imported via existing backup UI; never silently move or copy user data.
- R5: typecheck/lint/unit/integration and relevant E2E pass; packaged Electron app smoke and desktop/mobile screenshots reviewed independently.
- R6: publish branch/tag `v0.20.0-beta.3` as GitHub **prerelease**, never latest; attach multi-platform installers via existing CI, document unsigned builds and known limits.

## Architecture / shared contracts
Reuse `docs/02-ARCHITECTURE.md`. Theme mode remains core `settings.theme`. Color palette is UI-only and device-local, stored as `octobooks.palette`; valid ids `ocean`, `lagoon`, `coral`, `abyss`, `pearl`; unknown/blocked storage falls back to ocean. Apply `html[data-palette]`, CSS semantic tokens and browser theme-color. Prepaint bootstrap in both HTML entries must agree with UI. No new package or database migration. Palette selections sync between same-origin windows via storage events, never with host sync. Mode initialization must preserve existing local theme preference.

Identity: sidebar display brand `OctoBooks`, preview product `octobooks Preview`, desktop app id `app.octobooks.preview`, mobile application id `app.octobooks.preview` (Java namespace stays `dev.branchlearn.app`), existing `branch://` pairing stays compatible. Set explicit preview default Electron userData before all services: app.getPath(appData)/octobooks-preview; BRANCH_USER_DATA takes precedence. Stable .rhymebook paths, environment variable names, backup format markers and @branch package imports remain for compatibility. Headless command may add octobooks alias while preserving rhymebook.

Visual direction: quiet sea-glass surfaces, deep ink text, teal actions, coral highlights, generous breathing room and a memorable octopus/book glyph. Learning remains the central interaction. Avoid decorative motion in reading surfaces; honor reduced motion. All copy Korean except product name and small brand labels.

## Ownership and dependency graph
ARCH → THEME + BRAND + RELEASE → INTEGRATE → REVIEW → PUBLISH → DOCS.
- ARCH lead, plan/contracts/design: read-only architect review before implementation.
- THEME executor, `packages/ui/src/styles.css`, `app/useTheme.ts`, new `app/palette.ts`, new `settings/AppearanceSettings.tsx`, `settings/SettingsModal.tsx`, `settings/RemoteSettings.tsx`, `packages/ui/index.html`, `apps/mobile/index.html`, theme tests. No core settings changes.
- BRAND executor, `assets/icon/**`, `scripts/gen-icons.mjs`, generated icon outputs, new `components/OctoMark.tsx`, `components/TopBar.tsx`, `session/Sidebar.tsx`, `chat/EmptyChat.tsx`, `onboarding/Onboarding.tsx`, `chat/MessageItem.tsx` if relevant, `book/**` identity only. No settings/theme files.
- RELEASE lead, desktop/mobile metadata/main/tray, release workflow, versions, README, e2e, integration, documentation. Mobile `icon` files belong BRAND, mobile HTML belongs THEME.
- REVIEW separate code-reviewer, read-only final diff and evidence.

## Validation strategy / release target
Existing `pnpm typecheck`, `pnpm lint`, `pnpm test`; web E2E `pnpm e2e`, add targeted palette persistence, appearance, storage fallback/invalid input and remote settings tests. Use isolated browser fixtures, demo data only. Desktop build `pnpm --filter @branch/desktop package:dir`, launch packaged Electron with temporary BRANCH_USER_DATA, inspect real renderer. Screenshot at 1440/390 plus tablet. No existing installed app/user data touched.
GitHub repo `lafin716/rhymebook` existing Release workflow; non-production beta target. Authenticate with existing gh CLI only (do not read tokens). Tag only reviewed commit in preview branch. Workflow explicitly sets prerelease=true and make_latest=false for beta tags; use explicit ref/commit for workflow dispatch. Use prerelease=true and make_latest=false, wait for CI artifacts and inspect resulting release. No production hosting change.

## Model routing
Lead inherited model/effort; ARCH architect role default (gpt-5.4-mini/high); implementation executor role default (gpt-5.5/medium), MEDIUM/STANDARD; final review code-reviewer role default (gpt-5.5/high), CRITICAL/PREMIUM requested, strongest supported fixed reviewer role. Explorer lookup unavailable (unsupported spark for account); leader handles local lookup. No global model config changed.

Contract review amendments: preview userData explicit in both dev/package, all native install ids separate; same branch:// scheme retained for compatibility so preview instructions recommend QR/manual pairing. Export display headers updated, format markers and existing Anki deck names retained. Headless octobooks alias intentionally shares legacy server data location and is not started by preview app.
