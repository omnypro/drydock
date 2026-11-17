import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Client, InMemoryTransport } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createDrydockServer, INSTRUCTIONS } from "../src/server"

let root: string
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), text)
}
const MARKS = `export default [{ mark: "replaces", component: "app/src/ui/NewTag.tsx", replaces: "app/src/ui/OldTag.tsx", reason: "" }]\n`
const project = () => ({
  root,
  appConfig: "app/vite.config.ts",
  tokens: ["app/src/tokens.css"],
  styles: [],
  rawValues: ["app/src/**/*.css"],
  components: { ledger: { source: ["app/src"], entries: [/^app\/src\/main\.tsx$/] }, marks: "marks.ts" },
})

let client: Client
let close: () => Promise<void>
type Text = { content: { type: string; text: string }[]; isError?: boolean }
const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as Text
const data = async <T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}) => {
  const result = await call(name, args)
  if (result.isError) throw new Error(result.content[0]?.text)
  return JSON.parse(result.content[0]!.text) as T
}

beforeAll(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "drydock-mcp-")))
  write("app/vite.config.ts", "export default {}\n")
  write("app/tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, moduleResolution: "bundler", module: "ESNext", target: "ES2022", jsx: "preserve" }, include: ["src"] }))
  write("app/src/tokens.css", ":root { --space-2: 8px; --color-teal-200: #aaffee }\n")
  write("app/src/main.tsx", `import { Page } from "./ui/Page"\nconsole.log(Page)\n`)
  write("app/src/ui/Page.tsx", `import { OldTag } from "./OldTag"\nexport function Page() {\n  return <OldTag label="x" />\n}\n`)
  write("app/src/ui/OldTag.tsx", `export function OldTag({ label }: { label: string }) {\n  return <i>{label}</i>\n}\n`)
  write("app/src/ui/NewTag.tsx", `/** A tag. */\nexport function NewTag({ label, tone }: { /** What it says. */ label: string; tone?: "calm" | "warm" }) {\n  return <b>{tone}{label}</b>\n}\n`)
  write("app/src/ui/NewTag.module.css", ".root { padding: 8px; color: #123456 }\n")
  write(
    "app/src/ui/NewTag.cases.tsx",
    `import { skip } from "@drydock/catalog/cases"\nimport { NewTag } from "./NewTag"\n\nconst page = (label: string) => <NewTag label={label} />\n\nexport default {\n  sample: { label: "x" },\n  each: { tone: skip("") },\n  windows: { wide: [1280, 800] },\n  owed: { disabled: { waived: "" }, long: page("a long label") },\n  more: { warm: <NewTag label="x" tone="warm" /> },\n}\n`,
  )
  write("marks.ts", MARKS)
  const made = createDrydockServer(project())
  close = made.close
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair()
  await made.server.connect(serverEnd)
  client = new Client({ name: "test", version: "0.0.0" })
  await client.connect(clientEnd)
}, 30_000)

afterAll(async () => {
  await client.close()
  await close()
  fs.rmSync(root, { recursive: true, force: true })
})

describe("the tools", () => {
  test("offers five tools, none that sets a mark, and tells an agent the rules", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort()
    expect(names).toEqual(["clear_mark", "list_components", "list_marks", "read_component", "read_tokens"])
    expect(client.getInstructions()).toBe(INSTRUCTIONS)
  })

  test("lists the components, narrowed by folder or name", async () => {
    const { components } = await data<{ components: { id: string; cases: boolean }[] }>("list_components")
    expect(components.map((c) => c.id)).toEqual(["app/src/ui/NewTag.tsx", "app/src/ui/OldTag.tsx", "app/src/ui/Page.tsx"])
    expect(components.find((c) => c.id === "app/src/ui/NewTag.tsx")?.cases).toBe(true)
    expect((await data<{ components: unknown[] }>("list_components", { name: "tag" })).components).toHaveLength(2)
    expect((await data<{ components: unknown[] }>("list_components", { folder: "app/src/elsewhere" })).components).toHaveLength(0)
  })

  test("reads a component: props, what its cases file names, the reasons still owed, its marks and its raw values", async () => {
    type Read = { doc: string; props: { name: string }[]; cases: unknown; marks: { replaces?: string }[]; rawValues: { value: string; token?: string }[] }
    const page = await data<Read>("read_component", { id: "app/src/ui/NewTag.tsx" })
    expect(page.doc).toBe("A tag.")
    expect(page.props.map((p) => p.name)).toEqual(["label", "tone"])
    expect(page.cases).toEqual({
      owed: [{ name: "disabled", waived: { reason: "" } }, { name: "long" }],
      more: ["warm"],
      skipped: [{ prop: "tone", reason: "" }],
      windows: ["wide"],
      reasonsOwed: ["owed.disabled", "each.tone"],
      problems: [],
    })
    expect(page.marks.map((m) => m.replaces)).toEqual(["app/src/ui/OldTag.tsx"])
    expect(page.rawValues.map((r) => [r.value, r.token ?? null])).toEqual([
      ["#123456", null],
      ["8px", "--space-2"],
    ])
  }, 30_000)

  test("returns an unknown component as an error result with what to do", async () => {
    const result = await call("read_component", { id: "app/src/ui/Nope.tsx" })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain("list_components gives the ids")
  })

  test("reads the tokens and the raw values, narrowed by group", async () => {
    const all = await data<{ tokens: { name: string }[]; raw: unknown[] }>("read_tokens", { raw: true })
    expect(all.tokens.map((t) => t.name)).toEqual(["--space-2", "--color-teal-200"])
    expect(all.raw.length).toBeGreaterThan(0)
    const colors = await data<{ tokens: { name: string }[]; raw?: unknown }>("read_tokens", { group: "color" })
    expect(colors.tokens.map((t) => t.name)).toEqual(["--color-teal-200"])
    expect(colors.raw).toBeUndefined()
  })

  test("answers calls sent at once, each against the files as they are", async () => {
    const results = await Promise.all([call("list_marks"), call("read_component", { id: "app/src/ui/OldTag.tsx" }), call("list_components")])
    expect(results.every((r) => !r.isError)).toBe(true)
  }, 30_000)
})

