import { describe, expect, test } from "bun:test"
import { displayTokens, readTokens } from "../src/tokens/read"

const css = `
:root {
  color-scheme: dark;
  --color-teal-200: oklch(0.9 0.05 180);
  --color-accent: var(--color-teal-200);
  --color-alias: var(--color-accent);
  --space-2: 0.5rem;
  --flag-stripe-1: #123456;
  --font-emphasis: var(--font-body);
  --font-body: "Example Sans", sans-serif;
  --loose: var(--missing);
}
.card { --not-a-token: 1px; }
`

describe("readTokens", () => {
  const tokens = readTokens([{ file: "tokens.css", css }])
  const get = (name: string) => tokens.find((t) => t.name === name)

  test("reads custom properties from :root only, in source order", () => {
    expect(tokens.map((t) => t.name)).toEqual([
      "--color-teal-200",
      "--color-accent",
      "--color-alias",
      "--space-2",
      "--flag-stripe-1",
      "--font-emphasis",
      "--font-body",
      "--loose",
    ])
  })

  test("resolves an alias through more than one step, and one declared later", () => {
    expect(get("--color-alias")?.resolved).toBe("oklch(0.9 0.05 180)")
    expect(get("--font-emphasis")?.resolved).toBe('"Example Sans", sans-serif')
  })

  test("keeps a reference to a missing token as written", () => {
    expect(get("--loose")?.resolved).toBe("var(--missing)")
  })

  test("groups palette steps by family and the rest by kind", () => {
    expect(get("--color-teal-200")?.group).toBe("color/teal")
    expect(get("--color-accent")?.group).toBe("color/semantic")
    expect(get("--flag-stripe-1")?.group).toBe("flag/stripe")
    expect(get("--space-2")?.group).toBe("space")
  })
})

describe("where tokens are declared", () => {
  const read = (source: string) => readTokens([{ file: "t.css", css: source }])

  test("reads `html`, `:host`, a selector list with `:root`, and Tailwind's `@theme`", () => {
    const tokens = read(`html { --a: 1px } :host { --b: 2px } :root, :host { --c: 3px } @theme { --d: 4px } @layer base { :root { --e: 5px } }`)
    expect(tokens.map((t) => t.name)).toEqual(["--a", "--b", "--c", "--d", "--e"])
    expect(tokens.every((t) => !t.condition)).toBe(true)
  })

  test("keeps a dark block apart, with its condition, and resolves its aliases inside it first", () => {
    const tokens = read(`
      :root { --bg: #fff; --fg: var(--bg); --edge: #ccc }
      @media (prefers-color-scheme: dark) { :root { --bg: #000 } }
      :root[data-theme="dark"] { --bg: #111; --edge: var(--bg) }
    `)
    const named = (name: string) => tokens.filter((t) => t.name === name).map((t) => ({ condition: t.condition, resolved: t.resolved }))
    expect(named("--bg")).toEqual([
      { condition: undefined, resolved: "#fff" },
      { condition: "@media (prefers-color-scheme: dark)", resolved: "#000" },
      { condition: ':root[data-theme="dark"]', resolved: "#111" },
    ])
    expect(named("--fg")).toEqual([{ condition: undefined, resolved: "#fff" }])
    expect(named("--edge")[1]).toEqual({ condition: ':root[data-theme="dark"]', resolved: "#111" })
  })

  test("ignores custom properties on other selectors, in keyframes and in nested rules", () => {
    const tokens = read(`.card { --x: 1px } @keyframes k { from { --y: 1px } } :root { .inner { --z: 1px } }`)
    expect(tokens).toEqual([])
  })
})

describe("var() fallbacks", () => {
  const resolved = (source: string, name: string) => readTokens([{ file: "t.css", css: `:root { ${source} }` }]).find((t) => t.name === name)?.resolved

  test("uses a fallback that holds parentheses and nested var()", () => {
    expect(resolved("--c: 1px; --d: var(--c, var(--e, 2px))", "--d")).toBe("1px")
    expect(resolved("--d: var(--missing, var(--e, rgb(0 0 0)))", "--d")).toBe("rgb(0 0 0)")
  })

  test("uses the fallback when the token is not declared", () => {
    expect(resolved("--d: var(--missing, 4px)", "--d")).toBe("4px")
  })

  test("leaves a loop as written instead of expanding it", () => {
    expect(resolved("--a: var(--b) var(--b); --b: var(--a) var(--a)", "--a")).toBe("var(--a) var(--a) var(--a) var(--a)")
  })
})

describe("displayTokens", () => {
  const show = (source: string) => displayTokens(readTokens([{ file: "t.css", css: source }])).map((t) => [t.name, t.resolved])

  test("takes the dark value over the base one, and resolves aliases against it", () => {
    expect(
      show(`
        :root { --bg: #fff; --fg: var(--bg); --edge: #ccc }
        @media (prefers-color-scheme: dark) { :root { --bg: #000 } }
        :root[data-theme="dark"] { --edge: #333 }
      `),
    ).toEqual([
      ["--bg", "#000"],
      ["--fg", "#000"],
      ["--edge", "#333"],
    ])
  })

  test("leaves a light block off the page and keeps a token that exists only in dark", () => {
    expect(show(`:root { --a: 1px } @media (prefers-color-scheme: light) { :root { --a: 2px } } @media (prefers-color-scheme: dark) { :root { --only: 3px } }`)).toEqual([
      ["--a", "1px"],
      ["--only", "3px"],
    ])
  })

  test("lists a name once when two files declare it, with the last value", () => {
    const tokens = displayTokens(readTokens([{ file: "a.css", css: ":root { --x: 1px }" }, { file: "b.css", css: ":root { --x: 2px }" }]))
    expect(tokens.map((t) => [t.name, t.resolved, t.file])).toEqual([["--x", "2px", "b.css"]])
  })
})
