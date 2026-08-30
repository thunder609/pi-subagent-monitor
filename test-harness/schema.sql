-- Schema compatible con pi-subagent-monitor
-- Usa node:sqlite built-in (Node >= 22.5)
-- Columnas exactas que el monitor espera en subagent_tasks
CREATE TABLE IF NOT EXISTS subagent_tasks (
  id TEXT PRIMARY KEY,
  cwd TEXT NOT NULL,
  agent TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('foreground','background')),
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed','queued','cancelled','canceled')),
  created_at TEXT NOT NULL,
  session_id TEXT,
  nested_session_path TEXT
);

-- Eventos para detail view
CREATE TABLE IF NOT EXISTS subagent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  activity TEXT,
  output_preview TEXT,
  FOREIGN KEY (task_id) REFERENCES subagent_tasks(id) ON DELETE CASCADE
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_tasks_cwd ON subagent_tasks(cwd);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON subagent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON subagent_tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_events_task ON subagent_events(task_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON subagent_events(created_at);