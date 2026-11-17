import fs from "node:fs"
import path from "node:path"
import { deriveLedger, type Ledger, type LedgerComponent } from "@drydock/ledger"
import { markState, readMarks, type MarkState } from "@drydock/marks"
import { openReader, type ComponentShape, type Reader } from "@drydock/reader"
import { ledgerConfig, type ResolvedProject } from "../project"
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
  error?: string
}

export type ComponentIndex = { components: Pick<LedgerComponent, "id" | "name" | "filed" | "level" | "apps" | "inShowcase" | "kind">[]; unresolved: number }

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
const casesFileOf = (file: string) => path.join(path.dirname(file), `${path.basename(file).replace(/\.\w+$/, "")}.cases.tsx`)

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
    const file = casesFileOf(path.join(project.root, component.id))
    return exists(file) ? path.relative(project.root, file) : null
  }

  /** The marks file is read on every call. It is small, and a page then follows an edit to it without a watcher. */
  const marks = (): MarksView => {
    if (!settings?.marks) return { file: null, exists: false, marks: [], problems: [] }
    const read = readMarks(project.root, settings.marks)
    return { file: read.file, exists: read.exists, problems: read.problems, marks: read.marks.map((mark) => markState(mark, current())) }
  }
  const replacing = (id: string) => marks().marks.filter((m): m is Handover["mark"] => m.mark === "replaces" && m.component === id)

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
    marks,
    /** The ledger component a file is, when the ledger lists it. */
    listed,
    /** The old components that a component replaces, among those the ledger lists. */
    replacedBy: (id: string) => replacing(id).flatMap((m) => listed(m.replaces) ?? []),
    async page(id: string, part?: string): Promise<ComponentPage | undefined> {
      const component = listed(id)
      if (!component) return undefined
      const chosen = part && component.parts.includes(part) ? part : component.parts[0]!
      const { shape, error } = await shapeOf(component, chosen)
      const named = marks().marks.filter((m) => m.component === id || (m.mark === "replaces" && m.replaces === id))
      return { component, part: chosen, parts: component.parts, shape, casesFile: casesFor(component), marks: named, ...(error ? { error } : {}) }
    },
    /** The handover of a component marked as replacing another. `replaces` picks the old one when the component replaces several. */
    async handover(id: string, part?: string, replaces?: string): Promise<Handover | undefined> {
      const component = listed(id)
      const all = replacing(id)
      const mark = all.find((m) => m.replaces === replaces) ?? all[0]
      if (!component || !mark) return undefined
      const chosen = part && component.parts.includes(part) ? part : component.parts[0]!
      const old = listed(mark.replaces) ?? null
      // The old part is the one of the same name, when the old file has it, so a file of several parts pairs them up.
      const oldPart = old ? (old.parts.includes(chosen) ? chosen : old.parts[0]!) : null
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
