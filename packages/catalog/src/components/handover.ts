import type { ComponentShape, PropShape } from "@drydock/reader"

/** One prop of the new component or the old one, set side by side. */
export type PropRow = {
  /** `renamed` comes only from the mark. Two props whose types match are not taken to be one prop renamed. */
  status: "kept" | "renamed" | "dropped" | "new"
  /** The name the new component takes it under, or the old name for a dropped prop. */
  name: string
  /** The old name of a renamed prop. */
  was?: string
  type: string
  /** The old component's type, when it is not the same. */
  oldType?: string
  doc: string
}

/** The props of the new component against the old one's: the new component's in its order, then those that only the old one takes. */
export function compareProps(old: ComponentShape, neu: ComponentShape, renamed: Record<string, string> = {}): PropRow[] {
  const oldByName = new Map(old.props.map((p) => [p.name, p]))
  const newNames = new Set(neu.props.map((p) => p.name))
  const wasFor = new Map(Object.entries(renamed).filter(([from, to]) => oldByName.has(from) && !newNames.has(from) && newNames.has(to)).map(([from, to]) => [to, from]))
  const typeChange = (before: PropShape, after: PropShape) => (before.type === after.type ? {} : { oldType: before.type })
  const rows: PropRow[] = neu.props.map((prop) => {
    const same = oldByName.get(prop.name)
    if (same) return { status: "kept", name: prop.name, type: prop.type, ...typeChange(same, prop), doc: prop.doc }
    const was = wasFor.get(prop.name)
    if (was) return { status: "renamed", name: prop.name, was, type: prop.type, ...typeChange(oldByName.get(was)!, prop), doc: prop.doc }
    return { status: "new", name: prop.name, type: prop.type, doc: prop.doc }
  })
  const carried = new Set(wasFor.values())
  for (const prop of old.props) if (!newNames.has(prop.name) && !carried.has(prop.name)) rows.push({ status: "dropped", name: prop.name, type: prop.type, doc: prop.doc })
  return rows
}
