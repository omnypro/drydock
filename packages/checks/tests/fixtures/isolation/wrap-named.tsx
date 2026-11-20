import type { ReactNode } from "react"

/** A wrapper written with a named export where a default one is needed. */
export function Wrap({ children }: { children: ReactNode }) {
  return <>{children}</>
}