describe("clearing a mark", () => {
  test("refuses while a file still renders the old component, and leaves the marks file as it was", async () => {
    expect((await data<{ finished: unknown[] }>("list_marks")).finished).toEqual([])
    const result = await call("clear_mark", { mark: "replaces", component: "app/src/ui/NewTag.tsx", replaces: "app/src/ui/OldTag.tsx" })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toBe("1 file still renders app/src/ui/OldTag.tsx: app/src/ui/Page.tsx")
    expect(fs.readFileSync(path.join(root, "marks.ts"), "utf8")).toBe(MARKS)
  })

  test("lists the mark as finished once nothing renders the old component, and clears it", async () => {
    write("app/src/ui/Page.tsx", `import { NewTag } from "./NewTag"\nexport function Page() {\n  return <NewTag label="x" />\n}\n`)
    expect((await data<{ finished: unknown[] }>("list_marks")).finished).toEqual([{ mark: "replaces", component: "app/src/ui/NewTag.tsx", replaces: "app/src/ui/OldTag.tsx" }])
    expect(await data("clear_mark", { mark: "replaces", component: "app/src/ui/NewTag.tsx", replaces: "app/src/ui/OldTag.tsx" })).toEqual({ cleared: true, file: "marks.ts" })
    expect(fs.readFileSync(path.join(root, "marks.ts"), "utf8")).toBe("export default []\n")
  }, 30_000)
})

test("serves over stdio with nothing but the protocol on stdout, and its process ends when the client goes", async () => {
  write(
    "drydock.config.ts",
    `export default { appConfig: "app/vite.config.ts", tokens: ["app/src/tokens.css"], styles: [], rawValues: [], components: { ledger: { source: ["app/src"], entries: [/^app\\/src\\/main\\.tsx$/] }, marks: "marks.ts" } }\n`,
  )
  const transport = new StdioClientTransport({ command: "bun", args: [path.join(import.meta.dir, "../src/main.ts"), root], stderr: "pipe" })
  const stdio = new Client({ name: "test", version: "0.0.0" })
  await stdio.connect(transport)
  const pid = transport.pid!
  const result = (await stdio.callTool({ name: "list_components", arguments: {} })) as Text
  expect(JSON.parse(result.content[0]!.text).components.length).toBe(3)
  // Reading a component starts the type reader's compiler process, which has to go when the server does.
  expect(((await stdio.callTool({ name: "read_component", arguments: { id: "app/src/ui/NewTag.tsx" } })) as Text).isError).toBeFalsy()
  const children = Bun.spawnSync(["pgrep", "-P", String(pid)]).stdout.toString().trim().split("\n").filter(Boolean).map(Number)
  expect(children.length).toBeGreaterThan(0)
  await stdio.close()
  const running = (id: number) => {
    try {
      process.kill(id, 0)
      return true
    } catch {
      return false
    }
  }
  let left = [pid, ...children].filter(running)
  for (let tries = 0; left.length && tries < 50; tries++) {
    await Bun.sleep(100)
    left = left.filter(running)
  }
  expect(left).toEqual([])
}, 60_000)
