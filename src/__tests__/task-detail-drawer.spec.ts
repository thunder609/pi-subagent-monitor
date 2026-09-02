import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TaskDetailDrawer } from "../index";
import {
  makeTask,
  makeEvent,
  makeCall,
  makeResult,
  makeThink,
  sampleLiveLines,
  COMPLETED_STATUS,
  FAILED_STATUS,
  resetFixtureCounters,
} from "./fixtures";
import type { SessionLine } from "../index";
import type { SubagentTask, SubagentEvent } from "../types";

const DRAWER_WIDTH = 48;

function makeDrawer(opts: {
  task?: Partial<SubagentTask>;
  liveSessionLines?: SessionLine[];
  events?: SubagentEvent[];
  theme?: "dark" | "light";
} = {}): TaskDetailDrawer {
  const task = makeTask(opts.task ?? {});
  const drawer = new TaskDetailDrawer({
    task,
    liveSessionLines: opts.liveSessionLines ?? [],
    events: opts.events ?? [],
    theme: opts.theme ?? "dark",
  });
  return drawer;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function visibleWidth(s: string): number {
  return stripAnsi(s).length;
}

describe("TaskDetailDrawer.render", () => {
  beforeEach(() => resetFixtureCounters());

  it("emits exactly DRAWER_WIDTH visible columns per line", () => {
    const drawer = makeDrawer({
      task: { id: "subtask_abcdef00-1111-1113-aaaa-111111111111", status: "running" },
      liveSessionLines: sampleLiveLines(),
    });
    const lines = drawer.render(DRAWER_WIDTH);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(visibleWidth(line)).toBe(DRAWER_WIDTH);
    }
  });

  it("displays the full subtask id without truncation in the header", () => {
    const fullId = "subtask_abcdef00-1111-1113-aaaa-111111111111";
    const drawer = makeDrawer({
      task: { id: fullId, status: "completed" },
      liveSessionLines: [],
    });
    const lines = drawer.render(DRAWER_WIDTH).map(stripAnsi);
    expect(lines.some((l) => l.includes(fullId))).toBe(true);
    expect(lines.some((l) => l.includes("abcdef00") && !l.includes(fullId))).toBe(
      false,
    );
  });

  it("shows the LIVE badge when the task is running", () => {
    const drawer = makeDrawer({ task: { status: "running" } });
    const lines = drawer.render(DRAWER_WIDTH).map(stripAnsi);
    expect(lines.some((l) => l.toUpperCase().includes("LIVE"))).toBe(true);
  });

  it("does not show the LIVE badge when the task is terminal", () => {
    const drawer = makeDrawer({ task: { status: COMPLETED_STATUS } });
    const lines = drawer.render(DRAWER_WIDTH).map(stripAnsi);
    expect(lines.some((l) => l.toUpperCase().includes("LIVE"))).toBe(false);
  });

  it("shows the meta line with status, duration, tokens, cost", () => {
    const drawer = makeDrawer({
      task: {
        status: COMPLETED_STATUS,
        usage_input: 1234,
        usage_output: 567,
        usage_cost: 0.0123,
      },
    });
    const lines = drawer.render(DRAWER_WIDTH).map(stripAnsi);
    // meta line contains both the status badge text and at least one digit
    const meta = lines.find((l) => /id\s+subtask/.test(l));
    expect(meta).toBeDefined();
    expect(meta!).toMatch(/\d/);
  });

  it("renders the live execution stream when SessionLines are provided", () => {
    const drawer = makeDrawer({
      task: { status: "running" },
      liveSessionLines: sampleLiveLines(),
    });
    const lines = drawer.render(DRAWER_WIDTH).map(stripAnsi);
    expect(lines.some((l) => l.includes("write_file"))).toBe(true);
    expect(lines.some((l) => l.toLowerCase().includes("plan"))).toBe(true);
  });

  it("falls back to the event log when no SessionLines are available", () => {
    const task = makeTask({ id: "subtask_event-fallback", status: COMPLETED_STATUS });
    const drawer = new TaskDetailDrawer({
      task,
      liveSessionLines: [],
      events: [makeEvent(task.id, { activity: "fallback-event" })],
      theme: "dark",
    });
    const lines = drawer.render(DRAWER_WIDTH).map(stripAnsi);
    expect(lines.some((l) => l.toLowerCase().includes("fallback-event"))).toBe(true);
  });

  it("renders the tool-call table with totals for live tool calls", () => {
    const drawer = makeDrawer({
      task: { status: COMPLETED_STATUS },
      liveSessionLines: sampleLiveLines(),
    });
    const lines = drawer.render(DRAWER_WIDTH).map(stripAnsi);
    // table header should be present
    expect(lines.some((l) => l.toLowerCase().includes("tool"))).toBe(true);
    // totals line should mention call count and failed count
    const totalsLine = lines.find((l) => /\d+\s+calls?\s+\d+\s+failed/.test(l));
    expect(totalsLine).toBeDefined();
  });
});

