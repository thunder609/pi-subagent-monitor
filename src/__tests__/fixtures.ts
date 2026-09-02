/**
 * Pure builders for the drawer's spec. No SQLite, no filesystem, no timer.
 * Keep this file dependency-free so the test suite stays fast.
 */
import type {
  SubagentEvent,
  SubagentStatus,
  SubagentTask,
} from "../types";
import type { SessionLine } from "../index";

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter.toString().padStart(6, "0")}`;
}

export function makeTask(overrides: Partial<SubagentTask> = {}): SubagentTask {
  const id = overrides.id ?? nextId("subtask");
  return {
    id,
    cwd: "/tmp/fixture",
    agent: "fixture-agent",
    mode: "foreground",
    status: "running",
    task: "fixture task",
    context: null,
    created_at: new Date().toISOString(),
    attempt: 1,
    session_id: null,
    nested_session_path: null,
    started_at: new Date().toISOString(),
    ended_at: null,
    last_activity_at: null,
    last_activity: null,
    output_preview: null,
    usage_input: 100,
    usage_output: 50,
    usage_cache_read: 0,
    usage_cache_write: 0,
    usage_cost: 0.001,
    usage_turns: 1,
    model: null,
    effort: null,
    error: null,
    error_metadata_json: null,
    error_category: null,
    result: null,
    transcript: null,
    pi_retry_attempts: null,
    pending_message_count: null,
    undelivered_message_count: null,
    ...overrides,
  };
}

export function makeEvent(
  taskId: string,
  overrides: Partial<SubagentEvent> = {},
): SubagentEvent {
  return {
    task_id: taskId,
    attempt: 1,
    cwd: "/tmp/fixture",
    created_at: new Date().toISOString(),
    status: "running",
    activity: "thinking",
    output_preview: null,
    ...overrides,
  };
}

export function makeCall(tool: string, args?: string): SessionLine {
  return { kind: "call", text: `\u2192 ${tool}${args ? " " + args : ""}` };
}

export function makeResult(text: string, error = false): SessionLine {
  return {
    kind: "result",
    text: `${error ? "\u2717" : "\u2190"} tool: ${text}`,
  };
}

export function makeThink(text: string): SessionLine {
  return { kind: "think", text: `~ ${text}` };
}

export function makeUser(text: string): SessionLine {
  return { kind: "user", text: `you: ${text}` };
}

export function makeAssistant(text: string): SessionLine {
  return { kind: "assistant", text: `assistant: ${text}` };
}

export function resetFixtureCounters(): void {
  counter = 0;
}

/** Sample of three tool calls plus their results, used as a default payload
 *  for the drawer's spec. */
export function sampleLiveLines(): SessionLine[] {
  return [
    makeThink("Plan: build the JWT service"),
    makeCall("write_file", "src/auth/jwt.ts"),
    makeResult("Created src/auth/jwt.ts"),
    makeCall("write_file", "src/auth/middleware.ts"),
    makeResult("Created src/auth/middleware.ts"),
    makeCall("bash", "npm test -- auth"),
    makeResult("PASS  auth tests", true),
  ];
}

export const RUNNING_STATUS: SubagentStatus = "running";
export const COMPLETED_STATUS: SubagentStatus = "completed";
export const FAILED_STATUS: SubagentStatus = "failed";