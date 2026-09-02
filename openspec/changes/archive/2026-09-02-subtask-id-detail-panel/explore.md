# Explore: subtask-id-detail-panel

## Scope of change

Migrate the existing fullscreen detail view (`Enter` → `expand()` in `SubagentMonitorComponent`) to a persistent side drawer that lives next to the task list. The drawer exposes the full subtask `id` plus a copy affordance, parent/child navigation, the live execution stream (already parsed by `tailSession`), the recorded event log, and the final output preview.

In scope:
- New `TaskDetailDrawer` Component living to the right of the existing side panel (anchor: right-center, fixed 48 cols; falls back to fullscreen when terminal width < 96 cols).
- Theme auto-detection (dark by default, light when `COLORFGBG` or `TERM` hints at a light background).
- Wiring inside `SubagentMonitorComponent` so `Enter` opens the drawer instead of switching `viewMode` to `"detail"`.
- `Enter` while the drawer is focused jumps to the parent task (or first child if `Shift+Enter`).
- New Vitest setup with unit tests for the drawer's sections (id display, copy, navigation, scroll, theme).
- Removal of the `expand()`/`collapse()` fullscreen pathway from `MonitorController` (still keeping `ProjectedLogComponent` intact).

Out of scope:
- SQLite schema changes.
- `ProjectedLogComponent` behavior.
- Adding a short `id` badge in the task list cards (separate change).
- New commands/UI surface beyond key bindings.
- Persisting drawer selection across monitor restarts.

## Map of touched code

### `src/index.ts` (812 LoC, single file)
Hosts four classes and the `extension` entrypoint:
- `SubagentMonitorComponent` — list + (current) detail fullscreen, SQL read/write, key handling. Owns `viewMode`, `selectedTask`, `detailEvents`, `liveSessionLines`, `detailScroll`, `followTail`.
- `ProjectedLogComponent` — separate widget for the `P` projection flow. **Untouched.**
- `MonitorController` — wraps the monitor in a TUI overlay; owns `expand()`/`collapse()` (lines ≈420-440) that swap the side overlay for a fullscreen one.
- `extension(pi)` — registers commands and the `ctrl+q`/`alt+h`/`alt+s` shortcuts.

Render branches:
- `renderList` (lines ≈540-595): the right-side panel cards. Stays unchanged.
- `renderDetail` (lines ≈625-700): today emits the FULL detail body. This becomes obsolete; its data feeds the drawer instead.

### `src/types.ts` (155 LoC)
`SubagentTask`, `SubagentEvent`, `TaskNode`, `ViewMode = "list" | "detail"`. `ViewMode` becomes `"list" | "drawer"`. No DB shape changes; both shapes already carry `id`, `parentId` (via `taskTree`), `nested_session_path`, `result`, `error`.

### `src/db-path.ts` (74 LoC)
Untouched. The drawer reads the same DB path; no new resolver needed.

### `test-harness/` (5 files)
- `subagent-db.ts` (256 LoC): helpers to seed SQLite scenarios.
- `simple-test.ts`, `simulate-tree.ts`: smoke runners.
- `init-db.cjs`, `schema.sql`: minimal DB setup.
- **Pre-existing bug** to flag (not blocking): `simulate-tree.ts` calls `db.createTask({...})` with an object, but `subagent-db.ts` declares positional args. The harness is already broken at HEAD. Out of scope to fix here.

### `package.json`
- No `test` script, no `vitest`/`@vitest/*` devDeps. Adding both is required to meet `strict_tdd` and the agreed test runner in `openspec/config.yaml`.
- Bumping `0.8.0` → `0.9.0` is the natural SemVer step for a user-visible migration of a primary key surface.

## Existing contracts (library API)

`src/index.ts` exports (already part of the public API):
- `SubagentMonitorComponent`, `ProjectedLogComponent`, `MonitorController`, `extension`.
- Helpers: `tailSession`, `formatDuration`, `formatTokens`, `formatCost`, `modeBadge`, `buildTaskTree`, `DEFAULT_DB_PATH`, `DEFAULT_INTERVAL_MS`, `resolveMonitorDbPath`, `projectScopedDbPath`, `projectNameForCwd`.
- Types: `SubagentTask`, `SubagentEvent`, `ViewMode`, `TaskNode`, `MonitorDbMode`.

The new drawer must keep the exports additive — no removals beyond what `MonitorController`'s fullscreen swap becomes unused. Internal `viewMode` value `"detail"` becomes `"drawer"`. Because `ViewMode` is exported, this is a breaking type change. To minimize churn:
- `ViewMode = "list" | "drawer"` (was `"list" | "detail"`).
- Document the change in the changelog entry of `apply-progress.md`.

## Dependencies & build impact

- Add `vitest`, `@vitest/coverage-v8` as devDependencies.
- New npm scripts: `test`, `test:watch`, `test:coverage`.
- tsup config stays the same; the drawer is part of the single `src/index.ts` entry.
- No runtime dependency added (drawer uses existing `@earendil-works/pi-tui` primitives — `Component`, `matchesKey`, `visibleWidth`, box helpers already in the file).

## Risk register

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Review-budget: change likely crosses 400 lines | Medium | Run `sdd-tasks` review-workload forecast. If >400, surface split option before apply. |
| `ViewMode` rename breaks library consumers | Medium | Document in `proposal.md`; consider keeping `"detail"` as an alias for one release. |
| Theme detection guess is wrong on some terminals | Low | Default to dark; only flip to light when `COLORFGBG` matches a light scheme. No user override needed for v0.9.0. |
| Drawer + side panel both consuming right edge of a 72-80 col terminal | Medium | Hard rule: if `termWidth < 96`, drawer replaces the side panel temporarily while open. |
| Pre-existing harness bug (`simulate-tree.ts`) trips up smoke validation | Low | Add a `tsc --noEmit` guard on `test-harness/` before runs; fix the harness signature mismatch as part of `apply` if cheap. |

## Open product questions (for pre-proposal gate)

These belong to the proposal round, not explore. Captured here so we don't lose them:
1. Should the drawer also show subtask `id` of the **parent task** when one exists, or only the current subtask?
2. Should `c` (copy id) write to clipboard (impossible in TUI without OSC52) or stage the id in a transient footer line the user pastes manually?
3. Should the drawer auto-close when the task disappears from the polling window, or stay open on a "stale" snapshot until the user dismisses?