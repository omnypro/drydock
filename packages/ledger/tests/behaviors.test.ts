import { afterAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { deriveLedger, type Ledger } from "../src"

let dir: string

async function project(files: Record<string, string>, extra: Partial<Parameters<typeof deriveLedger>[0]> = {}): Promise<Ledger> {
  dir = await mkdtemp(path.join(os.tmpdir(), "drydock-ledger-"))
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true })
    await writeFile(path.join(dir, name), text)
  }
  return deriveLedger({ root: dir, source: ["src"], entries: [/^src\/main\.tsx$/], ...extra })
}
const get = (ledger: Ledger, name: string) => ledger.components.find((c) => c.id === `src/${name}`)!

afterAll(() => dir && rm(dir, { recursive: true, force: true }))

const TSCONFIG = JSON.stringify({ compilerOptions: { moduleResolution: "bundler", jsx: "preserve", paths: { "@/*": ["./src/*"] } }, include: ["src"] })

describe("levels in a cycle", () => {
  const graph = (first: string) => ({
    "tsconfig.json": TSCONFIG,
    [`src/${first}.tsx`]: `import { Menu } from "./Menu"\nexport function ${first}() { return <Menu /> }`,
    "src/Menu.tsx": `import { ${first} } from "./${first}"\nimport { Row } from "./Row"\nexport function Menu() { return <div><${first} /><Row /></div> }`,
    "src/Row.tsx": `import { Cell } from "./Cell"\nexport function Row() { return <Cell /> }`,
    "src/Cell.tsx": `import { Dot } from "./Dot"\nexport function Cell() { return <Dot /> }`,
    "src/Dot.tsx": `export function Dot() { return <i /> }`,
  })

  test("gives the same levels whatever the files are called", async () => {
    const levels = async (first: string) => {
      const ledger = await project(graph(first))
      return Object.fromEntries(ledger.components.map((c) => [c.name === first ? "first" : c.name, c.level]))
    }
    expect(await levels("Item")).toEqual(await levels("Zebra"))
    expect(await levels("Item")).toMatchObject({ Dot: 0, Cell: 1, Row: 2, first: 3, Menu: 3 })
  })
})

describe("which uses count", () => {
  test("follows a namespace import to the members used, through an index file", async () => {
    const ledger = await project({
      "tsconfig.json": TSCONFIG,
      "src/main.tsx": `import { Page } from "./Page"\nconsole.log(Page)`,
      "src/Page.tsx": `import * as UI from "./ui"\nexport function Page() { return <UI.Card /> }`,
      "src/ui/index.ts": `export * from "./Card"\nexport * from "./Badge"`,
      "src/ui/Card.tsx": `export function Card() { return <b /> }`,
      "src/ui/Badge.tsx": `export function Badge() { return <i /> }`,
    })
    expect(get(ledger, "Page.tsx").builtFrom).toEqual(["src/ui/Card.tsx"])
    expect(get(ledger, "ui/Badge.tsx").apps).toEqual([])
  })

  test("does not count a type position as a use, and does not report an imported interface as missing", async () => {
    const ledger = await project({
      "tsconfig.json": TSCONFIG,
      "src/main.tsx": `import { Wrapper } from "./Wrapper"\nconsole.log(Wrapper)`,
      "src/Wrapper.tsx": `import { Card, CardProps } from "./Card"\nexport function Wrapper(props: CardProps & { of?: typeof Card }) { return <u>{String(props)}</u> }`,
      "src/Card.tsx": `export interface CardProps { id?: string }\nexport function Card() { return <b /> }`,
    })
    expect(get(ledger, "Wrapper.tsx").builtFrom).toEqual([])
    expect(ledger.failed).toEqual([])
  })

  test("lists a use from a file that is not a component, such as a router", async () => {
    const ledger = await project({
      "tsconfig.json": TSCONFIG,
      "src/main.tsx": `import { routes } from "./routes"\nconsole.log(routes)`,
      "src/routes.tsx": `import { Home } from "./Home"\nexport const routes = [{ path: "/", element: <Home /> }]`,
      "src/Home.tsx": `export function Home() { return <main /> }`,
    })
    expect(get(ledger, "Home.tsx")).toMatchObject({ usedBy: [], referencedBy: ["src/routes.tsx"], apps: ["app"] })
  })
})

