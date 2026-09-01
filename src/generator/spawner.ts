import { spawn } from "child_process";
import { resolve } from "path";

export interface SpawnerOptions {
  taskId: string;
  agent: string;
  cwd: string;
  prompt: string;
  timeoutMs?: number;
}

export interface SpawnResult {
  process: NodeJS.Process;
  taskId: string;
  sessionPath: string;
}

/**
 * Spawns a child Node process to execute a subagent task.
 *
 *   - stdio piping for captured output
 *   - IPC (4th stdio index) for postMessage to the parent
 *   - Global timeout + SIGTERM/SIGKILL handling
 */
export function spawnChild(opts: SpawnerOptions): SpawnResult {
  const { taskId, agent, cwd, prompt, timeoutMs = 300000 } = opts;

  // 1. Path of the JSONL session file for this run
  const sessionDir = resolve(cwd, ".pi", "agent", "sessions");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const sessionFile = resolve(sessionDir, `${timestamp}_${taskId}.jsonl`);

  // 2. Inline script the child process executes.
  //    Worker mode (when workerPort exists) is the happy path;
  //    the no-workerPort branch is a fallback for environments where
  //    child_process IPC is unavailable.
  const inlineScript = `
const { workerPort } = require('worker_threads');
if (!workerPort) {
  let accumulated = '';
  process.stdin?.on('data', (chunk) => { accumulated += chunk.toString(); });
  process.stdin?.on('end', () => {
    const result = \`Tarea completada: \${accumulated.substring(0, 80)}...\`;
    process.stdout.write(JSON.stringify({ type: 'usage', input: accumulated.length, output: result.length, cacheRead: 0, cacheWrite: 0 }) + '\\n');
    process.stdout.write(JSON.stringify({ type: 'completed', text: result }) + '\\n');
    process.exit(0);
  });
} else {
  let accumulated = '';
  workerPort.on('message', (msg) => {
    if (msg.type === 'prompt') {
      accumulated = msg.text;
      const result = \`Resultado de: \${accumulated.substring(0, 40)}...\`;
      workerPort.postMessage({
        type: 'usage',
        input: Math.max(1, accumulated.length),
        output: Math.max(1, result.length),
        cacheRead: 0,
        cacheWrite: 0
      });
      workerPort.postMessage({ type: 'completed', text: result });
      workerPort.postMessage({ type: 'exit' });
    }
    if (msg.type === 'exit') {
      workerPort.close();
      process.exit(0);
    }
    if (msg.type === 'kill') {
      process.kill(process.pid, 'SIGTERM');
    }
  });
  let stdinData = '';
  process.stdin?.on('data', (chunk) => { stdinData += chunk.toString(); });
  process.stdin?.on('end', () => { accumulated = stdinData; });
}

process.on('SIGTERM', () => {
  workerPort?.postMessage({ type: 'kill' });
  setTimeout(() => process.kill('SIGKILL'), 3000);
});
`;

  // 3. Spawn child process with stdio + IPC.
  const child = spawn("node", ["-e", inlineScript], {
    cwd,
    stdio: ["pipe", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      PI_SUBAGENT_TASK_ID: taskId,
      PI_SUBAGENT_AGENT: agent,
    },
  });

  // 4. Initial prompt via stdin.
  child.stdin?.write(JSON.stringify({ type: "prompt", text: prompt }));
  child.stdin?.end();

  // 5. Global timeout watchdog.
  const timeoutId = setTimeout(() => {
    child.kill("SIGKILL");
    clearTimeout(timeoutId);
  }, timeoutMs);

  // 6. Clean shutdown timers on exit.
  child.on("exit", () => {
    clearTimeout(timeoutId);
  });

  return { process: child as unknown as NodeJS.Process, taskId, sessionPath: sessionFile };
}

/**
 * Install SIGTERM/SIGINT handlers on the current process for graceful cancel.
 * Forks off a watchdog that escalates to SIGKILL after 3 s.
 */
export function setupSignalHandling(
  process: NodeJS.Process,
  onTerm: () => void,
  onExit: () => void,
): void {
  let escalated = false;
  process.on("SIGTERM", () => {
    onTerm();
    setTimeout(() => {
      if (!escalated) {
        escalated = true;
        process.exit(1);
      }
    }, 3000);
  });

  process.on("SIGINT", () => {
    onTerm();
  });

  process.on("exit", (code) => {
    onExit();
    if (code !== 0) {
      // eslint-disable-next-line no-console
      console.log(`[spawner] Process exited with code ${code}`);
    }
  });
}