# NaviOS cohesive audit — 2026-08-26

Branch: `audit/navios-cohesive-rebuild-2026-08-25`

This branch is intentionally review-only. Do not merge or promote it until the mobile visual, build, artifact, and intelligence gates below pass.

## Source of truth

The production screenshots report build `7ceaf8f`. The later `f9915ad` "master overhaul" wrote a second app under `src/` while the real product continues to live under root `app/`. That split lets a commit look like a full redesign while touching the wrong application tree. The first repair in this branch removes that divergent legacy overhaul and restores the previous `src/` files so the branch can build again.

## P0 product defects

- **Composer discontinuity:** the empty-chat state changes the composer from the normal flex surface into a separate grid. The first send therefore looks like a new composer appears. Fix: one component geometry before and after the first turn.
- **Routing truth:** Auto / Deep / Team are Navi Soul orchestration modes, not underlying model names. The picker must say so. Provider pins belong in Diagnostics.
- **Settings selection state:** Motion and Density paint every option as selected because a non-empty string is tested instead of `value === option.id`. Semantic `aria-checked` is already correct; the visual state must follow it.
- **Account copy:** the Settings profile card says "Apple Account, iCloud, and more" even though NaviOS is not an Apple system surface. Replace with truthful NaviOS account/workspace language.
- **Connector information architecture:** personal accounts, AI provider keys, deployment credentials, MCP servers, and arbitrary APIs are mixed into one screen. Split into Connected Apps, AI Providers, and Developer & Infrastructure.
- **Artifacts:** a request such as "Create an interactive car driving simulation" must produce one working artifact, open it, preserve it in history, and never leak raw artifact protocol JSON.

## Intelligence and speed gates

Measure separately:

1. tap → request dispatch
2. request → first visible token/status
3. first visible token → completion
4. end-to-end task success

Navi Soul already has local routing, provider planning/fallbacks, health ordering, tools, memory, retrieval, council synthesis, and verification. The next architecture pass should make that pipeline explicit rather than continuing to grow one giant chat route.

## Review gates before merge

- Typecheck and production build pass.
- iPhone home composer and active-chat composer have continuous geometry.
- Auto / Deep / Team labels and Effort are understandable without knowing provider internals.
- Motion/Density show exactly one selected state.
- No Apple/iCloud account claim remains.
- Artifact regression passes with a real interactive artifact.
- No direct production deployment from this branch.
