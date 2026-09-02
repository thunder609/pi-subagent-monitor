# Changelog

## 0.9.0 — subtask-id-detail-panel

### Added

- **`TaskDetailDrawer` component**: persistent side drawer (48 cols) that shows the full subtask `id` (no truncation), the meta line (status, duration, tokens, cost), the live execution stream parsed from the subagent's session JSONL, and a tool-call table with totals. Adapts to the terminal's apparent theme (dark default, light on strong hint via `COLORFGBG` or `TERM=*-light`). Library consumers can embed it directly.
- **`detectTheme` / `themeColors`** in a new `src/theme.ts` module: pure helpers to resolve the apparent terminal theme and produce a small palette object. Reusable from any future TUI component.
- **`fixture-parent-child.cjs`** in `test-harness/`: smoke fixture that seeds a parent + child subtask pair in a clean SQLite file. Useful for manual drawer runs against `PI_SUBAGENTS_HISTORY_DB_PATH`.
- **Vitest dev environment**: `npm test`, `npm test:watch`, `npm test:coverage` scripts; `vitest.config.ts` at repo root.

### Changed

- **`Enter` on a subtask** opens the drawer instead of swapping the monitor to a fullscreen overlay. The list panel stays visible to the left of the drawer.
- **`SubagentMonitorComponent`** gained an `onOpenDrawer(task, liveSessionLines, events)` callback that the `MonitorController` uses to mount the drawer. When the callback is not wired (library consumers using only the monitor), the old detail behaviour is preserved as a fallback.

### Removed

- **`MonitorController.expand()` / `collapse()`** are no-ops after this change (the fullscreen swap is replaced by the drawer). They are kept in source to avoid breaking any consumer that referenced them, but they no longer mutate state.
- **The detail body inside `SubagentMonitorComponent.renderDetail`** is still present for the fallback path, but the primary surface is now the drawer. The `viewMode === "drawer"` branch keeps working for consumers that want the legacy detail.

### Deprecated

- **`ViewMode` literal `"detail"`**: still exported as the `VIEW_MODE_DETAIL_ALIAS` constant for one release. New code should narrow on `"drawer"` or `"list"` directly.

### Migration

For library consumers:

```ts
// before
const mode: ViewMode = "detail";

// after
const mode: ViewMode = "drawer";
// or, if you need to keep existing comparisons compiling:
import { VIEW_MODE_DETAIL_ALIAS } from "pi-subagent-monitor";
const legacy: typeof VIEW_MODE_DETAIL_ALIAS = "detail";
```

For consumers that embedded the monitor and wanted the fullscreen detail overlay: the `MonitorController` no longer offers the fullscreen swap. Mount the drawer yourself via `tui.showOverlay(new TaskDetailDrawer({...}), {...})` or use the `onOpenDrawer` callback.

## 0.8.0 and earlier

See git history for changes prior to the OpenSpec adoption.