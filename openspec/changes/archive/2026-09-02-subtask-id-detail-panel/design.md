# Design: subtask-id-detail-panel

## Goal

Replace the fullscreen detail view with a persistent side drawer (`TaskDetailDrawer`) that keeps the list visible, shows the full subtask `id`, exposes a copy stage, and renders a tool-call table with totals. Reuse the data the existing detail view already gathers (`liveSessionLines`, `detailEvents`, `taskTree`) so no new SQL or JSONL parsing is introduced. Keep `ProjectedLogComponent` and the public surface additive where possible.

## Architecture

### New component: `TaskDetailDrawer`

Lives in `src/index.ts` next to the existing classes. Implements `Component` from `@earendil-works/pi-tui`. Owns no DB / no timer; it is a pure view fed by the parent `SubagentMonitorComponent` on each render.

State:
- `task: SubagentTask` — the selected subtask (snapshot, immutable across renders).
- `liveSessionLines: SessionLine[]` — copied from the parent (already parsed by `tailSession`).
- `events: SubagentEvent[]` — fallback when JSONL tail is unavailable.
- `stagedId: string | null` — populated by the `c` key, rendered in the footer.
- `followTail: boolean` — true for running tasks, false otherwise; controls auto-scroll.
- `scroll: number` — number of rows from the bottom (0 = tail).
- `theme: "dark" | "light"` — detected at construction time from environment.
- `toolCallTable: ToolCallRow[]` — derived from `liveSessionLines` (`kind === "call"` paired with the next `kind === "result"` if present), each row with `{ tool, status, durationMs }`.

Public surface:
- `invalidate(): void`
- `handleInput(data: string): void`
- `render(width: number): string[]`

The drawer does **not** know about the list panel, the controller, or the TUI; the parent decides when to show or hide it.

### New module: `src/theme.ts`

Pure helper module exporting:
- `detectTheme(): "dark" | "light"` — reads `process.env.COLORFGBG` and `process.env.TERM`. Defaults to `"dark"`. Returns `"light"` only on a strong hint.
- `themeColors(theme: "dark" | "light")` — returns a small palette object that mirrors the inline `COLORS` map used in `src/index.ts` so the drawer can pick the right shade for status badges and section headers.

Rationale: keep theme logic isolated so the drawer's render function is testable with a fixture palette and so future TUI components can reuse it.

### `SubagentMonitorComponent` changes

- Rename `viewMode: ViewMode` so `"detail"` becomes `"drawer"`.
- Add `drawerOpen: boolean` plus `drawerTaskId: string | null` to track the drawer state separately from `viewMode` (since `viewMode` now exclusively describes the list-vs-drawer body of the panel, not whether the drawer overlay is mounted).
- `handleListInput("return" / "enter")` → open the drawer for `tasks[selectedIndex]` instead of switching `viewMode` to `"detail"`.
- `handleListInput("escape" / "b" / "q")` → also closes the drawer if open.
- `handleDrawerInput(data)` → new method that delegates to the drawer's `handleInput`, then mirrors parent state when needed (e.g. after navigation).
- `tick()` continues to refresh `liveSessionLines` and `detailEvents` for the **drawer's** task (renamed internal vars for clarity).
- The fullscreen `renderDetail` method becomes obsolete; it is deleted. Its data feeds the drawer instead.

### `MonitorController` changes

- `expand()` and `collapse()` are removed (no longer referenced).
- A new method `openDrawerFor(taskId: string)` and `closeDrawer()` manage a new `OverlayHandle` for the drawer, anchored to `right-center`, width `"48"`, `minWidth: 48`, `maxHeight: "100%"`. When `termWidth < 96`, the side panel's overlay is hidden for the duration and the drawer takes its place.
- `dispose()` closes the drawer overlay too.

### `types.ts` changes

- `ViewMode = "list" | "drawer"`.
- Add a JSDoc-deprecated alias `type LegacyDetailMode = "detail"; export const VIEW_MODE_DETAIL_ALIAS: LegacyDetailMode = "detail";` so consumers can still reference it.

### Package and scripts

- `package.json`:
  - devDependencies: `vitest@^2`, `@vitest/coverage-v8@^2`.
  - scripts: `test`, `test:watch`, `test:coverage` (delegating to `vitest run` / `vitest` / `vitest run --coverage`).
  - version bump `0.8.0` → `0.9.0`.
- `tsconfig.json`: add `"vitest.config.ts"` to `include`? No — Vitest reads its own config; nothing to change.

### Test infrastructure

