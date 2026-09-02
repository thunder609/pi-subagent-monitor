# Tasks: subtask-id-detail-panel

## Review Workload Forecast

| Field | Value |
| --- | --- |
| Estimated changed lines | ~480 total (PR 1 ~150, PR 2 ~330) |
| 400-line budget risk | Low after split |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (foundation + theme + viewMode + harness) → PR 2 (drawer + wiring + docs) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

```text
Decision needed before apply: No (resolved by split)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Low
```

The forecast was ~480 LoC with Medium risk. The parent resolved the decision by splitting into two stacked PRs. PR 1 is foundation only (~150 LoC): Vitest setup, theme module + spec, `ViewMode` rename + alias + spec, harness signature fix + new parent/child fixture. PR 2 is the user-visible migration (~330 LoC): the `TaskDetailDrawer` component + spec, the controller / monitor wiring, README and changelog, and the version bump.

Each PR stays under the 400-line budget on its own. PR 2 targets the tip of PR 1's branch (`stacked-to-main`). No `size:exception` is needed.

## Strict TDD mode

`openspec/config.yaml` declares `strict_tdd: true` with runner `vitest`. Every implementation step below follows RED → GREEN → TRIANGULATE → REFACTOR and only commits when `npm test` is green for the affected spec. The runner is `npm test`.

## Task list

Work units are grouped by file / concern and ordered by dependency. Each implementation task ends with `<!-- sdd-owner: implementation -->`. Parent-only actions are listed separately at the end.

Tasks are split into two stacked PRs:

- **PR 1 — Foundation.** Vitest setup, theme module + spec, `ViewMode` rename + alias + spec, harness signature fix + new parent/child fixture. Targets main directly. Branch name suggestion: `feat/sdd-subtask-id-detail-panel-pr1`.
- **PR 2 — Drawer + wiring + docs.** `TaskDetailDrawer` component + spec, controller / monitor wiring, README and changelog, version bump. Targets the tip of PR 1's branch (`stacked-to-main`). Branch name suggestion: `feat/sdd-subtask-id-detail-panel-pr2`.

### PR 1 — Foundation

- [x] Add Vitest devDeps (`vitest@^2`, `@vitest/coverage-v8@^2`) and npm scripts (`test`, `test:watch`, `test:coverage`) to `package.json`. <!-- sdd-owner: implementation -->
- [x] Add `vitest.config.ts` at the repo root with `environment: 'node'` and `include: ['src/__tests__/**/*.spec.ts']`. <!-- sdd-owner: implementation -->
- [ ] Create `src/__tests__/fixtures.ts` with pure builders for `SubagentTask`, `SubagentEvent`, and `SessionLine` arrays (no SQLite). <!-- sdd-owner: implementation -->
      Deferred to PR 2: drawer spec will need fixtures; PR 1 specs do not.

### Theme module

- [x] RED: write `src/__tests__/theme.spec.ts` covering the `detectTheme()` matrix (`COLORFGBG` with dark/light foregrounds, `TERM` `*-light`, default). <!-- sdd-owner: implementation -->
- [x] GREEN: implement `src/theme.ts` exporting `detectTheme()` and `themeColors(theme)`. <!-- sdd-owner: implementation -->
- [x] TRIANGULATE: extend the spec with malformed `COLORFGBG` (non-numeric, missing `;`) and conflicting hints (dark fg + light term). <!-- sdd-owner: implementation -->
- [x] REFACTOR: extract pure decision tables; no console output in the module. <!-- sdd-owner: implementation -->

### ViewMode type alias

- [x] RED: write `src/__tests__/view-mode.spec.ts` asserting `ViewMode` narrows on `"drawer"` and that the deprecated `"detail"` alias constant exists. <!-- sdd-owner: implementation -->
- [x] GREEN: rename `ViewMode` value in `src/types.ts` to `"list" | "drawer"`; export `VIEW_MODE_DETAIL_ALIAS: "detail"` with JSDoc `@deprecated`. <!-- sdd-owner: implementation -->
- [x] TRIANGULATE: assert assignment from a string literal at compile time. <!-- sdd-owner: implementation -->
- [x] Migration shim: update the 3 internal references in `src/index.ts` (`viewMode === "detail"` / `viewMode = "detail"`) to `"drawer"` so `tsc --noEmit` stays green. Logic untouched. <!-- sdd-owner: implementation -->

### PR 2 — Drawer + wiring + docs

### Drawer component (PR 2)

- [ ] RED: write `src/__tests__/task-detail-drawer.spec.ts` covering header full-id display, `c` stage in footer, `Esc`/`b` close, parent/child navigation including no-op when missing, narrow-width fallback (drawer width 80), dark default, light-theme hint, tool-call table rendering, totals correctness, scroll behavior with `followTail`. <!-- sdd-owner: implementation -->
- [ ] GREEN: implement `TaskDetailDrawer` class in `src/index.ts` (next to `ProjectedLogComponent`) with `Component` interface. Reuse the file's existing box helpers. Tool-call rows derived from `liveSessionLines` (`kind === "call"` paired with the next `kind === "result"` if present). <!-- sdd-owner: implementation -->
- [ ] TRIANGULATE: more shapes — completed task with no JSONL tail (event log fallback), running task with two live updates, completed task with mixed tool results. <!-- sdd-owner: implementation -->
- [ ] REFACTOR: extract a private `deriveToolCallTable(lines)` helper; ensure `render(width)` returns lines of exactly `width` visible columns (assert in spec). <!-- sdd-owner: implementation -->

