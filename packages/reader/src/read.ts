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

async function literalsOf(prop: PropFacts): Promise<Literal[] | null> {
  const out: Literal[] = []
  for (const part of await (await prop.type()).parts()) {
    if (part.isEmpty()) continue
    const literal = await part.literal()
    if (literal === undefined) return null
    out.push(literal)
  }
  return out
}

export async function readComponent(project: Project, file: string, name: string, compiler: string): Promise<ComponentShape | undefined> {
  const facts: ComponentFacts | undefined = await project.component(file, name)
  if (!facts) return undefined

  type Seen = { prop: PropFacts; values: Literal[] | null }
  const members: { seen: Seen[]; position: number }[] = []
  for (const member of await facts.props.parts()) {
    const seen: Seen[] = []
    let position = Number.POSITIVE_INFINITY
    for (const prop of await facts.ownProps(member)) {
      const values = await literalsOf(prop)
      if (values && values.length === 0) continue
      if (values) position = Math.min(position, prop.position)
      seen.push({ prop, values })
    }
    members.push({ seen, position })
  }
  // Members, and the props inside them, go by position in the source. The compiler's order is not stable across versions.
  members.sort((a, b) => a.position - b.position)

  const props = new Map<string, PropShape & { position: number }>()
  const declared = new Map<string, Literal[]>()
  for (const { seen } of members) {
    for (const { prop, values } of seen) {
      const known = props.get(prop.name)
      const entry: PropShape & { position: number } = known ?? {
        name: prop.name,
        kind: !values ? "data" : values.every((v) => typeof v === "boolean") ? "boolean" : "union",
        optional: prop.optional,
        type: await (await prop.type()).text(),
        doc: "",
        values: [],
        position: prop.position,
      }
      entry.position = Math.min(entry.position, prop.position)
      for (const value of values ?? []) if (!entry.values.includes(value)) entry.values.push(value)
      if (!entry.doc) entry.doc = await prop.doc()
      if (values) declared.set(prop.name, [...new Set([...(declared.get(prop.name) ?? []), ...(await prop.declaredOrder())])])
      props.set(prop.name, entry)
    }
  }

  const ordered = [...props.values()]
    .sort((a, b) => a.position - b.position)
    .map(({ position: _position, ...entry }) => {
      const values = inDeclarationOrder(entry.values, declared.get(entry.name) ?? [])
      // The compiler prints a union in its own order, so a union's text is rebuilt from the ordered values.
      const type = entry.kind === "union" ? values.map((value) => JSON.stringify(value)).join(" | ") : entry.type
      return { ...entry, type, values }
    })

  const shapes = members.map(({ seen }) => {
    const shape: Record<string, Literal[]> = {}
    for (const { prop, values } of seen.slice().sort((a, b) => a.prop.position - b.prop.position)) {
      if (values) shape[prop.name] = inDeclarationOrder(values, declared.get(prop.name) ?? [])
    }
    return shape
  })

  return { name, compiler, doc: facts.doc, props: ordered, shapes, defaults: facts.defaults }
}
