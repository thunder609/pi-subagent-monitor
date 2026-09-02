/**
 * Shared types and helpers used by both the monitor (read) and the generator
 * (write). Both halves must agree on the row shapes that flow through SQLite.
 */
import * as crypto from "crypto";

export type SubagentStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type SubagentActivity =
  | "queued"
  | "started"
  | "resumed"
  | "completed"
  | "cancelled"
  | "output"
  | "think";

export interface SubagentTask {
  id: string;
  cwd: string;
  agent: string;
  mode: string;
  status: SubagentStatus | string;
  task: string | null;
  context: string | null;
  created_at: string;
  attempt: number | null;
  session_id: string | null;
  nested_session_path: string | null;
  started_at: string | null;
  ended_at: string | null;
  last_activity_at: string | null;
  last_activity: string | null;
  output_preview: string | null;
  usage_input: number | null;
  usage_output: number | null;
  usage_cache_read: number | null;
  usage_cache_write: number | null;
  usage_cost: number | null;
  usage_turns: number | null;
  model: string | null;
  effort: string | null;
  error: string | null;
  error_metadata_json: string | null;
  error_category: string | null;
  result: string | null;
  transcript: string | null;
  pi_retry_attempts: number | null;
  pending_message_count: number | null;
  undelivered_message_count: number | null;
}

export interface SubagentEvent {
  id?: number;
  task_id: string;
  attempt: number | null;
  cwd: string;
  created_at: string;
  status: SubagentStatus | string;
  activity: SubagentActivity | string;
  output_preview: string | null;
}

export interface TaskAttempt {
  id: string;
  attempt: number;
  status: "running" | "completed" | "failed" | "cancelled";
  started_at: string;
  ended_at: string | null;
}

/**
 * Body mode of the monitor side panel. After the subtask-id-detail-panel change
 * the panel switches between the task list and the new drawer's content via
 * the `"drawer"` literal. The legacy `"detail"` literal is preserved as a
 * deprecated alias constant for one release.
 */
export type ViewMode = "list" | "drawer";

/**
 * @deprecated Use `"drawer"` instead. Kept for one release so library
 * consumers can migrate without an immediate type break.
 */
export const VIEW_MODE_DETAIL_ALIAS = "detail" as const;

export interface TaskNode {
  task: SubagentTask;
  parentId: string | null;
  childrenIds: string[];
  siblingIndex: number;
  siblingCount: number;
}

export function isRunning(t: SubagentTask): t is SubagentTask & {
  status: "running";
} {
  return t.status === "running";
}

export function isTerminal(
  t: SubagentTask,
): t is SubagentTask & { status: "completed" | "failed" | "cancelled" } {
  return ["completed", "failed", "cancelled"].includes(t.status);
}

export function generateTaskId(): string {
  return `subtask_${crypto.randomUUID()}`;
}

export function buildTaskTree(
  tasks: SubagentTask[],
): Map<string, TaskNode> {
  const nodeMap = new Map<string, TaskNode>();
  for (const task of tasks) {
    nodeMap.set(task.id, {
      task,
      parentId: null,
      childrenIds: [],
      siblingIndex: 0,
      siblingCount: 1,
    });
  }
  const bySession = new Map<string, SubagentTask[]>();
  for (const task of tasks) {
    if (task.session_id) {
      const arr = bySession.get(task.session_id) ?? [];
      arr.push(task);
      bySession.set(task.session_id, arr);
    }
  }
  for (const [, sessionTasks] of bySession) {
    sessionTasks.sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    for (let i = 0; i < sessionTasks.length; i++) {
      const node = nodeMap.get(sessionTasks[i].id);
      if (!node) continue;
      node.siblingIndex = i;
      node.siblingCount = sessionTasks.length;
      if (i > 0) node.parentId = sessionTasks[i - 1].id;
    }
  }
  for (const task of tasks) {
    if (task.nested_session_path) {
      const childSessionId = task.nested_session_path
        .split("/")
        .pop()
        ?.replace(".jsonl", "");
      if (childSessionId) {
        const children = tasks.filter((t) => t.session_id === childSessionId);
        for (const child of children) {
          const childNode = nodeMap.get(child.id);
          const parentNode = nodeMap.get(task.id);
          if (!childNode || !parentNode) continue;
          childNode.parentId = task.id;
          parentNode.childrenIds.push(child.id);
        }
      }
    }
  }
  return nodeMap;
}