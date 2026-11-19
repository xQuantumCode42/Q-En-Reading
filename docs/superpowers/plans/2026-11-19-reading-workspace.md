# Spacious reading workspace

User requests a narrower collapsible navigation, moving reading activity into it with cleanup, and central reading/assistant/full Chinese translation views. Routine choices delegated; retain version 1.1.1, privacy, content, bookmarks and current history. Continue current project; no changes to speaking.

Design: 176px expanded / 58px collapsed sidebar; recent reading max 8 within 14 days, automatic prune or explicit clear removes activity only, never article bodies/bookmarks. Article library becomes full-width management view accessible from nav. Reading occupies central space with top-right tabs for original, existing assistant, bilingual full translation. Selecting text exposes explicit analysis buttons; no selection or tab click triggers AI.

Full translation: split exact source into <=4,000 character chunks at paragraph/sentence boundaries; each is a new translation analysis kind, strict response containing only Traditional Chinese translation. Reuse bounded 90s requests, cache by article/model/offsets, backup validation, progress/cancel. Sequential explicit generation saves chunks as completed, retry resumes; translated content can display Chinese-only or original/Chinese pairs. Tab switch alone loads saved results. Original text remains untouched. Recent activity not included in content backups; sidebar collapse stored locally.

- [x] Failing recent cleanup/non-deletion and translation splitting/schema/provider-context tests.
- [x] Recent store/API + translation analysis mode, strict validation and cache integration.
- [x] Sidebar, central tabs, library manager and explicit resumable translation view.
- [x] Typecheck/build/core + desktop scenarios, visual checks expanded/collapsed/translation, review, docs and final Windows canonical bundle/installer update with archive.

Verification: 35 core tests passed; typecheck/build/format checks passed. Source, packaged and canonical-path Electron suites passed, covering existing acceptance flow plus collapse/width, recent cleanup, translation explicit request, partial failure/resume, cancellation, restart cache and backup validation. Visual screenshots reviewed; read-only review found no important issue. No real subscription use added; live translation quality/time remains for actual use. Version stays 1.1.1. Canonical full bundle/root installer updated after archiving previous artifacts and verifying SHA-256. No Git commit created.
