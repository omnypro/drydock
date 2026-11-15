import { describe, expect, test } from "bun:test"
import { readTokens } from "../src/tokens/read"

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