- New file `vitest.config.ts` at repo root: node environment, include `src/__tests__/**/*.spec.ts`.
- New directory `src/__tests__/`:
  - `theme.spec.ts` — `detectTheme()` matrix (COLORFGBG variations, TERM variants).
  - `task-detail-drawer.spec.ts` — render, scroll, navigation no-op, `c` stage, theme variants, narrow-width fallback (uses a fake `termWidth`).
  - `view-mode.spec.ts` — type alias presence and deprecated `"detail"` acceptance.
- Fixtures: pure functions in `src/__tests__/fixtures.ts` that build `SubagentTask` / `SubagentEvent` / `SessionLine` arrays without touching SQLite.

### Pre-existing harness fix

- `test-harness/simulate-tree.ts`: align its `createTask` and `addEvent` calls with the positional signature declared in `subagent-db.ts`. Five-line fix; outside the unit-test scope but unblocks realistic smoke runs.

## Data flow

```text
list input (Enter)
   │
   ▼
SubagentMonitorComponent.openDrawer(task)
   │ (sets drawerOpen=true, drawerTaskId=task.id)
   ▼
MonitorController.openDrawerFor(task.id)
   │ (tui.showOverlay(drawer, { anchor: right-center, width: "48" }))
   ▼
Tick (every 1s):
   SubagentMonitorComponent copies latest liveSessionLines + events
   into the drawer instance and calls drawer.invalidate().
   │
   ▼
Drawer render(width):
   computes toolCallTable from liveSessionLines
   emits header / meta / stream-or-events / tool table / footer
```

`followTail` is true for tasks with `status === "running"` and stays true until the user scrolls up. Pressing `End` snaps back to the tail. When `followTail` is true, `scroll` is forced to 0 at the end of `render` (same trick the existing code uses).

## Key contracts

- `drawer.render(width)` returns `string[]` lines that are exactly `width` visible columns wide each (reusing the existing `boxLine` / `boxSep` / `boxTop` / `boxBottom` helpers in `src/index.ts`). The internal section heights are computed from `width` and an injected `heightProvider` the same way the list view does.
- The drawer reports key events back to the parent via callbacks: `onClose`, `onNavigateTo(taskId)`, `onStageId(id)`. Parent owns the `tui.showOverlay` lifecycle; the drawer does not call `tui` directly.
- `SubagentMonitorComponent.tick()` keeps its existing one-second cadence. The drawer's internal `toolCallTable` is recomputed every render from the latest `liveSessionLines`; no internal timer.

## Test plan (RED → GREEN → REFACTOR)

For each spec requirement, write one failing Vitest first, then implement:

1. `theme.spec.ts`
   - RED: `detectTheme()` returns wrong value for `COLORFGBG=15;default` and `TERM=xterm-256color`.
   - GREEN: implement per matrix in `src/theme.ts`.
   - TRIANGULATE: more env variants.
2. `view-mode.spec.ts`
   - RED: `ViewMode` does not narrow on `"drawer"`; the alias constant does not exist.
   - GREEN: rename + add alias constant.
3. `task-detail-drawer.spec.ts`
   - RED: render width mismatches when given a 48-col buffer.
   - GREEN: implement `TaskDetailDrawer.render(width)` reusing box helpers.
   - TRIANGULATE: narrow-terminal fallback (width 80), tool-call table with mixed results, scroll up then `End`, `c` stages then refreshes, theme=light colors different, `←`/`→` navigation updates parent's `drawerTaskId` via callback.

Per the strict TDD contract in `openspec/config.yaml`, every task commits only after `npm test` is green for the relevant spec.

## Rollout and rollback

- Single feature commit (or two if the harness fix warrants a separate commit) on the current branch.
- Rollback is `git revert <commit>`; no schema migration, no runtime migration. Library consumers that had picked up the `"detail"` literal switch back via the deprecated alias.

## Risks revisited

- Review budget still a concern. Estimated changed lines (rough): ~480. Will confirm in `sdd-tasks`; if confirmed over 400, surface the split-vs-proceed decision before `sdd-apply`.
- Theme detection relies on env vars that not every terminal exports. Fallback is dark; if detection fails the drawer is still legible, just styled for a dark background.

## Open assumption carried from the proposal

The 48-col drawer must fit a full `subtask_<uuid>` (36 chars) plus the `[c]` hint in the header line without wrapping. This will be covered by an explicit width assertion in `task-detail-drawer.spec.ts`. If the assertion fails, we widen to 52 cols and re-check the `< 96` fallback threshold.