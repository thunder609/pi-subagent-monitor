import { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { SubagentDb } from "../db";

export async function handleCancel(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const arg = args.trim();
  if (!arg) {
    ctx.ui.notify("Uso: `/misubagent-cancel <taskId>`", "error");
    return;
  }

  const taskId = arg;
  const db = new SubagentDb();
  const cwd = process.cwd();

  try {
    // 1. Read the current task.
    const task = (await db.queryRow(
      `SELECT id, status, started_at, ended_at, agent, attempt, cwd FROM subagent_tasks WHERE id = '${taskId}'`,
    )) as
      | {
          id: string;
          status: string;
          started_at: string | null;
          ended_at: string | null;
          agent: string;
          attempt: number | null;
          cwd: string;
        }
      | undefined;

    if (!task) {
      ctx.ui.notify(`No hay tarea con ID ${taskId}`, "error");
      return;
    }

    if (task.status !== "running" && task.status !== "queued") {
      ctx.ui.notify(
        `La tarea ${taskId} ya finalizada (status: ${task.status}). No se puede cancelar.`,
        "error",
      );
      return;
    }

    // 2. Mark cancelled + set ended_at + log a new attempt row + event.
    const now = new Date().toISOString();
    await db.tx(async (sqlite) => {
      sqlite.exec(
        `UPDATE subagent_tasks SET status='cancelled', ended_at='${now}', last_activity='cancelled' WHERE id='${taskId}'`,
      );
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
          '${taskId}', ${task.attempt ?? 1}, cwd, agent, mode, 'cancelled', task, context,
          '${now}', session_id, nested_session_path,
          ${task.started_at ? `'${task.started_at}'` : `'1970-01-01T00:00:00.000Z'`}, '${now}', '${now}', 'cancelled',
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
        `INSERT INTO subagent_events (task_id, attempt, cwd, created_at, status, activity, output_preview) VALUES ('${taskId}', ${task.attempt ?? 1}, '${cwd}', '${now}', 'cancelled', 'cancelled', NULL)`,
      );
    });

    ctx.ui.notify(`Tarea ${taskId} cancelada.`, "info");
  } catch (err) {
    ctx.ui.notify(
      `Error al cancelar: ${err instanceof Error ? err.message : String(err)}`,
      "error",
    );
  } finally {
    db.close();
  }
}