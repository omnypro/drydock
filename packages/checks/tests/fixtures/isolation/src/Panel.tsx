import type { ComponentProps } from "react"

function Body(): never {
  throw new Error("Panel's body needs a provider.")
}

/** Takes children through a native element's props, and throws for a reason that has nothing to do with them. */
export function Panel({ children, ...props }: ComponentProps<"section">) {
  return <section {...props}>{children ? <Body /> : null}</section>
}
