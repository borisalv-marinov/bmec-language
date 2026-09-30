# Personal Reading Queue

This small custom app starts from BMEC's generated project and adds one
developer-owned model, two authenticated routes, and a composed form/list UI.
The account owner comes from the verified server-side principal. The request
body contains only a title; it cannot choose an owner.

Start a project with `bmec new my-app`, then copy this `main.bmec` into the
new project. Use the [step-by-step walkthrough](../../docs/CUSTOM_APP_READING_QUEUE.md)
for the source progression, local account setup, checks, run, release build,
and current page-refresh behavior.

The owner-isolation acceptance test runs with two separate accounts and
SQLite. It verifies anonymous denial, server-controlled ownership, rejection
of a forged owner field, and that each account reads only its own book.

```sh
node dist/cli/index.js check examples/reading-queue/main.bmec --json
node dist/cli/index.js fmt examples/reading-queue/main.bmec --check
npm test -- --run tests/reading-queue.test.ts
```
