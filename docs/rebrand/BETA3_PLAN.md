# OctoBooks beta 3 icon and sidebar

Status: complete. Source8ab5be3, release v0.20.0-beta.3; local checks, independent review, iOS simulator build, exact-source CI, seven release assets and downloaded-distribution smoke verified. See VALIDATION.md for evidence and explicit platform limits.

Scoped feature, 2026-10-16. Worktree /private/tmp/octobooks-preview on preview/octobooks; baseline 377ec60. Main remains untouched. User explicitly authorized commit, push and beta release.

## Outcome and contracts
- Use the approved cap-and-pencil PNG as the canonical raster master, preserving its content. Generate desktop, web, mobile launcher/adaptive, tray and splash assets through the existing icon script; no new dependency.
- UI asset contract: packages/ui/src/assets/octobooks-icon.png (generated at 256px from canonical master). Shared OctoMark displays it; sidebar uses a 32px box (smaller than existing 40px) with exact adjacent wordmark OctoBooks. Keep controls, navigation, preview install IDs, data and palette behavior.
- User's new wordmark request supersedes docs/rebrand/DESIGN.md icon-only restriction. Do not broaden naming changes throughout unrelated text.
- Follow-up: increase readability of all five palettes in light/dark; strengthen Ocean toward blue rather than pale teal. Preserve palette identifiers, persistence and app data. Check token contrast for text/primary actions and review actual screens.
- Prepare 0.20.0-beta.3, Android/iOS build23. Existing GitHub beta tag workflow builds macOS/Windows/Linux/Android, prerelease=true and make_latest=false. No merge to main or App Store/TestFlight work.

## Ownership / dependencies
1. Leader: canonical asset, scripts/gen-icons.mjs and generated platform assets, version files, docs, validation and GitHub release.
2. Executor: shared OctoMark and Sidebar only; use the agreed generated UI PNG. No asset/version/release edits. Reader/reviewer separate from implementation.
3. Independent reviewer: final delta and release-readiness audit, read-only.

## Verification and stop
Run fresh typecheck, lint, unit tests, existing appearance/core E2E, targeted screenshot checks of desktop/mobile/tablet branding, icon sizes/alpha and deterministic generator checks; build and launch packaged macOS Preview in isolated data. Run native builds through existing Release CI and verify published tag source, assets, prerelease/latest policy. Stop only with published next beta and verified CI or explicit external blocker. Persist evidence in docs/rebrand/VALIDATION.md and docs/PROGRESS.md.

## Complexity and routing
MEDIUM implementation / STANDARD-medium, leader effective model session default. Legacy explore/executor defaults were unavailable for this account, so implementation stayed with the leader. Independent ce-correctness-reviewer ran on supported gpt-6.1-sol/high and approved the final delta after the Android safe-area correction. Runtime orchestration modes not needed. No dependencies added; no cleanup/refactor lane.
