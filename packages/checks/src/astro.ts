import { GlobalRegistrator } from "@happy-dom/global-registrator"
import path from "node:path"
import { buildAstroCatalog, casesFileFor, ledgerConfig, type ResolvedProject } from "@drydock/catalog"
import { deriveLedger } from "@drydock/ledger"
import { AXE_OPTIONS } from "./axe"

export type AstroRun = { components: number; passed: boolean; output: string }

/** The `.astro` components that have a cases file. `only` limits it to these ids. */
export function planAstro(project: ResolvedProject, only?: string[]): { id: string }[] {
  if (!project.components) return []
  return deriveLedger(ledgerConfig(project))
    .components.filter((c) => c.kind === "astro" && (!only || only.includes(c.id)) && casesFileFor(path.join(project.root, c.id)))
    .map((c) => ({ id: c.id }))
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!

/**
 * The checks for `.astro` cases that need no browser. The catalog's static build is the first: a case that throws
 * fails it, so every case renders only when the build passes. Then the structural rules run over each built page, one
 * drawn case at a time.
 */
export async function runAstroChecks(project: ResolvedProject, items: { id: string }[], { echo = true } = {}): Promise<AstroRun> {
  const lines: string[] = []
  const say = (line: string) => {
    lines.push(line)
    if (echo) console.log(line)
  }
  const done = (passed: boolean): AstroRun => ({ components: items.length, passed, output: lines.join("\n") })
  if (!items.length) return done(true)

  let built: Awaited<ReturnType<typeof buildAstroCatalog>>
  try {
    built = await buildAstroCatalog(project)
  } catch (error) {
    say(`(fail) every case renders: the catalog's Astro build failed: ${message(error)}`)
    return done(false)
  }

  let passed = true
  GlobalRegistrator.register()
  try {
    // axe reads the window when it loads, so it loads after happy-dom is in place.
    const axe = (await import("axe-core")).default
    for (const item of items) {
      const page = built.pages.find((p) => p.id === item.id)
      if (!page) {
        say(`(fail) ${item.id}: the build has no page for it`)
        passed = false
        continue
      }
      document.documentElement.innerHTML = await Bun.file(page.file).text()
      const stages = [...document.querySelectorAll(".stage")]
      const violations: string[] = []
      for (const stage of stages) {
        const section = stage.closest("section")?.id ?? ""
        const name = stage.closest(".case")?.querySelector("h3")?.textContent?.trim()
        const label = name ? `${section}: ${name}` : section
        const result = await axe.run(stage, AXE_OPTIONS)
        for (const v of result.violations) violations.push(`${label}: ${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)
      }
      say(`${item.id}: ${stages.length} cases built and audited`)
      for (const v of violations) say(`(fail) ${item.id} > roles, names and labels: ${v}`)
      if (violations.length) passed = false
    }
  } finally {
    await GlobalRegistrator.unregister()
  }
  return done(passed)
}
