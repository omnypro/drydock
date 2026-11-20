import { describe, expect, test } from "bun:test"
import type { ComponentShape, PropShape } from "@drydock/reader"
import { grid, MAX_CELLS } from "../src/generate/grid"
import { allCases } from "../src/generate/cases"
import { autoSample } from "../src/generate/sample"
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
  takesChildren: false,
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

describe("allCases", () => {
  const list = allCases(chip, {
    sample: { shape: "soft", label: "Tag" },
    owed: { disabled: { waived: "a chip cannot be disabled" }, long: { width: 120, render: "long" } },
    more: { plain: "plain" },
  })

  test("lists the sample, every grid cell, every sweep row, then the cases the file writes", () => {
    const count = (section: string) => list.filter((item) => item.section === section).length
    expect([count("sample"), count("grid"), count("sweep"), count("owed"), count("more")]).toEqual([1, 54, 14, 1, 1])
  })

  test("labels a grid cell with its look and its column, and leaves out a waived case", () => {
    expect(list[1]).toEqual({ section: "grid", label: "shape: soft · tone: calm · density: compact · scale: tight", props: { shape: "soft", label: "Tag", tone: "calm", density: "compact", scale: "tight" } })
    expect(list.filter((item) => item.section === "owed").map((item) => [item.label, item.width])).toEqual([["long", 120]])
  })

  test("draws a window case's element, with the window's size, and keeps a window the file does not list", () => {
    const pages = allCases(chip, {
      sample: { shape: "soft", label: "Tag" },
      windows: { beside: [1280, 800] },
      more: { wide: { window: "beside", render: "page" }, lost: { window: "under", render: "other" } },
    }).filter((item) => item.section === "more")
    expect(pages).toEqual([
      { section: "more", label: "wide", element: "page", window: { name: "beside", size: [1280, 800] } },
      { section: "more", label: "lost", element: "other", window: { name: "under" } },
    ])
  })
})

describe("autoSample", () => {
  const required = (name: string, type: string): PropShape => ({ name, kind: "data", optional: false, type, doc: "", values: [], ordered: true })
  const shapeOf = (...props: PropShape[]): ComponentShape => ({ name: "Badge", compiler: "test", doc: "", defaults: {}, takesChildren: false, props, shapes: [{}] })

  test("gives a component with no required props an empty sample", () => {
    expect(autoSample(shapeOf(union("tone", ["calm", "warm"]), data("title", true)))).toEqual({ props: {}, unset: [], guessedChildren: false })
  })

  test("fills a required choice with its first value and a required switch with false", () => {
    const tone: PropShape = { ...union("tone", ["calm", "warm"]), optional: false }
    const on: PropShape = { name: "on", kind: "boolean", optional: false, type: "boolean", doc: "", values: [false, true], ordered: true }
    expect(autoSample(shapeOf(tone, on)).props).toEqual({ tone: "calm", on: false })
  })

  test("fills required text with the prop's name, a number with 1, and children with the component's name", () => {
    const { props, unset } = autoSample(shapeOf(required("label", "string"), required("count", "number"), required("children", 'import("react").ReactNode'), required("aside", "ReactNode")))
    expect(props).toEqual({ label: "label", count: 1, children: "Badge", aside: "aside" })
    expect(unset).toEqual([])
  })

  test("gives children a value even when they are optional, since a component with no content draws nothing", () => {
    const children: PropShape = { ...required("children", 'import("react").ReactNode'), optional: true }
    const title: PropShape = { ...required("title", 'import("react").ReactNode'), optional: true }
    expect(autoSample(shapeOf(children, title)).props).toEqual({ children: "Badge" })
  })

  test("gives children to a component that takes them through a native element's props, where no prop of its own is named children", () => {
    expect(autoSample({ ...shapeOf(union("size", ["sm", "lg"])), takesChildren: true })).toEqual({ props: { children: "Badge" }, unset: [], guessedChildren: true })
  })

  test("fills a required callback with a function that does nothing", () => {
    const { props } = autoSample(shapeOf(required("onSave", "() => void"), required("onPick", "(id: string) => Promise<void>")))
    expect(typeof props.onSave).toBe("function")
    expect((props.onPick as () => unknown)()).toBeUndefined()
  })

  test("asks the page for an element where the type needs one, and names the prop when the page gives none", () => {
    const shape = shapeOf(required("children", 'import("react").ReactElement<unknown, string>'))
    expect(autoSample(shape, (text) => ({ element: text })).props).toEqual({ children: { element: "Badge" } })
    expect(autoSample(shape)).toEqual({ props: {}, unset: ["children"], guessedChildren: false })
  })

  test("names a required prop whose type it cannot make a value for, and leaves it out", () => {
    expect(autoSample(shapeOf(required("label", "string"), required("state", "EmotePickerState"), required("config", "{ id: string }")))).toEqual({ props: { label: "label" }, unset: ["state", "config"], guessedChildren: false })
  })
})
