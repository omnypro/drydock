// Runs the three checks that may fail a build. Usage: bun scripts/check.ts <project root> [project config] [--cases] [--focus] [--component <id>]
// With neither --cases nor --focus it runs both. The config defaults to drydock.config.ts at the project root.
// It exits with 1 when a check fails, and with 2 when it cannot run.
import path from "node:path"
import { startCatalog, type ProjectConfig } from "@drydock/catalog"
import { checkFocus, planChecks, runCaseChecks, withBrowser } from "../src"

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith("--")))
const only = args.flatMap((a, i) => (a === "--component" && args[i + 1] ? [args[i + 1]!] : []))
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--component")
const [rootArg, configArg] = positional
if (!rootArg) {
  console.error("usage: bun scripts/check.ts <project root> [project config] [--cases] [--focus] [--component <id>]")
  process.exit(2)
}
const root = path.resolve(rootArg)
const config = (await import(path.resolve(configArg ?? path.join(root, "drydock.config.ts")))).default as ProjectConfig
const project = { ...config, root }
const both = !flags.has("--cases") && !flags.has("--focus")

const plan = planChecks(project, only.length ? only : undefined)
for (const { id, reason } of plan.unplaced) console.error(`cannot check ${id}: ${reason}`)
const items = plan.groups.flatMap((g) => g.items)
console.log(`${items.length} components with a cases file`)
let failed = false

if (both || flags.has("--cases")) {
  for (const group of plan.groups) {
    const run = await runCaseChecks(group)
    if (!run.passed) failed = true
  }
}

if ((both || flags.has("--focus")) && items.length) {
  const catalog = await startCatalog(project)
  try {
    await withBrowser(async (browser) => {
      for (const item of items) {
        const result = await checkFocus(browser, catalog.url, item)
        if (result.error) {
          failed = true
          console.log(`focus ${item.id}: could not check: ${result.error}`)
          continue
        }
        console.log(`focus ${item.id}: ${result.checked - result.invisible.length} of ${result.checked} show focus`)
        for (const label of result.invisible) console.log(`  no visible focus: ${label}`)
        for (const label of result.unreached) console.log(`  not reached by Tab: ${label}`)
        if (result.invisible.length) failed = true
      }
    })
  } finally {
    await catalog.close()
  }
}

if (plan.unplaced.length && !items.length) process.exit(2)
process.exit(failed ? 1 : 0)
