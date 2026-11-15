import type { Native } from "./native"
import type { Density } from "./scale"

type Tone = "calm" | "warm" | "bold"

type Look =
  | {
      /** How the chip is filled. Defaults to `soft`. */
      shape?: "soft"
      /** What the chip says about its content. */
      tone?: Tone
    }
  | { shape: "line"; tone?: Exclude<Tone, "bold"> }
  | { shape: "bare"; tone?: never }

export type ChipProps = Native &
  Look & {
    /** The width. */
    scale?: "tight" | "normal" | "wide"
    /** The chip shows a dot before its label. */
    dot?: boolean
    density?: Density
    label: string
    onPick?: () => void
  }

/** A small tag for a value. */
export function Chip({ shape = "soft", scale = "normal", dot, label }: ChipProps) {
  return `${shape}${scale}${dot}${label}`
}

export function Plain() {
  return "no props"
}
