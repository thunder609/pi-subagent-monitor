// simulate-tree.ts
// Simula padre → hijo → nieto para pi-subagent-monitor
// Genera DB + JSONL session files para ver en vivo

import { getSubagentDB } from "./subagent-db.js";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.resolve(__dirname, "subagent-history.sqlite");
const JSONL_DIR = path.resolve(__dirname, ".subagent-sessions");

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log("🚀 Iniciando simulación padre → hijo → nieto");
  console.log(`📁 DB: ${DB_PATH}`);
  console.log(`📁 JSONL dir: ${JSONL_DIR}\n`);

  const db = getSubagentDB(DB_PATH);

  // IDs de session para linkear árbol padre/hijo
  const rootSessionId = "session-orchestrator-001";
  const researcherSessionId = "session-researcher-002";
  const coderSessionId = "session-coder-003";

  const rootJsonl = path.resolve(JSONL_DIR, `${rootSessionId}.jsonl`);
  const researcherJsonl = path.resolve(JSONL_DIR, `${researcherSessionId}.jsonl`);
  const coderJsonl = path.resolve(JSONL_DIR, `${coderSessionId}.jsonl`);

  // Asegurar directorios
  const fs = await import("fs");
  if (!fs.existsSync(JSONL_DIR)) fs.mkdirSync(JSONL_DIR, { recursive: true });

  // ============================================================
  // TASK PADRE: orchestrator (foreground, spawnea subagents)
  // ============================================================
  const orchestratorId = db.createTask({
    cwd: process.cwd(),
    agent: "orchestrator",
    mode: "foreground",
    sessionId: rootSessionId,
    nestedSessionPath: researcherJsonl,  // 👈 apunta al JSONL del HIJO
    model: "claude-3.5-sonnet",
    effort: "high"
  });
  console.log(`📋 Orchestrator task: ${orchestratorId}`);

  db.startTask(orchestratorId);
  db.addEvent({ taskId: orchestratorId, status: "running", activity: "Spawning researcher subagent" });
  db.logUserMessage(rootSessionId, "Necesito investigar y luego implementar una feature");
  await sleep(100);
  db.logAssistantMessage(rootSessionId, "Voy a spawnear un researcher para investigar y luego un coder para implementar");
  await sleep(100);
  db.logToolCall(rootSessionId, "spawn_subagent", { agent: "researcher", task: "Investigar mejores prácticas para auth JWT" });
  await sleep(100);

  db.updateUsage(orchestratorId, 500, 200, 0.0012);
  db.addEvent({ taskId: orchestratorId, status: "running", activity: "Spawning researcher subagent", outputPreview: "spawn_subagent researcher..." });

  // ============================================================
  // TASK HIJO: researcher (background, research)
  // ============================================================
  const researcherId = db.createTask({
    cwd: process.cwd(),
    agent: "researcher",
    mode: "background",
    sessionId: researcherSessionId,
    nestedSessionPath: coderJsonl,  // 👈 apunta al JSONL del NIETO
    model: "claude-3.5-haiku",
    effort: "medium"
  });
  console.log(`🔍 Researcher task: ${researcherId}`);

  db.startTask(researcherId);
  db.logUserMessage(researcherSessionId, "Investigar mejores prácticas para auth JWT en Node.js");
  await sleep(100);
  db.logThinking(researcherSessionId, "Buscaré info sobre: algoritmos, expiración, refresh tokens, storage seguro");
  await sleep(200);
  db.logToolCall(researcherSessionId, "web_search", { query: "JWT best practices Node.js 2024" });
  await sleep(300);
  db.logToolResult(researcherSessionId, "web_search", "Resultados: RS256 recomendado, access token 15min, refresh token 7d, httpOnly cookies");
  await sleep(200);
  db.logToolCall(researcherSessionId, "web_search", { query: "JWT refresh token rotation security" });
  await sleep(300);
  db.logToolResult(researcherSessionId, "web_search", "Rotación obligatoria: invalidar refresh token tras uso, detectar reutilización");
  await sleep(200);
  db.logAssistantMessage(researcherSessionId, "Resumen: Usar RS256, access 15min, refresh 7d con rotación, httpOnly secure cookies, invalidar en logout");
  await sleep(100);

  db.updateUsage(researcherId, 1200, 800, 0.0042);
  db.addEvent({ taskId: researcherId, status: "running", activity: "Research completed, spawning coder", outputPreview: "spawn_subagent coder..." });

  // El researcher spawnea al coder
  db.logToolCall(researcherSessionId, "spawn_subagent", { agent: "coder", task: "Implementar auth JWT con refresh rotation" });
  await sleep(100);

  // ============================================================
  // TASK NIETO: coder (background, implementation)
  // ============================================================
  const coderId = db.createTask({
    cwd: process.cwd(),
    agent: "coder",
    mode: "background",
    sessionId: coderSessionId,
    nestedSessionPath: undefined,  // sin hijos
    model: "claude-3.5-sonnet",
    effort: "high"
  });
  console.log(`💻 Coder task: ${coderId}`);

  db.startTask(coderId);
  db.logUserMessage(coderSessionId, "Implementar auth JWT con refresh token rotation basado en research");
  await sleep(100);
  db.logThinking(coderSessionId, "Crearé: JWT service, middleware, endpoints login/refresh/logout, tests");
  await sleep(200);
  db.logToolCall(coderSessionId, "write_file", { path: "src/auth/jwt.ts", content: "// JWT service implementation" });
  await sleep(300);
  db.logToolResult(coderSessionId, "write_file", "Created src/auth/jwt.ts");
  await sleep(100);
  db.logThinking(coderSessionId, "Ahora crearé el middleware");
  await sleep(200);
  db.logToolCall(coderSessionId, "write_file", { path: "src/auth/middleware.ts", content: "// Auth middleware" });
  await sleep(300);
  db.logToolResult(coderSessionId, "write_file", "Created src/auth/middleware.ts");
  await sleep(100);
  db.logThinking(coderSessionId, "Ahora las rutas");
  await sleep(200);
  db.logToolCall(coderSessionId, "write_file", { path: "src/routes/auth.ts", content: "// Auth routes" });
  await sleep(300);
  db.logToolResult(coderSessionId, "write_file", "Created src/routes/auth.ts");
  await sleep(200);
  db.logToolCall(coderSessionId, "bash", { command: "npm test -- auth" });
  await sleep(500);
  db.logToolResult(coderSessionId, "bash", "PASS  auth tests\n  ✓ JWT signing\n  ✓ Refresh rotation\n  ✓ Middleware validation");
  await sleep(100);
  db.logAssistantMessage(coderSessionId, "Auth JWT implementado y tests pasando. Listo para revisión.");
  await sleep(100);

  db.updateUsage(coderId, 2500, 1800, 0.012);
  db.addEvent({ taskId: coderId, status: "running", activity: "All tests passing", outputPreview: "npm test -- auth → PASS" });

  // Completar nieto primero
  db.completeTask(coderId, "completed");
  console.log(`✅ Coder completed`);

  // Researcher completa
  db.updateUsage(researcherId, 0, 0, 0);
  db.completeTask(researcherId, "completed");
  console.log(`✅ Researcher completed`);

  // Orchestrator completa
  db.updateUsage(orchestratorId, 800, 400, 0.002);
  db.completeTask(orchestratorId, "completed");
  console.log(`✅ Orchestrator completed`);

  // ============================================================
  // Mostrar árbol final
  // ============================================================
  db.printTree();

  db.close();
  console.log("\n🎉 Simulación completa!");
  console.log("Ahora en Pi:");
  console.log("  export PI_SUBAGENTS_HISTORY_DB_PATH=" + DB_PATH);
  console.log("  /subagent-monitor");
  console.log("\nControles en monitor:");
  console.log("  ↑/↓        - seleccionar task");
  console.log("  Enter      - abrir detail view");
  console.log("  ←/→        - navegar padre/hijo");
  console.log("  P          - proyectar log completo");
  console.log("  Esc/b      - volver");
}

main().catch(console.error);