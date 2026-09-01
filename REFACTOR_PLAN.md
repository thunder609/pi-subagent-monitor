# Refactor Plan — Fuse `pi-my-sub-agent-generator` into `pi-subagent-monitor`

**Target version:** `0.8.0`
**Scope:** merge the sub-agent generator (`pi-my-sub-agent-generator/`) into the
main package (`pi-subagent-monitor/`) so both ship as one installable extension.

## Goals

1. One npm package, one `dist/index.js`, one `package.json`.
2. Existing command surfaces stay intact:
   - Monitor side: `subagent-monitor`, `subagent-monitor-all`, `subagent-monitor-db`,
     `subagent-monitor-install`, `/subagent-monitor-hide`, `/subagent-monitor-show`,
     shortcuts `ctrl+q`, `alt+h`, `alt+s`.
   - Generator side: `misubagent-spawn`, `misubagent-cancel`, `misubagent-resume`.
3. One shared `dbPath` helper so the generator and monitor always agree on the
   database file.
4. Shared types (`SubagentTask`, `SubagentEvent`, `TaskAttempt`) live in one place.
5. Tests stay in `test-harness/` (one per concern, no forced integration).

## Non-goals

- We are NOT changing command names, command signatures, or keyboard shortcuts.
- We are NOT introducing a new public API; everything that is exported today
  keeps being exported.
- We are NOT removing the existing `pi-my-sub-agent-generator/package.json` until
  the new build is verified end-to-end (it stays as a stub pointing at the merged
  entry so any local dev-link keeps working).

## File-by-file changes

### New files

- `src/db-path.ts` — single helper for resolving the SQLite path. Replaces
  duplicated logic in `pi-my-sub-agent-generator/src/db.ts` and
  `src/index.ts:resolveMonitorDbPath`.

  ```ts
  // src/db-path.ts
  import { existsSync } from "fs";
  import { homedir } from "os";
  import { dirname, join, resolve } from "path";

  export const DEFAULT_DB_PATH = join(
    homedir(),
    ".local/share/pi/subagents/subagents-history.sqlite"
  );

  export function projectNameForCwd(cwd: string): string { /* unchanged */ }
  function slugify(name: string): string { /* unchanged */ }
  export function projectScopedDbPath(cwd: string): string { /* unchanged */ }

  export function resolveDbPath(
    cwd: string,
    env: NodeJS.ProcessEnv = process.env
  ): string {
    const envPath = env.PI_SUBAGENTS_HISTORY_DB_PATH;
    if (envPath) return resolve(envPath);
    const projectDb = projectScopedDbPath(cwd);
    return existsSync(projectDb) ? projectDb : DEFAULT_DB_PATH;
  }
  ```

- `src/types.ts` — shared `SubagentTask`, `SubagentEvent`, `TaskAttempt`,
  `isRunning`, `isTerminal`, `generateTaskId`. Both monitor and generator import
  from here.

- `src/generator/db.ts` — `SubagentDb` class (moved from
  `pi-my-sub-agent-generator/src/db.ts`). Constructor signature unchanged so the
  command handlers do not need to be edited beyond their import paths.

- `src/generator/spawner.ts` — moved verbatim from
  `pi-my-sub-agent-generator/src/spawner.ts`. Internal imports updated to use
  `./db-path` and `./types` (now `../db-path` and `../types`).

- `src/generator/commands/spawn.ts` — moved from
  `pi-my-sub-agent-generator/src/commands/spawn.ts`. The handler function keeps
  its name but its signature changes from
  `registerSpawnCommand(ctx: SlashCommandContext, db: SubagentDb)` to
  `handleSpawn(ctx: ExtensionCommandContext, db: SubagentDb)` so it matches the
  monitor's existing pattern.

- `src/generator/commands/cancel.ts` — same move. Signature changes from
  `SlashCommandContext` to `ExtensionCommandContext`.

- `src/generator/commands/resume.ts` — same move. Same signature change.

- `src/generator/index.ts` — extracted as the generator half of the extension.
  Re-exports `handleSpawn`, `handleCancel`, `handleResume`, `SubagentDb`,
  `spawnAgent`, plus the type guards. The main `src/index.ts` calls into this
  module from inside the existing `function extension(pi: ExtensionAPI)` block.

- `tests/README.md` — short doc explaining how to run monitor tests vs generator
  tests, what each suite covers, and which suite requires a writable temp DB.

### Modified files

