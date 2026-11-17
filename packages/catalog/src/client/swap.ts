import type { PropRow } from "../components/handover"
import type { Props } from "../generate/valid"

/** The parts of React that a swap needs. */
export type ElementTools = {
  createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
  isValidElement(value: unknown): boolean
}

type DrawnElement = { type: unknown; key: string | null; props: Record<string, unknown> }

/** The props for the old component: renamed props under their old names, and none of the props that only the new one takes. */
export function forOld(props: Props, rows: PropRow[]): Props {
  const was = new Map(rows.filter((r) => r.status === "renamed").map((r) => [r.name, r.was!]))
  const onlyNew = new Set(rows.filter((r) => r.status === "new").map((r) => r.name))
  return Object.fromEntries(Object.entries(props).flatMap(([name, value]) => (onlyNew.has(name) ? [] : [[was.get(name) ?? name, value]])))
}

/**
 * The element with the old component in each place the new one is, or `undefined` when the tree does not hold the new
 * one. It follows every prop that holds an element or a list of them, so a page's slots (`chat={<Chat />}`) are
 * reached as well as its children. Elements that a component creates while it renders are out of reach.
 */
export function withOld(React: ElementTools, element: unknown, New: unknown, Old: unknown, rows: PropRow[]): unknown {
  let swapped = false
  // Children that JSX wrote side by side go back in as separate arguments. Passed as one array they would read as a list that needs keys.
  const make = (type: unknown, props: Record<string, unknown>) => {
    const { children, ...rest } = props
    return Array.isArray(children) ? React.createElement(type, rest, ...(children as unknown[])) : React.createElement(type, props)
  }
  const rebuild = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      const mapped = node.map(rebuild)
      return mapped.some((m, at) => m !== node[at]) ? mapped : node
    }
    if (!React.isValidElement(node)) return node
    const { type, key, props } = node as DrawnElement
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(props)) {
      const rebuilt = rebuild(value)
      if (rebuilt !== value) changed = true
      next[name] = rebuilt
    }
    if (key !== null) next.key = key
    if (type === New) {
      swapped = true
      return make(Old, forOld(next as Props, rows))
    }
    return changed ? make(type, next) : node
  }
  const result = rebuild(element)
  return swapped ? result : undefined
}

/** Whether the element's tree holds the component, through its children and every prop that holds an element. */
export function holds(React: ElementTools, element: unknown, component: unknown): boolean {
  if (Array.isArray(element)) return element.some((item) => holds(React, item, component))
  if (!React.isValidElement(element)) return false
  const { type, props } = element as DrawnElement
  return type === component || Object.values(props).some((value) => holds(React, value, component))
}
