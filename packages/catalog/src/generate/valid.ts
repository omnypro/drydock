import type { ComponentShape, Literal } from "@drydock/reader"

export type Props = Record<string, unknown>

/**
 * Whether the types allow these props together. A member of the props type lists the literal props it takes, so a pair
 * the types rule out (`ghost` with a tone) matches no member. A prop that is not a literal prop is never ruled out.
 */
export function isValid(shape: ComponentShape, props: Props): boolean {
  const literal = new Set(shape.props.filter((p) => p.kind !== "data").map((p) => p.name))
  return shape.shapes.some((member) =>
    Object.entries(props).every(([name, value]) => {
      if (value === undefined || !literal.has(name)) return true
      return (member[name] as Literal[] | undefined)?.includes(value as Literal) ?? false
    }),
  )
}

/**
 * Makes props valid by dropping the ones that the first member allowing `name: value` does not take.
 * It returns the props that survive and the names it dropped. The chosen prop itself is never dropped.
 */
export function withValue(shape: ComponentShape, base: Props, name: string, value: unknown): { props: Props; dropped: string[] } {
  const wanted = { ...base, [name]: value }
  if (isValid(shape, wanted)) return { props: wanted, dropped: [] }
  const member = shape.shapes.find((m) => (m[name] as Literal[] | undefined)?.includes(value as Literal))
  if (!member) return { props: wanted, dropped: [] }
  const literal = new Set(shape.props.filter((p) => p.kind !== "data").map((p) => p.name))
  const dropped: string[] = []
  const props: Props = {}
  for (const [key, current] of Object.entries(wanted)) {
    const allowed = member[key] as Literal[] | undefined
    if (key !== name && literal.has(key) && !allowed?.includes(current as Literal)) dropped.push(key)
    else props[key] = current
  }
  return { props, dropped }
}

/** Starts from the sample and applies each override in turn, dropping the sample's props that an override rules out. */
export function compose(shape: ComponentShape, sample: Props, overrides: Props): Props {
  return Object.entries(overrides).reduce((props, [name, value]) => withValue(shape, props, name, value).props, sample)
}
