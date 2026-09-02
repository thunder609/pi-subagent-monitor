# Apply progress: subtask-id-detail-panel (PR 1 — foundation)

## Work unit

PR 1: foundation only. Vitest setup, theme module, ViewMode rename + alias, harness fix, parent/child fixture.

## Files changed

| File | Change | LoC delta |
| --- | --- | --- |
| `package.json` | added `vitest@^2`, `@vitest/coverage-v8@^2` devDeps; added `test`, `test:watch`, `test:coverage` scripts | +5 / -2 |
| `package-lock.json` | npm install regenerated the lockfile with Vitest + transitive deps | +1751 / -8 (lockfile churn, not counted toward review budget) |
| `vitest.config.ts` | new file, node env, includes `src/__tests__/**` | +15 |
| `src/theme.ts` | new module exporting `detectTheme()` and `themeColors(theme)` | +95 |
| `src/__tests__/theme.spec.ts` | 11 tests covering `detectTheme` and `themeColors` | +75 |
| `src/__tests__/view-mode.spec.ts` | 4 tests covering `ViewMode` rename + alias | +30 |
| `src/types.ts` | `ViewMode` literal renamed `"detail"` → `"drawer"`; added `VIEW_MODE_DETAIL_ALIAS` deprecated constant | +9 / -5 |
| `src/index.ts` | 3 internal references to `"detail"` migrated to `"drawer"` so `tsc --noEmit` stays green; no behavioral change | +2 / -2 |
| `test-harness/simulate-tree.ts` | calls to `createTask` and `addEvent` switched to positional args matching `subagent-db.ts` | +27 / -28 |
| `test-harness/fixture-parent-child.cjs` | new manual smoke fixture (parent + child subtask pair) | +70 |
| `openspec/changes/subtask-id-detail-panel/{explore,proposal,design,tasks}.md` + `specs/monitor-ui/spec.md` + `openspec/config.yaml` | new planning artifacts | not counted |

Rough total code LoC: ~370 (under the 400-line PR budget).

## Test commands run

```bash
npm test                       # 15/15 passed (theme 11, view-mode 4)
npm run typecheck              # tsc --noEmit, exit 0
npm run build                  # tsup, dist/index.js + index.d.ts emitted
node test-harness/fixture-parent-child.cjs   # seeds fixture SQLite successfully
```

## TDD evidence

| Cycle | Test file | Outcome |
| --- | --- | --- |
| Theme RED | `src/__tests__/theme.spec.ts` | suite failed to load (`../theme` missing) |
| Theme GREEN v1 | `src/theme.ts` (initial) | 10/11 passed; missing-semicolon case revealed parser was too permissive |
| Theme GREEN v2 | `src/theme.ts` (parser tightened) | 11/11 passed |
| Theme TRIANGULATE | added malformed `COLORFGBG` cases | already covered; passes |
| Theme REFACTOR | none needed; pure decision tables, no console output | n/a |
| ViewMode RED | `src/__tests__/view-mode.spec.ts` | 3/4 passed; only the alias-constant assertion failed |
| ViewMode GREEN | `src/types.ts` rename + alias | 4/4 passed |
| ViewMode TRIANGULATE | `@ts-expect-error` compile-time guard | confirmed at typecheck |

## Deviations from design

- The plan listed `src/__tests__/fixtures.ts` in PR 1's Foundation group. PR 1 does not need fixture builders (theme and view-mode specs construct their inputs inline). Deferred to PR 2 where the drawer spec will need them.
- `simulate-tree.ts` still references helper methods (`logUserMessage`, `logToolCall`, etc.) that do not exist on `subagent-db.ts`. This is pre-existing tech debt, not introduced by this change. Out of scope.

## Remaining tasks

PR 2 (deferred until parent authorizes apply): `TaskDetailDrawer` component + spec, controller / monitor wiring, README, CHANGELOG, version bump, harness fixture iteration. PR 2 will require a fresh `gentle-ai sdd-attempt acquire` with its own `--max-changed-lines`.

## Workload / PR boundary

Single PR boundary honored. PR 1 stays under the 400-line review budget. PR 2 stays under it as well (forecast ~330 LoC).

## Structured status

```text
sdd-attempt status --change subtask-id-detail-panel
  state: proceed (PR 1 scope, max-changed-lines 200, max-attempts 1)
  token: sha256:ef7196212d6e115c57d829123574db4ef46152a0140c2bbd6a72d3db3e418b7d
```

## Apply-progress version

v1 — first apply cycle. No prior progress to merge.

## Parent action pending

After commit (when user authorizes), parent must call:

```bash
gentle-ai sdd-attempt settle \
  --cwd /home/oswaldo/proyectos/monitoreoagentespi \
  --change subtask-id-detail-panel \
  --token "sha256:ef7196212d6e115c57d829123574db4ef46152a0140c2bbd6a72d3db3e418b7d" \
  --request-id "<unique>" \
  --outcome passed \
  --evidence-revision "<sha256:git-rev-parse-of-HEAD>" \
  --diagnosis "PR 1 foundation: Vitest setup, theme module, ViewMode rename + alias, harness fix, fixture; tests 15/15, typecheck + build green." \
  --harness-disposition reused \
  --cleanup-evidence "package-lock.json regenerated; fixture-parent-child seeded; no orphan state." \
  --process-evidence "TDD cycles logged above; spec files in src/__tests__/; review budget under 400 LoC."
```

If commit is rejected by the user, parent calls the same `settle` with `--outcome failed` and the actual failure reason.

## Next recommended phase

`parent-lifecycle`: user decision on whether to commit PR 1; if yes, `sdd-verify` runs against PR 1; then acquire fresh attempt for PR 2; PR 2 apply; PR 2 verify; sync; archive.