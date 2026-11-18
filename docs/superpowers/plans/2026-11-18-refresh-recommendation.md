# Manual daily recommendation refresh

User explicitly requests a refresh button, superseding the earlier no-replacement rule for this manual action only. Keep version 1.1.1 and existing uncommitted work. Use existing subscription search, bounded cancellation and validated citations.

Design: show refresh on a ready card, retain the previous card while searching and on error/cancel. Manual refresh excludes the current URL, replaces today's SQLite record only after successful validation, and never changes bookmarks or imported articles. Automatic ensure/retry still uses today's cached record. Share in-flight work and prevent late/cross-day writes. No confirmation needed: user authorized this feature and delegated routine choices.

- [x] Failing coordinator regression for refresh replacing/persisting, exclusion, error/cancel/same URL preserving old result and bookmark.
- [x] Store replace only on manual refresh; provider exclusion input; separate restricted IPC/preload method.
- [x] Button/loading/cancel/error UI, keep auto-cache and bookmarks.
- [x] Source and packaged desktop tests, docs, canonical Windows build/installer update with old artifacts preserved.

Verification: 31 core tests passed, typechecks and production build passed. Source/final packaged/canonical-path desktop suites passed, including manual refresh, exclusion input, bookmark preservation, same URL rejection, failure/cancel preservation and restart. Closing-during-refresh regression fixed and tested. Read-only review found no important issues. Version stays 1.1.1, canonical installer and full bundle updated with archived prior artifacts and matching hashes. No commit or real subscription usage added.
