import type { ReactNode } from "react"

/** A component with required props and no cases file beside it. */
export function Bare({ label, tone, size = "md", onPick, children }: { label: string; tone: "calm" | "loud"; size?: "sm" | "md"; onPick: () => void; children: ReactNode }) {
  return (
    <button type="button" data-tone={tone} data-size={size} onClick={onPick}>
      <b data-part="label">{label}</b>
      <i data-part="children">{children}</i>
    </button>
  )
}
