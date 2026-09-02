import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The test-harness helper (test-harness/subagent-db.ts) is consumed by the
 * real CLI execution path via `npx tsx` (and historically by `node` with the
 * TypeScript strip-types loader), NOT by the vitest transformer. Vitest
 * silently rewrites bare `require()` calls so the import looks healthy there
 * even when the file is broken for any real Node ESM loader. To prove the
 * harness actually loads at runtime, we shell out to the same Node ESM loader
 * the user runs and assert it returns the expected exports without an
 * unhandled `ReferenceError`.
 */

const harnessFile = resolve(process.cwd(), "test-harness/subagent-db.ts");
const nodeBinary = process.execPath;
const args = ["--experimental-strip-types", "--input-type=module", "-e", `import("./test-harness/subagent-db.ts").then(m => { process.stdout.write("OK " + Object.keys(m).sort().join(",")); }).catch(e => { process.stderr.write("FAIL " + e.message); process.exit(1); })`];

describe("test-harness/subagent-db (real Node ESM loader)", () => {
  it("source file exists at the expected path", () => {
    expect(existsSync(harnessFile)).toBe(true);
  });

  it("loads under the Node ESM loader used at runtime (no ReferenceError)", () => {
    const result = spawnSync(nodeBinary, args, { encoding: "utf8", cwd: process.cwd() });
    // Strip the noisy experimental warning Node prints to stderr; we only
    // care about whether the script crashed with the actual bug signature.
    const stderr = (result.stderr ?? "").replace(/^\(node:\d+\) ExperimentalWarning:.*$/gm, "").trim();
    expect(result.status, `node --experimental-strip-types crashed.\nstdout: ${result.stdout}\nstderr: ${stderr}`).toBe(0);
    expect(result.stdout).toMatch(/^OK SubagentDB,getSubagentDB$/);
    // Belt-and-suspenders: the historical bug surfaces literally as
    // "require is not defined in ES module scope". Even if some future Node
    // version changes the message, we want this regression test to fail loud.
    expect(stderr).not.toMatch(/require is not defined in ES module scope/);
  });
});
