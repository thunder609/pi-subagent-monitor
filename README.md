# pi-subagent-monitor

A [Pi](https://github.com/badlogic/pi-mono) coding-agent extension (and embeddable TUI component) that shows **live `pi-subagents` activity** in a side panel — tasks, status, tokens, cost, duration, and full event logs.

Read-only by design: it never touches your agent sessions. It watches the subagent history database that [`pi-subagents`](https://www.npmjs.com/package/pi-subagents-j0k3r) writes and renders it.

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
pi-subagents ──writes──> ~/.local/share/pi/subagents/subagents-history.sqlite
                                        │
                                        ▼ (read-only, 1s poll)
                        pi-subagent-monitor side panel
```

The monitor polls the SQLite history database (via the built-in `node:sqlite`
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

Add it to your `~/.pi/agent/settings.json`:

```jsonc
{
  "extensions": [
    "pi-subagent-monitor"
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

The panel also auto-opens on `session_start` when a UI is present.

### Panel controls

| Key | Action |
| --- | --- |
| `↑` / `↓` | Select task |
| `Enter` | Open detail / event log |
| `←` / `→` | Navigate to parent / first child task |
| `P` | Project full log into the main editor area |
| `b` / `Esc` | Back to list |
| `r` | Refresh |
| `a` | Toggle all-CWDs mode |

### Global shortcuts

| Shortcut | Action |
| --- | --- |
| `ctrl+q` | Focus / unfocus the panel |
| `ctrl+alt+h` | Hide the panel |
| `ctrl+alt+s` | Show the panel |

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
  statusColor,
  modeBadge,
  DEFAULT_DB_PATH,
  DEFAULT_INTERVAL_MS,
  type SubagentTask,
  type SubagentEvent,
  type SessionLine,
  type Theme,
  type ViewMode,
  type TaskNode,
} from "pi-subagent-monitor";
```

- `SubagentMonitorComponent` — self-contained monitor panel (`Component`)
- `ProjectedLogComponent` — full event-log view for a single task
- `MonitorController` — wires the monitor into a `TUI` overlay and handles projection
- `buildTaskTree` — organizes flat tasks into a parent/child/sibling tree using `session_id` / `nested_session_path`
- `tailSession` — reads recent conversation lines from a subagent session JSONL
- `formatDuration` / `formatTokens` / `formatCost` / `statusColor` / `modeBadge` — display helpers

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # tsup -> dist/index.js + dist/index.d.ts
npm run dev         # rebuild on change
```

## License

[MIT](LICENSE)
