import { beforeAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { startCatalog, type ResolvedProject, type RunningCatalog } from "@drydock/catalog"
import { checkFocus, planChecks, runCaseChecks, withBrowser, type CasesRun, type FocusResult } from "../src"

const root = path.join(import.meta.dir, "fixtures", "project")
const project: ResolvedProject = {
  root,
  appConfig: "vite.config.ts",
  tokens: [],
  styles: [],
  rawValues: [],
  components: { ledger: { source: ["src"], entries: [/^src\/main\.tsx$/] } },
}
const plan = planChecks(project)
const ids = plan.groups.flatMap((g) => g.items.map((i) => i.id))

describe("planChecks", () => {
  test("lists the components that have a cases file, in the folder of the nearest bunfig.toml", () => {
    expect(plan.groups.map((g) => g.cwd)).toEqual([root])
    expect(ids).toEqual(["src/Fragile.tsx", "src/Good.tsx", "src/Ringless.tsx", "src/Unlabeled.tsx"])
    expect(plan.unplaced).toEqual([])
  })

  test("says why it cannot check a component that has no test setup above it", () => {
    const bare = planChecks({ ...project, root: path.join(root, "src"), components: { ledger: { source: ["."], entries: [/^main\.tsx$/] } } })
    expect(bare.groups).toEqual([])
    expect(bare.unplaced.map((u) => u.id)).toEqual(["Fragile.tsx", "Good.tsx", "Ringless.tsx", "Unlabeled.tsx"])
    expect(bare.unplaced[0]!.reason).toContain("bunfig.toml")
  })
})

describe("the checks that need no browser", () => {
  let run: CasesRun
  beforeAll(async () => {
    run = await runCaseChecks(plan.groups[0]!, { echo: false })
  }, 120_000)

  test("draws every case of every planned component", () => {
    expect(run.output).toContain("src/Good.tsx: 6 cases drawn and audited")
    expect(run.output).toContain("src/Unlabeled.tsx: 5 cases drawn and audited")
  })

  test("fails when a case throws, and names the case", () => {
    expect(run.passed).toBe(false)
    expect(run.output).toContain('"grid: mode: broken: broken mode"')
    expect(run.output).toContain('"sweep: mode: broken: broken mode"')
  })

  test("fails when a case has no accessible name, and names the case and the rule", () => {
    expect(run.output).toContain('"sample: button-name: Buttons must have discernible text (button)"')
  })

  test("fails nothing else", () => {
    const failed = run.output.split("\n").filter((line) => line.startsWith("(fail)"))
    expect(failed.map((line) => line.replace(/ \[[\d.]+m?s\]$/, ""))).toEqual([
      "(fail) drydock > src/Fragile.tsx > every case renders",
      "(fail) drydock > src/Unlabeled.tsx > roles, names and labels",
    ])
  })
})

describe("visible keyboard focus", () => {
  const results = new Map<string, FocusResult>()
  const folders = { before: process.cwd(), during: "", after: "" }
  beforeAll(async () => {
    const catalog: RunningCatalog = await startCatalog(project)
    try {
      folders.during = process.cwd()
      await withBrowser(async (browser) => {
        for (const item of plan.groups[0]!.items) results.set(item.id, await checkFocus(browser, catalog.url, item))
      })
    } finally {
      await catalog.close()
      folders.after = process.cwd()
    }
  }, 180_000)

  test("passes an element whose look changes when the keyboard focuses it", () => {
    expect(results.get("src/Good.tsx")).toMatchObject({ checked: 6, invisible: [], unreached: [] })
  })

  test("fails an element that takes away its ring and puts nothing in its place", () => {
    expect(results.get("src/Ringless.tsx")).toMatchObject({ checked: 2, invisible: ["sample: Go", "grid: Go"] })
  })

  test("works from the app's folder while the catalog runs, and returns to its own after", () => {
    expect(folders.during).toBe(root)
    expect(folders.after).toBe(folders.before)
  })
})
