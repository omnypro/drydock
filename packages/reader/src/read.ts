import path from "node:path"
import type { ComponentFacts, Literal, Project, PropFacts } from "./facts"
import type { ComponentShape, PropShape } from "./types"

/** Orders values by where the source declares them. Values the source does not list keep the compiler's order, after the listed ones. */
export function inDeclarationOrder(values: Literal[], declared: Literal[]): Literal[] {
  const rank = (value: Literal) => {
    const at = declared.indexOf(value)
    return at === -1 ? declared.length : at
  }
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => rank(a.value) - rank(b.value) || a.index - b.index)
  const result = sorted.map((entry) => entry.value)
  // `boolean` is not a list in the source, so false comes before true by rule.
  return result.every((v) => typeof v === "boolean") ? result.sort((a, b) => Number(a) - Number(b)) : result
}

type Literals = { values: Literal[] | null; nullable: boolean }

async function literalsOf(prop: PropFacts): Promise<Literals> {
  const values: Literal[] = []
  let nullable = false
  for (const part of await (await prop.type()).parts()) {
    if (part.isNull()) {
      nullable = true
      continue
    }
    if (part.isEmpty()) continue
    const literal = await part.literal()
    if (literal === undefined) return { values: null, nullable }
    values.push(literal)
  }
  return { values, nullable }
}

type Seen = { prop: PropFacts; values: Literal[] | null }

type Place = { own: boolean; file: string; position: number }

/** Props of the component's own file come first. The rest follow by file, then by where the file declares them. */
const before = (a: Place, b: Place) => Number(b.own) - Number(a.own) || a.file.localeCompare(b.file) || a.position - b.position

/** What the reader learns about one prop across every member of the props type. */
type Entry = Place & {
  name: string
  optional: boolean
  doc: string
  values: Literal[]
  data: boolean
  nullable: boolean
  texts: string[]
}

/** The path of `target` from the folder of `from`, written as an import would write it. */
function relativeTo(from: string, target: string): string {
  const relative = path.relative(path.dirname(from), target)
  return relative.startsWith(".") ? relative : `./${relative}`
}

export async function readComponent(project: Project, file: string, name: string, compiler: string): Promise<ComponentShape | undefined> {
  const facts: ComponentFacts | undefined = await project.component(file, name)
  if (!facts) return undefined
  if (!facts.props) return { name, compiler, doc: facts.doc, props: [], shapes: [{}], defaults: facts.defaults, takesChildren: false }

  const members: { seen: Seen[]; lead: Place | undefined }[] = []
  const looseIn = new Set<string>()
  const nullable = new Set<string>()
  let takesChildren = false
  for (const member of await facts.props.parts()) {
    takesChildren ||= await facts.takesChildren(member)
    const seen: Seen[] = []
    let lead: Place | undefined
    for (const prop of await facts.declaredProps(member)) {
      const { values, nullable: isNullable } = await literalsOf(prop)
      if (isNullable) nullable.add(prop.name)
      // A prop that is only `never` or `undefined` in this member is not a value there. It still makes the prop optional.
      if (values && values.length === 0) {
        looseIn.add(prop.name)
        continue
      }
      if (values && (!lead || before(prop, lead) < 0)) lead = prop
      seen.push({ prop, values })
    }
    members.push({ seen, lead })
  }
  // Members, and the props inside them, go by position in the source. The compiler's order is not stable across versions.
  members.sort((a, b) => (a.lead && b.lead ? before(a.lead, b.lead) : Number(!a.lead) - Number(!b.lead)))

  const entries = new Map<string, Entry>()
  const declared = new Map<string, Literal[]>()
  const inMembers = new Map<string, number>()
  for (const { seen } of members) {
    for (const { prop, values } of seen) {
      inMembers.set(prop.name, (inMembers.get(prop.name) ?? 0) + 1)
      const text = await (await prop.type()).text()
      const entry: Entry = entries.get(prop.name) ?? {
        name: prop.name,
        file: prop.file,
        own: prop.own,
        position: prop.position,
        optional: prop.optional,
        doc: "",
        values: [],
        data: false,
        nullable: false,
        texts: [],
      }
      if (before(prop, entry) < 0) Object.assign(entry, { file: prop.file, own: prop.own, position: prop.position })
      entry.optional ||= prop.optional
      if (!values) entry.data = true
      for (const value of values ?? []) if (!entry.values.includes(value)) entry.values.push(value)
      if (!entry.texts.includes(text)) entry.texts.push(text)
      if (!entry.doc) entry.doc = await prop.doc()
      if (values) declared.set(prop.name, [...new Set([...(declared.get(prop.name) ?? []), ...(await prop.declaredOrder())])])
      entries.set(prop.name, entry)
    }
  }
  // A prop that some member leaves out, or allows only as `undefined` or `never`, is optional.
  for (const entry of entries.values()) {
    if (looseIn.has(entry.name) || (inMembers.get(entry.name) ?? 0) < members.length) entry.optional = true
    entry.nullable = nullable.has(entry.name)
  }

  const ordered = [...entries.values()]
    .sort(before)
    .map((entry): PropShape => {
      const origin = entry.own ? {} : { declaredIn: relativeTo(file, entry.file) }
      if (entry.data) return { name: entry.name, kind: "data", optional: entry.optional, type: entry.texts.join(" | "), doc: entry.doc, ...origin, values: [], ordered: true }
      const list = declared.get(entry.name) ?? []
      const values = inDeclarationOrder(entry.values, list)
      const kind = values.every((v) => typeof v === "boolean") ? "boolean" : "union"
      // The compiler prints a union in its own order, so a union's text is rebuilt from the ordered values.
      const type = kind === "union" ? [...values.map((value) => JSON.stringify(value)), ...(entry.nullable ? ["null"] : [])].join(" | ") : entry.texts.join(" | ")
      const listed = kind === "boolean" || values.every((value) => list.includes(value))
      return { name: entry.name, kind, optional: entry.optional, type, doc: entry.doc, ...origin, values, ordered: listed }
    })

  const shapes = members.map(({ seen }) => {
    const shape: Record<string, Literal[]> = {}
    for (const { prop, values } of seen.slice().sort((a, b) => before(a.prop, b.prop))) {
      if (values) shape[prop.name] = inDeclarationOrder(values, declared.get(prop.name) ?? [])
    }
    return shape
  })

  return { name, compiler, doc: facts.doc, props: ordered, shapes, defaults: facts.defaults, takesChildren }
}
