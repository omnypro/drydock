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
    expect(canonical(" #ABC ")).toBe("#abc")
  })
})