- `src/index.ts` — keep the existing monitor extension body intact, but at the
  bottom of the same `function extension(pi: ExtensionAPI)` block, after the
  monitor registers all its commands and shortcuts, append:

  ```ts
  import { registerGeneratorCommands } from "./generator";
  registerGeneratorCommands(pi);
  ```

  This adds the three generator slash commands to the same extension. The
  `SHORTCUT_FLAG` guard we already have for the monitor also protects the
  generator commands, so there is no double-registration risk when multiple
  extension copies load.

  Also drop the local `resolveMonitorDbPath` and `DEFAULT_DB_PATH` definitions
  in favour of importing from `./db-path`.

  Bump the version constant in the `package.json` header comment from `0.7.1`
  to `0.8.0`.

- `package.json` — bump `version` to `0.8.0`. Update `description` to mention
  that the package now also ships a sub-agent generator. No new dependencies
  are expected; both halves already run on the same Pi + `node:sqlite` peer
  dependencies.

- `README.md` — replace the "Use as a Pi extension" section's intro to mention
  that the package now also ships the generator commands. Keep all existing
  command tables intact (both monitor and generator commands are listed).

- `tsup.config.ts` — entry stays `src/index.ts`. No structural changes; the
  single entry already covers everything because `src/generator/index.ts` is
  imported transitively.

### Removed files

After the new build is verified and the manual test below passes, the old
sub-project is deleted:

- `pi-my-sub-agent-generator/src/commands/cancel.ts`
- `pi-my-sub-agent-generator/src/commands/resume.ts`
- `pi-my-sub-agent-generator/src/commands/spawn.ts`
- `pi-my-sub-agent-generator/src/db.ts`
- `pi-my-sub-agent-generator/src/index.ts`
- `pi-my-sub-agent-generator/src/spawner.ts`
- `pi-my-sub-agent-generator/src/types.ts`
- `pi-my-sub-agent-generator/test-harness/` (already superseded by the merged
  `tests/` suite — see execution checklist)
- `pi-my-sub-agent-generator/package.json` (last, after the merged build is
  verified to satisfy the manual test)

Until that point, `pi-my-sub-agent-generator/package.json` becomes a stub that
points its `main` at `../dist/index.js`, so any local `npm link` keeps working.

## Execution checklist

Run each step in order. Stop and re-plan if any step fails the manual test.

- [ ] 1. Create the worktree and branch:
       `git worktree add ../pi-subagent-monitor-fuse -b fuse/my-sub-agent-generator`.
       All edits below happen inside that worktree, not in `main`.
- [ ] 2. Add `src/db-path.ts`, `src/types.ts`. Add `src/generator/` directory
       with `db.ts`, `spawner.ts`, `commands/{spawn,cancel,resume}.ts`,
       `index.ts`. Copy file contents verbatim from the old paths; update
       internal imports as described above.
- [ ] 3. Edit `src/index.ts` to import from the new modules and to call
       `registerGeneratorCommands(pi)` at the end of the `extension()` body.
       Drop the local `DEFAULT_DB_PATH` and `resolveMonitorDbPath` exports in
       favour of re-exports from `./db-path`.
- [ ] 4. Bump `package.json` `version` to `0.8.0`. Update `description` and
       add a one-line `keywords` entry mentioning "generator" if it is missing.
- [ ] 5. Replace `pi-my-sub-agent-generator/package.json` with a stub whose
       `main` points at the merged `dist/index.js`. Keep its `name` and
       `version` so existing `npm link` users are not broken.
- [ ] 6. Update `README.md` intro and "Use as a Pi extension" section per the
       description in the "Modified files" block above. Keep all command tables.
- [ ] 7. `npm run typecheck`. Must exit 0.
- [ ] 8. `npm run build`. Must produce `dist/index.js` without warnings about
       missing exports.
- [ ] 9. Copy `dist/index.js` over the global npm install path so Herdr/Pi
       picks it up:
       `cp dist/index.js ~/.pi/agent/npm/node_modules/pi-subagent-monitor/dist/index.js`
       (this is the same bootstrap workaround we used during the bug-fix
       session; once `settings.json` is updated to use the local path it can be
       retired).
- [ ] 10. Restart Herdr/Pi manually. Open the monitor panel. Verify:
       - `c` cancels a task (writes to `subagent_tasks`).
       - `r` resumes a cancelled/failed/completed task (validates row exists
         then performs INSERT + UPDATE).
       - `/subagent-monitor-hide` and `/subagent-monitor-show` work.
       - `alt+s` and `alt+h` work.
       - `/misubagent-spawn`, `/misubagent-cancel`, `/misubagent-resume` are
         available as slash commands and respond without errors.
- [ ] 11. If step 10 passes, run the test suite listed below. If any test
       fails, fix and restart from step 7.
