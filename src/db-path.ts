/**
 * Database path resolution for both the monitor (read) and the generator
 * (write). Single source of truth so the two halves never disagree on which
 * SQLite file is being read or written.
 *
 * Resolution rules (mode = "auto", the default):
 *   1. If PI_SUBAGENTS_HISTORY_DB_PATH is set, use that exact path.
 *   2. Otherwise, if a per-project file `subagents-history-<project>.sqlite`
 *      exists next to the global DB, use it.
 *   3. Otherwise, fall back to the shared global DB.
 *
 * The `project` and `global` modes are explicit and skip steps 2 and 1.
 */
import { existsSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join, resolve } from "path";
import { execSync } from "child_process";

export const DEFAULT_DB_PATH = join(
  homedir(),
  ".local/share/pi/subagents/subagents-history.sqlite",
);

export type MonitorDbMode = "auto" | "project" | "global";

/** Derive a stable project name from a working directory: git root basename,
 *  falling back to the cwd basename. Pinable with PI_SUBAGENTS_PROJECT_NAME. */
export function projectNameForCwd(cwd: string): string {
  const envName = process.env.PI_SUBAGENTS_PROJECT_NAME;
  if (envName && envName.trim()) return envName.trim();
  try {
    const root = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (root) return basename(root);
  } catch {
    /* not a git repo — fall through */
  }
  return basename(cwd) || "project";
}

function slugify(name: string): string {
  return (
    name
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

export function projectScopedDbPath(cwd: string): string {
  return join(
    dirname(DEFAULT_DB_PATH),
    `subagents-history-${slugify(projectNameForCwd(cwd))}.sqlite`,
  );
}

/** Effective DB path for a mode: the generator writes the same file when
 *  PI_SUBAGENTS_HISTORY_DB_PATH is set, so the monitor must honor it first. */
export function resolveMonitorDbPath(mode: MonitorDbMode, cwd: string): string {
  if (mode === "project") return projectScopedDbPath(cwd);
  if (mode === "global") return DEFAULT_DB_PATH;
  const envPath = process.env.PI_SUBAGENTS_HISTORY_DB_PATH;
  if (envPath) return resolve(envPath);
  const projectDb = projectScopedDbPath(cwd);
  return existsSync(projectDb) ? projectDb : DEFAULT_DB_PATH;
}

/** Default path used when no env var is set and the caller does not know its
 *  cwd. Equivalent to the global DB. */
export function defaultDbPath(): string {
  return DEFAULT_DB_PATH;
}