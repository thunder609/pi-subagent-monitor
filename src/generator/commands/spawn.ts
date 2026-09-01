import { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { SubagentDb } from "../db";
import { spawnChild } from "../spawner";
import { generateTaskId } from "../../types";

export async function handleSpawn(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const parts = args.trim().split(/\s+/);
  if (parts.length < 2 || !parts[0]) {
    ctx.ui.notify(
      "Uso: `/misubagent-spawn <agentName> <task description>`",
      "error",
    );
    return;
  }

  const [agentName, ...taskParts] = parts;
  const taskDescription = taskParts.join(" ");
  const taskId = generateTaskId();
  const db = new SubagentDb();
  const cwd = process.cwd();

  let child: ReturnType<typeof spawnChild>["process"] | null = null;

  try {
    // 1. Insert the task row in 'queued' state.
    const now = new Date().toISOString();
    await db.tx(async (sqlite) => {
      sqlite.exec(
        `INSERT INTO subagent_tasks (
          id, cwd, agent, mode, status, task, context,
          created_at, attempt, session_id, nested_session_path,
          started_at, last_activity_at, last_activity,
          usage_input, usage_output, usage_cache_read, usage_cache_write, usage_cost, usage_turns,
          model, effort, result, transcript,
          pi_retry_attempts, pending_message_count, undelivered_message_count
        ) VALUES (
          '${taskId}', '${cwd}', '${agentName}', 'task', 'queued', '${taskDescription}', NULL,
          '${now}', 1, NULL, NULL,
          NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL,
          NULL, 0, 0
        )`,
      );
    });

    // 2. Spawn the child process.
    const spawned = spawnChild({
      taskId,
      agent: agentName,
      cwd,
      prompt: taskDescription,
      timeoutMs: 600000,
    });
    child = spawned.process;

    // 3. Flip to 'running' + record the started event.
    const startedAt = new Date().toISOString();
    await db.tx(async (sqlite) => {
      sqlite.exec(
        `UPDATE subagent_tasks SET status='running', started_at='${startedAt}', last_activity_at='${startedAt}', last_activity='started' WHERE id='${taskId}'`,
      );
      sqlite.exec(
        `INSERT INTO subagent_events (task_id, attempt, cwd, created_at, status, activity, output_preview) VALUES ('${taskId}', 1, '${cwd}', '${startedAt}', 'running', 'started', NULL)`,
      );
    });

    // 4. Listen for usage messages from the child.
    child.on("message", (msg: unknown) => {
      if (
        msg &&
        typeof msg === "object" &&
        (msg as { type?: string }).type === "usage"
      ) {
        const m = msg as {
          input?: number;
          output?: number;
          cacheRead?: number;
          cacheWrite?: number;
        };
        const usageAt = new Date().toISOString();
        const input = m.input ?? 0;
        const output = m.output ?? 0;
        db.tx(async (sqlite) => {
          sqlite.exec(
            `UPDATE subagent_tasks SET
              usage_input = COALESCE(usage_input, 0) + ${input},
              usage_output = COALESCE(usage_output, 0) + ${output},
              usage_cache_read = COALESCE(usage_cache_read, 0) + ${m.cacheRead ?? 0},
              usage_cache_write = COALESCE(usage_cache_write, 0) + ${m.cacheWrite ?? 0},
              usage_cost = (COALESCE(usage_input, 0) + ${input}) * 0.001 + (COALESCE(usage_output, 0) + ${output}) * 0.002,
              last_activity_at = '${usageAt}',
              last_activity = 'running'
            WHERE id = '${taskId}'`,
          );
        }).catch(() => {
          /* best-effort; ignore */
        });
      }
    });

    // 5. Final status when the child exits.
    child.on("close", (code: number | null) => {
      const newStatus = code === 0 ? "completed" : "failed";
      const endedAt = new Date().toISOString();
      db.tx(async (sqlite) => {
        sqlite.exec(
          `UPDATE subagent_tasks SET status='${newStatus}', ended_at='${endedAt}', last_activity='${newStatus}' WHERE id='${taskId}'`,
        );
        sqlite.exec(
          `INSERT INTO subagent_events (task_id, attempt, cwd, created_at, status, activity, output_preview) VALUES ('${taskId}', 1, '${cwd}', '${endedAt}', '${newStatus}', '${newStatus}', NULL)`,
        );
      }).catch(() => {
        /* best-effort; ignore */
      });
      ctx.ui.notify(
        `Subagente ${taskId} finalizado ${newStatus}.`,
        "info",
      );
    });

    ctx.ui.notify(
      `Subagente spawnado: ${taskId}. Usá /misubagent-cancel ${taskId} para cancelar.`,
      "info",
    );
  } catch (err) {
    // Best-effort: flip the task row to 'failed' so the operator sees it.
    try {
      const message = err instanceof Error ? err.message : String(err);
      await db.tx(async (sqlite) => {
        sqlite.exec(
          `UPDATE subagent_tasks SET status='failed', error='${message}' WHERE id='${taskId}'`,
        );
      });
    } catch {
      /* ignore */
    }
    ctx.ui.notify(
      `Error al spawnear subagente: ${err instanceof Error ? err.message : String(err)}`,
      "error",
    );
  } finally {
    db.close();
    // Note: do NOT kill `child` here; spawn success means the parent intentionally
    // hands the lifecycle over to the child process IPC handlers above.
    void child;
  }
}