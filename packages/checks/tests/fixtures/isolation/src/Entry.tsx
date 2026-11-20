import type { ComponentProps } from "react"

/** A native input. Its props type allows children, and the element throws when it is given any. */
export function Entry(props: ComponentProps<"input">) {
  return <input data-part="entry" {...props} />
}
