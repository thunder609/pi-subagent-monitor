import { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Component, OverlayHandle, TUI, KeybindingsManager, visibleWidth, matchesKey } from "@earendil-works/pi-tui";
import { join, basename } from "path";
import { homedir } from "os";
import { existsSync, openSync, readSync, closeSync, fstatSync } from "fs";
import { createRequire as createNodeRequire } from "module";
import { DEFAULT_DB_PATH, resolveMonitorDbPath } from "./db-path";
import type { MonitorDbMode } from "./db-path";
import { registerGeneratorCommands } from "./generator";
import type { SubagentTask, SubagentEvent, ViewMode, TaskNode } from "./types";
import { buildTaskTree } from "./types";
import type { DatabaseSync as DatabaseSyncInstance } from "node:sqlite";

// Runtime require for node:sqlite: keeps the specifier verbatim regardless of
// bundler builtin-list age (older tsup rewrote "node:sqlite" into "sqlite").
// Aliased import avoids colliding with tsup's injected banner.
const nodeRequire = createNodeRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

export { DEFAULT_DB_PATH } from "./db-path";
export const DEFAULT_INTERVAL_MS = 1000;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Extract a short human-readable summary from one pi session .jsonl entry. */
export interface SessionLine { kind: "user" | "assistant" | "think" | "call" | "result" | "code"; text: string }
function compactToolArgs(args: any): string {
  if (args && typeof args === "object") {
    const key = ["command", "path", "file_path", "cmd", "query", "pattern", "prompt", "task", "description", "url"].find(k => typeof args[k] === "string" && args[k]);
    if (key) return String(args[key]).replace(/\s+/g, " ").trim().slice(0, 60);
  }
  const s = JSON.stringify(args ?? {});
  return s === "{}" ? "" : s.replace(/\s+/g, " ").slice(0, 50);
}
const CODE_FENCE_RE = /```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)```/g;
const MAX_CODE_LINES = 10;
const MAX_FENCES_PER_BLOCK = 2;
function fenceToLines(lang: string, source: string): SessionLine[] {
  const raw = source.replace(/\t/g, "  ").split("\n");
  while (raw.length && !raw[raw.length - 1].trim()) raw.pop();
  while (raw.length && !raw[0].trim()) raw.shift();
  if (!raw.length) return [];
  const out: SessionLine[] = [{ kind: "code", text: "┌──" + (lang ? " " + lang : "") }];
  for (const l of raw.slice(0, MAX_CODE_LINES)) out.push({ kind: "code", text: "│ " + l });
  if (raw.length > MAX_CODE_LINES) out[out.length - 1] = { kind: "code", text: "└── … +" + (raw.length - MAX_CODE_LINES) + " more lines" };
  else out.push({ kind: "code", text: "└──" });
  return out;
}
function summarizeSessionEntry(entry: any): SessionLine[] {
  if (!entry || typeof entry !== "object") return [];
  const msg = entry.message;
  if (entry.type !== "message" || !msg) {
    return entry.type === "model_change" ? [{ kind: "assistant", text: "model → " + (entry.modelId ?? "?") }] : [];
  }
  if (msg.role === "toolResult") {
    const out = Array.isArray(msg.content)
      ? msg.content.map((c: any) => (c?.type === "text" && c.text ? c.text : "")).join(" ")
      : String(msg.content ?? "");
    const flag = msg.isError ? "✗" : "←";
    const name = msg.toolName ?? "tool";
    return [{ kind: "result", text: flag + " " + name + ": " + out.replace(/\s+/g, " ").trim().slice(0, 90) }];
  }
  const role = msg.role === "assistant" ? "assistant" : "you";
  if (Array.isArray(msg.content)) {
    const lines: SessionLine[] = [];
    for (const c of msg.content) {
      if (c?.type === "text" && c.text) {
        const txt = String(c.text);
        const fences = [...txt.matchAll(CODE_FENCE_RE)];
        if (!fences.length || role === "you") {
          lines.push({ kind: role === "you" ? "user" : "assistant", text: role + ": " + txt.replace(/\s+/g, " ").trim() });
        } else {
          const prose = txt.slice(0, Math.max(0, (fences[0].index ?? 0))).replace(/\s+/g, " ").trim();
          lines.push({ kind: "assistant", text: "assistant: " + (prose ? prose.slice(0, 80) : "[generated code]") });
          for (const f of fences.slice(0, MAX_FENCES_PER_BLOCK)) lines.push(...fenceToLines(f[1], f[2]));
          if (fences.length > MAX_FENCES_PER_BLOCK) lines.push({ kind: "assistant", text: "assistant: … +" + (fences.length - MAX_FENCES_PER_BLOCK) + " more code blocks" });
        }
      }
      else if ((c?.type === "thinking" || c?.type === "reasoning") && (c.thinking || c.text)) lines.push({ kind: "think", text: "~ " + String(c.thinking || c.text).replace(/\s+/g, " ").trim() });
      else if (c?.type === "toolCall" || c?.type === "tool_use" || c?.type === "toolUse") {
        const rawArgs = c.arguments ?? c.input;
        const args = compactToolArgs(rawArgs);
        lines.push({ kind: "call", text: "→ " + (c.name ?? "tool") + (args ? " " + args : "") });
        // Source code written to created/modified files (write/edit tools).
        const srcKey = rawArgs && typeof rawArgs === "object"
          ? ["content", "new_string", "newText", "source"].find(k => typeof rawArgs[k] === "string" && rawArgs[k].includes("\n"))
          : undefined;
        if (srcKey) lines.push(...fenceToLines("", rawArgs[srcKey]));
      }
    }
    return lines;
  }
  if (typeof msg.content === "string" && msg.content.trim()) return [{ kind: role === "you" ? "user" : "assistant", text: role + ": " + msg.content.replace(/\s+/g, " ").trim() }];
  return [];
}
export function tailSession(nestedSessionPath: string | null, maxEntries = 140, maxBytes = 192 * 1024): SessionLine[] {
  if (!nestedSessionPath) return [];
  const candidates = nestedSessionPath.startsWith("/")
    ? [nestedSessionPath]
    : [join(homedir(), ".pi", "agent", "sessions", nestedSessionPath), nestedSessionPath];
  const path = candidates.find(p => existsSync(p));
  if (!path) return [];
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, start);
    const lines = buf.toString("utf8").split("\n").filter(l => l.trim().length > 0);
    const out: SessionLine[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < maxEntries; i--) {
      try {
        const entries = summarizeSessionEntry(JSON.parse(lines[i]));
        if (!entries.length) continue;
        const room = maxEntries - out.length;
        if (room <= 0) break;
        out.unshift(...entries.slice(0, Math.min(room, entries.length)));
      } catch { /* partial line — skip */ }
    }
    return out;
  } catch { return []; }
  finally { if (fd !== null) try { closeSync(fd); } catch { /* ignore */ } }
}

