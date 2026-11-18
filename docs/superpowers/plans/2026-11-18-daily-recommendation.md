# Daily recommendation implementation plan

> Execute inline using superpowers:executing-plans; use tests before production changes.

Goal: One source-grounded English recommendation per local date, mixed public news and saved websites.

Architecture: A main-process coordinator owns the daily cache, single-flight request, abort deadline and account boundary. A web-search provider uses existing OAuth and SSE transport. Renderer owns only presentation and website settings.

Tech stack: Existing Electron, React, TypeScript, SQLite and Zod; no new dependency.

Spec: ../specs/2026-11-18-daily-recommendation-design.md

## Constraints and review focus
Keep version 1.1.1 and speaking project untouched. Avoid private paths in docs. Reject nonpublic links and uncited/hallucinated results. A late response must not write after date/account changes or shutdown. Concurrent requests must converge on one record. Restores must not change today's fixed recommendation. Old backups remain readable.

## Tasks
- [x] Test local dates, public URLs, durable daily uniqueness, backup merge/replace, failure/retry and abort behavior in tests/recommendations.test.ts; watched missing-module and regression failures before implementation.
- [x] Implement shared/recommendations.ts, coordinator and provider in electron/recommendations.ts; extend Store backup with validated optional fields.
- [x] Integrate fixed IPC in main/preload/api. Auto-run only when subscription sharing is active; gate account changes/restores while busy and abort on shutdown.
- [x] Add src/DailyRecommendation.tsx and website editor, automatic startup/focus checks and visible retry/error/locked-day states. Keep current reading layout usable.
- [x] Run focused/core tests, typecheck/build and Electron fixture test covering startup login, source settings, search evidence, restart cache and browser opening. Review safety and actual package contents before completion.

## Ledger
Ruling: User's explicit request to start authorizes execution of the described workflow; do not ask again for design approval. No version bump or Git commit is implied. RSS fallback is deferred rather than misrepresenting model memory as search.

Verification: Real subscription search succeeded with matching source evidence. Packaged restart retained the daily record and made zero new search calls. Read-only review found no important issues; real-stream terminal-empty output required a regression-backed transport fix. Validation details are in VERIFICATION.md.
