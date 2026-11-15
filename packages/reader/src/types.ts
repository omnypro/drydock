import type { Literal } from "./facts"

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
  /** One entry per member of the props type: the literal props of that member. */
  shapes: Record<string, Literal[]>[]
  defaults: Record<string, string>
}