### Wiring (PR 2)

- [ ] RED: extend `task-detail-drawer.spec.ts` (or add a small integration spec) that asserts `SubagentMonitorComponent.openDrawer(task)` flips internal `drawerOpen` to `true` and that `tick()` propagates `liveSessionLines`/`detailEvents` to the drawer. <!-- sdd-owner: implementation -->
- [ ] GREEN: rework `SubagentMonitorComponent` so `Enter` opens the drawer instead of switching `viewMode` to `"detail"`; rename `viewMode` value to `"drawer"`; add `drawerOpen` / `drawerTaskId` state; delete the `renderDetail` body. <!-- sdd-owner: implementation -->
- [ ] TRIANGULATE: spec the "selected subtask disappears" scenario — drawer closes, list returns to clamped index. <!-- sdd-owner: implementation -->
- [ ] GREEN: rework `MonitorController`: remove `expand()`/`collapse()`; add `openDrawerFor(taskId)` and `closeDrawer()` methods managing an `OverlayHandle` with anchor `right-center`, width `"48"`, `minWidth: 48`, `maxHeight: "100%"`. When `termWidth < 96`, hide the side panel overlay for the duration. <!-- sdd-owner: implementation -->
- [ ] REFACTOR: collapse duplicated key handling between list and drawer paths into a single `handleInput` switch. <!-- sdd-owner: implementation -->

### Harness fix (PR 1)

- [x] Update `test-harness/simulate-tree.ts` to call `db.createTask(cwd, agent, mode, sessionId?, nestedSessionPath?)` and `db.addEvent(taskId, status, activity?)` with positional args, matching `subagent-db.ts`. <!-- sdd-owner: implementation -->
- [x] Add a new fixture script `test-harness/fixture-parent-child.cjs` (or `.ts`) that seeds a parent + child subtask pair so drawer parent/child navigation can be smoke-tested manually. <!-- sdd-owner: implementation -->
- [x] Note: `simulate-tree.ts` still calls `db.logUserMessage/logToolCall/logThinking/logAssistantMessage/logToolResult` which do not exist in `subagent-db.ts`. Out of scope; recorded as tech debt. `tsc --noEmit` still green because `tsc` only covers `src/`. <!-- sdd-owner: implementation -->

### Versioning and changelog (PR 2)

- [ ] Bump `package.json` version `0.8.0` → `0.9.0`. <!-- sdd-owner: implementation -->
- [ ] Create `openspec/CHANGELOG.md` with an entry documenting the `ViewMode` rename, the new drawer surface, and the `expand()` / `collapse()` removal. <!-- sdd-owner: implementation -->
- [ ] Update `README.md` "Panel controls" and "Use as a library" sections to reflect the new drawer keys and the deprecated alias. <!-- sdd-owner: implementation -->

### Verification gate per PR

PR 1 verification:

- [x] Run `npm test`, `npm run typecheck`, `npm run build`. All exit 0. <!-- sdd-owner: implementation -->

### Parent-owned lifecycle actions

- [x] Stop before apply if the cumulative diff after the "Wiring" group crosses ~280 LoC; surface the split-vs-proceed decision per `delivery_strategy: ask-on-risk`. <!-- sdd-owner: parent --> Resolved: split into two stacked PRs after forecast exceeded single-PR budget; `chain_strategy: stacked-to-main`.
- [x] Run `gentle-ai sdd-attempt acquire` with `--max-attempts 1` and `--max-changed-lines 600` immediately before the first apply write; route on `proceed|blocked|complete`. <!-- sdd-owner: parent --> Acquired PR 1 scope (token `sha256:ef719621…`); routed `proceed`.
- [ ] Run `gentle-ai sdd-attempt settle` after the last task commits, with the SHA-256 evidence revision of the apply commit and a brief diagnosis. <!-- sdd-owner: parent -->
- [ ] Re-read `sdd-orchestrator-workflow.md` "Native Runtime Attempt Authority" before invoking acquire / settle. <!-- sdd-owner: parent -->

## Verification commands

```bash
# PR 1
npm run typecheck
npm test
node test-harness/init-db.cjs && node --import tsx test-harness/fixture-parent-child.ts   # smoke (new fixture)

# PR 2
npm run typecheck
npm run build
npm test
```

## Rollback strategy per PR

- PR 1 (foundation): revert the PR commit. No schema migration; consumers keep their existing build.
- PR 2 (drawer + wiring): revert the PR commit. Because PR 1 already renamed `ViewMode` to `"list" | "drawer"` and exported the deprecated alias, reverting PR 2 leaves consumers on the new type but without the drawer surface (still additive; the legacy `"detail"` alias still works).