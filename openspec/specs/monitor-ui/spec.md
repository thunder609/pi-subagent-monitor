# Delta for monitor-ui

## ADDED Requirements

### Requirement: Subtask Detail Drawer

The system MUST surface a per-subtask detail drawer that opens when the user activates a subtask from the list view, and MUST persist the full subtask `id` (no truncation) plus a copy affordance for that `id`.

#### Scenario: Open drawer from list

- GIVEN the monitor side panel is open with at least one subtask in the list
- WHEN the user presses `Enter` on the selected subtask
- THEN the monitor MUST open a drawer anchored to the right of the existing side panel
- AND the drawer MUST display the full subtask `id` without truncation
- AND the list panel MUST remain visible to the left of the drawer

#### Scenario: Stage id for manual copy

- GIVEN the drawer is open for a subtask
- WHEN the user presses `c`
- THEN the drawer footer MUST visibly display the full subtask `id` in a clearly delimited "staged" line
- AND pressing `c` again MUST refresh the staged value (idempotent for the current subtask)
- AND the system MUST NOT attempt to write to the OS clipboard

#### Scenario: Close drawer returns to list

- GIVEN the drawer is open
- WHEN the user presses `Esc` or `b`
- THEN the drawer MUST close
- AND the monitor MUST restore the side panel exactly as it was before opening

#### Scenario: Selected subtask disappears while drawer is open

- GIVEN the drawer is open for a subtask
- WHEN the next polling tick no longer reports that subtask in the database
- THEN the drawer MUST close automatically
- AND the monitor MUST return focus to the list view at the previously selected index, clamped to the new list bounds

### Requirement: Drawer Width and Fallback

The drawer MUST be 48 columns wide on terminals with `termWidth >= 96`, and MUST replace the side panel (fullscreen-ish, preserving the drawer body) when `termWidth < 96`.

#### Scenario: Wide terminal layout

- GIVEN the terminal is at least 96 columns wide
- WHEN the drawer is open
- THEN both the list panel and the drawer MUST be visible side by side
- AND the drawer MUST occupy exactly 48 columns of horizontal space

#### Scenario: Narrow terminal fallback

- GIVEN the terminal is less than 96 columns wide
- WHEN the drawer is open
- THEN the list panel MUST be hidden while the drawer is open
- AND the drawer body MUST still render with the same internal section layout
- AND when the drawer closes, the list panel MUST reappear in its prior position

### Requirement: Drawer Content Sections

The drawer MUST render at least these sections, in order: header (agent name, full id, status badge), meta (status, duration, tokens, cost), live execution stream (or recorded event log fallback), tool-call table with totals, and a footer with key hints plus the staged id when active.

#### Scenario: All sections render for a completed subtask

- GIVEN a completed subtask with at least one recorded event
- WHEN the drawer opens
- THEN the drawer MUST render the header with the agent name, full id, and a non-running status badge
- AND the meta section MUST show duration (ended - started), input and output tokens, and total cost
- AND the events section MUST list events in chronological order
- AND the tool-call table MUST show at least one row per recorded tool call (when JSONL tail data is available)
- AND the footer MUST show key hints and the current staged id (if any)

#### Scenario: Live stream for a running subtask

- GIVEN a running subtask with a `nested_session_path` that exists on disk
- WHEN the drawer is open and a polling tick produces new JSONL entries
- THEN the drawer MUST append the new entries to the live execution stream without losing scroll position
- AND the tool-call table MUST update its totals (count and failed count) accordingly
- AND if `followTail` is enabled (default for running tasks), the live stream MUST auto-scroll to the newest entry

#### Scenario: Empty / unavailable JSONL fallback

- GIVEN a subtask with no `nested_session_path` or with a path that does not exist on disk
- WHEN the drawer is open
- THEN the live execution stream section MUST be replaced by the recorded event log section
- AND the tool-call table MUST still render with zero rows plus totals `(0 / 0 failed)`
- AND no error MUST be surfaced to the user

#### Scenario: Tool-call table structure

- GIVEN a subtask with at least one tool call available (from JSONL tail)
- WHEN the tool-call table renders
- THEN each row MUST show the tool name, the call status (`✓` success / `✗` failure), and an estimated duration
- AND the table footer MUST show total call count and failed count
- AND the table MUST cap its visible rows to the available drawer height, appending a `(+N more)` indicator when truncated

### Requirement: Parent/Child Navigation Inside the Drawer