// Inline color function (not exported from pi-tui)
function color(text: string, style?: string): string {
  const styles: Record<string, string> = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m",
    magenta: "\x1b[35m", cyan: "\x1b[36m", white: "\x1b[37m", bgGreen: "\x1b[42m"
  };
  if (!style) return text;
  const codes = style.split(" ").map(s => styles[s] || "").filter(Boolean).join("");
  return codes ? `${codes}${text}\x1b[0m` : text;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
export function formatTokens(n: number | null): string {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}
export function formatCost(c: number | null): string {
  if (!c) return "$0.00";
  return "$" + c.toFixed(4);
}
function statusColor(status: string): keyof typeof COLORS {
  switch (status) {
    case "running": return "green";
    case "completed": return "blue";
    case "failed": return "red";
    case "queued": return "yellow";
    default: return "white";
  }
}
const COLORS = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m", white: "\x1b[37m", gray: "\x1b[90m", bgGreen: "\x1b[42m" };
export function modeBadge(mode: string): string { return mode === "background" ? "BG" : "FG"; }
export function truncate(str: string, len: number): string { if (str.length <= len) return str; return str.slice(0, len - 1) + "…"; }

// --- Box drawing helpers: every emitted line is EXACTLY `W` visible columns wide ---
const ANSI_RE = /(\x1b\[[0-9;]*m)/g;
const boxTop = (W: number): string => color("╔" + "═".repeat(Math.max(0, W - 2)) + "╗", "cyan");
const boxSep = (W: number, ch = "═"): string => color("╠" + ch.repeat(Math.max(0, W - 2)) + "╣", "cyan");
const boxBottom = (W: number): string => color("╚" + "═".repeat(Math.max(0, W - 2)) + "╝", "cyan");
function visibleTruncate(s: string, maxVisible: number): string {
  if (maxVisible < 1 || visibleWidth(s) <= maxVisible) return s;
  let out = "", vis = 0, i = 0;
  while (i < s.length && vis < maxVisible - 1) {
    if (s[i] === "\x1b") { const m = /^(\x1b\[[0-9;]*m)/.exec(s.slice(i)); if (m) { out += m[1]; i += m[1].length; continue; } }
    out += s[i]; i++; vis++;
  }
  return out + "…";
}
function boxLine(content: string, W: number): string {
  const inner = Math.max(0, W - 4); // "║ " + content + " ║"
  let c = visibleWidth(content) > inner ? visibleTruncate(content, inner) : content;
  c += " ".repeat(Math.max(0, inner - visibleWidth(c)));
  return color("║ ", "cyan") + c + color(" ║", "cyan");
}
function boxLineCentered(content: string, W: number): string {
  const inner = Math.max(0, W - 4);
  const vw = Math.min(visibleWidth(content), inner);
  const text = vw < visibleWidth(content) ? truncate(content, vw) : content;
  const left = Math.floor((inner - vw) / 2);
  const right = inner - vw - left;
  return color("║ ", "cyan") + " ".repeat(left) + text + " ".repeat(right) + color(" ║", "cyan");
}

// Re-export shared types so existing library consumers keep working.
export type { SubagentTask, SubagentEvent, ViewMode, TaskNode } from "./types";

export { buildTaskTree } from "./types";

// --- Monitor Component ---
class SubagentMonitorComponent implements Component {
  private db: DatabaseSyncInstance | null = null;
  private dbPath: string; private cwd: string; private allCwds: boolean; private intervalMs: number;
  private tasks: SubagentTask[] = []; private taskTree: Map<string, TaskNode> = new Map();
  private running = false; private intervalId: NodeJS.Timeout | null = null;
  private cachedWidth?: number; private cachedLines?: string[];
  private dbError: string | null = null;
  private viewMode: ViewMode = "list"; private selectedIndex = 0;
  private selectedTask: SubagentTask | null = null; private detailEvents: SubagentEvent[] = [];
  private detailScroll = 0; private projectMode = false;
  private dbMode: MonitorDbMode = "auto";
  private listScroll = 0; private lastVisibleRows = 10;
  private followTail = true; private spinnerFrame = 0;
  private rPressedCount = 0;
  private lastResumeError: string | null = null;
  private lastResumeTarget: string | null = null;
  private liveSessionLines: SessionLine[] = [];
  private heightProvider?: () => number;
  private onProject?: (task: SubagentTask, events: SubagentEvent[]) => void;
  private onRequestUnfocus?: () => void;
  private onExpand?: (expanded: boolean) => void;
  private onHide?: () => void;

  constructor(options: { dbPath?: string; cwd?: string; allCwds?: boolean; intervalMs?: number; dbMode?: MonitorDbMode; heightProvider?: () => number; onProject?: (task: SubagentTask, events: SubagentEvent[]) => void; onRequestUnfocus?: () => void; onExpand?: (expanded: boolean) => void; onHide?: () => void } = {}) {
    this.cwd = options.cwd || process.cwd(); this.allCwds = options.allCwds || false;
    this.intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS; this.onProject = options.onProject; this.onRequestUnfocus = options.onRequestUnfocus; this.onExpand = options.onExpand;
    this.heightProvider = options.heightProvider; this.onHide = options.onHide;
    this.dbMode = options.dbMode ?? "auto";
    this.dbPath = options.dbPath || resolveMonitorDbPath(this.dbMode, this.cwd);
  }
  /** Target full height in rows for stretching the panel vertically. */
  private targetHeight(): number { const h = this.heightProvider ? this.heightProvider() : 0; return h >= 14 ? h : 24; }
  getDbMode(): MonitorDbMode { return this.dbMode; }
  getDbPath(): string { return this.dbPath; }
  /** Switch the DB scope live: reconnect to the new file and refresh. */
  setDbMode(mode: MonitorDbMode): void {
    this.dbMode = mode;
    this.dbPath = resolveMonitorDbPath(mode, this.cwd);
    if (this.running) {
      this.disconnect(); this.connect();
      this.tasks = this.fetchTasks(); this.refreshTree();
      this.selectedIndex = 0; this.viewMode = "list"; this.selectedTask = null;
    }
    this.invalidate();
  }
  setAllCwds(all: boolean): void { this.allCwds = all; this.invalidate(); }
  private connect(): boolean {
    try { this.db = new DatabaseSync(this.dbPath, { readOnly: true }); this.dbError = null; return true; }
    catch (e) { this.dbError = e instanceof Error ? e.message : String(e); return false; }
  }
  private disconnect(): void { if (this.db) { this.db.close(); this.db = null; } }
  private fetchTasks(): SubagentTask[] {
    if (!this.db) return [];
    try {
      let sql: string;
      if (this.allCwds) {
        sql = "SELECT id, cwd, agent, mode, status, started_at, ended_at, usage_input, usage_output, usage_cache_read, usage_cache_write, usage_cost, usage_turns, model, effort, last_activity, last_activity_at, created_at, session_id, nested_session_path, attempt FROM subagent_tasks ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, created_at DESC LIMIT 50";
        const stmt = this.db.prepare(sql); return stmt.all() as unknown as SubagentTask[];
      }
      sql = "SELECT id, cwd, agent, mode, status, started_at, ended_at, usage_input, usage_output, usage_cache_read, usage_cache_write, usage_cost, usage_turns, model, effort, last_activity, last_activity_at, created_at, session_id, nested_session_path, attempt FROM subagent_tasks WHERE cwd = ? ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, created_at DESC LIMIT 30";
      const stmt = this.db.prepare(sql); return stmt.all(this.cwd) as unknown as SubagentTask[];
    } catch (e) { this.dbError = e instanceof Error ? e.message : String(e); return []; }
  }
  private fetchEvents(taskId: string): SubagentEvent[] {
    if (!this.db || !taskId) return [];
    try { const sql = "SELECT created_at, status, activity, output_preview FROM subagent_events WHERE task_id = ? ORDER BY created_at ASC"; const stmt = this.db.prepare(sql); return stmt.all(taskId) as unknown as SubagentEvent[]; }
    catch { return []; }
  }
  /** Full resume: creates new attempt, updates task to queued/running, inserts resume event. */
  private resumeTask(task: SubagentTask): void {
    this.lastResumeError = null;
    this.lastResumeTarget = task.id;
    const writeDb = new DatabaseSync(this.dbPath, { readOnly: false });
    try {
      const now = new Date().toISOString();
      const newAttempt = (task.attempt || 1) + 1;

      // Validate: task must exist in subagent_tasks. Without this guard, the
      // INSERT...SELECT inserts 0 rows silently and the task is never resumed.
      const exists = writeDb.prepare(`SELECT 1 AS x FROM subagent_tasks WHERE id = ?`).get(task.id);
      if (!exists) {
        this.lastResumeError = `task id not found in subagent_tasks: ${task.id}`;
        return;
      }
      writeDb.exec(`
      INSERT INTO subagent_task_attempts (
        task_id, attempt, cwd, agent, mode, status, task, context,
        created_at, session_id, nested_session_path,
        started_at, ended_at, last_activity_at, last_activity,
        output_preview, prompt, continuation_prompt, system_prompt,
        transcript, usage_input, usage_output, usage_cache_read, usage_cache_write,
        usage_cost, usage_context_tokens, usage_turns, model, effort,
        model_source, effort_source, fallback_used, error, error_metadata_json,
        error_category, result, thread_snapshot_json,
        pi_retry_attempts, pending_message_count, undelivered_message_count
      ) SELECT 
        '${task.id}', ${newAttempt}, cwd, agent, mode, 'running', task, context,
        '${now}', session_id, nested_session_path,
        '${now}', NULL, '${now}', 'resumed',
        output_preview, prompt, continuation_prompt, system_prompt,
        transcript, usage_input, usage_output, usage_cache_read, usage_cache_write,
        usage_cost, usage_context_tokens, usage_turns, model, effort,
        model_source, effort_source, fallback_used, error, error_metadata_json,
        error_category, result, thread_snapshot_json,
        pi_retry_attempts, pending_message_count, undelivered_message_count
      FROM subagent_tasks WHERE id = '${task.id}'
      `);
      writeDb.exec(`
      UPDATE subagent_tasks SET status='queued', attempt=${newAttempt} WHERE id='${task.id}'
      `);
      writeDb.exec(`
      UPDATE subagent_tasks 
      SET status='running', started_at='${now}',
          last_activity_at='${now}', last_activity='resumed',
          ended_at=NULL
      WHERE id='${task.id}'
      `);
      writeDb.exec(`
      INSERT INTO subagent_events (task_id, attempt, cwd, created_at, status, activity, output_preview)
      VALUES ('${task.id}', ${newAttempt}, '${this.cwd}', '${now}', 'running', 'resumed', NULL)
      `);
      task.status = "running";
      task.attempt = newAttempt;
      task.started_at = now;
      task.last_activity_at = now;
      task.last_activity = "resumed";
    } catch (e) {
      this.lastResumeError = String((e as Error)?.message ?? e);
      console.error("Resume failed:", e);
    } finally {
      writeDb.close();
    }
  }
  private cancelTask(task: SubagentTask): void {
    this.lastResumeError = null;
    this.lastResumeTarget = task.id;
    const writeDb = new DatabaseSync(this.dbPath, { readOnly: false });
    try {
      const now = new Date().toISOString();
      // Validate: task must exist; UPDATE on missing row would silently affect 0 rows.
      const exists = writeDb.prepare(`SELECT 1 AS x FROM subagent_tasks WHERE id = ?`).get(task.id);
      if (!exists) {
        this.lastResumeError = `cancel: task id not found in subagent_tasks: ${task.id}`;
        return;
      }
      const result = writeDb.prepare(`UPDATE subagent_tasks SET status = 'cancelled', ended_at = ?, last_activity_at = ?, last_activity = 'cancelled' WHERE id = ?`).run(now, now, task.id);
      if (result.changes === 0) {
        this.lastResumeError = `cancel: UPDATE affected 0 rows for id=${task.id}`;
        return;
      }
      task.status = "cancelled";
      task.ended_at = now;
      task.last_activity_at = now;
      task.last_activity = "cancelled";
    } catch (e) {
      this.lastResumeError = String((e as Error)?.message ?? e);
      console.error("Cancel failed:", e);
    } finally {
      writeDb.close();
    }
  }
  private refreshTree(): void { this.taskTree = buildTaskTree(this.tasks); }
  start(): void { if (!this.connect()) return; this.running = true; this.tick(); this.intervalId = setInterval(() => this.tick(), this.intervalMs); }
  stop(): void { this.running = false; if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; } this.disconnect(); }
  private tick(): void {
    if (!this.running) return;
    try {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      this.tasks = this.fetchTasks(); this.refreshTree();
      if (this.selectedIndex >= this.tasks.length) this.selectedIndex = Math.max(0, this.tasks.length - 1);
      if (this.viewMode === "detail" && this.selectedTask) {
        const stillExists = this.tasks.some(t => t.id === this.selectedTask!.id);
        if (!stillExists) { this.viewMode = "list"; this.selectedTask = null; this.detailEvents = []; this.liveSessionLines = []; this.detailScroll = 0; }
        else {
          // Live view: stream events + session activity while the subagent is running.
          if (this.selectedTask.status === "running") {
            this.detailEvents = this.fetchEvents(this.selectedTask.id);
            this.liveSessionLines = tailSession(this.selectedTask.nested_session_path);
            if (this.followTail) this.detailScroll = 0;
          }
        }
      }
      this.invalidate();
    } catch { }
  }
  handleInput(data: string): void { if (this.viewMode === "list") this.handleListInput(data); else this.handleDetailInput(data); }
  private handleListInput(data: string): void {
    if (matchesKey(data, "up")) { if (this.selectedIndex > 0) { this.selectedIndex--; if (this.selectedIndex < this.listScroll) this.listScroll = this.selectedIndex; this.invalidate(); } }
    else if (matchesKey(data, "down")) { if (this.selectedIndex < this.tasks.length - 1) { this.selectedIndex++; if (this.selectedIndex >= this.listScroll + this.lastVisibleRows) this.listScroll = this.selectedIndex - this.lastVisibleRows + 1; this.invalidate(); } }
    else if (matchesKey(data, "return") || matchesKey(data, "enter")) { const t = this.tasks[this.selectedIndex]; if (t) { this.openDetail(t); this.onExpand?.(true); } }
    else if (matchesKey(data, "r")) { this.tick(); }
    else if (matchesKey(data, "c")) { const t = this.tasks[this.selectedIndex]; if (t) { this.cancelTask(t); this.tick(); } }
    else if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "b")) { if (this.onRequestUnfocus) this.onRequestUnfocus(); }
    else if (matchesKey(data, "alt+h")) { if (this.onHide) this.onHide(); }
  }
  private handleDetailInput(data: string): void {
    const node = this.selectedTask ? this.taskTree.get(this.selectedTask.id) : null;
    const hasSession = this.liveSessionLines.length > 0;
    const maxScroll = hasSession ? this.liveSessionLines.length : Math.max(0, this.detailEvents.length - 1);
    if (matchesKey(data, "up")) { if (this.detailScroll < maxScroll) { this.detailScroll++; this.followTail = false; this.invalidate(); } }
    else if (matchesKey(data, "down")) { if (this.detailScroll > 0) { this.detailScroll--; if (this.detailScroll === 0) this.followTail = true; this.invalidate(); } }
    else if (matchesKey(data, "end")) { this.detailScroll = 0; this.followTail = true; this.invalidate(); }
    else if (matchesKey(data, "left")) { if (node?.parentId) { const parentTask = this.tasks.find(t => t.id === node.parentId); if (parentTask) this.openDetail(parentTask); } }
    else if (matchesKey(data, "right")) { if (node?.childrenIds.length) { const childTask = this.tasks.find(t => t.id === node.childrenIds[0]); if (childTask) this.openDetail(childTask); } }
    else if (matchesKey(data, "p")) { if (this.selectedTask && this.onProject) { this.onProject(this.selectedTask, this.detailEvents); this.invalidate(); } }
    else if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "b")) { this.closeDetail(); this.onExpand?.(false); }
    else if (matchesKey(data, "alt+h")) { if (this.onHide) this.onHide(); }
    else if (matchesKey(data, "r")) {
          this.rPressedCount++;
          console.error("[PI-MON-DEBUG] detail r pressed, count=", this.rPressedCount, "selectedTask=", this.selectedTask?.id, "status=", this.selectedTask?.status, "raw data=", JSON.stringify(data));
          if (this.selectedTask) {
            const status = this.selectedTask.status?.trim().toLowerCase() || "";
            console.error("[PI-MON-DEBUG] normalized status=", JSON.stringify(status));
            // PLAN C: always call resumeTask to confirm whether the handler runs.
            this.resumeTask(this.selectedTask);
            this.detailEvents = this.fetchEvents(this.selectedTask.id);
            this.liveSessionLines = tailSession(this.selectedTask.nested_session_path);
            this.detailScroll = 0;
            this.followTail = true;
            this.invalidate();
          }
        }
  }
  private openDetail(task: SubagentTask): void { this.selectedTask = task; this.detailEvents = this.fetchEvents(task.id); this.liveSessionLines = tailSession(task.nested_session_path); this.detailScroll = 0; this.followTail = true; this.viewMode = "detail"; this.invalidate(); }
  private closeDetail(): void { this.viewMode = "list"; this.selectedTask = null; this.detailEvents = []; this.liveSessionLines = []; this.detailScroll = 0; this.followTail = true; this.invalidate(); }
  invalidate(): void { this.cachedWidth = undefined; this.cachedLines = undefined; }
  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    const now = Date.now(); const termWidth = width; const lines: string[] = [];
    if (this.viewMode === "list") this.renderList(lines, now, termWidth); else this.renderDetail(lines, termWidth);
    this.cachedLines = lines; this.cachedWidth = width; return lines;
  }
  private renderList(lines: string[], now: number, termWidth: number): void {
    const W = termWidth;
    // Compact columns so the panel fits ~36 terminal columns without cutting
    // data: selector(2) + agent + gap + mode(2) + gap + status(5) + gap + duration.
    const colAgent = 13, colMode = 2, colStatus = 5;
    const durWidth = Math.max(4, W - 29);
    const STATUS_ABBR: Record<string, string> = { completed: "done", failed: "fail", running: "run", queued: "queue", cancelled: "canc", canceled: "canc" };

    lines.push(boxTop(W));
    lines.push(boxLineCentered(color("SUBAGENTS", "bold"), W));
    lines.push(boxSep(W));
    const cwdShort = this.allCwds ? "ALL" : this.cwd.replace(homedir(), "~");
    lines.push(boxLine(color("CWD:", "dim") + " " + color(cwdShort, "white"), W));
    const dbBadge = this.dbMode === "project" ? "DB:P" : this.dbMode === "global" ? "DB:G" : "DB:A";
    lines.push(boxLine(color("DB:", "dim") + " " + color(dbBadge, "cyan") + color(" " + basename(this.dbPath), "dim"), W));
    if (this.dbError) lines.push(boxLine(color("DB Error: " + this.dbError, "red"), W));
    lines.push(boxSep(W));

    const headerCells = " Agent".padEnd(colAgent + 2) + "Md ".padEnd(colMode + 1) + " Stat".slice(0, colStatus + 1).padEnd(colStatus + 1) + " Dur";
    lines.push(boxLine(color(headerCells, "bold"), W));
    lines.push(boxSep(W, "─"));

    // Height-aware task window (panel stretches vertically).
    const FOOTER_LINES = 4;
    const availableRows = Math.max(3, this.targetHeight() - lines.length - FOOTER_LINES);
    const totalTasks = this.tasks.length;
    if (this.listScroll > Math.max(0, totalTasks - availableRows)) this.listScroll = Math.max(0, totalTasks - availableRows);
    if (this.selectedIndex < this.listScroll) this.listScroll = this.selectedIndex;
    if (this.selectedIndex >= this.listScroll + availableRows) this.listScroll = this.selectedIndex - availableRows + 1;
    this.lastVisibleRows = Math.min(totalTasks - this.listScroll, availableRows);

    if (!totalTasks) {
      const msg = this.allCwds ? "No subagent tasks recorded" : "No tasks for this CWD";
      lines.push(boxLine(color(msg, "dim"), W));
    }
    for (let r = 0; r < this.lastVisibleRows; r++) {
      const i = this.listScroll + r;
      const task = this.tasks[i];
      const isSelected = i === this.selectedIndex;
      const started = task.started_at ? new Date(task.started_at).getTime() : null;
      const ended = task.ended_at ? new Date(task.ended_at).getTime() : null;
      const duration = started ? (ended || now) - started : 0;
      const isRunning = task.status === "running";
      const agentName = truncate(task.agent, colAgent - 1);
      const mode = modeBadge(task.mode);
      const durationStr = formatDuration(duration);
      let row = isSelected ? color("▶ ", "cyan") : "  ";
      row += color(agentName.padEnd(colAgent), isSelected ? "yellow" : isRunning ? "green" : "white") + " " +
        color(mode.padEnd(colMode), "dim") + " " +
        color((isRunning ? SPINNER_FRAMES[this.spinnerFrame] + "" : (STATUS_ABBR[task.status] ?? task.status)).slice(0, colStatus).padEnd(colStatus), isRunning ? "bgGreen" : statusColor(task.status)) + " " +
        color(durationStr.slice(0, durWidth).padEnd(durWidth), isRunning ? "green" : "yellow");
      lines.push(boxLine(row, W));
    }
    for (let p = totalTasks ? this.lastVisibleRows : 1; p < availableRows; p++) lines.push(boxLine("", W));

    lines.push(boxSep(W));
    const runningTask = this.tasks.find(t => t.status === "running");
    const currentName = runningTask ? runningTask.agent : (this.tasks[this.selectedIndex]?.agent || "—");
    const liveBadge = runningTask ? color("● LIVE " + SPINNER_FRAMES[this.spinnerFrame], "bgGreen") : color("IDLE", "dim");
    const above = this.listScroll > 0 ? color("↑" + this.listScroll + " ", "cyan") : "";
    const below = this.listScroll + this.lastVisibleRows < totalTasks ? color("↓" + (totalTasks - this.listScroll - this.lastVisibleRows) + " ", "cyan") : "";
    const barContent = liveBadge + " " + color(truncate(currentName, 18), "white") + " " + above + below + color("[Enter] vivo ", "cyan") + color("[r] ↻ ", "yellow") + color("[a] all", "cyan");
    lines.push(boxLine(barContent, W));
    const help = "[↑/↓] select • [Enter] expand • [ctrl+q] focus • [alt+h] hide • Tasks: " + totalTasks + " • r:" + this.rPressedCount + (this.lastResumeError ? " • err:" + this.lastResumeError : "");
    lines.push(boxLine(color(help, "dim"), W));
    lines.push(boxBottom(W));
  }
  private renderDetail(lines: string[], termWidth: number): void {
    const W = termWidth;
    const task = this.selectedTask; if (!task) { this.closeDetail(); return this.renderList(lines, Date.now(), W); }
    const node = this.taskTree.get(task.id);
    const isRunning = task.status === "running";
    lines.push(boxTop(W));
    const livePrefix = isRunning ? SPINNER_FRAMES[this.spinnerFrame] + " LIVE · " : "";
    lines.push(boxLineCentered(color(livePrefix + truncate(task.agent, Math.max(8, W - livePrefix.length - 6)), isRunning ? "bgGreen" : "bold"), W));
    lines.push(boxSep(W));
    const started = task.started_at ? new Date(task.started_at).getTime() : null;
    const ended = task.ended_at ? new Date(task.ended_at).getTime() : null;
    const duration = started ? (ended || Date.now()) - started : 0; const durationStr = formatDuration(duration);
    const inputTokens = task.usage_input || 0; const outputTokens = task.usage_output || 0;
    const tokensStr = "↑" + formatTokens(inputTokens) + " ↓" + formatTokens(outputTokens);
    const costStr = formatCost(task.usage_cost); const sColor = statusColor(task.status);
    let meta = "ID " + truncate(task.id, 8) + " · " + modeBadge(task.mode) + " · "; meta += color(task.status, sColor) + " · " + color(durationStr, "yellow") + " · " + color(tokensStr, "cyan") + " · " + color(costStr, "green");
    lines.push(boxLine(meta, W));
    lines.push(boxSep(W));

    // Height-aware live execution stream.
    const FOOTER_LINES = 4;
    const hasSession = this.liveSessionLines.length > 0;
    const availableRows = Math.max(4, this.targetHeight() - lines.length - FOOTER_LINES);
    if (hasSession) {
      // Main body: the subagent's real execution (thoughts, tool calls, results).
      let scroll = this.detailScroll;
      if (this.followTail) scroll = 0;
      if (scroll > Math.max(0, this.liveSessionLines.length - availableRows)) scroll = Math.max(0, this.liveSessionLines.length - availableRows);
      this.detailScroll = scroll;
      const end = this.liveSessionLines.length - scroll;
      const start = Math.max(0, end - availableRows);
      const windowed = this.liveSessionLines.slice(start, end);
      if (start > 0) lines.push(boxLine(color("↑ " + start + " earlier", "cyan"), W));
      for (const s of windowed) {
        const style = s.kind === "code" ? "gray" : s.kind === "think" ? "cyan" : s.kind === "call" ? "magenta" : s.kind === "result" ? (s.text.startsWith("✗") ? "red" : "green") : s.kind === "user" ? "yellow" : "white";
        lines.push(boxLine(color(s.text, style), W));
      }
      for (let p = windowed.length + (start > 0 ? 1 : 0); p < availableRows; p++) lines.push(boxLine("", W));
    }
    else if (!this.detailEvents.length && !isRunning) { lines.push(boxLine(color("No events recorded", "dim"), W)); }
    else if (!this.detailEvents.length && isRunning) {
      lines.push(boxLine(color(SPINNER_FRAMES[this.spinnerFrame] + " waiting for events…", "cyan"), W));
      if (availableRows > 1) for (let p = 1; p < availableRows; p++) lines.push(boxLine("", W));
    }
    else {
      const evLineCount = (ev: SubagentEvent) => ev.output_preview ? 2 : 1;
      let budget = availableRows;
      const visible: SubagentEvent[] = [];
      for (let i = this.detailEvents.length - 1 - this.detailScroll; i >= 0 && budget > 0; i--) {
        const cost = evLineCount(this.detailEvents[i]);
        if (cost > budget) break;
        visible.unshift(this.detailEvents[i]); budget -= cost;
      }
      for (const ev of visible) {
        const evTime = new Date(ev.created_at).toLocaleTimeString(); const evStatusColor = statusColor(ev.status);
        const activity = truncate(ev.activity || "—", Math.max(10, W - 18));
        const output = ev.output_preview ? truncate(ev.output_preview, Math.max(10, W - 20)) : "";
        lines.push(boxLine(color(evTime, "dim") + " " + color("[" + ev.status + "]", evStatusColor) + " " + color(activity, "white"), W));
        if (output) { lines.push(boxLine("  " + color(output, "dim"), W)); }
      }
      if (budget > 0) for (let p = 0; p < budget; p++) lines.push(boxLine("", W));
    }

    lines.push(boxSep(W));
    const runningTask2 = this.tasks.find(t => t.status === "running");
    const statusBadge2 = runningTask2 ? color("● LIVE " + SPINNER_FRAMES[this.spinnerFrame], "bgGreen") : color("IDLE", "dim");
    const navParent = color("[←parent]", node?.parentId ? "cyan" : "dim");
    const navChild = color("[→child]", node?.childrenIds.length ? "cyan" : "dim");
    const navProject = color("[P] project", "yellow"); const navClose2 = color("[Esc] back", "red"); const navRefresh2 = color("[r] ↻", "yellow");
    const followTag = this.followTail ? color("▼live", "green") : color("⏸paused", "yellow");
    const barContent2 = statusBadge2 + " " + followTag + " " + navParent + " " + navChild + " " + navProject + " " + navClose2 + " " + navRefresh2;
    lines.push(boxLine(barContent2, W));
    const help2 = "[↑/↓] scroll • [←/→] tree • [P] project • [b/Esc] back" + (this.followTail ? "" : " • [↓/End] resume live") + " • r:" + this.rPressedCount + (this.lastResumeError ? " • err:" + this.lastResumeError : "");
    lines.push(boxLine(color(help2, "dim"), W));
    lines.push(boxBottom(W));
  }
}

