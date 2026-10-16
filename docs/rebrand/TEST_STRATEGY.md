# octobooks verification

- Core behavior: existing pnpm test; no schema/protocol changes intended.
- Type/static: pnpm typecheck, pnpm lint, git diff --check.
- Build: pnpm build; pnpm --filter @branch/desktop package:dir with isolated worktree and temporary runtime user data. Android/iOS builds delegated to existing platform CI where possible.
- New behavior: palette id validation, unavailable storage fallback; select every theme, change appearance independently, reload, check CSS/meta and persistent local selection; remote settings usable without pairing and unaffected by host sync.
- Regression: existing branch/selection, split/mindmap, vault, backups and onboarding E2E. Capture desktop/mobile/tablet screenshots and review.
- Release: reviewed commit only; preview branch and v0.20.0-beta.1 tag; GitHub prerelease, latest=false; CI artifacts match octobooks labels. Smoke packaged macOS Electron with temporary user data. Record platform CI results and unsigned/notarization limitations accurately.
- Isolation: compare main SHA e0a9a6259685cb03c949477be606bbe3ccce0430 and original checkout git status before and after. Never start stable packaged app or modify its data.