The drawer MUST allow navigating to the parent or first child task without first closing and re-opening.

#### Scenario: Jump to parent

- GIVEN the drawer is open for a subtask that has a parent in the current tree
- WHEN the user presses `←`
- THEN the drawer MUST close and reopen for the parent subtask
- AND the parent id MUST NOT be displayed in the new header (only the parent's own id is shown)

#### Scenario: Jump to first child

- GIVEN the drawer is open for a subtask that has at least one child in the current tree
- WHEN the user presses `→`
- THEN the drawer MUST close and reopen for the first child subtask

#### Scenario: No parent / no child available

- GIVEN the drawer is open for a subtask without a parent (or without children)
- WHEN the user presses `←` (or `→`)
- THEN the drawer MUST remain open on the current subtask
- AND the footer hint MUST show the corresponding key as dimmed for that direction

### Requirement: Theme Auto-Detection

The drawer MUST adapt its foreground and accent colors to the terminal's apparent theme: dark by default, light when the terminal environment strongly hints at a light background.

#### Scenario: Dark default

- GIVEN no `COLORFGBG` env var or one whose foreground matches a dark ANSI color, and `TERM` does not match a `*-light` pattern
- WHEN the drawer renders
- THEN foreground text MUST use bright colors over the existing background
- AND accents (status badges, selection arrow) MUST use the existing dark-friendly palette

#### Scenario: Light theme hint

- GIVEN `COLORFGBG` is set and the foreground component (before the `;`) is one of the canonical light foregrounds (white, bright white, or yellow as a stand-in for many light themes), or `TERM` matches `*-light`
- WHEN the drawer renders
- THEN text MUST use darker foreground variants
- AND accents MUST use the existing light-friendly palette

### Requirement: Vitest Test Suite

The repository MUST ship a Vitest configuration and a unit-test suite covering the drawer's rendering, navigation, copy stage, scroll behavior, and theme detection.

#### Scenario: Default Vitest scripts

- GIVEN a fresh clone of the repository after this change
- WHEN a contributor runs `npm test`
- THEN the Vitest runner MUST execute the drawer specs and exit with status 0
- AND `npm run typecheck` MUST exit with status 0
- AND `npm run build` MUST exit with status 0

#### Scenario: Required spec coverage

- GIVEN the new test suite
- WHEN the suite runs
- THEN it MUST cover: full-id display (no truncation), `c` staging, `Esc`/`b` close, parent/child navigation including no-op when missing, narrow-terminal fallback, dark default, light-theme hint, tool-call table rendering, totals correctness, and scroll behavior with `followTail`.

## MODIFIED Requirements

### Requirement: Detail View Mode

The exported `ViewMode` type MUST be `"list" | "drawer"`. The legacy literal value `"detail"` MUST remain available as a deprecated alias for at least one release.

(Previously: `ViewMode = "list" | "detail"`. The fullscreen detail overlay reached via `Enter` is replaced by a side drawer; the legacy literal is kept as a deprecated alias.)

#### Scenario: Public type literal update

- GIVEN a library consumer importing `ViewMode` from `pi-subagent-monitor`
- WHEN the consumer narrows on `"drawer"`
- THEN TypeScript MUST accept the narrowing without error
- AND narrowing on the deprecated `"detail"` literal MUST still type-check (with a deprecation note in the JSDoc)

#### Scenario: Fullscreen detail removal

- GIVEN the monitor is open
- WHEN the user activates a subtask
- THEN the system MUST NOT swap the side overlay to a fullscreen overlay anymore
- AND `MonitorController.expand()` / `collapse()` MUST be removed (or reduced to no-op stubs) since they no longer serve a purpose
- AND `ProjectedLogComponent` MUST keep working unchanged for the `P` projection flow

## REMOVED Requirements

### Requirement: Fullscreen Detail Overlay

(Reason: The fullscreen detail view is replaced by a persistent side drawer that keeps the list in peripheral view. `Enter` no longer needs to swap overlays.)
(Migration: Library consumers that relied on `MonitorController.expand()` / `collapse()` should migrate to opening the drawer directly via `SubagentMonitorComponent`. The drawer's public surface is additive; no consumer code is required to change, but the fullscreen swap APIs are no-ops after this change.)

### Requirement: Truncated ID in Header

(Reason: The truncated 8-char prefix in the detail view header was the original motivation for this change. Operators could not reliably identify or reference a subtask from the detail surface.)
(Migration: The new drawer header always shows the full subtask `id`. No consumer action required.)