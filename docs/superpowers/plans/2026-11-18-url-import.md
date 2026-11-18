# URL-only article import

User explicitly requested fixing URL-only add/save so the resulting article is readable and analyzable. Keep version 1.1.1, existing articles and speaking project untouched.

- [x] First test HTML extraction, paragraph preservation, no script execution, empty/paywall rejection, public DNS restrictions and URL-only input validation; review redirect validation.
- [x] Implement electron/article-import.ts with script-free DOM/Readability parsing and a bounded, cancellable HTTP client. Resolve and pin public DNS addresses; revalidate redirects. No credentials, cookies, browser login or AI reconstruction.
- [x] Integrate article:add: fetch only when body is blank, use user title or extracted title, validate the complete Article before saving. Cancellation never saves a late result.
- [x] Permit empty title/body only for URL import in the modal; preserve fields on failures, show fetching state/cancel. Keep manual paste behavior.
- [x] Verify core/typecheck/build, URL-only -> read -> select -> analysis desktop flow and real public article; update README and both canonical executable/installer locations with archived prior artifacts.

Limits: 25 seconds, 2 MiB decoded HTML, five redirects, 200,000-character article; retain current 60,000-character AI analysis limit. Only plain text reaches the renderer. Do not bypass paywalls or JS-only restrictions.

Review follow-up: moved JSDOM/Readability into a memory-bounded worker; cancellation terminates parsing without blocking main IPC. HTML meta charset is honored. All 28 tests, source and packaged desktop flows passed; actual public NASA extraction and worker cancellation passed. Canonical bundle and installer updated with SHA-256 verification; previous canonical artifacts archived under release/_build-temp/before-url-import-20261118/. Version unchanged.
