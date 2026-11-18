import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { startCatalog, type ResolvedProject, type RunningCatalog } from "@drydock/catalog"
import { checkFocus, planAstro, runAstroChecks, withBrowser, type AstroRun, type FocusResult } from "../src"

const site = (name: string): ResolvedProject => ({
  root: fs.realpathSync(path.join(import.meta.dir, "fixtures", name)),
  appConfig: "astro.config.mjs",
  tokens: [],
  styles: [],
  rawValues: [],
  components: { ledger: { source: ["src"], entries: [/^src\/pages\//], entryExports: true } },
})
const project = site("astro-site")

test("lists the .astro components that have a cases file", () => {
  expect(planAstro(project).map((c) => c.id)).toEqual(["src/components/Good.astro", "src/components/Pinger.astro", "src/components/Ringless.astro", "src/components/Unlabeled.astro"])
})

describe("the checks that need no browser", () => {
  let run: AstroRun
  beforeAll(async () => {
    run = await runAstroChecks(project, planAstro(project), { echo: false })
  }, 180_000)

  test("builds and audits every case of every component", () => {
    expect(run.output).toContain("src/components/Good.astro: 2 cases built and audited")
    expect(run.output).toContain("src/components/Ringless.astro: 1 cases built and audited")
    // Its built page carries a module script, which the audit reads past without loading.
    expect(run.output).toContain("src/components/Pinger.astro: 1 cases built and audited")
  })

  test("fails when a case has no accessible name, and names the case and the rule, and fails nothing else", () => {
    expect(run.passed).toBe(false)
    expect(run.output.split("\n").filter((line) => line.startsWith("(fail)"))).toEqual([
      "(fail) src/components/Unlabeled.astro > roles, names and labels: sample: button-name: Buttons must have discernible text (button)",
    ])
  })

  test("fails every case renders when a case throws, since the build stops", async () => {
    const broken = site("astro-broken")
    const result = await runAstroChecks(broken, planAstro(broken), { echo: false })
    expect(result.passed).toBe(false)
    expect(result.output).toContain("(fail) every case renders: the catalog's Astro build failed:")
    expect(result.output).toContain("A gauge cannot show 140")
  }, 180_000)
})

describe("visible keyboard focus on .astro pages", () => {
  const results = new Map<string, FocusResult>()
  let catalog: RunningCatalog
  beforeAll(async () => {
    catalog = await startCatalog(project)
    await withBrowser(async (browser) => {
      for (const item of planAstro(project, ["src/components/Good.astro", "src/components/Ringless.astro"])) results.set(item.id, await checkFocus(browser, catalog.url, item))
    })
  }, 180_000)

  afterAll(async () => {
    await catalog.close()
  }, 30_000)

  test("passes a button the browser draws a ring on, and fails one that takes the ring away", () => {
    expect(results.get("src/components/Good.astro")).toMatchObject({ checked: 2, invisible: [], unreached: [] })
    expect(results.get("src/components/Ringless.astro")).toMatchObject({ checked: 1, invisible: ["sample: Go"] })
  })
})

test("writes nothing into the sites", () => {
  for (const name of ["astro-site", "astro-broken"]) expect([".astro", "dist"].filter((entry) => fs.existsSync(path.join(import.meta.dir, "fixtures", name, entry)))).toEqual([])
})