- [ ] 12. Once the merged build is verified by both manual test and suite,
       delete the old files listed under "Removed files" and the stub
       `pi-my-sub-agent-generator/package.json`.
- [ ] 13. `npm run typecheck && npm run build` one more time to make sure
       nothing references the deleted paths.
- [ ] 14. `git status`, review the diff, then commit with the message proposed
       in the commit-message section below. User approval required before
       `git push`.

## Test checklist (must pass before commit)

### Monitor tests

- `npx tsx test-harness/subagent-db.ts init` — creates a fresh DB with the
  expected schema; must exit 0.
- `npx tsx test-harness/simulate-tree.ts` — inserts a parent/child/grandchild
  task tree; the script ends with `export PI_SUBAGENTS_HISTORY_DB_PATH=…`.
  Must exit 0 and print the export line.
- `npx tsx test-harness/simple-test.ts` — generic sanity check; must exit 0.

### Generator tests

- `npx tsx pi-my-sub-agent-generator/test-harness/spawn.test.ts` — verifies
  `misubagent-spawn` writes a `subagent_tasks` row with status `queued`.
- `npx tsx pi-my-sub-agent-generator/test-harness/cancel.test.ts` — verifies
  `misubagent-cancel` flips a `running` task to `cancelled` and inserts the
  matching `subagent_events` row.
- `npx tsx pi-my-sub-agent-generator/test-harness/resume.test.ts` — verifies
  `misubagent-resume` flips a terminal task back to `running` and creates a
  new attempt.

All generator tests set `PI_SUBAGENTS_HISTORY_DB_PATH` to a per-run temp file
under `test-harness/tmp/` (the scripts already do this).

### Manual smoke test

After Herdr reload, in one session:

1. Open the monitor panel (`/subagent-monitor`).
2. Pick a `running` task from the list.
3. Press `c` — the row status becomes `canc`.
4. Press `r` in detail view on the same task — the row status becomes `run`.
5. Run `/subagent-monitor-db`, choose `Global`, confirm the badge in the
   panel header switches to `DB:G`.
6. Run `/misubagent-spawn foo bar`, confirm a new row appears in the panel
   list within one second.
7. Run `/misubagent-cancel <id>` with the id from step 6, confirm the row
   disappears or flips to `canc`.

If any of the seven steps fails, stop and debug before committing.

## Proposed commit message

```
chore: fuse pi-my-sub-agent-generator into pi-subagent-monitor (v0.8.0)

Move the sub-agent generator sources (db, spawner, commands) from
pi-my-sub-agent-generator/ into src/generator/ of the main package. The two
extensions now ship as a single npm package with a single dist bundle.

- New shared helpers in src/db-path.ts and src/types.ts so monitor and
  generator agree on the SQLite path and on SubagentTask/SubagentEvent
  shapes.
- src/index.ts now calls registerGeneratorCommands(pi) inside the same
  ExtensionAPI block; the existing SHORTCUT_FLAG guard protects against
  duplicate registration when multiple copies load.
- Generator slash commands keep their public names: misubagent-spawn,
  misubagent-cancel, misubagent-resume.
- Monitor keyboard surface (c / r / alt+h / alt+s / ctrl+q) is unchanged.
- README updated; mentions removed from j0k3r; Database scoping section
  rewritten with per-option setup steps.
- Drops the duplicate pi-subagent-monitor ^0.6.1 self-dependency that was
  masking local edits.
- Bumps version 0.7.1 -> 0.8.0.
```

## Risks

- **Command-context API mismatch.** The generator currently uses
  `SlashCommandContext` from the Pi SDK; the monitor uses
  `ExtensionCommandContext`. The merged code standardises on
  `ExtensionCommandContext` because that is the surface the main extension
  uses. If any generator command relied on `SlashCommandContext`-only methods,
  the porting work happens in step 3 of the checklist.
- **Duplicate `SHORTCUT_FLAG`.** Today the generator does not register
  shortcuts, so there is nothing to clash. If future generator work adds a
  shortcut, it must use the same `globalThis.__piSubagentMonitorShortcutRegistered`
  flag (renamed mentally to "this extension's flag") to avoid double registration.
- **Lost generator `npm link`.** Anyone who today does
  `npm link pi-my-sub-agent-generator` keeps working as long as the stub
  `package.json` in `pi-my-sub-agent-generator/` stays. We delete the stub
  only in step 12.
- **`tsup` entry.** Today the entry is `src/index.ts`; after the merge that
  file transitively imports `./generator`. `tsup` bundles both, so there is no
  separate bundle for the generator. If downstream tooling expects two
  bundles, that becomes a follow-up issue.