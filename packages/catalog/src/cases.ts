import type { ComponentProps, ElementType, ReactElement } from "react"

/** A prop the sweep leaves alone, with the reason. The reason is written by the person who skips it. */
export type Skip = { skip: string }
export const skip = (reason: string): Skip => ({ skip: reason })

/** An owed state this component cannot have, with the reason. */
export type Waived = { waived: string }

/** One drawn state. Give a width to draw it in a box that narrow. */
export type Case = ReactElement | { width: number; render: ReactElement }

/** The hand-written file beside a component, `X.cases.tsx`. Everything else on the component's page is read from its types. */
export interface Cases<C extends ElementType> {
  /** The plainest valid props. The grid and the sweep start from it. */
  sample: ComponentProps<C>
  /** A value for each optional prop, so the sweep can turn it on. A prop can be skipped with `skip(reason)`. */
  each?: { [P in keyof ComponentProps<C>]?: ComponentProps<C>[P] | Skip }
  /** The widths to draw at. The first is the default. */
  widths?: readonly number[]
  /** A height for a component that fills its parent. */
  height?: number
  /** The states this component is expected to show, each drawn or waived with a reason. */
  owed?: Record<string, Case | Waived>
  /** Any other named cases. */
  more?: Record<string, Case>
}
