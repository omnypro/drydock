import { beforeAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { deriveLedger, type Ledger, type LedgerConfig } from "../src"
import { ASTRO, MODULE, parseModule } from "../src/parse"

const root = path.join(import.meta.dir, "fixtures", "app")
const config: LedgerConfig = {
  root,
  source: ["src"],
  entries: [/^src\/main\.tsx$/],
  showcases: [/\.stories\.tsx$/],
  leaveOut: [/\/icons\//],
}

let ledger: Ledger
const component = (name: string) => {
  const found = ledger.components.find((c) => c.id.endsWith(`/${name}.tsx`) || c.id.endsWith(`/${name}.astro`))
  if (!found) throw new Error(`No component ${name}. The ledger has ${ledger.components.map((c) => c.id).join(", ")}`)
  return found
}
const ids = (...names: string[]) => names.map((n) => component(n).id).sort()

beforeAll(() => {
  ledger = deriveLedger(config)
})

describe("what each file is built from", () => {
  test("follows `export *`, a renamed re-export, a namespace re-export and a default-exported identifier", () => {
    expect(component("App").builtFrom).toEqual(ids("Button", "Card", "CycleA", "Layout", "Lazy", "TypeOnly", "extras"))
  })

  test("follows a dynamic import() into the file it loads", () => {
    expect(component("Lazy").builtFrom).toEqual(ids("Heavy"))
    expect(component("Heavy").usedBy).toEqual(ids("Lazy", "Home"))
  })

  test("ignores type-only imports, whole or per name", () => {
    expect(component("TypeOnly").builtFrom).toEqual([])
    expect(component("Card").usedBy).not.toContain(component("TypeOnly").id)
  })

  test("reads the components an .astro file draws from its template", () => {
    const home = component("Home")
    expect(home.kind).toBe("astro")
    expect(home.parts).toEqual(["Home"])
    expect(home.builtFrom).toEqual(ids("Button", "Heavy", "Orphan"))
  })

  test("names a default export after its file, or after its function", () => {
    expect(component("Layout").parts).toEqual(["Layout"])
    expect(component("Heavy").parts).toEqual(["Heavy"])
  })

  test("leaves out the files the config leaves out, and exports that are not component names", () => {
    expect(ledger.components.some((c) => c.id.includes("icons/"))).toBe(false)
    expect(component("Button").parts).toEqual(["Button"])
    expect(component("Button").builtFrom).toEqual([])
  })

  test("leaves out the entry, the showcases and files that are not components", () => {
    const listed = ledger.components.map((c) => c.id)
    expect(listed).not.toContain("src/main.tsx")
    expect(listed).not.toContain("src/ui/Orphan.stories.tsx")
    expect(listed).not.toContain("src/ui/lazy-helper.ts")
  })
})

describe("levels", () => {
  test("level 0 renders no other component, and a parent is one above its deepest child", () => {
    expect(component("Button").level).toBe(0)
    expect(component("Card").level).toBe(1)
    expect(component("Lazy").level).toBe(1)
    expect(component("App").level).toBeGreaterThan(component("Card").level)
  })

  test("ends on a cycle and records the use both ways", () => {
    expect(component("CycleA").usedBy).toContain(component("CycleB").id)
    expect(component("CycleB").usedBy).toContain(component("CycleA").id)
    expect(component("CycleA").level).toBeGreaterThan(0)
  })
})

describe("whether an app or a showcase reaches it", () => {
  test("reaches what the entry runs, through every kind of import", () => {
    for (const name of ["App", "Layout", "Button", "Card", "extras", "Lazy", "Heavy", "CycleA", "CycleB", "TypeOnly"]) {
      expect({ name, apps: component(name).apps }).toEqual({ name, apps: ["app"] })
    }
  })

  test("leaves a file that only an unreached file renders out of the app", () => {
    expect(component("Orphan").apps).toEqual([])
    expect(component("Unshown").apps).toEqual([])
    expect(component("Home").apps).toEqual([])
  })

  test("says which showcase draws a component", () => {
    expect(component("Orphan").shownIn).toEqual(["src/ui/Orphan.stories.tsx"])
    expect(component("Orphan").inShowcase).toBe(true)
    expect(component("Unshown").inShowcase).toBe(false)
  })

  test("counts an entry's exports as starting points when the config says so", () => {
    const routed = deriveLedger({ ...config, entries: [/^src\/pages\//], entryExports: true })
    const button = routed.components.find((c) => c.id === "src/ui/Button.tsx")!
    expect(button.apps).toEqual(["app"])
    expect(button.routedBy).toEqual(["src/pages/Home.astro"])
    expect(routed.components.some((c) => c.id === "src/pages/Home.astro")).toBe(false)
  })
})

describe("what it could not follow", () => {
  test("returns unresolved imports as data, by what each one is", () => {
    expect(ledger.unresolved.map(({ specifier, kind, count }) => ({ specifier, kind, count })).sort((a, b) => a.specifier.localeCompare(b.specifier))).toEqual([
      { specifier: "./ui/missing", kind: "relative", count: 1 },
      { specifier: "@/nowhere", kind: "alias", count: 1 },
      { specifier: "not-installed-package", kind: "package", count: 1 },
    ])
  })

  test("does not count stylesheets, queries or built-ins as unresolved", () => {
    const specifiers = ledger.unresolved.map((u) => u.specifier)
    expect(specifiers).not.toContain("./ui/theme.css")
    expect(specifiers).not.toContain("./ui/theme.css?raw")
  })

  test("returns a named import that no module exports", () => {
    expect(ledger.failed).toEqual([{ import: "Ghost from ./ui/Button", count: 1 }])
  })

  test("counts the files it read", () => {
    expect(ledger).toMatchObject({ astro: 1, showcaseFiles: 1, entries: ["src/main.tsx"] })
  })
})

describe("parseModule", () => {
  test("records imports, re-exports and stars by kind", () => {
    const mod = parseModule(
      "/x/a.ts",
      `import a, { b as c, type D } from "./m"
import type { E } from "./n"
import * as f from "./o"
export * from "./p"
export { q as r } from "./s"
export * as t from "./u"
export { a as z }
export type { E }`,
    )
    expect([...mod.imports]).toEqual([
      ["a", { specifier: "./m", name: "default" }],
      ["c", { specifier: "./m", name: "b" }],
      ["f", { specifier: "./o", name: "*" }],
    ])
    expect(mod.stars).toEqual(["./p"])
    expect(mod.reexports).toEqual([
      { specifier: "./s", name: "q", as: "r" },
      { specifier: "./u", name: "*", as: "t" },
    ])
    expect(mod.exports.get("z")).toBe("a")
  })

  test("keeps property names, JSX attribute names and the declaration's own name out of its refs", () => {
    const mod = parseModule("/x/a.tsx", `import { X, Y } from "./m"\nexport function A() { return <X label={Y.name} other={1} /> }`)
    expect([...mod.declarations.get("A")!.refs].sort()).toEqual(["X", "Y"])
  })

  test("puts a top-level statement in the module declaration, and a variable in its own", () => {
    const mod = parseModule("/x/a.ts", `import { run } from "./m"\nrun()\nexport const value = run`)
    expect([...mod.declarations.get(MODULE)!.refs]).toEqual(["run"])
    expect([...mod.declarations.get("value")!.refs]).toEqual(["run"])
  })

  test("reads the frontmatter of an .astro file as code and its template as the component", () => {
    const mod = parseModule("/x/a.astro", `---\nimport Card from "./Card"\nconst n = 1\n---\n<Card>{n}</Card>`)
    expect(mod.imports.get("Card")).toEqual({ specifier: "./Card", name: "default" })
    expect(mod.exports.get("default")).toBe(ASTRO)
    expect([...mod.declarations.get(ASTRO)!.refs].sort()).toEqual(["Card", "n"])
  })
})
