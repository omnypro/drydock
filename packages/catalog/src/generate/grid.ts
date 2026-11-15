import type { ComponentShape, Literal, PropShape } from "@drydock/reader"

/** The most cells a grid draws. Free axes past it are left to the sweep. */
export const MAX_CELLS = 200

export type Look = { label: string; props: Record<string, Literal> }

export type Grid = {
  /** The prop that runs across. Absent when the component has no union prop. */
  columns?: { prop: string; values: Literal[] }
  /** One row for each look and each combination of the other free props. */
  rows: Look[]
  /** Free props the grid did not combine, so the cell count stays drawable. The sweep covers them. */
  leftOut: string[]
}

const label = (props: Record<string, Literal>) => Object.entries(props).map(([name, value]) => `${name}: ${String(value)}`).join(" · ")

function product(axes: { prop: string; values: Literal[] }[]): Record<string, Literal>[] {
  return axes.reduce<Record<string, Literal>[]>((acc, axis) => acc.flatMap((soFar) => axis.values.map((value) => ({ ...soFar, [axis.prop]: value }))), [{}])
}

/**
 * Every combination of a component's union props that its types allow.
 * A free prop takes the same values in every member of the props type, so it combines with every look.
 * The other union props are the looks: one for each combination a member allows. The first free prop runs across.
 */
export function grid(shape: ComponentShape): Grid {
  const unions = shape.props.filter((p): p is PropShape => p.kind === "union")
  const same = (a: Literal[] | undefined, b: Literal[]) => !!a && a.length === b.length && a.every((v, i) => v === b[i])
  const free = unions.filter((p) => shape.shapes.every((member) => same(member[p.name], p.values)))
  const freeNames = new Set(free.map((p) => p.name))

  const seen = new Set<string>()
  const looks: Record<string, Literal>[] = []
  for (const member of shape.shapes) {
    const axes = unions.filter((p) => !freeNames.has(p.name) && member[p.name]).map((p) => ({ prop: p.name, values: member[p.name]! }))
    for (const combination of product(axes)) {
      const key = JSON.stringify(combination)
      if (!seen.has(key)) {
        seen.add(key)
        looks.push(combination)
      }
    }
  }

  const [column, ...others] = free
  const columns = column && { prop: column.name, values: column.values }
  const across = columns?.values.length ?? 1
  const rowAxes: { prop: string; values: Literal[] }[] = []
  const leftOut: string[] = []
  let rows = looks.length
  for (const axis of others) {
    if (rows * axis.values.length * across <= MAX_CELLS) {
      rowAxes.push({ prop: axis.name, values: axis.values })
      rows *= axis.values.length
    } else leftOut.push(axis.name)
  }

  const combos = product(rowAxes)
  return {
    ...(columns ? { columns } : {}),
    rows: looks.flatMap((look) => combos.map((combo) => ({ props: { ...look, ...combo }, label: label({ ...look, ...combo }) }))),
    leftOut,
  }
}
