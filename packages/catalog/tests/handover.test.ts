import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ComponentShape, PropShape } from "@drydock/reader"
import { createServer, type ViteDevServer } from "vite"
import { catalogViteConfig } from "../src"
import { compareProps } from "../src/components/handover"
import type { ComponentPage, Handover, MarksView } from "../src/components/service"

const prop = (name: string, type: string): PropShape => ({ name, kind: "data", optional: true, type, doc: `${name} doc`, values: [], ordered: true })
const shape = (...props: PropShape[]): ComponentShape => ({ name: "X", compiler: "test", doc: "", props, shapes: [{}], defaults: {} })

describe("compareProps", () => {
  test("marks each prop kept, new or dropped, with the old type when it changed", () => {
    expect(compareProps(shape(prop("label", "string"), prop("size", '"s" | "l"'), prop("loud", "boolean")), shape(prop("label", "string"), prop("size", '"sm" | "md"'), prop("icon", "string")))).toEqual([
      { status: "kept", name: "label", type: "string", doc: "label doc" },
      { status: "kept", name: "size", type: '"sm" | "md"', oldType: '"s" | "l"', doc: "size doc" },
      { status: "new", name: "icon", type: "string", doc: "icon doc" },
      { status: "dropped", name: "loud", type: "boolean", doc: "loud doc" },
    ])
  })

  test("takes a rename only from the mark, never from two types that match", () => {
    const old = shape(prop("loading", "boolean"))
    const neu = shape(prop("pending", "boolean"))
    expect(compareProps(old, neu).map((r) => r.status)).toEqual(["new", "dropped"])
    expect(compareProps(old, neu, { loading: "pending" })).toEqual([{ status: "renamed", name: "pending", was: "loading", type: "boolean", doc: "pending doc" }])
  })

  test("ignores a rename whose names the two components do not have", () => {
    expect(compareProps(shape(prop("a", "string")), shape(prop("b", "string")), { x: "b", a: "y" }).map((r) => r.status)).toEqual(["new", "dropped"])
  })
})

