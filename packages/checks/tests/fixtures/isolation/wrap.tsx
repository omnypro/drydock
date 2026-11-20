import type { ReactNode } from "react"
import { Frame } from "./frame"

/** What the fixture's app wraps every component in. */
export default function Wrap({ children }: { children: ReactNode }) {
  return <Frame.Provider value="app">{children}</Frame.Provider>
}
