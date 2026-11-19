import fs from "node:fs"
import path from "node:path"
import { deriveLedger, type Ledger, type LedgerComponent } from "@drydock/ledger"
import { markState, readMarks, type MarkState } from "@drydock/marks"
import { openReader, type ComponentShape, type Reader } from "@drydock/reader"
import { casesFileFor, ledgerConfig, type ResolvedProject } from "../project"
import { compareProps, type PropRow } from "./handover"

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
  /** The marks that name this component, as the new one, the old one or a parked one. */
  marks: MarkState[]
  /** New components that this component's cases file draws and that a mark says replace another, with the part of each to swap. */
  swaps: Swap[]
  error?: string
}

/** A new component and the old one it replaces, by file, with the export of each that a page swaps. */
export type Swap = { newId: string; oldId: string; part: string; oldPart: string }

export type ComponentIndex = {
  /** `cases` is whether a cases file sits beside the component. */
  components: (Pick<LedgerComponent, "id" | "name" | "filed" | "level" | "apps" | "inShowcase" | "kind"> & { cases: boolean })[]
  unresolved: number
}

export type MarksView = {
  /** The marks file from the project config, or `null` when the config names none. */
  file: string | null
  exists: boolean
  marks: MarkState[]
  problems: string[]
}

/** A component that replaces another, set beside the one it replaces. */
export type Handover = {
  mark: MarkState & { mark: "replaces" }
  component: LedgerComponent
  /** `null` when the ledger does not list the old component, as when its file is gone. */
  old: LedgerComponent | null
  part: string
  parts: string[]
  oldPart: string | null
  shape: ComponentShape | null
  oldShape: ComponentShape | null
  /** Empty unless both shapes were read. */
  props: PropRow[]
  casesFile: string | null
  errors: string[]
}

const exists = (file: string) => fs.existsSync(file)

/** The ledger and the readers for a project. Both are built when a page asks, and dropped when a source file changes. */
export function componentService(project: ResolvedProject) {
  const settings = project.components
  let ledger: Ledger | undefined
  /** Kept with the ledger, since the plugin asks for the index on every module it resolves. */
  let indexed: ComponentIndex | undefined
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
  const current = (): Ledger => (ledger ??= deriveLedger(ledgerConfig(project)))
  const listed = (id: string) => current().components.find((c) => c.id === id)

  /** The props of one part, or why they could not be read. */
  const shapeOf = async (component: LedgerComponent, part: string): Promise<{ shape: ComponentShape | null; error?: string }> => {
    const file = path.join(project.root, component.id)
    const tsconfig = tsconfigFor(file)
    if (!tsconfig) return { shape: null, error: "No tsconfig.json above the component" }
    if (component.kind === "astro") return { shape: null, error: "The reader reads React components only" }
    try {
      return { shape: (await (await readerFor(tsconfig)).read(file, part)) ?? null }
    } catch (caught) {
      return { shape: null, error: caught instanceof Error ? caught.message : String(caught) }
    }
  }
  const casesFor = (component: LedgerComponent) => {
    const file = casesFileFor(path.join(project.root, component.id))
    return file ? path.relative(project.root, file) : null
  }


  /** The marks file is read on every call. It is small, and a page then follows an edit to it without a watcher. */
  const marks = (): MarksView => {
    if (!settings?.marks) return { file: null, exists: false, marks: [], problems: [] }
    const read = readMarks(project.root, settings.marks)
    return { file: read.file, exists: read.exists, problems: read.problems, marks: read.marks.map((mark) => markState(mark, current())) }
  }
  const replacing = (id: string) => marks().marks.filter((m): m is Handover["mark"] => m.mark === "replaces" && m.component === id)
  /** The old part is the one of the same name, when the old file has it, so a file of several parts pairs them up. */
  const oldPartFor = (old: LedgerComponent, part: string) => (old.parts.includes(part) ? part : old.parts[0]!)
  const swapsFor = (id: string): Swap[] => {
    const component = listed(id)
    const cases = component && casesFor(component)
    if (!cases) return []
    return marks().marks.flatMap((mark) => {
      if (mark.mark !== "replaces") return []
      const neu = listed(mark.component)
      const old = listed(mark.replaces)
      if (!neu || !old || !neu.shownIn.includes(cases)) return []
      return [{ newId: neu.id, oldId: old.id, part: neu.parts[0]!, oldPart: oldPartFor(old, neu.parts[0]!) }]
    })
  }

  return {
    enabled: Boolean(settings),
    /** Forgets the ledger and what the readers hold, so the next page sees the files as they are. */
    invalidate() {
      ledger = undefined
      indexed = undefined
      for (const reader of readers.values()) void reader.then((r) => r.refresh())
    },
    /** The same, and resolves once every reader has caught up, for a caller that reads right after. */
    async refresh() {
      ledger = undefined
      indexed = undefined
      await Promise.all([...readers.values()].map(async (reader) => (await reader).refresh()))
    },
    /** The whole ledger, as the import scan last read it. */
    ledger: current,
    async close() {
      await Promise.all([...readers.values()].map(async (reader) => (await reader).close()))
      readers.clear()
    },
    index(): ComponentIndex {
      if (indexed) return indexed
      const { components, unresolved } = current()
      indexed = {
        components: components.map((component) => {
          const { id, name, filed, level, apps, inShowcase, kind } = component
          return { id, name, filed, level, apps, inShowcase, kind, cases: casesFor(component) !== null }
        }),
        unresolved: unresolved.length,
      }
      return indexed
    },
    marks,
    /** The ledger component a file is, when the ledger lists it. */
    listed,
    /** The old components that a component replaces, among those the ledger lists. */
    replacedBy: (id: string) => replacing(id).flatMap((m) => listed(m.replaces) ?? []),
    swapsFor,
    async page(id: string, part?: string): Promise<ComponentPage | undefined> {
      const component = listed(id)
      if (!component) return undefined
      const chosen = part && component.parts.includes(part) ? part : component.parts[0]!
      const { shape, error } = await shapeOf(component, chosen)
      const named = marks().marks.filter((m) => m.component === id || (m.mark === "replaces" && m.replaces === id))
      return { component, part: chosen, parts: component.parts, shape, casesFile: casesFor(component), marks: named, swaps: swapsFor(id), ...(error ? { error } : {}) }
    },
    /** The handover of a component marked as replacing another. `replaces` picks the old one when the component replaces several. */
    async handover(id: string, part?: string, replaces?: string): Promise<Handover | undefined> {
      const component = listed(id)
      const all = replacing(id)
      const mark = all.find((m) => m.replaces === replaces) ?? all[0]
      if (!component || !mark) return undefined
      const chosen = part && component.parts.includes(part) ? part : component.parts[0]!
      const old = listed(mark.replaces) ?? null
      const oldPart = old ? oldPartFor(old, chosen) : null
      const [neu, before] = await Promise.all([shapeOf(component, chosen), old && oldPart ? shapeOf(old, oldPart) : Promise.resolve({ shape: null })])
      const errors = [neu.error, "error" in before ? before.error : undefined].filter((e): e is string => Boolean(e))
      return {
        mark,
        component,
        old,
        part: chosen,
        parts: component.parts,
        oldPart,
        shape: neu.shape,
        oldShape: before.shape,
        props: neu.shape && before.shape ? compareProps(before.shape, neu.shape, mark.renamed) : [],
        casesFile: casesFor(component),
        errors,
      }
    },
  }
}

export type ComponentService = ReturnType<typeof componentService>
