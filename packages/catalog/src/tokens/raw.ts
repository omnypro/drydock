import postcss from "postcss"
import valueParser from "postcss-value-parser"
import type { RawKind, RawValue, Token } from "./types"

const COLOR_FUNCTIONS = new Set(["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch"])
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const SKIP_PROPERTIES = new Set(["src", "font-family", "content", "grid-template-areas", "unicode-range"])
const NAMED_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan " +
    "darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet " +
    "deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush " +
    "lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen " +
    "linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace " +
    "olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen " +
    "seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
)
const NAMED_HEX: Record<string, string> = { white: "#ffffff", black: "#000000" }

/** The token kinds that can stand in for a length, by the property that holds it. The first pattern that matches decides. */
const LENGTH_KINDS: [RegExp, string[]][] = [
  [/radius/, ["radius"]],
  [/^font-size$/, ["text"]],
  [/^line-height$/, ["text"]],
  [/^(letter|word)-spacing$/, ["space", "text"]],
  [/^(min-|max-)?(width|height|inline-size|block-size)$|^flex-basis$/, ["size", "space"]],
  [/./, ["space", "size"]],
]

function normalizeColor(value: string): string {
  const v = value.trim().toLowerCase()
  if (NAMED_HEX[v]) return NAMED_HEX[v]
  if (v.startsWith("#")) {
    let hex = v.slice(1)
    if (hex.length <= 4) hex = [...hex].map((c) => c + c).join("")
    if (hex.length === 8 && hex.endsWith("ff")) hex = hex.slice(0, 6)
    return `#${hex}`
  }
  return v.replace(/\s*([,/()])\s*/g, "$1").replace(/\s+/g, " ").replace(/(^|[^\d.])\.(\d)/g, "$10.$2")
}

/** Puts a value in the form two spellings of it share, so `8px` and `0.5rem`, `100ms` and `0.1s`, and `#fff` and `#ffffff` match. */
export function canonical(value: string): string {
  const v = value.trim().toLowerCase().replace(/\s+/g, " ")
  const px = /^(-?[\d.]+)px$/.exec(v)
  if (px) return `${Number(px[1]) / 16}rem`
  const ms = /^(-?[\d.]+)ms$/.exec(v)
  if (ms) return `${Number(ms[1]) / 1000}s`
  const unit = /^(-?[\d.]+)(rem|em|s)$/.exec(v)
  if (unit) return `${Number(unit[1])}${unit[2]}`
  if (HEX.test(v) || NAMED_COLORS.has(v) || COLOR_FUNCTIONS.has(/^([a-z]+)\(/.exec(v)?.[1] ?? "")) return normalizeColor(v)
  return v
}

type Found = { kind: RawKind; value: string }

function classify(node: valueParser.Node): Found | null {
  if (node.type === "word") {
    if (HEX.test(node.value)) return { kind: "color", value: node.value.toLowerCase() }
    if (NAMED_COLORS.has(node.value.toLowerCase())) return { kind: "color", value: node.value.toLowerCase() }
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

/** The token kinds that fit a raw value, from the properties that hold it. */
function kindsFor(entry: RawValue): string[] {
  if (entry.kind === "color") return ["color"]
  if (entry.kind === "duration") return ["duration"]
  if (entry.kind === "easing") return ["ease"]
  const kinds: string[] = []
  for (const property of entry.properties) {
    for (const [pattern, fit] of LENGTH_KINDS) {
      if (!pattern.test(property.toLowerCase())) continue
      for (const kind of fit) if (!kinds.includes(kind)) kinds.push(kind)
      break
    }
  }
  return kinds
}

/** Counts each raw value across the given stylesheets and names a token that already holds it and fits where it is used. */
export function scanRaw(sources: { file: string; css: string }[], tokens: Token[]): RawValue[] {
  const byValue = new Map<string, RawValue>()
  for (const { file, css } of sources) {
    for (const { found, property } of findRaw(css, file)) {
      const key = `${found.kind}:${canonical(found.value)}`
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

  const tokensByValue = new Map<string, Token[]>()
  for (const token of tokens) {
    if (token.condition) continue
    const key = canonical(token.resolved)
    tokensByValue.set(key, [...(tokensByValue.get(key) ?? []), token])
  }
  const out = [...byValue.values()]
  for (const entry of out) {
    const candidates = tokensByValue.get(canonical(entry.value)) ?? []
    for (const kind of kindsFor(entry)) {
      const hit = candidates.find((token) => token.kind === kind)
      if (hit) {
        entry.token = hit.name
        break
      }
    }
  }
  return out.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}
