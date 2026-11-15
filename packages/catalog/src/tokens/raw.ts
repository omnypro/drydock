import postcss from "postcss"
import valueParser from "postcss-value-parser"
import type { RawKind, RawValue, Token } from "./types"

const COLOR_FUNCTIONS = new Set(["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch"])
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const SKIP_PROPERTIES = new Set(["src", "font-family", "content", "grid-template-areas", "unicode-range"])
const KINDS_WITH_TOKENS = new Set(["space", "radius", "text", "duration", "ease", "size"])

/** Puts a value in the form two spellings of it share, so `8px` and `0.5rem` match. */
export function canonical(value: string): string {
  const v = value.trim().toLowerCase().replace(/\s+/g, " ")
  const px = /^(-?[\d.]+)px$/.exec(v)
  if (px) return `${Number(px[1]) / 16}rem`
  const unit = /^(-?[\d.]+)(rem|em|s|ms)$/.exec(v)
  if (unit) return `${Number(unit[1])}${unit[2]}`
  return v
}

type Found = { kind: RawKind; value: string }

function classify(node: valueParser.Node): Found | null {
  if (node.type === "word") {
    if (HEX.test(node.value)) return { kind: "color", value: node.value.toLowerCase() }
    const parsed = valueParser.unit(node.value)
    if (!parsed) return null
    const amount = Number(parsed.number)
    if (amount === 0) return null
    const unit = parsed.unit.toLowerCase()
    if (unit === "px" || unit === "rem" || unit === "em") return { kind: "length", value: `${amount}${unit}` }
    if (unit === "ms" || unit === "s") return { kind: "duration", value: `${amount}${unit}` }
    return null
  }
  if (node.type === "function") {
    const name = node.value.toLowerCase()
    const text = valueParser.stringify(node)
    if (text.includes("var(")) return null
    if (COLOR_FUNCTIONS.has(name)) return { kind: "color", value: text.replace(/\s+/g, " ").toLowerCase() }
    if (name === "cubic-bezier" || name === "steps") return { kind: "easing", value: text.replace(/\s+/g, " ").toLowerCase() }
  }
  return null
}

/** Lists the raw colors, lengths, durations and easings in one stylesheet's declarations. */
export function findRaw(css: string, file: string): { found: Found; property: string }[] {
  const out: { found: Found; property: string }[] = []
  const root = postcss.parse(css, { from: file })
  root.walkDecls((decl) => {
    if (SKIP_PROPERTIES.has(decl.prop.toLowerCase())) return
    valueParser(decl.value).walk((node) => {
      if (node.type === "function") {
        const name = node.value.toLowerCase()
        if (name === "var" || name === "url" || name === "env") return false
        const found = classify(node)
        if (found) {
          out.push({ found, property: decl.prop })
          return false
        }
        return
      }
      const found = classify(node)
      if (found) out.push({ found, property: decl.prop })
      return
    })
  })
  return out
}

/** Counts each raw value across the given stylesheets and names a token that already holds it. */
export function scanRaw(sources: { file: string; css: string }[], tokens: Token[]): RawValue[] {
  const byValue = new Map<string, RawValue>()
  for (const { file, css } of sources) {
    for (const { found, property } of findRaw(css, file)) {
      const key = `${found.kind}:${found.value}`
      let entry = byValue.get(key)
      if (!entry) {
        entry = { value: found.value, kind: found.kind, count: 0, files: [], properties: [] }
        byValue.set(key, entry)
      }
      entry.count += 1
      const seen = entry.files.find((f) => f.file === file)
      if (seen) seen.count += 1
      else entry.files.push({ file, count: 1 })
      if (!entry.properties.includes(property)) entry.properties.push(property)
    }
  }

  const tokenByValue = new Map<string, string>()
  for (const token of tokens) {
    if (!KINDS_WITH_TOKENS.has(token.kind) && token.kind !== "color") continue
    const key = canonical(token.resolved)
    if (!tokenByValue.has(key)) tokenByValue.set(key, token.name)
  }
  const out = [...byValue.values()]
  for (const entry of out) entry.token = tokenByValue.get(canonical(entry.value))
  return out.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}
