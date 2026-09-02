# pi-subagent-monitor

A [Pi](https://github.com/badlogic/pi-mono) coding-agent extension (and embeddable TUI component) that shows **live subagent activity** in a side panel — tasks, status, tokens, cost, duration, and full event logs.

Read-only by design: it never touches your agent sessions. It watches the subagent history SQLite database that any compatible generator writes and renders it.

## Features

- **Live side panel** pegged to the right edge of the Pi TUI, refreshed every second
- **Task list** with status colors, foreground/background (`FG`/`BG`) badges, token counts, cost estimates, and elapsed time
- **Running-task indicator** — see at a glance which subagent is working right now
- **Side drawer detail view**: per-subtask drawer that shows the full subtask `id` (no truncation) with a copy-id footer line, the live execution stream (`user`, `assistant`, `think`, `call`, `result`, `code`) read straight from the subagent's session JSONL, and a tool-call table with totals
- **Parent/child navigation** across nested subagent trees (`session_id` / `nested_session_path`)
- **Log projection** — project a task's full log into the main editor area for reading or copying
- **Multi-project aware**: monitor only the current CWD or all tracked CWDs
- **Zero configuration**: auto-opens on `session_start`; sensible defaults everywhere

## How it works

```
your-agent ──writes──> ~/.local/share/pi/subagents/custom-db.sqlite
                                         │
                                         ▼ (read-only, 1s poll)
                         pi-subagent-monitor side panel
```

The monitor polls the SQLite history database (via the built-in `node:sqlite`
module — no native dependencies) and, for the detail view, tails each task's
own session JSONL to render its most recent conversation lines.

You can use any SQLite database containing the expected schema (tables
`subagent_tasks` and `subagent_events` with compatible columns) — the monitor
does not care which generator wrote it.

## Requirements

| Requirement | Version |
| --- | --- |
| Node.js | >= 22.5 (built-in `node:sqlite`) |
| `@earendil-works/pi-coding-agent` | >= 0.84.0 (peer dependency) |
| `@earendil-works/pi-tui` | >= 0.84.0 (peer dependency) |

The Pi SDK packages are peer dependencies: they must already exist in the Pi
runtime that loads this extension.

## Install

```bash
npm install -g pi-subagent-monitor
```

## Use as a Pi extension

Add it to the `packages` array of your `~/.pi/agent/settings.json`:

```jsonc
{
  "packages": [
    "npm:pi-subagent-monitor"
  ]
}
```

Or point directly at the built entry file:

```jsonc
{
  "extensions": [
    { "path": "./node_modules/pi-subagent-monitor/dist/index.js" }
  ]
}
```

### Commands

| Command | Description |
| --- | --- |
| `subagent-monitor` | Toggle the side panel for the current CWD |
| `subagent-monitor-all` | Toggle the side panel across all CWDs |
| `subagent-monitor-db` | Switch database scope (auto / project / global) |
| `subagent-monitor-install` | Show how to install the extension globally or locally |
| `/subagent-monitor-hide` | Hide the panel (works in every terminal) |
| `/subagent-monitor-show` | Show the panel (works in every terminal) |

The panel also auto-opens on `session_start` when a UI is present.

### Database scoping

The panel reads a SQLite history database that any compatible subagent
generator writes. You can point it at a single shared global database, a
different database per project, or let it auto-detect based on the
environment.

The panel header shows the active scope as `DB:A` (auto), `DB:P` (project), or
`DB:G` (global) together with the database file name so you always know which
one is being read.

#### Option A: Global (one database for everything)

Use the default global database, shared across every project:

```
~/.local/share/pi/subagents/subagents-history.sqlite
```

Setup steps:

1. Launch your subagent generator with no extra config (it writes to the
   default global path).
2. In Pi, run `/subagent-monitor-db` and choose **Global**.
3. The panel header will show `DB:G` and `subagents-history.sqlite`.

Best for: a single project, or when you want to see every subagent task from
every project in the same panel.

#### Option B: Per-project (one database per project)

Isolate each project's history into its own SQLite file:

```
~/.local/share/pi/subagents/subagents-history-<project>.sqlite
```

`<project>` is the git root basename (or the cwd basename when not in a git
repo); pin it with `PI_SUBAGENTS_PROJECT_NAME`.

Setup steps:

1. Launch your subagent generator with the project-scoped path, for example:

   ```bash
   export PI_SUBAGENTS_HISTORY_DB_PATH=~/.local/share/pi/subagents/subagents-history-my-project.sqlite
   pi
   ```

   Put the `export` line in the project's shell rc (or a project-local
   `.env`) so it is set every time you launch Pi from that directory.

