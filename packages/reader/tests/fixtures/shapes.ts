type Mix = { kind: "one"; value: "fixed" } | { kind: "many"; value: string[] }

export function Mixed(props: Mix) {
  return props.kind
}

export function Nullable({ tone }: { tone?: "info" | "warn" | null; flag?: boolean | null }) {
  return tone
}

export function Linkish(props: { href: string; label: string } | { href?: never; label: string }) {
  return props.label
}

interface Sizes {
  size?: "sm" | "md" | "lg"
}

export function ByIndex({ size }: { size?: Sizes["size"] }) {
  return size
}