// --- Projected Widget Component ---
class ProjectedLogComponent implements Component {
  private task: SubagentTask; private events: SubagentEvent[]; private scroll = 0; private onClose: () => void;
  constructor(task: SubagentTask, events: SubagentEvent[], onClose: () => void) { this.task = task; this.events = events; this.onClose = onClose; this.scroll = Math.max(0, events.length - 1); }
  invalidate(): void {}
  handleInput(data: string): void {
    const maxScroll = Math.max(0, this.events.length - 1);
    if (matchesKey(data, "up")) { if (this.scroll > 0) this.scroll--; }
    else if (matchesKey(data, "down")) { if (this.scroll < maxScroll) this.scroll++; }
    else if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "b") || matchesKey(data, "p")) { this.onClose(); }
  }
  render(width: number): string[] {
    const lines: string[] = []; const termWidth = width; const maxLines = Math.floor(termWidth * 0.4);
    lines.push(color("╔", "cyan") + color("═".repeat(termWidth - 2), "cyan") + color("╗", "cyan"));
    const title = " PROJECTED LOG: " + this.task.agent + " (" + this.task.id + ") ";
    lines.push(color("║", "cyan") + color(title.padEnd(termWidth - 2), "bold") + color("║", "cyan"));
    lines.push(color("╠", "cyan") + color("═".repeat(termWidth - 2), "cyan") + color("╬", "cyan"));
    const started = this.task.started_at ? new Date(this.task.started_at).getTime() : null;
    const ended = this.task.ended_at ? new Date(this.task.ended_at).getTime() : null;
    const duration = started ? (ended || Date.now()) - started : 0; const durationStr = formatDuration(duration);
    lines.push(color("║", "cyan") + " " + color("Status: ", "dim") + color(this.task.status, statusColor(this.task.status)) + color("  Mode: ", "dim") + modeBadge(this.task.mode) + color("  Duration: ", "dim") + color(durationStr, "yellow") + color("  Model: ", "dim") + color(this.task.model || "default", "magenta") + color(" ║", "cyan"));
    lines.push(color("╠", "cyan") + color("═".repeat(termWidth - 2), "cyan") + color("╬", "cyan"));
    if (!this.events.length) { lines.push(color("║", "cyan") + color(" No events recorded ".padEnd(termWidth - 2), "dim") + color("║", "cyan")); }
    else {
      const start = Math.max(0, this.events.length - maxLines - this.scroll);
      const end = this.events.length - this.scroll; const visibleEvents = this.events.slice(start, end);
      for (const ev of visibleEvents) {
        const evTime = new Date(ev.created_at).toLocaleTimeString(); const evStatusColor = statusColor(ev.status);
        const activity = truncate(ev.activity || "—", termWidth - 18);
        const output = ev.output_preview ? truncate(ev.output_preview, termWidth - 18) : "";
        lines.push(color("║", "cyan") + " " + color(evTime, "dim") + " " + color("[" + ev.status + "]", evStatusColor) + " " + color(activity, "white") + color(" ║", "cyan"));
        if (output) { lines.push(color("║", "cyan") + "   " + color(output, "dim") + color(" ║", "cyan")); }
      }
    }
    lines.push(color("╠", "cyan") + color("═".repeat(termWidth - 2), "cyan") + color("╬", "cyan"));
    lines.push(color("║", "cyan") + color(" [↑/↓] scroll • [Esc/b/q/P] close projection ".padEnd(termWidth - 2), "dim") + color("║", "cyan"));
    lines.push(color("╚", "cyan") + color("═".repeat(termWidth - 2), "cyan") + color("╝", "cyan")); return lines;
  }
}

