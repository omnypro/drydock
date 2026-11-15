import { describe, expect, test } from "bun:test"
import { canonical, findRaw, scanRaw } from "../src/tokens/raw"
import { readTokens } from "../src/tokens/read"

describe("findRaw", () => {
  test("finds colors, lengths, durations and easings", () => {
    const found = findRaw(
      `.a { color: #FFF; border: 1px solid rgba(0, 0, 0, 0.5); transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1); padding: 0.5rem 0; }`,
      "a.module.css",
    ).map((f) => `${f.found.kind} ${f.found.value}`)
    expect(found).toEqual([
      "color #fff",
      "length 1px",
      "color rgba(0, 0, 0, 0.5)",
      "duration 150ms",
      "easing cubic-bezier(0.4, 0, 0.2, 1)",
      "length 0.5rem",
    ])
  })

  test("skips values that come from a token, including a fallback inside var()", () => {
    const found = findRaw(
      `.a { padding: var(--space-2); color: var(--color-primary, #fff); margin: calc(var(--space-2) + 1px); background: color-mix(in srgb, var(--x) 20%, transparent); }`,
      "a.module.css",
    ).map((f) => f.found.value)
    expect(found).toEqual(["1px"])
  })

  test("skips zero, unitless numbers, urls and font families", () => {
    const found = findRaw(
      `.a { margin: 0; line-height: 1.4; z-index: 10; background: url(/a-1px.png); font-family: "A 12px", sans-serif; }`,
      "a.module.css",
    )
    expect(found).toEqual([])
  })
})

describe("scanRaw", () => {
  const tokens = readTokens([
    { file: "tokens.css", css: `:root { --space-2: 0.5rem; --duration-base: 0.15s; --color-gray-100: #fafafa; --color-primary: var(--color-gray-100); }` },
  ])
  const sources = [
    { file: "a.module.css", css: `.a { padding: 8px; margin: 8px; color: #fafafa; transition: opacity 0.15s; border-width: 3px; }` },
    { file: "b.module.css", css: `.b { padding: 8px; gap: 3px; }` },
  ]
  const raw = scanRaw(sources, tokens)
  const get = (value: string) => raw.find((r) => r.value === value)

  test("counts a value across files, most used first", () => {
    expect(get("8px")?.count).toBe(3)
    expect(get("8px")?.files).toEqual([
      { file: "a.module.css", count: 2 },
      { file: "b.module.css", count: 1 },
    ])
    expect(raw[0]?.value).toBe("8px")
  })

  test("names the token that holds the same value, across spellings", () => {
    expect(get("8px")?.token).toBe("--space-2")
    expect(get("0.15s")?.token).toBe("--duration-base")
    expect(get("#fafafa")?.token).toBe("--color-gray-100")
    expect(get("3px")?.token).toBeUndefined()
  })
})

describe("canonical", () => {
  test("puts px and rem on one scale", () => {
    expect(canonical("16px")).toBe("1rem")
    expect(canonical("0.50rem")).toBe("0.5rem")
    expect(canonical(" #ABC ")).toBe("#aabbcc")
  })
})

describe("what a suggested token has to fit", () => {
  const tokens = readTokens([
    {
      file: "tokens.css",
      css: `:root { --radius-md: 0.5rem; --space-2: 0.5rem; --text-14: 0.875rem; --color-white: #ffffff; --color-shadow: rgba(0, 0, 0, 0.35); --duration-fast: 0.1s; }`,
    },
  ])
  const raw = scanRaw(
    [{ file: "a.module.css", css: `.a { padding: 8px; border-radius: 8px; font-size: 14px; color: white; background: #fff; box-shadow: 0 0 1px rgba(0,0,0,.35); transition-duration: 100ms; }` }],
    tokens,
  )
  const get = (value: string) => raw.find((r) => r.value === value)

  test("suggests a radius token for a radius and a space token for padding, from the same value", () => {
    expect(get("8px")?.properties).toEqual(["padding", "border-radius"])
    expect(get("8px")?.token).toBe("--space-2")
  })

  test("suggests a text token for a font size", () => {
    expect(get("14px")?.token).toBe("--text-14")
  })

  test("suggests nothing when the only token of that value is another kind", () => {
    const other = scanRaw([{ file: "a.module.css", css: `.a { border-radius: 8px }` }], readTokens([{ file: "t.css", css: `:root { --space-2: 0.5rem }` }]))
    expect(other[0]?.token).toBeUndefined()
  })

  test("counts one color once however it is spelled, and finds named colors", () => {
    expect(raw.filter((r) => r.kind === "color" && r.token === "--color-white").map((r) => r.count)).toEqual([2])
    expect(get("rgba(0,0,0,.35)")?.token).toBe("--color-shadow")
  })

  test("puts 100ms and 0.1s together", () => {
    expect(get("100ms")?.token).toBe("--duration-fast")
  })
})

describe("canonical colors", () => {
  test("expands short hex and drops a full alpha", () => {
    expect(canonical("#fff")).toBe("#ffffff")
    expect(canonical("#FFFFFFFF")).toBe("#ffffff")
    expect(canonical("white")).toBe("#ffffff")
  })

  test("ignores spacing and a missing leading zero in a color function", () => {
    expect(canonical("rgba(0, 0, 0, .35)")).toBe(canonical("rgba(0,0,0,0.35)"))
  })
})