2. In Pi, run `/subagent-monitor-db` and choose **Project**.
3. The panel header will show `DB:P` and the per-project file name.

Best for: multiple projects where you want clean isolation — deleting one
project's database does not affect the others.

#### Option C: Auto (default, env var override)

The default mode. Resolution order on every read:

1. If `PI_SUBAGENTS_HISTORY_DB_PATH` is set, use that exact path.
2. Otherwise, if a per-project file `subagents-history-<project>.sqlite`
   exists, use it.
3. Otherwise, fall back to the global database.

Setup steps:

1. (Optional) Set `PI_SUBAGENTS_HISTORY_DB_PATH` to a custom path when you
   want a non-default database.
2. Do nothing else — the monitor picks the right one based on the rules
   above.
3. The panel header will show `DB:A`.

Best for: most users. Lets you opt into per-project isolation per directory
without changing the panel mode, while still working out-of-the-box when no
env var is set.

### Panel controls

| Key | Action |
| --- | --- |
| `↑` / `↓` | Select task |
| `Enter` | Open the subtask detail drawer (side panel, 48 cols) |
| `←` / `→` | Inside the drawer: navigate to parent / first child task |
| `c` | Inside the drawer: stage the full subtask `id` in the footer for copy-paste |
| `P` | Project full log into the main editor area |
| `b` / `Esc` | Back to list (or close drawer if open) |
| `r` | Refresh / Resume task (completed/failed → running) |
| `a` | Toggle all-CWDs mode |
| `c` (in list) | Cancel selected task (status → cancelled) |

The detail drawer is a persistent side overlay that shows the full subtask `id` (no truncation), the meta line (status, duration, tokens, cost), the live execution stream (parsed from the subtask's session JSONL when available) or the recorded event log fallback, and a tool-call table with totals. When the terminal is narrower than 96 columns the drawer temporarily hides the side panel so the two overlays do not collide.

### Global shortcuts

| Shortcut | Action |
| --- | --- |
| `ctrl+q` | Focus / unfocus the panel |
| `alt+h` | Hide the panel |
| `alt+s` | Show the panel |

You can also use the slash commands `/subagent-monitor-hide` and `/subagent-monitor-show` from the editor input.

## Use as a library

The same components can be embedded in your own TUI:

```ts
import {
  SubagentMonitorComponent,
  ProjectedLogComponent,
  MonitorController,
  TaskDetailDrawer,
  buildTaskTree,
  tailSession,
  formatDuration,
  formatTokens,
  formatCost,
  modeBadge,
  detectTheme,
  themeColors,
  DEFAULT_DB_PATH,
  DEFAULT_INTERVAL_MS,
  resolveMonitorDbPath,
  projectScopedDbPath,
  projectNameForCwd,
  type SubagentTask,
  type SubagentEvent,
  type SessionLine,
  type ViewMode,
  type TaskNode,
  type MonitorDbMode,
  type Theme,
  type ThemePalette,
} from "pi-subagent-monitor";
```

- `SubagentMonitorComponent` — self-contained monitor panel (`Component`)
- `ProjectedLogComponent` — full event-log view for a single task
- `TaskDetailDrawer` — per-subtask side drawer (full id, live stream, tool-call table with totals, copy-id footer)
- `MonitorController` — wires the monitor into a `TUI` overlay and handles projection and the new drawer
- `buildTaskTree` — organizes flat tasks into a parent/child/sibling tree using `session_id` / `nested_session_path`
- `tailSession` — reads recent conversation lines from a subagent session JSONL
- `detectTheme` / `themeColors` — terminal theme auto-detection (dark default, light on strong hint) and palette helpers
- `formatDuration` / `formatTokens` / `formatCost` / `modeBadge` — display helpers
- `resolveMonitorDbPath` / `projectScopedDbPath` / `projectNameForCwd` — database scoping helpers
- `MonitorDbMode` — `"auto" | "project" | "global"` database scope type

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # tsup -> dist/index.js + dist/index.d.ts
npm run dev         # rebuild on change
```

## License

[MIT](LICENSE)
