import type { ComponentProps, ReactNode } from "react"

/** Takes its children through the native element's props and declares none of its own. */
export function Title(props: ComponentProps<"h3"> & { size?: "sm" | "lg" }) {
  return props.size ?? null
}

/** Declares its children itself. */
export function Panel(props: { children: ReactNode; tone?: "calm" }) {
  return props.tone ?? null
}

/** Takes no children at all. */
export function Dot(props: { tone?: "calm" | "warm" }) {
  return props.tone ?? null
}
