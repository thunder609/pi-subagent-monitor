import { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { SubagentDb } from "../db";
import { spawnChild } from "../spawner";
import { SubagentTask, isTerminal } from "../../types";

export async function handleResume(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const arg = args.trim();
  if (!arg) {
    ctx.ui.notify("Uso: `/misubagent-resume <taskId>`", "error");
    return;
  }

  const taskId = arg;
  const db = new SubagentDb();
  const cwd = process.cwd();

  try {
    // 1. Read the current task.
    const task = (await db.queryRow(
      `SELECT * FROM subagent_tasks WHERE id = '${taskId}'`,
    )) as SubagentTask | undefined;

    if (!task) {
      ctx.ui.notify(`No hay tarea con ID ${taskId}`, "error");
      return;
    }

    if (task.status === "running") {
      ctx.ui.notify(`La tarea ${taskId} ya está running.`, "error");
      return;
    }

    if (task.status === "queued") {
      ctx.ui.notify(`La tarea ${taskId} ya está en cola.`, "error");
      return;
    }

    // Resume is for terminal tasks (cancelled / failed / completed) only.
    if (!isTerminal(task)) {
      ctx.ui.notify(
        `La tarea ${taskId} está en estado ${task.status}; no se puede reanudar.`,
        "error",
      );
      return;
    }

    // 2. Create a new attempt number and reserve the row.
    const newAttempt = (task.attempt ?? 0) + 1;
    const now = new Date().toISOString();

    await db.tx(async (sqlite) => {
      sqlite.exec(
        `INSERT INTO subagent_task_attempts (
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
          '${taskId}', ${newAttempt}, cwd, agent, mode, 'running', task, context,
          '${now}', session_id, nested_session_path,
          '${now}', NULL, '${now}', 'resumed',
          output_preview, prompt, continuation_prompt, system_prompt,
          transcript, usage_input, usage_output, usage_cache_read, usage_cache_write,
          usage_cost, usage_context_tokens, usage_turns, model, effort,
          model_source, effort_source, fallback_used, error, error_metadata_json,
          error_category, result, thread_snapshot_json,
          pi_retry_attempts, pending_message_count, undelivered_message_count
        FROM subagent_tasks WHERE id = '${taskId}'
        `,
      );
      sqlite.exec(
        `UPDATE subagent_tasks SET status='queued', attempt=${newAttempt} WHERE id='${taskId}'`,
      );
    });

    // 3. Spawn the new process.
    const { process: child } = spawnChild({
      taskId,
      agent: task.agent,
      cwd: task.cwd,
      prompt: `Reanudando tarea cancelada/fallida. Intento #${newAttempt}. Descripción original: ${task.task ?? ""}`,
      timeoutMs: 600000,
    });

    // 4. Flip to running + record the resumed event.
    await db.tx(async (sqlite) => {
      sqlite.exec(
        `UPDATE subagent_tasks SET status='running', started_at='${now}', last_activity_at='${now}', last_activity='resumed' WHERE id='${taskId}'`,
      );
      sqlite.exec(
        `INSERT INTO subagent_events (task_id, attempt, cwd, created_at, status, activity, output_preview) VALUES ('${taskId}', ${newAttempt}, '${cwd}', '${now}', 'running', 'resumed', NULL)`,
      );
    });

    child.on("exit", () => {
      // Best-effort cleanup hook; the child is responsible for status updates
      // it owns. We just drop the reference here.
    });

    ctx.ui.notify(
      `Tarea ${taskId} reanudada (intento #${newAttempt}).`,
      "info",
    );
  } catch (err) {
    ctx.ui.notify(
      `Error al reanudar: ${err instanceof Error ? err.message : String(err)}`,
      "error",
    );
  } finally {
    db.close();
  }
}