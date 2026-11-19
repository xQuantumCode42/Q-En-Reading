# Bookmark translation persistence

Bug report: translated bookmarked articles appear to lose translation. Code investigation: chunks auto-save, but bookmark reopening uses literal source URL equality (redirects create a second article), and translation display hides models other than current settings.

Fix: optional bookmark articleId and article importedFrom alias, repair old same-URL links without network and choose translated copy when legacy duplicates exist. Bookmark reader opens linked local ID, never re-downloads a linked body. Show persisted translation counts; provide explicit existing-article linking for legacy redirects that cannot be inferred safely. Translate output remains auto-saved; no redundant save button. Display saved model versions independently of current generation model. Backup validates/remaps articleId and deletion clears links. Keep 1.1.1, private content untouched.

- [x] Regressions for redirect bookmark lookup, model change visibility, backup/remapping and deletion.
- [x] Store/schema/API stable links and summary, optional import alias, model-independent saved-version selector.
- [x] Bookmark open/status/relink UI and desktop regression with redirect, changed model, restart, zero inference or download on reopen.
- [x] Full tests/build/packaged checks, docs and canonical Windows artifact update with archive.

Validation: 36 core tests plus typecheck/build passed. Source, packaged, and canonical desktop flows passed: redirected bookmark points to same local ID, saved translation count updates, changed preference model still displays old saved translation after restart, zero download/inference on reopening, linked bookmark can relink. Review identified merge-copy relinking gap; all bookmarks now expose relinking with translation counts. Screenshot checked. Canonical complete bundle and installer updated with archived previous artifacts and matching hashes. Version remains 1.1.1; no user data inspected, no real subscription use or commit added.
