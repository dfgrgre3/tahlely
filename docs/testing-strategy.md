# Testing Strategy (v0.1.0)

## Categories

- **Unit** — pure logic: ids/errors, policy evaluation, path guard, secret
  redaction, ignore matcher, config merge/validate, LRU/content cache, logger
  redaction, line diff, report builders.
- **Integration** — module interaction over real seams: analysis engine over
  fixture projects (all five built-ins fire), agent service against the mock
  provider (approval/denial paths), executor spawning real allowlisted
  commands (output, timeout, emergency stop), JSON repositories on temp dirs,
  full store flow (demo → analysis → report → chat).
- **Contract** — `tests/contract/boundaries.test.ts` enforces layering
  (allowed workspace deps, no React in packages, no `node:` in browser-safe
  modules, domain free of platform imports). Fails the build on violations.
- **Security** — traversal/sibling-prefix/null-byte rejection, metachar
  rejection, non-allowlist denial, subcommand denial, fail-closed unknown
  permissions, approval-required-by-default agent tools.
- **Regression** — the suite itself; every fix in Prompt 1 added or corrected
  a test (ignore descendants, memory-FS dirs, metachar position, id brands).
- **Performance** — caps and budgets asserted structurally (indexer
  `maxFiles`/`maxFileSizeBytes`, context budgets, diff input bound);
  dedicated large-repo benchmarks land with the Rust sidecar (Phase 2).
- **E2E (desktop)** — deferred to Phase 2 (Tauri driver + seeded workspace);
  the store flow test covers the same user journey headlessly today.

## Gates

```powershell
npm test            # 60 tests, must all pass
npm run typecheck   # strict TS incl. noUncheckedIndexedAccess, no unused locals
npm run lint        # eslint, --max-warnings 0
npm run format:check
npm run build       # tsc + vite production bundle
```

## Conventions

Colocated `tests/` per package plus `tests/contract`. No network, no DOM, no
timing flakes (abort/timeout paths use small real timers). Tests import
`node:` freely; `src/` browser-safety is enforced by the contract test.
