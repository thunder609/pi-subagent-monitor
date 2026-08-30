# pi-subagent-monitor

A [Pi](https://github.com/badlogic/pi-mono) coding-agent extension (and embeddable TUI component) that shows **live `pi-subagents-j0k3r` activity** in a side panel — tasks, status, tokens, cost, duration, and full event logs.

Read-only by design: it never touches your agent sessions. It watches the subagent history database that [`pi-subagents-j0k3r`](https://www.npmjs.com/package/pi-subagents-j0k3r) writes and renders it.

## Features

- **Live side panel** pegged to the right edge of the Pi TUI, refreshed every second
- **Task list** with status colors, foreground/background (`FG`/`BG`) badges, token counts, cost estimates, and elapsed time
- **Running-task indicator** — see at a glance which subagent is working right now
- **Drill-down detail view**: full event log per task, including tailed conversation lines (`user`, `assistant`, `think`, `call`, `result`, `code`) read straight from the subagent's session JSONL
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
    You can use any SQLite database containing the expected schema (tables `subagent_tasks` and `subagent_events` with compatible columns).
module — no native dependencies) and, for the detail view, tails each task's
own session JSONL to render its most recent conversation lines.

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

The panel reads the history SQLite database that the subagent generator writes. By default the scope is **auto**:

1. Use `PI_SUBAGENTS_HISTORY_DB_PATH` if set (the generator honors the same variable)
2. Otherwise use a per-project database `subagents-history-<project>.sqlite` if one exists
3. Otherwise fall back to the shared global database

The project name is the git root basename (or the cwd basename when not in a git repo); you can pin it with `PI_SUBAGENTS_PROJECT_NAME`.

To keep separate per-project history, launch the agent generator with a project-scoped path:

```bash
PI_SUBAGENTS_HISTORY_DB_PATH=~/.local/share/pi/subagents/subagents-history-my-project.sqlite pi
```

The panel header shows the active scope as `DB:A` (auto), `DB:P` (project), or `DB:G` (global) with the database file name.

### Panel controls

| Key | Action |
| --- | --- |
| `↑` / `↓` | Select task |
| `Enter` | Open detail / event log |
| `←` / `→` | Navigate to parent / first child task |
| `P` | Project full log into the main editor area |
| `b` / `Esc` | Back to list |
| `r` | Refresh / Resume task (completed/failed → running) |
| `a` | Toggle all-CWDs mode |
| `c` | Cancel selected task (status → cancelled) |

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
  buildTaskTree,
  tailSession,
  formatDuration,
  formatTokens,
  formatCost,
  modeBadge,
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
} from "pi-subagent-monitor";
```

- `SubagentMonitorComponent` — self-contained monitor panel (`Component`)
- `ProjectedLogComponent` — full event-log view for a single task
- `MonitorController` — wires the monitor into a `TUI` overlay and handles projection
- `buildTaskTree` — organizes flat tasks into a parent/child/sibling tree using `session_id` / `nested_session_path`
- `tailSession` — reads recent conversation lines from a subagent session JSONL
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
