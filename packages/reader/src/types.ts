import type { DefaultValue, Literal } from "./facts"

export type PropShape = {
  name: string
  /** `union` for literals, `boolean` for `true` and `false`, `data` for anything else. */
  kind: "union" | "boolean" | "data"
  optional: boolean
  /** The type as written. */
  type: string
  doc: string
  /** Every literal the prop takes across all shapes, in declaration order. */
  values: Literal[]
}

export type ComponentShape = {
  name: string
  /** The compiler that read it, with its version. */
  compiler: string
  doc: string
  props: PropShape[]
  /** Props that another file of the project declares. They are not in `props`. A component typed from a shared `RowProps` lists its props here. */
  fromOtherFiles: string[]
  /** One entry per member of the props type: the literal props of that member. */
  shapes: Record<string, Literal[]>[]
  defaults: Record<string, DefaultValue>
}
