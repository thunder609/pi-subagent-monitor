// fixture-parent-child.cjs
// Seeds a parent + child subtask pair in a clean SQLite file. Smoke fixture for
// the drawer parent/child navigation surfaces. Not a Vitest test — meant to be
// run manually against a fresh test DB and then pointed at by the monitor.

const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const FIXTURE_DIR = path.resolve(__dirname, ".fixture-parent-child");
const DB_PATH = path.join(FIXTURE_DIR, "subagent-history.sqlite");
const SCHEMA_PATH = path.resolve(__dirname, "schema.sql");

function resetDir() {
  if (fs.existsSync(FIXTURE_DIR)) {
    fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function main() {
  resetDir();
  const db = new DatabaseSync(DB_PATH);
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));

  const parentSessionId = "fixture-parent-" + Date.now();
  const childSessionId = "fixture-child-" + Date.now();
  const parentId = "fixture-parent-" + parentSessionId.slice(-6);
  const childId = "fixture-child-" + childSessionId.slice(-6);

  const now = nowIso();

  db.prepare(`
    INSERT INTO subagent_tasks (id, cwd, agent, mode, status, created_at, session_id, nested_session_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(parentId, process.cwd(), "fixture-parent", "foreground", "completed", now, parentSessionId, null);

  db.prepare(`
    INSERT INTO subagent_tasks (id, cwd, agent, mode, status, created_at, session_id, nested_session_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(childId, process.cwd(), "fixture-child", "background", "running", now, childSessionId, null);

  db.prepare(`
    INSERT INTO subagent_events (task_id, created_at, status, activity)
    VALUES (?, ?, ?, ?)
  `).run(parentId, now, "completed", "Spawned child");
  db.prepare(`
    INSERT INTO subagent_events (task_id, created_at, status, activity)
    VALUES (?, ?, ?, ?)
  `).run(childId, now, "running", "Working on fixture task");

  db.close();

  console.log(`✅ Fixture seeded at: ${DB_PATH}`);
  console.log(`   Parent id: ${parentId}`);
  console.log(`   Child  id: ${childId}`);
  console.log("");
  console.log("To exercise the drawer against this fixture:");
  console.log(`  export PI_SUBAGENTS_HISTORY_DB_PATH="${DB_PATH}"`);
  console.log("  /subagent-monitor");
  console.log("  ↑/↓ select the child → Enter to open drawer → ← to jump to parent");
}

main();