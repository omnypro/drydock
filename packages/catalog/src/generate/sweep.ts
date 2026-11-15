import type { ComponentShape } from "@drydock/reader"
import { withValue, type Props } from "./valid"

export type SweepRow = {
  prop: string
  /** The value this row turns on. */
  value: unknown
  /** How the value is written on the page. */
  label: string
  props: Props
  /** Props of the sample that the types rule out together with this value. They are left off the row. */
  dropped: string[]
  /** `true` for the row that is the sample's own value. */
  isSample: boolean
}

export type Sweep = {
  rows: SweepRow[]
  /** Props that `each` skips, with the reason that was written for each. */
  skipped: { prop: string; reason: string }[]
  /** Optional props with no value in `each`, which the sweep cannot draw. */
  unset: string[]
}

const isSkip = (value: unknown): value is { skip: string } => typeof value === "object" && value !== null && "skip" in value && typeof (value as { skip: unknown }).skip === "string"

/** One prop at a time against the sample: each value of a union or boolean prop, and the value `each` gives a data prop. */
export function sweep(shape: ComponentShape, sample: Props, each: Props = {}): Sweep {
  const rows: SweepRow[] = []
  const skipped: Sweep["skipped"] = []
  const unset: string[] = []
  for (const prop of shape.props) {
    if (prop.declaredIn && prop.kind === "data" && !(prop.name in each)) continue
    const given = each[prop.name]
    if (isSkip(given)) {
      skipped.push({ prop: prop.name, reason: given.skip })
      continue
    }
    if (prop.kind !== "data") {
      for (const value of prop.values) {
        const { props, dropped } = withValue(shape, sample, prop.name, value)
        rows.push({ prop: prop.name, value, label: String(value), props, dropped, isSample: sample[prop.name] === value })
      }
    } else if (prop.name in each) {
      const { props, dropped } = withValue(shape, sample, prop.name, given)
      rows.push({ prop: prop.name, value: given, label: typeof given === "string" ? JSON.stringify(given) : typeof given, props, dropped, isSample: false })
    } else if (prop.optional && !(prop.name in sample)) unset.push(prop.name)
  }
  return { rows, skipped, unset }
}
