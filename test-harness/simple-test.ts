// Simple test to verify monitor captures activity in the database
// Creates a task in subagent_tasks and events in subagent_events

import { getSubagentDB } from "./subagent-db.js";
import { resolve } from "path";

const DB_PATH = resolve("test-harness/subagent-history.sqlite");

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log("🧪 Running simple test to verify monitor captures DB activity...\n");
  console.log(`📁 Using DB: ${DB_PATH}\n`);

  const db = getSubagentDB(DB_PATH);

  // 1. Create a test task
  const taskId = db.createTask(
    process.cwd(),
    "test-monitor-agent",
    "background",
    "session-test-001"
  );
  console.log(`📋 Created task: ${taskId}`);

  // 2. Start the task (sets status to running, adds event)
  db.startTask(taskId);
  console.log(`▶️  Task started (status: running)`);

  // 3. Add some activity events
  db.addEvent(taskId, "running", "Processing test data");
  await sleep(100);
  db.addEvent(taskId, "running", "Fetching test resources");
  await sleep(100);
  db.addEvent(taskId, "running", "Analyzing results");
  console.log(`📊 Added 3 activity events`);

  // 4. Update usage stats
  db.updateUsage(taskId, 100, 50, 0.0005);
  console.log(`📈 Updated usage stats`);

  // 5. Complete the task
  db.completeTask(taskId, "completed");
  console.log(`✅ Task completed (status: completed)`);

  // 6. Verify by reading back
  const events = db.getEvents(taskId);
  console.log(`\n📊 Total events for task: ${events.length}`);
  events.forEach((e: any, i: number) => {
    console.log(`  ${i + 1}. [${e.status}] ${e.activity} (${e.created_at})`);
  });

  // Print tree
  db.printTree();

  db.close();
  console.log("\n✅ Simple test completed successfully!");
  console.log("Monitor should now show this task in the DB.");
}

main().catch(console.error);
