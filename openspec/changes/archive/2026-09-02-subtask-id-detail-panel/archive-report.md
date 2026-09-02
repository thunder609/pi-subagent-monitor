# Archive report: subtask-id-detail-panel

## Status

**ARCHIVED** — change folder moved to dated archive after verification and sync.

## Executive summary

The SDD change `subtask-id-detail-panel` shipped across two stacked PRs (`7af6753` + `2f4ee05`) on branch `feat/sdd-subtask-id-detail-panel-pr1`. Verification passed against the delta spec; the canonical spec for the new `monitor-ui` capability was synced from the change folder; this archive finalizes the cycle.

## Artifacts read (preconditions)

- `openspec/changes/subtask-id-detail-panel/proposal.md` ✅
- `openspec/changes/subtask-id-detail-panel/design.md` ✅
- `openspec/changes/subtask-id-detail-panel/tasks.md` ✅
- `openspec/changes/subtask-id-detail-panel/specs/monitor-ui/spec.md` ✅
- `openspec/changes/subtask-id-detail-panel/apply-progress.md` ✅
- `openspec/changes/subtask-id-detail-panel/verify-report.md` ✅ (status: PASS)
- `openspec/changes/subtask-id-detail-panel/sync-report.md` ✅ (status: SYNCED)
- `openspec/config.yaml` ✅

## Final task completion gate

Re-read `openspec/changes/subtask-id-detail-panel/tasks.md` immediately before archive. **0 implementation task markers** with `- [ ]` remain. Parent-owned lifecycle actions are also marked complete.

## Domains synced (via `sdd-sync`)

- **`monitor-ui`** — new capability. Canonical spec created at `openspec/specs/monitor-ui/spec.md` (188 LoC, verbatim copy of the delta spec).

## ADDED / MODIFIED / REMOVED requirement names

The delta spec was an `## ADDED Requirements` block for a new domain (no canonical spec existed before this change). Every requirement in the delta is recorded as canonical ADDED content:

- ADDED (canonical): `Subtask Detail Drawer`
- ADDED (canonical): `Drawer Width and Fallback`
- ADDED (canonical): `Drawer Content Sections`
- ADDED (canonical): `Parent/Child Navigation Inside the Drawer`
- ADDED (canonical): `Theme Auto-Detection`
- ADDED (canonical): `Vitest Test Suite`
- ADDED (canonical, from MODIFIED delta): `Detail View Mode`
- ADDED (canonical, from REMOVED delta): `Fullscreen Detail Overlay`
- ADDED (canonical, from REMOVED delta): `Truncated ID in Header`

The MODIFIED/REMOVED distinction in the delta is preserved as narrative in the canonical spec (`(Previously: ...)` notes on MODIFIED, `(Reason: ...)` / `(Migration: ...)` notes on REMOVED) so a future change can target these requirements correctly.

## Active same-domain change warnings

None. `monitor-ui` had no canonical spec and no other active change touches the same domain.

## Destructive merge approvals / blockers

None. The merge was purely additive (new domain). No REMOVED of existing canonical requirements, no large MODIFIED replacement.

## Structured status & action context

```text
gentle-ai sdd-attempt status --change subtask-id-detail-panel
  revision: sha256:e3b5ee3d213eac64b9f129dc0a65ebc74644948f61a83d98ae946f559b1d4246
  attempts: 3 total
    - ordinal 1 (PR 1 acquire): interrupted (work-unit rescope to split)
    - ordinal 2 (PR 1 apply):    passed, 2852 LoC, budget exceeded (maintainer accepted)
    - ordinal 3 (PR 2 apply):    passed, 743 LoC, budget exceeded (maintainer accepted)
  cumulative_changed_lines: 3595
  next_ordinal: 4 (no further acquire; cycle closed)
```

`actionContext.mode: workspace-planning`; `allowedEditRoots` include `openspec/` per the preflight.

## Archived path

`openspec/changes/archive/2026-09-02-subtask-id-detail-panel/`

Contents of the archive (mirror of the pre-archive change folder, except this report):

```
2026-09-02-subtask-id-detail-panel/
├── proposal.md
├── design.md
├── tasks.md
├── apply-progress.md
├── verify-report.md
├── sync-report.md
├── archive-report.md          # this file
└── specs/
    └── monitor-ui/
        └── spec.md
```

The `.keep` placeholder and the empty `.applied/` directory are not preserved in the archive.

## What was NOT archived

- The committed implementation code (lives on `feat/sdd-subtask-id-detail-panel-pr1`, commits `7af6753` + `2f4ee05`).
- The canonical `openspec/specs/monitor-ui/spec.md`.
- `README.md`, `package.json`, `src/__tests__/*`, `src/theme.ts`, `src/index.ts`, `vitest.config.ts`, `.gitignore`, `test-harness/fixture-parent-child.cjs`, `test-harness/simulate-tree.ts`, `test-harness/.gitignore` updates — all already on the branch.
- `openspec/CHANGELOG.md` (lives at repo root, already on the branch).

The archive is the audit trail of the change itself (proposal, design, tasks, apply-progress, verify, sync, archive); the implementation is on git.

## Risks for future changes touching `monitor-ui`

- The MODIFIED/REMOVED delta requirements are now first-class canonical content. Future changes must treat them as existing requirements rather than `## ADDED Requirements`. Standard OpenSpec semantics.
- Verify report noted 2 assertion-quality WARNINGs on the drawer's theme surface (smoke-test-only + implementation-detail coupling). Not blocking; documented in `verify-report.md`.
- Aggregate `index.ts` coverage is 23.71% because most of the file is out of scope (generator, ProjectedLogComponent, extension entrypoint). `theme.ts` coverage is 100% / 94.73% branches.
- Two `size:exception` decisions are recorded in the runtime status; these are governance artifacts, not behavior.

## Next recommended phase

Cycle closed. Future work on this change would be a new SDD change (`monitor-ui` is now an established capability with its own canonical spec).