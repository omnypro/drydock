export type Token = {
  /** The custom property, for example `--space-2`. */
  name: string
  /** The value as written in the stylesheet. */
  value: string
  /** The value with every `var()` replaced by what it points at. */
  resolved: string
  /** The first segment of the name: `color`, `space`, `text`, and so on. */
  kind: string
  /** The page section: the kind, or `color/blue` for a palette family. */
  group: string
  /** The stylesheet the token is declared in, from the project root. */
  file: string
  /** What the token applies under, such as `@media (prefers-color-scheme: dark)`. Absent for a token that always applies. The page's data has none: it holds the dark values. */
  condition?: string
}

export type RawKind = "color" | "length" | "duration" | "easing"

export type RawValue = {
  /** The value as written, lowercased. */
  value: string
  kind: RawKind
  count: number
  files: { file: string; count: number }[]
  properties: string[]
  /** A token whose value is the same, when there is one. */
  token?: string
}

export type TokensData = {
  tokens: Token[]
  raw: RawValue[]
  /** How many stylesheets the raw scan read. */
  scanned: number
  /** Files the scan could not read or parse, so the rest still report. */
  unreadable: { file: string; message: string }[]
}