// --- Controller Component ---
class MonitorController implements Component {
  private monitor: SubagentMonitorComponent; private tui: TUI | null = null;
  private monitorHandle: OverlayHandle | null = null; private projectedHandle: OverlayHandle | null = null;
  private fsHandle: OverlayHandle | null = null; private expanded = false;
  private allCwds: boolean; private hidden = false;
  constructor(tui: TUI, allCwds: boolean, dbMode: MonitorDbMode = "auto") {
    this.tui = tui; this.allCwds = allCwds;
    this.monitor = new SubagentMonitorComponent({
      allCwds, intervalMs: 1000, dbMode,
      heightProvider: () => (this.tui ? this.tui.terminal.rows : 24),
      onProject: (task, events) => this.openProjectedLog(task, events),
      onRequestUnfocus: () => { this.monitorHandle?.unfocus(); this.tui?.requestRender(); },
      onExpand: (x) => { if (x) this.expand(); else this.collapse(); },
      onHide: () => this.hide(),
    });
    this.monitor.start(); this.createOverlay();
  }
  private createOverlay(): void {
    if (!this.tui) return;
    this.monitorHandle = this.tui.showOverlay(this.monitor, { anchor: "right-center", width: "17%", minWidth: 36, maxHeight: "100%", margin: { right: 0 }, nonCapturing: true, visible: (termWidth: number) => termWidth >= 72 });
  }
  /** Swap the side panel for a full-screen overlay of the SAME component (keeps state). */
  private expand(): void {
    if (!this.tui || this.expanded) return;
    this.monitorHandle?.hide(); this.monitorHandle = null;
    this.fsHandle = this.tui.showOverlay(this.monitor, { anchor: "center", width: "100%", maxHeight: "100%", margin: 0, nonCapturing: false });
    this.expanded = true; this.tui.requestRender();
  }
  /** Return to the main screen: drop full screen, restore the side panel unfocused. */
  private collapse(): void {
    if (!this.tui || !this.expanded) return;
    this.fsHandle?.hide(); this.fsHandle = null;
    this.createOverlay();
    this.expanded = false; this.tui.requestRender();
  }
  toggleFocus(): boolean {
    const handle = this.monitorHandle; if (!handle) return false;
    if (handle.isFocused()) { handle.unfocus(); } else { handle.focus(); }
    return handle.isFocused();
  }
  isFocused(): boolean { return this.monitorHandle?.isFocused() ?? false; }
  private openProjectedLog(task: SubagentTask, events: SubagentEvent[]): void {
    if (!this.tui || this.projectedHandle) return;
    const projected = new ProjectedLogComponent(task, events, () => this.closeProjectedLog());
    this.projectedHandle = this.tui.showOverlay(projected, { anchor: "top-center", width: "80%", minWidth: 80, maxHeight: "60%", nonCapturing: false });
  }
  private closeProjectedLog(): void { if (this.projectedHandle) { this.projectedHandle.setHidden(true); this.projectedHandle = null; } }
  handleInput(data: string): void {
    if (this.projectedHandle) { this.tui?.requestRender(); return; }
    this.monitor.handleInput(data); this.tui?.requestRender();
  }
  invalidate(): void { this.monitor.invalidate(); }
  render(width: number): string[] { return []; }
  dispose(): void { this.monitor.stop(); this.closeProjectedLog(); this.fsHandle?.hide(); this.fsHandle = null; if (this.monitorHandle) { this.monitorHandle.setHidden(true); this.monitorHandle = null; } this.hidden = false; }
  getMonitor(): SubagentMonitorComponent { return this.monitor; }
  getHandle(): OverlayHandle | null { return this.monitorHandle; }
  setDbMode(mode: MonitorDbMode): string { this.monitor.setDbMode(mode); return this.monitor.getDbPath(); }
  hide(): void {
    this.hidden = true;
    if (this.expanded) { this.fsHandle?.hide(); this.fsHandle = null; this.expanded = false; }
    if (this.monitorHandle) this.monitorHandle.setHidden(true);
  }
  show(): void {
    this.hidden = false;
    if (this.monitorHandle) { this.monitorHandle.setHidden(false); }
    else { this.createOverlay(); }
  }
}

