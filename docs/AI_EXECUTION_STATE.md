# BMEC 0.9.1-beta.3 execution checkpoint

Updated 2026-10-02. This public candidate is based on the current public `main` and is a new prerelease candidate after `0.9.1-beta.2`; it does not relabel the older `0.8` branch. Private repository history, credentials, and raw evidence are not included.

## Completed in this candidate

- Filter knowledge matches by category before limiting results. Add `bmec ai context` and authentication workflow records; cover both discovery commands at small limits.
- Add a generated local starter recipe that enters the created project before checking, building, testing, and running. Its empty-directory test confirms an HTTP response.
- Reject malformed performance-gate inputs, missing measurements, nonfinite or negative timings, and invalid bundle sizes while preserving existing regression thresholds.
- Clarify default local development without users versus configured synthetic local users; document commands and environment behavior.
- Correct the benchmark description: the app's CRUD operations are separate writes, not one transaction. Add bounded browser/app measurements for representative data, repeated interactions, and concurrent reads; SQLite was measured. PostgreSQL support requires an explicitly disposable database.
- Fix static-file symlink traversal and readiness-rate-limit bypass, with regressions. Cache validated parsed integer literals in the interpreter.
- Add a home-page interpreter performance ranking with method and scope, and update the website benchmark page. Preserve the browser compiler/runner, graph identifiers, and current showcase features.
- Align project metadata, documentation, download names, generated AI metadata, and website copy to `0.9.1-beta.3`. Package archives are built for the website only; no npm or Marketplace publishing occurred.

## Acceptance results

- `npm run build`: passed.
- `npm test`: 1,278 passed, 7 skipped; 133 test files passed, 2 skipped.
- `npm run test:native`: 75/75 differential cases passed.
- `npm run test:fuzz`: 12/12 fuzz properties passed.
- Documentation coverage: 41 capability areas, 41 compiler constructs, 104 standard-library symbols, 8 host capabilities, and 12 mapped examples.
- Package smoke: installed the generated tarball, created a project, passed doctor/check/release, and served the local app.
- Examples: 32 source files passed; the intentional invalid fixture was diagnosed.
- Security gate: 0 dependency vulnerabilities; 177-component CycloneDX lockfile SBOM; 133 release files checked for source/test/secret paths.
- HTTP regressions: readiness throttling and static symlink escape tests passed.
- Community Issues browser smoke on SQLite: login, owner isolation, CRUD, search, pagination, invalid/no-access operations, repeated UI actions, concurrency, and SQLite restart persistence passed. Synthetic data: 135 issues, 126 search matches, 32 foreign-repository rows. Bounded run: 5 repeated search actions; 8 concurrent requests across 3 waves. List p50 2.776 ms; search p50 2.457 ms; concurrent authenticated reads p50 27.490 ms / p95 32.027 ms. Local measurements only, not an SLO.
- Interpreter ranking run: Windows x64, Node 24.18, 200,000 iterations per workload, one warm-up and five samples. Medians: Counter 27.355 ms (46.6% lower than 51.221 ms baseline); Checksum 45.105 ms (34.6%); Function calls 75.156 ms (32.4%); Collection 118.196 ms (24.8%). These are local interpreter-only measurements.
- Website build and browser smoke: passed at 360, 768, 850, and 1440 px. The generated `/downloads/` page links to the two manifest-verified candidate archives and shows their SHA-256 values; its mobile checks confirm wrapping and no overflow. Site and playground axe scans reported zero violations, and the playground exercised the real browser compiler, keyboard focus, and local-only request boundary.
- Application accessibility automation: passed at mobile, tablet, and desktop, including keyboard, table, touch, and reduced-motion checks.
- Independent final review approved commit `616bc5e3692e0f43197ed6356eee07205c7027c3`, its generated artifact, package contents, acceptance evidence, and fixes from live smoke findings.
- Vercel prebuilt artifact: `website/dist` and `.vercel/output/static` matched byte-for-byte across 141 public files. No private evidence or secret paths were present; only the intended versioned CLI archive and VS Code extension are offered as website downloads.
- Production website: `https://bmec-language.vercel.app/` now serves `0.9.1-beta.3` from deployment `dpl_G749JRz7z9trzfQeUqpn8tptRMGV`, built from commit `616bc5e3692e0f43197ed6356eee07205c7027c3`. The feature branch commit was pushed and matched the remote before deployment. Live checks passed for 12 routes, 9 AI catalogs and schemas, documentation, candidate metadata, both downloads, and the interactive playground. Home and playground axe scans returned zero violations at 360, 768, and 1440 px; there was no overflow, console error, or failed HTTP response. The existing `0.9.1-beta.2` deployment `dpl_FKcEVdKckohwEwZZ9WEjDjEXJJTc` remains available for rollback.

## Pending / limitations

- PostgreSQL app benchmarks and the containerized fresh-deployment check remain unverified: there is no `BMEC_POSTGRES_URL`, local PostgreSQL service, or `psql`, and the current user cannot access the WSL Docker daemon socket. The opt-in benchmark also requires an explicit disposable-database flag. The clean packaged local app smoke passed; no PostgreSQL or container evidence is claimed.
- Human onboarding and a real screen-reader session have not been performed. Automated accessibility checks do not replace those sessions.

## Next actions

- [x] Run the final website, documentation, package, full test, examples, and security checks after the final code changes.
- [x] Resolve independent-review findings, push the feature branch, and deploy only the regenerated public Vercel artifact.
- [x] Verify the production alias, deployed candidate, live routes and metadata, downloads, responsive layout, console, and accessibility checks; keep the prior deployment as rollback.
- [x] Record the delivered commit, deployment URL, results, and remaining limitations in this checkpoint.
