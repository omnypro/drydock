import { createContext } from "react"

/** What the fixture's app puts around every component. A component that reads it has nothing to read without the app. */
export const Frame = createContext<string | null>(null)
