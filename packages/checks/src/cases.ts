import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { CheckGroup } from "./plan"

const RUNNER = path.join(import.meta.dir, "..", "runner", "cases.test.tsx")

export type CasesRun = { cwd: string; components: number; passed: boolean; output: string }

/**
 * Runs the no-browser checks for one group inside the project's own test setup: `bun test` in the folder of its
 * `bunfig.toml`, so the project's preloads (happy-dom, a compiler plugin) apply. Nothing is written into the project.
 */
export async function runCaseChecks(group: CheckGroup, { echo = true } = {}): Promise<CasesRun> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drydock-checks-"))
  const planFile = path.join(dir, "plan.json")
  fs.writeFileSync(planFile, JSON.stringify(group))
  try {
    const child = Bun.spawn([process.execPath, "test", RUNNER], {
      cwd: group.cwd,
      env: { ...process.env, DRYDOCK_CHECK_PLAN: planFile },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
    const output = `${stdout}${stderr}`
    if (echo) process.stdout.write(output)
    return { cwd: group.cwd, components: group.items.length, passed: (await child.exited) === 0, output }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
