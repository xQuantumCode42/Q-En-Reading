# Article analysis comparison and recent reading

User requests rename Reading Assistant to Article Analysis, put its tab farthest right, show original at left while analyzing, remove redundant reading list and expand/fold recent reading. Routine choices delegated. Stay on 1.1.1, existing data and speaking untouched.

Design: Original / Chinese comparison / Article analysis tab order. Reuse the existing original reader in a flex split alongside the existing analysis inspector; no duplicate original text, preserve selection offsets and position. Replace always-present library grid with explicit Manage Articles modal for older article CRUD/search. Main navigation returns to active article or home. Recent reading expands to 50 / 30 days and a persistent native details collapse control; activity pruning never deletes articles/notes/bookmarks.

- [x] Change recent limit regression first, verify existing code fails, implement store limits.
- [x] Modal-only article management, collapsible recent reading, rename/reorder analysis and split reading panels.
- [x] Adapt desktop flows; verify tab order, original remains visible in analysis, split widths, no default reading list, folding persistence and access to older articles via management.
- [x] Core/typecheck/build/desktop, visual review, docs, Windows packaged/canonical verification and artifact archive. No version bump or automatic commit.

Validation: typecheck/build/format and 35 core tests passed. Source, final packaged, and canonical-path desktop suites passed, including rightmost analysis tab, source visible at left, modal-only manager, recents folding persistence, original selection changes while inference is pending, and existing subscription/backup/translation flows. Reviewed comparison screenshot; read-only review found no important issue. Version remains 1.1.1. Previous artifacts archived and canonical EXE/installer updated with matching SHA-256. No real subscription calls or Git commit added.
