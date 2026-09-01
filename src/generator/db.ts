import { existsSync } from "fs";
import { resolve } from "path";
import { createRequire as createNodeRequire } from "module";
import { DEFAULT_DB_PATH } from "../db-path";
import type { DatabaseSync as DatabaseSyncInstance } from "node:sqlite";

// Runtime require for node:sqlite: keeps the specifier verbatim regardless of
// bundler builtin-list age (older tsup rewrote "node:sqlite" into "sqlite").
// Aliased import avoids colliding with tsup's injected banner (which already
// declares `createRequire` at the top of the bundle).
const nodeRequire = createNodeRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

/** Resolve the SQLite path: a customPath wins, otherwise the default global path. */
export function getDbPath(customPath?: string): string {
  if (customPath) return resolve(customPath);
  return DEFAULT_DB_PATH;
}

export interface DbOptions {
  dbPath?: string;
}

/**
 * Thin wrapper around node:sqlite that adds:
 *   - constructor-level existence check
 *   - tx() helper for BEGIN/COMMIT/ROLLBACK
 *   - prepare-once style exec()
 *
 * Used by the generator commands (spawn/cancel/resume) to read and write
 * subagent_tasks + subagent_events.
 */
export class SubagentDb {
  private db: DatabaseSyncInstance | null = null;
  private path: string;

  constructor(options: DbOptions = {}) {
    this.path = getDbPath(options.dbPath);
    if (!existsSync(this.path)) {
      throw new Error(
        `DB not found at ${this.path}. Run 'npm run init-db' to initialize the schema.`,
      );
    }
  }

  connect(): DatabaseSyncInstance {
    if (!this.db) {
      this.db = new DatabaseSync(this.path, { readOnly: false });
    }
    return this.db;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /** Run a function inside a BEGIN/COMMIT/ROLLBACK transaction. */
  async tx<T>(fn: (db: DatabaseSyncInstance) => Promise<T>): Promise<T> {
    const db = this.connect();
    db.exec("BEGIN TRANSACTION");
    try {
      const result = await fn(db);
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Read a single row from a SELECT, or undefined if no rows. */
  async queryRow<T>(sql: string, _params: unknown[] = []): Promise<T | undefined> {
    const db = this.connect();
    const stmt = db.prepare(sql);
    const rows = stmt.all() as T[];
    return rows.length > 0 ? rows[0] : undefined;
  }

  /** Execute INSERT/UPDATE/DELETE inside the implicit transaction. */
  async exec(sql: string, _params: unknown[] = []): Promise<void> {
    const db = this.connect();
    const stmt = db.prepare(sql);
    stmt.run();
  }
}