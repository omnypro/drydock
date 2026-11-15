import { describe, expect, test } from "bun:test"
import type { ComponentShape, PropShape } from "@drydock/reader"
import { grid, MAX_CELLS } from "../src/generate/grid"
import { sweep } from "../src/generate/sweep"
import { isValid, withValue } from "../src/generate/valid"

const union = (name: string, values: string[]): PropShape => ({ name, kind: "union", optional: true, type: values.join(" | "), doc: "", values, ordered: true })
const data = (name: string, optional = false, declaredIn?: string): PropShape => ({ name, kind: "data", optional, type: "string", doc: "", values: [], ordered: true, ...(declaredIn ? { declaredIn } : {}) })
const SCALE = ["tight", "normal", "wide"]
const DENSITY = ["compact", "roomy", "airy"]

/** What the reader returns for a component with three looks, one of which takes no tone. */
const chip: ComponentShape = {
  name: "Chip",
  compiler: "test",
  doc: "",
  defaults: {},
  props: [
    union("shape", ["soft", "line", "bare"]),
    union("tone", ["calm", "warm", "bold"]),
    union("scale", SCALE),
    { name: "dot", kind: "boolean", optional: true, type: "boolean", doc: "", values: [false, true], ordered: true },
    union("density", DENSITY),
    data("label"),
    data("onPick", true),
    data("title", true, "./native.ts"),
  ],
  shapes: [
    { shape: ["soft"], tone: ["calm", "warm", "bold"], scale: SCALE, dot: [false, true], density: DENSITY },
    { shape: ["line"], tone: ["calm", "warm"], scale: SCALE, dot: [false, true], density: DENSITY },
    { shape: ["bare"], scale: SCALE, dot: [false, true], density: DENSITY },
  ],
}

describe("isValid and withValue", () => {
  test("rules out a pair that no member of the props type takes", () => {
    expect(isValid(chip, { shape: "line", tone: "warm" })).toBe(true)
    expect(isValid(chip, { shape: "line", tone: "bold" })).toBe(false)
    expect(isValid(chip, { shape: "bare", tone: "calm" })).toBe(false)
    expect(isValid(chip, { shape: "bare", label: "x" })).toBe(true)
  })

  test("drops the sample's props that the chosen value rules out, and says which", () => {
    expect(withValue(chip, { shape: "soft", tone: "bold", label: "x" }, "shape", "line")).toEqual({ props: { shape: "line", label: "x" }, dropped: ["tone"] })
    expect(withValue(chip, { shape: "soft", tone: "calm" }, "shape", "bare")).toEqual({ props: { shape: "bare" }, dropped: ["tone"] })
    expect(withValue(chip, { shape: "soft" }, "tone", "warm")).toEqual({ props: { shape: "soft", tone: "warm" }, dropped: [] })
  })
})

describe("grid", () => {
  const result = grid(chip)

  test("draws one look for each combination a member allows: 3 + 2 + 1", () => {
    const looks = new Set(result.rows.map((r) => JSON.stringify({ shape: r.props.shape, tone: r.props.tone })))
    expect([...looks].map((k) => JSON.parse(k))).toEqual([
      { shape: "soft", tone: "calm" },
      { shape: "soft", tone: "warm" },
      { shape: "soft", tone: "bold" },
      { shape: "line", tone: "calm" },
      { shape: "line", tone: "warm" },
      { shape: "bare" },
    ])
  })

  test("runs the first free prop across and gives the other free prop its own rows", () => {
    expect(result.columns).toEqual({ prop: "scale", values: SCALE })
    expect(result.rows).toHaveLength(6 * 3)
    expect(result.rows[0]).toEqual({ label: "shape: soft · tone: calm · density: compact", props: { shape: "soft", tone: "calm", density: "compact" } })
    expect(result.leftOut).toEqual([])
  })

  test("never draws a pair the types rule out", () => {
    for (const row of result.rows) for (const value of SCALE) expect(isValid(chip, { ...row.props, scale: value })).toBe(true)
  })

  test("leaves a free prop to the sweep when the grid would pass its cell limit", () => {
    const wide = Array.from({ length: 12 }, (_, i) => `v${i}`)
    const many: ComponentShape = {
      ...chip,
      props: [union("a", wide), union("b", wide), union("c", wide)],
      shapes: [{ a: wide, b: wide, c: wide }],
    }
    const big = grid(many)
    expect(big.columns?.prop).toBe("a")
    expect(big.rows.length * 12).toBeLessThanOrEqual(MAX_CELLS)
    expect(big.leftOut).toEqual(["c"])
  })

  test("draws one empty look for a component with no union prop", () => {
    expect(grid({ ...chip, props: [data("label")], shapes: [{}] })).toEqual({ rows: [{ label: "", props: {} }], leftOut: [] })
  })
})

describe("sweep", () => {
  const sample = { shape: "soft", tone: "bold", label: "Tag" }
  const result = sweep(chip, sample, { onPick: () => undefined, title: { skip: "native attribute" } })

  test("turns one prop at a time, in the props' order, starting from the sample", () => {
    expect(result.rows.map((r) => `${r.prop}=${r.label}`)).toEqual([
      "shape=soft", "shape=line", "shape=bare",
      "tone=calm", "tone=warm", "tone=bold",
      "scale=tight", "scale=normal", "scale=wide",
      "dot=false", "dot=true",
      "density=compact", "density=roomy", "density=airy",
      "onPick=function",
    ])
    expect(result.rows.find((r) => r.prop === "tone" && r.label === "warm")?.props).toEqual({ shape: "soft", tone: "warm", label: "Tag" })
  })

  test("marks the sample's own value", () => {
    expect(result.rows.filter((r) => r.isSample).map((r) => `${r.prop}=${r.label}`)).toEqual(["shape=soft", "tone=bold"])
  })

  test("drops a sample prop that a value rules out, and says so on the row", () => {
    const line = result.rows.find((r) => r.prop === "shape" && r.label === "line")!
    expect(line.props).toEqual({ shape: "line", label: "Tag" })
    expect(line.dropped).toEqual(["tone"])
  })

  test("lists the skipped props with the reason that was written, and the optional props of the component itself that have no value", () => {
    expect(result.skipped).toEqual([{ prop: "title", reason: "native attribute" }])
    expect(sweep(chip, sample, {}).unset).toEqual(["onPick"])
  })
})
