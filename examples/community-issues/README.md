# Community Issues

A bounded repository and issue tracker built in BMEC. The example now includes
a browser sign-in page, an authenticated issue list with server-side title or
description search and 50-row cursor navigation, a repository chooser with
slug-based scoped issue pages and scoped search, and typed issue-detail links
through generated integer IDs.

From the repository root:

```sh
node dist/cli/index.js check examples/community-issues/main.bmec
npm test -- --run tests/community-issues.test.ts
npm run test:community-issues-browser
```

The SQLite HTTP integration checks anonymous denial, role restrictions, issue
and comment creation, repository filtering by ID and slug, literal text search,
scoped search cursors, and maintainer-only status changes. The Chromium flow
signs in through BMEC's HttpOnly session cookie, browses a selected repository
across 50/50/35 cursor pages with no foreign issues or duplicates, then searches
within that repository and traverses 50/50/26 results without losing scope.
Clearing search restores the selected repository's first page. The flow then
returns to global browsing and checks the same 50/50/26 global search, including
description-only hits and empty/end/error states. It opens a generated-ID detail
page, posts a comment attributed to the signed-in reporter, confirms the
reporter cannot change status, and confirms a maintainer can.

Scope: this is not a GitHub replacement. It has no Git integration, pull
requests, audit history, or atomic multi-table transactions. Search is a
case-sensitive literal substring over title or description, including ordinary
percent and underscore characters. The browser list and new search routes read
at most 50 records per request; the older `/issues/search?term=` compatibility
route remains capped at 100. Updates still accept a complete issue record.

The optional disposable PostgreSQL route check can be run separately with
`BMEC_POSTGRES_DISPOSABLE=1 node scripts/community-issues-postgres-e2e.mjs`
and an explicit `BMEC_POSTGRES_URL`. It creates and drops a random schema,
checks repository-scoped issue/search cursors and role boundaries, and does not
claim Git/GitHub integration, hosted service behavior, or production performance.