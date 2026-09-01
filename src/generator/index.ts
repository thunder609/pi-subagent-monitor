import { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleSpawn } from "./commands/spawn";
import { handleCancel } from "./commands/cancel";
import { handleResume } from "./commands/resume";

/**
 * Register the subagent-generator slash commands on a Pi extension instance.
 *
 * Mirrors the monitor's own command registration pattern (see
 * src/index.ts:extension); the parent extension calls this once during
 * bootstrap so all generator commands share the same lifecycle and so the
 * SHORTCUT_FLAG global guard in the parent extension still prevents
 * duplicate registration when more than one copy of the package loads.
 *
 * Public commands (unchanged from the previous pi-my-sub-agent-generator
 * package so existing users keep working):
 *   - /misubagent-spawn <agentName> <task description>
 *   - /misubagent-cancel <taskId>
 *   - /misubagent-resume <taskId>
 */
export function registerGeneratorCommands(pi: ExtensionAPI): void {
  // Wrapped in try/catch so a failure registering the generator commands never
  // aborts the parent extension's session_start / session_shutdown handlers.
  // If the SDK rejects one of these names, we want to see it in the log AND
  // keep the monitor panel working.
  try {
    pi.registerCommand("misubagent-spawn", {
      description:
        "Spawn a new subagent task. Args: <agentName> <task description>",
      handler: handleSpawn,
    });

    pi.registerCommand("misubagent-cancel", {
      description: "Cancel a running or queued subagent task by id.",
      handler: handleCancel,
    });

    pi.registerCommand("misubagent-resume", {
      description:
        "Resume a previously cancelled/failed subagent task by id (creates a new attempt).",
      handler: handleResume,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[pi-subagent-monitor] registerGeneratorCommands failed:", e);
  }
}

/** Re-exports so callers can import everything from one place. */
export { SubagentDb, getDbPath } from "./db";
export type { DbOptions } from "./db";
export { spawnChild, setupSignalHandling } from "./spawner";
export type { SpawnerOptions, SpawnResult } from "./spawner";
export { handleSpawn } from "./commands/spawn";
export { handleCancel } from "./commands/cancel";
export { handleResume } from "./commands/resume";