describe("TaskDetailDrawer.handleInput", () => {
  beforeEach(() => resetFixtureCounters());

  it("stages the full subtask id in the footer when 'c' is pressed", () => {
    const fullId = "subtask_11111111-2222-3333-aaaa-bbbbccccdddd";
    const drawer = makeDrawer({ task: { id: fullId, status: COMPLETED_STATUS } });
    drawer.handleInput("c");
    const lines = drawer.render(DRAWER_WIDTH).map(stripAnsi);
    expect(lines.some((l) => l.includes(fullId))).toBe(true);
  });

  it("refreshes the staged id if 'c' is pressed twice", () => {
    const fullId = "subtask_22222222-3333-4444-bbbb-ccccddddeeee";
    const drawer = makeDrawer({ task: { id: fullId, status: COMPLETED_STATUS } });
    drawer.handleInput("c");
    drawer.handleInput("c");
    const lines = drawer.render(DRAWER_WIDTH).map(stripAnsi);
    const stageLines = lines.filter((l) => l.includes(fullId));
    expect(stageLines.length).toBeGreaterThanOrEqual(1);
  });

  it("emits onClose when Escape is pressed", () => {
    const drawer = makeDrawer({ task: { status: COMPLETED_STATUS } });
    let closed = false;
    drawer.onClose = () => (closed = true);
    drawer.handleInput("\x1b");
    expect(closed).toBe(true);
  });

  it("emits onClose when 'b' is pressed", () => {
    const drawer = makeDrawer({ task: { status: COMPLETED_STATUS } });
    let closed = false;
    drawer.onClose = () => (closed = true);
    drawer.handleInput("b");
    expect(closed).toBe(true);
  });

  it("emits onNavigateTo with the parent id when 'left' is pressed and parent exists", () => {
    const parentId = "subtask_parent-1";
    const drawer = makeDrawer({
      task: { id: "subtask_child-1", status: COMPLETED_STATUS },
    });
    drawer.parentId = parentId;
    let navigated: string | null = null;
    drawer.onNavigateTo = (id) => (navigated = id);
    drawer.handleInput("\x1b[D");
    expect(navigated).toBe(parentId);
  });

  it("does not emit onNavigateTo when 'left' is pressed and no parent exists", () => {
    const drawer = makeDrawer({
      task: { id: "subtask_root-1", status: COMPLETED_STATUS },
    });
    drawer.parentId = null;
    let navigated = 0;
    drawer.onNavigateTo = () => (navigated += 1);
    drawer.handleInput("\x1b[D");
    expect(navigated).toBe(0);
  });

  it("emits onNavigateTo with the first child id when 'right' is pressed and a child exists", () => {
    const childId = "subtask_child-of-1";
    const drawer = makeDrawer({
      task: { id: "subtask_parent-with-child", status: COMPLETED_STATUS },
    });
    drawer.firstChildId = childId;
    let navigated: string | null = null;
    drawer.onNavigateTo = (id) => (navigated = id);
    drawer.handleInput("\x1b[C");
    expect(navigated).toBe(childId);
  });
});

describe("TaskDetailDrawer themes", () => {
  beforeEach(() => resetFixtureCounters());

  it("renders without error in dark theme", () => {
    const drawer = makeDrawer({ task: { status: "running" }, theme: "dark" });
    const lines = drawer.render(DRAWER_WIDTH);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("renders without error in light theme", () => {
    const drawer = makeDrawer({ task: { status: "running" }, theme: "light" });
    const lines = drawer.render(DRAWER_WIDTH);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("produces a different color sequence between dark and light themes", () => {
    const darkDrawer = makeDrawer({ task: { status: "running" }, theme: "dark" });
    const lightDrawer = makeDrawer({ task: { status: "running" }, theme: "light" });
    const darkAnsi = darkDrawer.render(DRAWER_WIDTH).join("\n");
    const lightAnsi = lightDrawer.render(DRAWER_WIDTH).join("\n");
    expect(darkAnsi).not.toBe(lightAnsi);
  });
});

describe("TaskDetailDrawer narrow-terminal fallback", () => {
  it("still renders at non-drawer width without throwing", () => {
    const drawer = makeDrawer({ task: { status: "running" } });
    // narrow but still wide enough for box borders
    expect(() => drawer.render(36)).not.toThrow();
    expect(() => drawer.render(48)).not.toThrow();
    expect(() => drawer.render(80)).not.toThrow();
  });
});