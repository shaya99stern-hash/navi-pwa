# Navi Soul checkpoint — 2026-09-08

## User direction

Preserve the existing NaviOS UI and design. Improve the engine underneath it. Use free routing by default, reserve stronger inference for complex work, and keep provider identities out of ordinary conversation. Latest instruction: copy the work, push and merge, then checkpoint. Do not restart a broad redesign before completing this release.

## Release

- Repository: shaya99stern-hash/navi-pwa
- Release PR: https://github.com/shaya99stern-hash/navi-pwa/pull/135
- Branch: feat/sovereign-engine-integration
- Previous verified production: 9b3d99a9189d6093c1cbcf2c26ed2cadd6e83f67 (PR 134).
- Fix commits: 632073190516bde4032127125c6a2daf1e044c2d and 3f708289556523287ad5af2d048425280b83ca2d.
- This checkpoint is committed before merge. Read PR 135 and current Vercel deployment for the final merge SHA; do not treat the previous production SHA as current.

## Root application fixes

1. Artifact acceptance and repair instructions now remain in the exact prompt blocks sent after preflight. Previously they were measured and then silently discarded.
2. Artifact output reserve remains 2,400 tokens when the task is also classified as code. Optional reference blocks yield room before the route is skipped.
3. Walkable museum requests receive the existing NaviScene spatial renderer contract.
4. Buffered artifact generation only offers tools with server executors, preventing an invisible client-only tool call from stranding generation.
5. Premium speech requests the existing PCM-to-WAV synthesis path consistently. A live test of the earlier MP3 selection still failed playback; the WAV change requires a production retest.

## Preserved engine

`engine/navisoul/` contains the clean-room Astro engine source, lockfile, and tests. It is intentionally excluded from the root Next.js compilation and deployment. It is NOT yet wired into the production UI. No credentials, dependencies, generated runtime bundles, or build output were copied.

Core files: lib/ai/router.ts; lib/tools/mcp-bus.ts; lib/streaming/parser.ts; lib/workers/document-parser.ts; components/ArtifactCanvas.astro; lib/sandbox/runtime.ts. Additional code covers registry configuration, document retrieval and embeddings, local persistence, and test fixtures.

## Verification recorded

- Root artifact/budget regressions passed; release agent reported all 116 existing test files passed and local build succeeded before the WAV addition.
- WAV container/sample checks passed. Root typecheck passed after the WAV and source-preservation changes. Final-head CI remains the release gate.
- Clean-room Astro check: 23 files, zero errors/warnings/hints. All 13 tests passed. Production build completed successfully.
- Local browser: React and Vue counters incremented; Mermaid rendered; isolated JavaScript returned 42.
- Live production microphone: permission granted, running 48 kHz AudioWorklet capture, detected sound, 63,532-byte 16 kHz WAV, transcription endpoint responded. No sustained spoken conversation was verified in this run.

## Required next verification and integration

1. Confirm PR 135 merged, final production deployment READY, aliases assigned to navikeep.org, and the deployed SHA.
2. Repeat the live prompt: "Create an interactive walkable museum artifact about Jewish scholars from 1100 to 1800. Include exhibits, movement, and readable details." Verify actual movement, exhibit details, and room navigation. The previous deployment returned a slideshow, so successful rendering alone is insufficient.
3. Test Settings > General > Voice > Test speaking voice. Require actual premium success; device fallback is not premium verification.
4. Integrate engine modules into the existing UI incrementally. The source snapshot itself does not activate the new engine. Complete document-worker/PDF browser verification, context handling, sandbox runtime repair, and local-first storage wiring before claiming them live.
5. Google sign-in was deferred by the user until the basics work. Full GitHub/Vercel actions, Deeds/Grant capabilities, third-party connectors, and sustained voice conversation still need end-to-end checks.

Do not claim unlimited free inference, frontier-model parity, universal plugin availability, or completed integration based on source files or configured credentials. The user values live evidence over file counts.

## Workspace recovery

Original editable engine: ../navisoul-engine. Root checkout: work/navi-pwa under the finish-x20 workspace. Hundreds of files show line-ending-only status changes; stage explicit files and inspect actual diffs. Do not indiscriminately stage the repository. The release subagent hit its usage limit; finish release directly if it remains unavailable.
