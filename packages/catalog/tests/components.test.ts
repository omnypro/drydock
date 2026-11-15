import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createServer, type ViteDevServer } from "vite"
import { catalogViteConfig } from "../src"
import type { ComponentIndex, ComponentPage } from "../src/components/service"

let root: string
let server: ViteDevServer
let base: string

const json = async <T>(url: string) => (await (await fetch(`${base}${url}`)).json()) as T

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "drydock-components-"))
  await mkdir(path.join(root, "app/src/ui"), { recursive: true })
  await writeFile(path.join(root, "app/vite.config.ts"), "export default {}\n")
  await writeFile(path.join(root, "app/tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, moduleResolution: "bundler", module: "ESNext", target: "ES2022", jsx: "preserve" }, include: ["src"] }))
  await writeFile(path.join(root, "app/src/main.tsx"), `import { Tag } from "./ui/Tag"\nconsole.log(Tag)\n`)
  await writeFile(
    path.join(root, "app/src/ui/Tag.tsx"),
    `/** A small tag. */\nexport function Tag({ tone = "calm", label }: { /** The mood. */ tone?: "calm" | "warm"; label: string }) {\n  return <b>{tone}{label}</b>\n}\n`,
  )
  await writeFile(path.join(root, "app/src/ui/Tag.cases.tsx"), `export default { sample: { label: "x" } }\n`)
  const config = await catalogViteConfig(
    {
      root,
      appConfig: "app/vite.config.ts",
      tokens: [],
      styles: [],
      rawValues: [],
      components: { ledger: { source: ["app/src"], entries: [/^app\/src\/main\.tsx$/] } },
    },
    { command: "serve", mode: "development" },
    { server: { port: 0, host: "127.0.0.1" }, logLevel: "silent" },
  )
  server = await createServer(config)
  await server.listen()
  base = server.resolvedUrls!.local[0]!.replace(/\/$/, "")
})

afterAll(async () => {
  await server.close()
  await rm(root, { recursive: true, force: true })
})

test("lists the components the ledger finds", async () => {
  const index = await json<ComponentIndex>("/drydock/components.json")
  expect(index.components).toEqual([{ id: "app/src/ui/Tag.tsx", name: "Tag", filed: "app/src/ui", level: 0, apps: ["app"], inShowcase: false, kind: "react" }])
})

test("serves a component's ledger entry, the shape the reader reads, and the cases file beside it", async () => {
  const page = await json<ComponentPage>("/drydock/component.json?file=app/src/ui/Tag.tsx")
  expect(page).toMatchObject({ part: "Tag", parts: ["Tag"], casesFile: "app/src/ui/Tag.cases.tsx" })
  expect(page.shape).toMatchObject({ name: "Tag", doc: "A small tag.", defaults: { tone: "calm" } })
  expect(page.shape?.props.map((p) => [p.name, p.kind, p.values])).toEqual([
    ["tone", "union", ["calm", "warm"]],
    ["label", "data", []],
  ])
}, 30_000)

test("answers the page for a component the ledger lists, with its module beside the component", async () => {
  const html = await (await fetch(`${base}/drydock/component?file=app/src/ui/Tag.tsx`)).text()
  expect(html).toContain("__drydock__Tag.tsx")
  expect(html).toContain("/drydock/page.js")
})

test("does not answer for a file the ledger does not list", async () => {
  expect((await fetch(`${base}/drydock/component.json?file=app/vite.config.ts`)).status).not.toBe(200)
  const html = await (await fetch(`${base}/drydock/component?file=app/vite.config.ts`)).text()
  expect(html).not.toContain("__drydock__")
  const module = await fetch(`${base}/@fs${path.join(root, "app/src/ui/__drydock__Nope.tsx")}`)
  expect(await module.text()).not.toContain("window.__drydock")
})

test("builds the page script", async () => {
  const script = await (await fetch(`${base}/drydock/page.js`)).text()
  expect(script).toContain("Components")
  expect(script).not.toContain("/@vite/client\"")
})
