import postcss, { type AtRule, type Declaration, type Node } from "postcss"
import valueParser from "postcss-value-parser"
import type { Token } from "./types"

/** Selectors whose custom properties are the project's tokens. */
const BASE_SELECTORS = new Set([":root", "html", ":host"])
/** At-rules that make a block conditional. `@layer` only orders styles, and `@theme` is where Tailwind declares tokens. */
const CONDITIONAL_AT_RULES = new Set(["media", "supports", "container"])

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

/**
 * Replaces each `var()` with what it points at, or with its fallback when nothing declares the name.
 * A reference that loops back to a name already being resolved stays as written.
 */
function resolve(value: string, lookup: (name: string) => string | undefined, stack: string[] = []): string {
  if (!value.includes("var(")) return value
  const parsed = valueParser(value)
  parsed.walk((node) => {
    if (node.type !== "function" || node.value.toLowerCase() !== "var") return undefined
    const name = node.nodes.find((n) => n.type === "word")?.value
    const comma = node.nodes.findIndex((n) => n.type === "div" && n.value === ",")
    const fallback = comma === -1 ? undefined : valueParser.stringify(node.nodes.slice(comma + 1)).trim()
    const target = name && !stack.includes(name) ? lookup(name) : undefined
    const picked = target ?? fallback
    if (picked === undefined) return false
    Object.assign(node, { type: "word", value: resolve(picked, lookup, name ? [...stack, name] : stack) })
    return false
  })
  return parsed.toString()
}

/**
 * What decides whether a custom property is a token, and when it applies. `null` is not a token.
 * `undefined` is a token that always applies. A string names the condition: a media query, or `:root[data-theme="dark"]`.
 */
function conditionOf(decl: Declaration): string | null | undefined {
  const parent = decl.parent
  let own: string | undefined
  if (parent?.type === "atrule") {
    if (parent.name !== "theme") return null
  } else if (parent?.type === "rule") {
    const selectors = parent.selectors.map((s) => s.trim())
    if (!selectors.some((s) => BASE_SELECTORS.has(s))) {
      if (!selectors.every((s) => /^(:root|html)(?=[.[:#])/.test(s))) return null
      own = parent.selector.replace(/\s+/g, " ").trim()
    }
  } else return null

  const conditions: string[] = []
  let node: Node | undefined = parent.parent
  while (node && node.type !== "root") {
    if (node.type !== "atrule") return null
    const at = node as AtRule
    if (at.name !== "layer") {
      if (!CONDITIONAL_AT_RULES.has(at.name)) return null
      conditions.unshift(`@${at.name} ${at.params}`.trim())
    }
    node = node.parent
  }
  if (own) conditions.push(own)
  return conditions.length ? conditions.join(" ") : undefined
}

/** Reads every custom property that is a token in one stylesheet. */
export function readDeclarations(css: string, file: string): Omit<Token, "resolved">[] {
  const out: Omit<Token, "resolved">[] = []
  postcss.parse(css, { from: file }).walkDecls((decl) => {
    if (!decl.prop.startsWith("--")) return
    const condition = conditionOf(decl)
    if (condition === null) return
    const kind = decl.prop.slice(2).split("-")[0] ?? ""
    out.push({
      name: decl.prop,
      value: decl.value.replace(/\s+/g, " ").trim(),
      kind,
      group: groupOf(decl.prop, kind),
      file,
      ...(condition ? { condition } : {}),
    })
  })
  return out
}

/**
 * Reads the tokens of every given stylesheet, in order, and resolves aliases across them.
 * A token that applies only under a condition resolves against the declarations of that condition first, then the base.
 * A name declared twice without a condition takes its last value.
 */
export function readTokens(sources: { file: string; css: string }[]): Token[] {
  const declared = sources.flatMap((source) => readDeclarations(source.css, source.file))
  const base = new Map<string, string>()
  const byCondition = new Map<string, Map<string, string>>()
  for (const token of declared) {
    if (!token.condition) base.set(token.name, token.value)
    else byCondition.set(token.condition, (byCondition.get(token.condition) ?? new Map()).set(token.name, token.value))
  }
  return declared.map((token) => {
    const own = token.condition ? byCondition.get(token.condition) : undefined
    return { ...token, resolved: resolve(token.value, (name) => own?.get(name) ?? base.get(name), [token.name]) }
  })
}

/**
 * The tokens as the page draws them. Dark is the design, so a token declared under a dark condition replaces the base
 * value of the same name, and the aliases around it resolve against it. Other conditions, light among them, are left off.
 */
export function displayTokens(tokens: Token[]): Token[] {
  const dark = new Map<string, Token>()
  const base = new Map<string, Token>()
  for (const token of tokens) {
    if (!token.condition) base.set(token.name, token)
    else if (/dark/i.test(token.condition)) dark.set(token.name, token)
  }
  const chosen = new Map(base)
  for (const [name, token] of dark) chosen.set(name, token)
  const lookup = (name: string) => chosen.get(name)?.value
  return [...chosen.values()].map(({ condition: _condition, ...token }) => ({ ...token, resolved: resolve(token.value, lookup, [token.name]) }))
}
