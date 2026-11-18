# Recommendation bookmarks

User requests one-click saving recommended articles. Continue in existing working tree with uncommitted related work; preserve version 1.1.1. User delegated routine choices and requested implementation, so no extra design approval gate.

Design: save the stored recommendation as a separate URL-keyed article bookmark, independent of body import and vocabulary favorites. Star card and favorites article section support save, remove, open and explicit import. Deduplicate by canonical public URL. Preserve recommendation snapshot; do not call AI or fetch on save. New optional validated backup field preserves old backup compatibility; merge retains local duplicate URLs, replace uses backup. Import errors retain bookmark. Keep existing paywall restriction; clarify metadata vs HTTP denial. Do not change speaking app or disclose private paths in product docs.

- [x] Add failing store tests for idempotency, restart, backup merge/replace and invalid duplicates.
- [x] Implement schema/store/IPC/preload, using stored day/URL only for external opening and saving.
- [x] Add card star and favorites article section; import explicitly via existing bounded importer.
- [x] Clarify payment metadata error and research free original-English sources.
- [x] Verify tests/build/source and packaged desktop, update docs and canonical Windows artifacts with previous artifacts archived.

Validation: 29 tests, typechecks/build, source and final packaged desktop passed. Desktop verifies restart persistence, bookmark-only backup restore, failed import preserving bookmark and retry. Read-only review found no important issues; screenshots checked. Updated canonical EXE and root installer after archiving prior artifacts; hashes match. NASA sample imports, NOAA sample HTTP access denied despite free browser reading. Version unchanged; no commit created.
