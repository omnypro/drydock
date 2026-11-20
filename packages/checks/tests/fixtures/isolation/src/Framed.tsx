import { useContext } from "react"
import { Frame } from "../frame"

/** A component that only works inside what the app wraps it in. */
export function Framed() {
  const where = useContext(Frame)
  if (!where) throw new Error("Framed has to sit inside the app's frame.")
  return <p data-part="framed">{where}</p>
}
