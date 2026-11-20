// Runs inside a project's own `bun test` setup, started by path from src/cases.ts. It draws every case of each planned
// component and checks the two rules that need no browser: every case renders, and roles, names and labels are present.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import { allCases, type CaseItem, type CasesInput } from "@drydock/catalog/generate"
import { openReader, type Reader } from "@drydock/reader"
import type { CheckGroup } from "../src/plan"
import { AXE_OPTIONS } from "../src/axe"

const planFile = process.env.DRYDOCK_CHECK_PLAN
const group = planFile ? (JSON.parse(fs.readFileSync(planFile, "utf8")) as CheckGroup) : undefined

// Cases files import `skip` from here. A project that has not installed Drydock still resolves it.
const casesModule = Bun.resolveSync("@drydock/catalog/cases", import.meta.dir)
Bun.plugin({
  name: "drydock-cases",
  setup(build) {
    build.onResolve({ filter: /^@drydock\/catalog\/cases$/ }, () => ({ path: casesModule }))
  },
})


type Result = { label: string; error?: string; violations: string[] }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!

if (!group) {
  test.skip("no plan: the checks CLI starts this file", () => {})
} else {
  const readers = new Map<string, Promise<Reader>>()
  const readerFor = (tsconfig: string) => {
    let reader = readers.get(tsconfig)
    if (!reader) readers.set(tsconfig, (reader = openReader({ tsconfig })))
    return reader
  }
  afterAll(async () => {
    for (const reader of readers.values()) await (await reader).close()
  })

  describe("drydock", () => {
    let React: typeof import("react")
    let createRoot: typeof import("react-dom/client").createRoot
    let axe: typeof import("axe-core")
    /** The project's wrapper, when its config names one. Every case is drawn inside it, as the catalog's pages draw it. */
    let Wrap: unknown

    beforeAll(async () => {
      if (typeof document === "undefined") throw new Error(`The test setup in ${group.cwd} has no DOM. Its bunfig.toml needs a preload that registers happy-dom.`)
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
      // The project's own React draws the cases, the same copy its components import.
      React = await import(Bun.resolveSync("react", group.cwd))
      createRoot = (await import(Bun.resolveSync("react-dom/client", group.cwd))).createRoot
      axe = (await import("axe-core")).default
      if (group.wrap) {
        Wrap = ((await import(group.wrap)) as { default?: unknown }).default
        if (!Wrap) throw new Error(`The wrapper ${group.wrap} has no default export.`)
      }
    })

    async function draw(Component: unknown, item: CaseItem): Promise<Result> {
      const host = document.createElement("div")
      if (item.width) host.style.width = `${item.width}px`
      document.body.append(host)
      const errors: unknown[] = []
      const root = createRoot(host, { onUncaughtError: (error) => errors.push(error), onCaughtError: (error) => errors.push(error) })
      const bare = item.element ?? React.createElement(Component as never, item.props as never)
      const element = Wrap ? React.createElement(Wrap as never, null, bare as never) : bare
      try {
        await React.act(async () => root.render(element as never))
      } catch (error) {
        errors.push(error)
      }
      let violations: string[] = []
      if (errors.length === 0) {
        const result = await axe.run(host, AXE_OPTIONS)
        violations = result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)
      }
      await React.act(async () => root.unmount())
      host.remove()
      return { label: item.label === item.section ? item.label : `${item.section}: ${item.label}`, ...(errors.length ? { error: message(errors[0]) } : {}), violations }
    }

    for (const item of group.items) {
      describe(item.id, () => {
        const results: Result[] = []
        let setup: string | undefined
        beforeAll(async () => {
          try {
            const module = (await import(item.file)) as Record<string, unknown>
            const Component = module[item.part] ?? module.default
            const cases = ((await import(item.casesFile)) as { default?: CasesInput }).default
            if (!Component) throw new Error(`${item.file} does not export ${item.part}`)
            if (!cases?.sample) throw new Error(`${item.casesFile} has no default export with a sample`)
            const shape = await (await readerFor(item.tsconfig)).read(item.file, item.part)
            if (!shape) throw new Error(`The reader did not find ${item.part} in ${item.file}`)
            for (const each of allCases(shape, cases)) results.push(await draw(Component, each))
            console.log(`${item.id}: ${results.length} cases drawn and audited`)
          } catch (error) {
            setup = message(error)
          }
        }, 120_000)

        test("every case renders", () => {
          expect(setup).toBeUndefined()
          expect(results.filter((r) => r.error).map((r) => `${r.label}: ${r.error}`)).toEqual([])
        })

        test("roles, names and labels", () => {
          expect(setup).toBeUndefined()
          expect(results.flatMap((r) => r.violations.map((v) => `${r.label}: ${v}`))).toEqual([])
        })
      })
    }
  })
}