describe("what counts as a component", () => {
  test("takes a function whatever its name, an aliased primitive, and leaves out a context, an enum, a constant and an error class", async () => {
    const ledger = await project({
      "tsconfig.json": TSCONFIG,
      "src/Many.tsx": [
        `import { createContext } from "react"`,
        `import * as Primitive from "./primitive"`,
        `export function FAQ() { return <dl /> }`,
        `export const H1 = () => <h1 />`,
        `export const Trigger = Primitive.Trigger`,
        `export const ThemeContext = createContext(1)`,
        `export enum Tone { A, B }`,
        `export const SIZES = ["a"]`,
        `export class ApiError extends Error {}`,
        `export default FAQ`,
      ].join("\n"),
      "src/primitive.ts": `export const Trigger = () => null`,
    })
    expect(get(ledger, "Many.tsx").parts.sort()).toEqual(["FAQ", "H1", "Many", "Trigger"].sort())
  })

  test("lists a part once when it is exported by name and as the default", async () => {
    const ledger = await project({ "tsconfig.json": TSCONFIG, "src/Twice.tsx": `export function Twice() { return <b /> }\nexport default Twice` })
    expect(get(ledger, "Twice.tsx").parts).toEqual(["Twice"])
  })
})

describe("imports", () => {
  test("follows a `.js` specifier to the TypeScript file, and an alias from a config beside a solution-style root", async () => {
    const ledger = await project({
      "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
      "tsconfig.app.json": JSON.stringify({ compilerOptions: { moduleResolution: "bundler", jsx: "preserve", paths: { "@/*": ["./src/*"] } }, include: ["src/main.tsx"] }),
      "src/main.tsx": `import { A } from "./A.js"\nconsole.log(A)`,
      "src/A.tsx": `import { B } from "@/B"\nexport function A() { return <B /> }`,
      "src/B.tsx": `export function B() { return <b /> }`,
    })
    expect(ledger.unresolved).toEqual([])
    expect(get(ledger, "A.tsx").builtFrom).toEqual(["src/B.tsx"])
    expect(get(ledger, "B.tsx").apps).toEqual(["app"])
  })

  test("uses the config nearest the file when a root config with no paths includes it too", async () => {
    const ledger = await project({
      "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "bundler", jsx: "preserve" } }),
      "src/tsconfig.json": TSCONFIG.replace("./src/*", "./*").replace('"include":["src"]', '"include":["."]'),
      "src/main.tsx": `import { A } from "@/A"\nconsole.log(A)`,
      "src/A.tsx": `export function A() { return <a /> }`,
    })
    expect(ledger.unresolved).toEqual([])
    expect(get(ledger, "A.tsx").apps).toEqual(["app"])
  })

  test("reads an .astro file that starts with a blank line, and every component named in one brace", async () => {
    const ledger = await project({
      "tsconfig.json": TSCONFIG,
      "src/main.tsx": `import "./Home.astro"`,
      "src/Home.astro": `\n---\nimport Alpha from "./Alpha.astro"\nimport Beta from "./Beta.astro"\nconst wide = true\n---\n<main><Dynamic as={wide ? Alpha : Beta} /></main>`,
      "src/Alpha.astro": `---\n---\n<a />`,
      "src/Beta.astro": `---\n---\n<b />`,
    })
    expect(get(ledger, "Home.astro").builtFrom).toEqual(["src/Alpha.astro", "src/Beta.astro"])
  })

  test("does not throw on a broken package manifest", async () => {
    const ledger = await project({
      "tsconfig.json": TSCONFIG,
      "src/main.tsx": `import "broken-package/sub"`,
      "node_modules/broken-package/package.json": "{ not json",
    })
    expect(ledger.unresolved.map((u) => u.specifier)).toEqual(["broken-package/sub"])
  })
})

describe("scale", () => {
  test("resolves 2,000 components through one index file of `export *` in a few seconds", async () => {
    const files: Record<string, string> = { "tsconfig.json": TSCONFIG }
    const parts: string[] = []
    for (let i = 0; i < 2000; i++) {
      files[`src/c/C${i}.tsx`] = `export function C${i}() { return <i /> }`
      parts.push(`export * from "./c/C${i}"`)
    }
    files["src/index.ts"] = parts.join("\n")
    files["src/main.tsx"] = `import { ${Array.from({ length: 2000 }, (_, i) => `C${i}`).join(", ")} } from "./index"\nconsole.log(${Array.from({ length: 2000 }, (_, i) => `C${i}`).join(", ")})`
    const t0 = performance.now()
    const ledger = await project(files)
    expect(performance.now() - t0).toBeLessThan(10_000)
    expect(ledger.components.filter((c) => c.apps.length).length).toBe(2000)
  }, 30_000)
})
