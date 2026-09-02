# Proposal: subtask-id-detail-panel

## Intent

Surface the full subtask `id` and a richer per-subtask view inside the side monitor. The current detail surface is a fullscreen overlay reached by pressing `Enter` on a task; it truncates the subtask `id` to 8 characters, hides the tool-call list as a structured table, and forces the user to lose the list context. After this change, the detail view becomes a persistent drawer anchored next to the list, shows the complete `id` with a one-key copy affordance, and presents the live execution stream and tool calls as a tabular breakdown that stays scannable while the subagent keeps running.

## Business problem

Operators running Pi with `pi-subagent-monitor` watch a fleet of subagents in real time. When a subagent misbehaves or returns an unexpected result, the first question is "which one is that?" The current `Enter → fullscreen` flow shows only `subtask_xx…` and immediately drops the list context, so the user has to memorize the truncated prefix and recover the surrounding list from memory. That makes incident triage and cross-referencing between conversations (or with external logs) slow and error-prone. Exposing the full `id` with a copy gesture, alongside a structured tool-call breakdown, cuts the median time from "something looks off" to "I have the identifier and the call sequence in front of me".

## Target users and situations

- **Pi session operators** monitoring live subagent activity during long-running workflows: need to identify and copy a subtask `id` to paste into an issue, a Slack thread, or a follow-up prompt.
- **Post-mortem reviewers** scrolling through completed subagents: want a stable, readable per-subtask snapshot without losing the list of other tasks.
- **TUI-first users** in terminals where the panel already takes 36 columns: need the new affordances without losing the existing list.

## Product outcome

- `Enter` on a task opens a drawer to the right of the existing side panel, fixed at 48 cols, with the full subtask `id` visible and one key away from being copied.
- The drawer stays open while the task is still running, streaming new tool calls and event rows in place; the user keeps the list in peripheral vision.
- If the terminal is narrower than 96 columns, the drawer replaces the side panel temporarily while open (no overlay collision), and restores the side panel on close.
- Pressing `Esc` or `b` returns to the list; pressing `←`/`→` jumps to the parent / first child task from within the drawer.
- Theme follows the terminal's background: dark by default, light when `COLORFGBG` or `TERM` strongly hints at a light scheme.

## Affected areas

- `src/index.ts` — replace the fullscreen detail body with the drawer; remove the `expand()` / `collapse()` swap in `MonitorController`; rework key handling so `Enter` opens the drawer instead of switching `viewMode` to `"detail"`.
- `src/types.ts` — rename exported `ViewMode` value `"detail"` → `"drawer"`. Keep the old literal as a deprecated alias for one release to soften the public-API break.
- `package.json` — add `vitest` and `@vitest/coverage-v8` as devDependencies; add `test`, `test:watch`, `test:coverage` scripts; bump version `0.8.0` → `0.9.0` (user-facing surface migration).
- `src/__tests__/` (new) — Vitest specs for `TaskDetailDrawer` rendering, id display, copy stage, navigation, scroll, and theme detection.
- `test-harness/` — fix the pre-existing signature mismatch in `simulate-tree.ts` while adding a new fixture that seeds a task with `parent_id` so drawer tests run against realistic shapes. (The existing harness bug is unrelated to this change but blocks realistic smoke runs; fixing it costs ~5 lines.)
- `openspec/CHANGELOG.md` (new) — record the breaking `ViewMode` rename.

## Scope boundaries (first slice)

In scope:
- Drawer component, fixed 48 cols, theme auto (dark default, light on strong hint).
- Header: agent name + full `id` + `[c]` copy indicator + status badge.
- Sections: meta (status, duration, tokens, cost), live execution stream (reuse `liveSessionLines`), event log fallback when no JSONL tail exists, tool-call table with totals.
- Keyboard: `↑`/`↓` scroll, `←`/`→` parent/child, `c` stage id, `p` project log, `r` resume, `Esc`/`b` close.
- Vitest setup and unit tests for the new component.
- Bumping the package version and documenting the breaking rename.

Out of scope (explicit non-goals):
- New commands, new shortcuts beyond what is listed above.
- Changing SQLite schema or `SubagentTask` / `SubagentEvent` shapes.
- Modifying `ProjectedLogComponent`.
- Showing a short `id` badge in the list cards (separate change).
- Persisting drawer selection across monitor restarts.
- OSC52 / real clipboard (we use a visible "staged id" footer instead).

## Risks and mitigations

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Review budget (>400 changed lines) | Medium | Run `sdd-tasks` review workload forecast before apply. If exceeded, surface the split-vs-proceed decision per `delivery_strategy: ask-on-risk`. |
| `ViewMode` rename breaks library consumers | Medium | Keep `"detail"` as a deprecated type literal for one release; document in `CHANGELOG`. |
| Drawer + side panel both consuming right edge on narrow terminals | Medium | Hard rule: if `termWidth < 96`, drawer replaces the side panel temporarily; verified with a render test. |
| Theme detection guess is wrong on some terminals | Low | Default to dark; flip only on strong hints (`COLORFGBG` with light foreground, or `TERM=*-light`). |
| Harness bug trips smoke validation | Low | Fix `simulate-tree.ts` signature mismatch as part of `apply`; add `tsc --noEmit` guard for `test-harness/`. |
| Drawer overflows when subtask has many tool calls | Low | Scrollable window; tool-call table capped at a sensible row count with a `(+N more)` indicator. |

## Success criteria

- A subtask selected with `Enter` opens a 48-col drawer to the right of the existing panel; the full `id` is visible without truncation.
- Pressing `c` puts the `id` in the footer so the user can copy it manually; pressing it again refreshes the staged value.
- `←` / `→` navigate to the parent / first child task without closing the drawer.
- Live tool calls append to the table while the subtask is `running`; once the subtask transitions to a terminal state, the stream freezes and the totals become the source of truth.
- If the terminal is < 96 columns, opening it does not visually collide with the list panel.
- All existing list-view behavior (selection, scroll, focus toggle, slash commands, project-mode, cancel/resume from list) keeps working unchanged.
- `npm test` runs the new Vitest suite and exits 0.
- `npm run typecheck` and `npm run build` stay green.
- Public API export surface stays additive except for the documented `ViewMode` rename.

## Rollback

The change is fully reversible by reverting the single commit (drawer + alias + harness fix + tests + version bump). Library consumers that already adopted the `"drawer"` literal would need to switch back to `"detail"`; the alias makes that a search-and-replace. No data migrations are involved.

## Proposal question round — resolved

1. Show `parentId` in the drawer header? **No** — keep header focused on the current subtask; arrow keys still navigate.
2. How to copy the `id`? **Stage in footer** (visible, copy-paste by hand) — universal TUI compatibility.
4. Task disappears mid-drawer? **Same as today** — close drawer, return to list. (No new "stale" state.)
5. Tool-call presentation? **Grouped table** with totals (`✓` / `✗`, duration, count).

Open assumption to validate during `sdd-spec`: the 48-col drawer can fit a 36-char `subtask_<uuid>` line plus margins in both themes without wrapping. If not, we widen the drawer to 52 cols and re-check the < 96 cols fallback threshold.