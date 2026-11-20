import type { DefaultValue, Literal } from "./facts"

export type PropShape = {
  name: string
  /** `union` for literals, `boolean` for `true` and `false`, `data` for anything else. */
  kind: "union" | "boolean" | "data"
  optional: boolean
  /** The type as written. */
  type: string
  doc: string
  /** The file that declares the prop, from the component's folder, when it is not the component's own file: `./lines.tsx`. */
  declaredIn?: string
  /** Every literal the prop takes across all shapes, in declaration order. */
  values: Literal[]
  /**
   * Whether `values` follows the source. It is `false` when the source writes the union in a form the reader cannot
   * follow (an indexed access into an interface, `keyof typeof`, a template literal), and the order is the compiler's.
   */
  ordered: boolean
}

export type ComponentShape = {
  name: string
  /** The compiler that read it, with its version. */
  compiler: string
  doc: string
  props: PropShape[]
  /** One entry per member of the props type: the literal props of that member. */
  shapes: Record<string, Literal[]>[]
  defaults: Record<string, DefaultValue>
  /**
   * Whether the component takes children. `props` lists only what the project declares, so the children that a native
   * element's props bring (`ComponentProps<"h3">`) are not in it, and this is how a page knows to give some.
   */
  takesChildren: boolean
}
