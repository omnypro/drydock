import type { Card } from "./Card"
import { type Button } from "./Button"

export function Badge(props: { of?: typeof Card; kind?: typeof Button }) {
  return <i>{String(props)}</i>
}
