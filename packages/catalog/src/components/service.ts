import fs from "node:fs"
import path from "node:path"
import { deriveLedger, type Ledger, type LedgerComponent } from "@drydock/ledger"
import { openReader, type ComponentShape, type Reader } from "@drydock/reader"
import type { ResolvedProject } from "../project"

export type ComponentPage = {
  component: LedgerComponent
  /** The part this page draws. */
  part: string
  /** Every component the file exports. */
  parts: string[]
  /** `null` when the reader did not find the part, or could not read the file. */
  shape: ComponentShape | null
  /** The cases file beside the component, from the project root, or `null` when there is none. */
  casesFile: string | null
  error?: string
}

export type ComponentIndex = { components: Pick<LedgerComponent, "id" | "name" | "filed" | "level" | "apps" | "inShowcase" | "kind">[]; unresolved: number }

const exists = (file: string) => fs.existsSync(file)

/** The ledger and the readers for a project. Both are built when a page asks, and dropped when a source file changes. */
export function componentService(project: ResolvedProject) {
  const settings = project.components
  let ledger: Ledger | undefined
  const readers = new Map<string, Promise<Reader>>()

  const tsconfigFor = (file: string): string | undefined => {
    if (settings?.tsconfig) return path.resolve(project.root, settings.tsconfig)
    for (let dir = path.dirname(file); dir.startsWith(project.root); dir = path.dirname(dir)) {
      const candidate = path.join(dir, "tsconfig.json")
      if (exists(candidate)) return candidate
    }
    return undefined
  }
  const readerFor = (tsconfig: string) => {
    let reader = readers.get(tsconfig)
    if (!reader) {
      reader = openReader({ tsconfig })
      readers.set(tsconfig, reader)
    }
    return reader
  }
  const current = (): Ledger => (ledger ??= deriveLedger({ root: project.root, ...settings!.ledger }))

  return {
    enabled: Boolean(settings),
    /** Forgets the ledger and what the readers hold, so the next page sees the files as they are. */
    invalidate() {
      ledger = undefined
      for (const reader of readers.values()) void reader.then((r) => r.refresh())
    },
    async close() {
      await Promise.all([...readers.values()].map(async (reader) => (await reader).close()))
      readers.clear()
    },
    index(): ComponentIndex {
      const { components, unresolved } = current()
      return { components: components.map(({ id, name, filed, level, apps, inShowcase, kind }) => ({ id, name, filed, level, apps, inShowcase, kind })), unresolved: unresolved.length }
    },
    async page(id: string, part?: string): Promise<ComponentPage | undefined> {
      const component = current().components.find((c) => c.id === id)
      if (!component) return undefined
      const file = path.join(project.root, component.id)
      const chosen = part && component.parts.includes(part) ? part : component.parts[0]!
      const base = path.join(path.dirname(file), `${path.basename(file).replace(/\.\w+$/, "")}.cases.tsx`)
      const casesFile = exists(base) ? path.relative(project.root, base) : null
      const tsconfig = tsconfigFor(file)
      let shape: ComponentShape | null = null
      let error: string | undefined
      if (!tsconfig) error = "No tsconfig.json above the component"
      else if (component.kind === "astro") error = "The reader reads React components only"
      else {
        try {
          shape = (await (await readerFor(tsconfig)).read(file, chosen)) ?? null
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught)
        }
      }
      return { component, part: chosen, parts: component.parts, shape, casesFile, ...(error ? { error } : {}) }
    },
  }
}

export type ComponentService = ReturnType<typeof componentService>
