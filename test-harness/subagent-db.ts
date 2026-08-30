// subagent-db.ts
// Helper mínimo para escribir a SQLite compatible con pi-subagent-monitor
// Usa node:sqlite built-in (Node >= 22.5) - cero dependencias nativas

import { createRequire } from "module";
import { DatabaseSync } from "node:sqlite";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync: DB } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

function pathModule(): typeof import("path") { return require("path"); }
const path = pathModule();

export class SubagentDB {
  private db: DB;

  constructor(dbPath: string) {
    this.db = new DB(dbPath);
    // Aplicar pragmas compatibles con node:sqlite
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subagent_tasks (
        id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        agent TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('foreground','background')),
        status TEXT NOT NULL CHECK (status IN ('running','completed','failed','queued','cancelled','canceled')),
        created_at TEXT NOT NULL,
        session_id TEXT,
        nested_session_path TEXT
      );
      CREATE TABLE IF NOT EXISTS subagent_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        activity TEXT,
        output_preview TEXT,
        FOREIGN KEY (task_id) REFERENCES subagent_tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_cwd ON subagent_tasks(cwd);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON subagent_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_session ON subagent_tasks(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_task ON subagent_events(task_id);
      CREATE INDEX IF NOT EXISTS idx_events_created ON subagent_events(created_at);
    `);
  }

  // --- Tasks ---
  createTask(cwd: string, agent: string, mode: "foreground" | "background", sessionId?: string, nestedSessionPath?: string): string {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO subagent_tasks (id, cwd, agent, mode, status, created_at, session_id, nested_session_path)
      VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)
    `).run(id, cwd, agent, mode, now, sessionId ?? null, nestedSessionPath ?? null);
    return id;
  }

  startTask(taskId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE subagent_tasks SET status = 'running', started_at = ?, last_activity_at = ? WHERE id = ?
    `).run(now, now, taskId);
    this.addEvent(taskId, "running", "Task started");
  }

  completeTask(taskId: string, finalStatus: "completed" | "failed" = "completed"): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE subagent_tasks SET status = ?, ended_at = ?, last_activity_at = ? WHERE id = ?
    `).run(finalStatus, now, now, taskId);
    this.addEvent(taskId, finalStatus, finalStatus === "completed" ? "Task completed" : "Task failed");
  }

  updateUsage(taskId: string, inputTokens?: number, outputTokens?: number, cost?: number): void {
    const sets: string[] = [];
    const vals: any[] = [];
    if (inputTokens !== undefined) { sets.push("usage_input = ?"); vals.push(inputTokens); }
    if (outputTokens !== undefined) { sets.push("usage_output = ?"); vals.push(outputTokens); }
    if (cost !== undefined) { sets.push("usage_cost = ?"); vals.push(cost); }
    if (sets.length > 0) {
      vals.push(taskId);
      this.db.prepare(`UPDATE subagent_tasks SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    }
  }

  addEvent(taskId: string, status: string, activity?: string): void {
    this.db.prepare(`
      INSERT INTO subagent_events (task_id, created_at, status, activity)
      VALUES (?, ?, ?, ?)
    `).run(taskId, new Date().toISOString(), status, activity ?? null);
  }

  // --- Tree navigation ---
  buildTaskTree(tasks: any[]): Map<string, { task: any; parentId: string | null; childrenIds: string[]; siblingIndex: number; siblingCount: number }> {
    const nodeMap = new Map<string, { task: any; parentId: string | null; childrenIds: string[]; siblingIndex: number; siblingCount: number }>();
    for (const task of tasks) {
      nodeMap.set(task.id, { task, parentId: null, childrenIds: [], siblingIndex: 0, siblingCount: 1 });
    }
    const bySession = new Map<string, any[]>();
    for (const task of tasks) {
      if (task.session_id) {
        const arr = bySession.get(task.session_id) || [];
        arr.push(task);
        bySession.set(task.session_id, arr);
      }
    }
    for (const [, sessionTasks] of bySession) {
      sessionTasks.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      for (let i = 0; i < sessionTasks.length; i++) {
        const node = nodeMap.get(sessionTasks[i].id)!;
        node.siblingIndex = i; node.siblingCount = sessionTasks.length;
        if (i > 0) node.parentId = sessionTasks[i - 1].id;
      }
    }
    for (const task of tasks) {
      if (task.nested_session_path) {
        const childSessionId = task.nested_session_path.split("/").pop()?.replace(".jsonl", "");
        if (childSessionId) {
          const children = tasks.filter((t: any) => t.session_id === childSessionId);
          for (const child of children) {
            const childNode = nodeMap.get(child.id)!;
            childNode.parentId = task.id;
            nodeMap.get(task.id)!.childrenIds.push(child.id);
          }
        }
      }
    }
    return nodeMap;
  }

  getTaskTree(cwd?: string, allCwds = false): Map<string, { task: any; parentId: string | null; childrenIds: string[]; siblingIndex: number; siblingCount: number }> {
    const tasks = cwd ? this.listTasks(cwd, allCwds) : this.listTasks(undefined, true);
    return this.buildTaskTree(tasks);
  }

  printTree(cwd?: string, allCwds = false): void {
    const tree = this.getTaskTree(cwd, allCwds);
    console.log("\n=== TASK TREE ===");
    function printNode(taskId: string, indent = "") {
      const node = tree.get(taskId);
      if (!node) return;
      const t = node.task;
      const statusColor = t.status === "running" ? "\x1b[32m" : t.status === "completed" ? "\x1b[34m" : t.status === "failed" ? "\x1b[31m" : "\x1b[90m";
      console.log(`${indent}├─ ${t.agent} (${t.id.slice(0, 8)}) [${statusColor}${t.status}\x1b[0m] ${t.mode}`);
      for (const childId of node.childrenIds) {
        printNode(childId, indent + "│  ");
      }
    }
    for (const [id, node] of tree) {
      if (!node.parentId) printNode(id);
    }
    console.log("");
  }

  // --- Events ---
  getEvents(taskId: string): any[] {
    return this.db.prepare("SELECT * FROM subagent_events WHERE task_id = ? ORDER BY created_at ASC").all(taskId);
  }

  close(): void { this.db.close(); }
}

// --- Singleton ---
let _instance: SubagentDB | null = null;
export function getSubagentDB(dbPath: string): SubagentDB {
  if (!_instance) _instance = new SubagentDB(dbPath);
  return _instance;
}