// --- Extension entry point ---
let currentAllCwds = true;
let currentDbMode: MonitorDbMode = "auto";

// Multiple copies of this extension can be loaded in one process (e.g. a
// user-scope bundle plus a project-local shim). Guard process-wide state so
// only the first instance registers the shortcut and auto-opens the panel,
// and route every copy to the single shared controller.
const g = globalThis as Record<string, unknown>;
const SHORTCUT_FLAG = "__piSubagentMonitorShortcutRegistered";
const AUTO_FLAG = "__piSubagentMonitorAutoOpened";
const CONTROLLER_KEY = "__piSubagentMonitorController";
function getController(): MonitorController | null { return (g[CONTROLLER_KEY] as MonitorController) ?? null; }
function setController(c: MonitorController | null): void { if (c) g[CONTROLLER_KEY] = c; else delete g[CONTROLLER_KEY]; }

function extension(pi: ExtensionAPI) {
  const toggleMonitor = async (ctx: ExtensionCommandContext, allCwds: boolean) => {
    currentAllCwds = allCwds;
    const existing = getController();
    if (existing) { existing.dispose(); setController(null); ctx.ui.notify("Subagent monitor closed", "info"); }
    else { await ctx.ui.custom<void>((tui, _theme, _kb, done) => { setController(new MonitorController(tui, allCwds, currentDbMode)); done(); return getController() as MonitorController; }, { overlay: false }); ctx.ui.notify("Subagent monitor opened (right side)", "info"); }
  };
  pi.registerCommand("subagent-monitor", { description: "Toggle subagent monitor side panel (current CWD)", handler: async (_args: string, ctx: ExtensionCommandContext) => { await toggleMonitor(ctx, false); } });
  pi.registerCommand("subagent-monitor-all", { description: "Toggle subagent monitor side panel (all CWDs)", handler: async (_args: string, ctx: ExtensionCommandContext) => { await toggleMonitor(ctx, true); } });
  // slash commands that ALWAYS work regardless of terminal keyboard protocol
  pi.registerCommand("subagent-monitor-hide", { description: "Hide the subagent monitor panel", handler: async (_a: string, ctx: ExtensionCommandContext) => {
    const c = getController(); if (!c) return ctx.ui.notify("Monitor not open", "info");
    c.hide(); ctx.ui.notify("Monitor hidden", "info");
  }});
  pi.registerCommand("subagent-monitor-show", { description: "Show the subagent monitor panel", handler: async (_a: string, ctx: ExtensionCommandContext) => {
    const c = getController(); if (!c) return ctx.ui.notify("Monitor not open", "info");
    c.show(); ctx.ui.notify("Monitor shown", "info");
  }});
  pi.registerCommand("subagent-monitor-install", { description: "Install pi-subagent-monitor globally or locally", handler: async (_a: string, ctx: ExtensionCommandContext) => {
    const choice = await ctx.ui.select("Where do you want to install pi-subagent-monitor?", ["Global (npm)", "Local (directory)"]);
    if (!choice) { ctx.ui.notify("Installation cancelled", "info"); return; }
    if (choice === "Global (npm)") {
      ctx.ui.notify("Run: npm install -g pi-subagent-monitor", "info");
      ctx.ui.notify("Then add \"npm:pi-subagent-monitor\" to settings.json packages array", "info");
    } else {
      const dir = await ctx.ui.input("Enter the local directory path (e.g., ~/.pi/extensions):", "~/.pi/extensions");
      if (!dir) { ctx.ui.notify("Installation cancelled", "info"); return; }
      ctx.ui.notify(`Copy dist/index.js to ${dir}/pi-subagent-monitor/`, "info");
      ctx.ui.notify(`Add "${dir}/pi-subagent-monitor/index.js" to settings.json extensions array`, "info");
    }
  }});
  pi.registerCommand("subagent-monitor-db", { description: "Switch monitor database scope (auto / project / global)", handler: async (_a: string, ctx: ExtensionCommandContext) => {
    const c = getController();
    const hint = c ? ` (current: ${c.getMonitor().getDbMode()})` : "";
    const choice = await ctx.ui.select(`Which database scope for the monitor?${hint}`, ["Auto", "Global", "Project"]);
    if (!choice) { ctx.ui.notify("DB scope change cancelled", "info"); return; }
    const mode: MonitorDbMode = choice === "Global" ? "global" : choice === "Project" ? "project" : "auto";
    currentDbMode = mode;
    if (c) {
      const path = c.setDbMode(mode);
      ctx.ui.notify(`Monitor DB scope: ${mode} → ${path}`, "info");
    } else {
      ctx.ui.notify(`DB scope set to ${mode} (applies when the monitor opens)`, "info");
    }
  }});
  if (!g[SHORTCUT_FLAG]) {
    g[SHORTCUT_FLAG] = true;
    try {
      pi.registerShortcut("ctrl+q", {
        description: "Focus/unfocus subagent monitor panel (↑/↓ navigate, Enter details, Esc back)",
        handler: async (ctx) => {
          const controller = getController();
          if (!controller) return;
          const focused = controller.toggleFocus();
          ctx.ui.notify(focused ? "Monitor focused — ↑/↓ select, Enter details, Esc to release" : "Focus released to chat", "info");
        },
      });
      pi.registerShortcut("alt+h", {
        description: "Hide subagent monitor panel (also: /subagent-monitor-hide)",
        handler: async (ctx) => {
          const controller = getController();
          if (!controller) return;
          controller.hide();
          ctx.ui.notify("Monitor hidden — alt+s or /subagent-monitor-show to restore", "info");
        },
      });
      pi.registerShortcut("alt+s", {
        description: "Show subagent monitor panel (also: /subagent-monitor-show)",
        handler: async (ctx) => {
          const controller = getController();
          if (!controller) return;
          controller.show();
          ctx.ui.notify("Monitor shown", "info");
        },
      });
    } catch { /* another copy already registered this shortcut */ }
  }
  // Generator commands (misubagent-spawn/cancel/resume) ship in the same
      // package; registering them here keeps the lifecycle and the
      // SHORTCUT_FLAG guard in one place. Outer try/catch so a generator
      // failure can never block the session_start / session_shutdown handlers
      // that follow — the monitor panel is more important than the generator.
      try {
        registerGeneratorCommands(pi);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[pi-subagent-monitor] generator registration failed:", e);
      }

      pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI && !getController() && !g[AUTO_FLAG]) {
      g[AUTO_FLAG] = true;
      setTimeout(() => { const dummyCtx: ExtensionCommandContext = ctx as any; toggleMonitor(dummyCtx, currentAllCwds).catch(() => {}); }, 500);
    }
  });
  pi.on("session_shutdown", () => {
    const controller = getController();
    if (controller) { controller.dispose(); setController(null); }
    delete g[AUTO_FLAG]; delete g[SHORTCUT_FLAG];
  });
}

// Re-export classes and extension for library consumers
export { SubagentMonitorComponent, ProjectedLogComponent, MonitorController, extension };
export default extension;