describe("the handover, served", () => {
  let root: string
  let server: ViteDevServer
  let base: string
  const get = (url: string) => fetch(`${base}${url}`)
  const json = async <T>(url: string) => (await (await get(url)).json()) as T
  const marks = (text: string) => writeFile(path.join(root, "marks.ts"), text)
  const MARK = `export default [{ mark: "replaces", component: "app/src/ui/NewTag.tsx", replaces: "app/src/ui/OldTag.tsx", renamed: { tone: "mood" }, reason: "" }]\n`

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), "drydock-handover-")))
    await mkdir(path.join(root, "app/src/ui"), { recursive: true })
    // The app's Vite folder is apart from the component sources, as `apps/web` is from `packages/` in Altair.
    await mkdir(path.join(root, "web"), { recursive: true })
    await writeFile(path.join(root, "web/vite.config.ts"), "export default {}\n")
    await writeFile(path.join(root, "app/tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, moduleResolution: "bundler", module: "ESNext", target: "ES2022", jsx: "preserve" }, include: ["src"] }))
    await writeFile(path.join(root, "app/src/main.tsx"), `import { Page } from "./ui/Page"\nconsole.log(Page)\n`)
    await writeFile(path.join(root, "app/src/ui/Page.tsx"), `import { OldTag } from "./OldTag"\nexport function Page() {\n  return <OldTag label="x" />\n}\n`)
    await writeFile(path.join(root, "app/src/ui/OldTag.tsx"), `export function OldTag({ tone, label, loud }: { tone?: "calm" | "warm"; label: string; loud?: boolean }) {\n  return <i>{tone}{label}{String(loud)}</i>\n}\n`)
    await writeFile(path.join(root, "app/src/ui/NewTag.tsx"), `export function NewTag({ mood, label }: { mood?: "calm" | "warm"; label: string }) {\n  return <b>{mood}{label}</b>\n}\n`)
    await writeFile(path.join(root, "app/src/ui/NewTag.cases.tsx"), `export default { sample: { label: "x" } }\n`)
    // A page that holds the new component in a slot, drawn in a window.
    await writeFile(path.join(root, "app/src/ui/Frame.tsx"), `export function Frame({ slot }: { slot?: unknown }) {\n  return <main>{slot as never}</main>\n}\n`)
    await writeFile(
      path.join(root, "app/src/ui/Frame.cases.tsx"),
      `import { Frame } from "./Frame"\nimport { NewTag } from "./NewTag"\n\nexport default { sample: {}, windows: { wide: [1280, 800] }, more: { page: { window: "wide", render: <Frame slot={<NewTag label="x" />} /> } } }\n`,
    )
    // Build output inside a source folder, as `src-tauri/target` is inside `apps/desktop`.
    await mkdir(path.join(root, "app/target/debug"), { recursive: true })
    await writeFile(path.join(root, "app/target/debug/build.rs"), "fn main() {}\n")
    await marks(MARK)
    const config = await catalogViteConfig(
      {
        root,
        appConfig: "web/vite.config.ts",
        tokens: [],
        styles: [],
        rawValues: [],
        components: { ledger: { source: ["app"], entries: [/^app\/src\/main\.tsx$/] }, marks: "marks.ts" },
      },
      { command: "serve", mode: "development" },
      // The fsevents package sends nothing on some Macs. Vite's watcher then falls back to fs.watch, so this test does not depend on it.
      { server: { port: 0, host: "127.0.0.1", watch: { useFsEvents: false } }, logLevel: "silent" },
    )
    server = await createServer(config)
    await server.listen()
    base = server.resolvedUrls!.local[0]!.replace(/\/$/, "")
  })

  // Closing a Vite server now and then takes about five seconds, which is Bun's default for a hook.
  afterAll(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }, 15_000)

  test("lists the marks with what the import graph says about each", async () => {
    expect(await json<MarksView>("/drydock/marks.json")).toEqual({
      file: "marks.ts",
      exists: true,
      problems: [],
      marks: [
        {
          mark: "replaces",
          component: "app/src/ui/NewTag.tsx",
          replaces: "app/src/ui/OldTag.tsx",
          renamed: { tone: "mood" },
          reason: "",
          finished: false,
          remaining: ["app/src/ui/Page.tsx"],
          unlisted: [],
          waitingOn: "1 file still renders app/src/ui/OldTag.tsx: app/src/ui/Page.tsx",
        },
      ],
    })
  })

  test("gives the mark to the pages of both components", async () => {
    for (const file of ["app/src/ui/NewTag.tsx", "app/src/ui/OldTag.tsx"]) {
      const page = await json<ComponentPage>(`/drydock/component.json?file=${file}`)
      expect(page.marks.map((m) => [m.component, m.mark === "replaces" ? m.replaces : ""])).toEqual([["app/src/ui/NewTag.tsx", "app/src/ui/OldTag.tsx"]])
    }
    expect((await json<ComponentPage>("/drydock/component.json?file=app/src/ui/Page.tsx")).marks).toEqual([])
  }, 30_000)

  test("serves the handover: both parts, the props side by side and the cases file", async () => {
    const handover = await json<Handover>("/drydock/handover.json?file=app/src/ui/NewTag.tsx")
    expect(handover).toMatchObject({ part: "NewTag", oldPart: "OldTag", casesFile: "app/src/ui/NewTag.cases.tsx", errors: [] })
    expect(handover.old?.id).toBe("app/src/ui/OldTag.tsx")
    expect(handover.props.map((r) => [r.status, r.name, r.was ?? ""])).toEqual([
      ["renamed", "mood", "tone"],
      ["kept", "label", ""],
      ["dropped", "loud", ""],
    ])
  }, 30_000)

  test("draws the handover from a module that imports both components", async () => {
    const html = await (await get("/drydock/handover?file=app/src/ui/NewTag.tsx")).text()
    expect(html).toContain("__drydock_handover__NewTag.tsx")
    const module = await (await get(`/@fs${path.join(root, "app/src/ui/__drydock_handover__NewTag.tsx")}`)).text()
    expect(module).toContain("OldTag.tsx")
    expect(module).toContain("NewTag.cases.tsx")
    expect(module).toContain("window.__drydock")
  })

  test("has no handover for a component that replaces nothing", async () => {
    expect((await get("/drydock/handover.json?file=app/src/ui/OldTag.tsx")).status).not.toBe(200)
    expect(await (await get("/drydock/handover?file=app/src/ui/OldTag.tsx")).text()).not.toContain("__drydock_handover__")
    expect(await (await get(`/@fs${path.join(root, "app/src/ui/__drydock_handover__OldTag.tsx")}`)).text()).not.toContain("window.__drydock")
  })

  test("watches the folders that hold the ledger's files, outside the app's Vite folder, and not the build output beside them", () => {
    const watched = Object.keys(server.watcher.getWatched())
    expect(watched).toContain(path.join(root, "app/src"))
    expect(watched).not.toContain(path.join(root, "app/target"))
  })

  test("lists the marked new components that a page's cases file draws, with the parts to swap", async () => {
    const frame = await json<ComponentPage>("/drydock/component.json?file=app/src/ui/Frame.tsx")
    expect(frame.swaps).toEqual([{ newId: "app/src/ui/NewTag.tsx", oldId: "app/src/ui/OldTag.tsx", part: "NewTag", oldPart: "OldTag" }])
    expect((await json<ComponentPage>("/drydock/component.json?file=app/src/ui/NewTag.tsx")).swaps).toEqual([])
  }, 30_000)

  test("gives the page module the new and the old component of each swap", async () => {
    const module = await (await get(`/@fs${path.join(root, "app/src/ui/__drydock__Frame.tsx")}`)).text()
    expect(module).toContain("NewTag.tsx")
    expect(module).toContain("OldTag.tsx")
    expect(module).toContain("news:")
  })

  test("draws a page case in a window of its own, and only for a component with a cases file", async () => {
    const html = await (await get(`/drydock/window?${new URLSearchParams({ file: "app/src/ui/Frame.tsx", case: "more/<page>" })}`)).text()
    expect(html).toContain("__drydock__Frame.tsx")
    expect(html).toContain("/drydock/window.js")
    expect(html).toContain("<title>Frame more/&#60;page&#62;</title>")
    expect(await (await get("/drydock/window?file=app/src/ui/OldTag.tsx&case=more/x")).text()).not.toContain("/drydock/window.js")
    expect(await (await get("/drydock/window.js")).text()).toContain("has no")
  })

  test("counts down when a file outside the app's Vite folder stops rendering the old component", async () => {
    const page = path.join(root, "app/src/ui/Page.tsx")
    const left = async () => (await json<MarksView>("/drydock/marks.json")).marks[0]?.remaining.length
    const until = async (want: number) => {
      let now = await left()
      for (let tries = 0; now !== want && tries < 50; tries++) {
        await Bun.sleep(100)
        now = await left()
      }
      return now
    }
    expect(await left()).toBe(1)
    await writeFile(page, `import { NewTag } from "./NewTag"\nexport function Page() {\n  return <NewTag label="x" />\n}\n`)
    expect(await until(0)).toBe(0)
    await writeFile(page, `import { OldTag } from "./OldTag"\nexport function Page() {\n  return <OldTag label="x" />\n}\n`)
    expect(await until(1)).toBe(1)
  }, 30_000)

  test("follows an edit to the marks file, and the handover goes when its mark does", async () => {
    await marks(`export default [{ mark: "parked", component: "app/src/ui/NewTag.tsx", reason: 1 }]\n`)
    expect(await json<MarksView>("/drydock/marks.json")).toMatchObject({ marks: [], problems: ["line 1: `reason` is written as a string"] })
    expect((await get("/drydock/handover.json?file=app/src/ui/NewTag.tsx")).status).not.toBe(200)
    await marks("export default []\n")
    expect((await json<ComponentPage>("/drydock/component.json?file=app/src/ui/NewTag.tsx")).marks).toEqual([])
    await marks(MARK)
    expect((await get("/drydock/handover.json?file=app/src/ui/NewTag.tsx")).status).toBe(200)
  }, 30_000)
})
