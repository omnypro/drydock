import postcss from "postcss"
import type { Token } from "./types"

const REF = /var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g

function groupOf(name: string, kind: string): string {
  const parts = name.slice(2).split("-")
  if (kind === "color") {
    const family = parts[1]
    const step = parts[2]
    return family && step && /^\d+$/.test(step) ? `color/${family}` : "color/semantic"
  }
  if (kind === "flag") return `flag/${parts[1] ?? ""}`
  return kind
}

function resolve(value: string, byName: Map<string, string>, depth = 0): string {
  if (depth > 10) return value
  return value.replace(REF, (whole, ref: string) => {
    const target = byName.get(ref)
    return target === undefined ? whole : resolve(target, byName, depth + 1)
  })
}

/** Reads every custom property declared on `:root` in one stylesheet. */
export function readDeclarations(css: string, file: string): Omit<Token, "resolved">[] {
  const out: Omit<Token, "resolved">[] = []
  const root = postcss.parse(css, { from: file })
  root.walkRules((rule) => {
    if (rule.selector.trim() !== ":root") return
    rule.each((node) => {
      if (node.type !== "decl" || !node.prop.startsWith("--")) return
      const kind = node.prop.slice(2).split("-")[0] ?? ""
      out.push({
        name: node.prop,
        value: node.value.replace(/\s+/g, " ").trim(),
        kind,
        group: groupOf(node.prop, kind),
        file,
      })
    })
  })
  return out
}

/** Reads the tokens of every given stylesheet, in order, and resolves aliases across them. */
export function readTokens(sources: { file: string; css: string }[]): Token[] {
  const declared = sources.flatMap((source) => readDeclarations(source.css, source.file))
  const byName = new Map<string, string>()
  for (const token of declared) byName.set(token.name, token.value)
  return declared.map((token) => ({ ...token, resolved: resolve(token.value, byName) }))
}
