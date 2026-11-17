import fs from "node:fs"
import path from "node:path"
import { collectTokens, componentService, type ResolvedProject } from "@drydock/catalog/data"
import { clearMark, type Mark } from "@drydock/marks"
import { McpServer } from "@modelcontextprotocol/server"
import * as z from "zod"
import { readCasesFile } from "./cases"

export const INSTRUCTIONS = `Drydock's view of this project: the components that the app's imports reach, their props and cases files, the design tokens, and the marks. Every call reads the files as they are now.

Marks and the reasons in a cases file belong to the project's owner. Never add a mark. When a cases file needs a skip or a waived state, write it with an empty reason and ask the owner for one; read_component lists the reasons still owed. When list_marks shows a finished mark, clear it with clear_mark as part of the work that finished it. clear_mark refuses a mark that the import graph does not show finished.`

type Result = { content: { type: "text"; text: string }[]; isError?: boolean }
const ok = (data: unknown): Result => ({ content: [{ type: "text", text: JSON.stringify(data) }] })
const refused = (message: string): Result => ({ content: [{ type: "text", text: message }], isError: true })
const casesFileOf = (file: string) => path.join(path.dirname(file), `${path.basename(file).replace(/\.\w+$/, "")}.cases.tsx`)

/** The MCP server for one project, and a way to close what it holds open: the type readers run a compiler process each. */
export function createDrydockServer(project: ResolvedProject): { server: McpServer; close(): Promise<void> } {
  const service = componentService(project)
  const server = new McpServer({ name: "drydock", version: "0.0.0" }, { instructions: INSTRUCTIONS })

  // Calls run one at a time. Each one re-reads the project, and a second call's refresh would reset the ledger under the first.
  let queue: Promise<unknown> = Promise.resolve()
  const one = (work: () => Promise<Result>): Promise<Result> => {
    const run = queue.then(async () => {
      try {
        if (!service.enabled) return refused("The project config has no `components` section, so there is no ledger to read.")
        await service.refresh()
        return await work()
      } catch (error) {
        return refused(error instanceof Error ? error.message : String(error))
      }
    })
    queue = run
    return run
  }
  const read = { readOnlyHint: true, openWorldHint: false }

  server.registerTool(
    "list_components",
    {
      description: "Lists the components the ledger finds: each one's file, name, level (0 renders no other component), the apps that render it, its exports, and whether a cases file sits beside it.",
      inputSchema: z.object({
        folder: z.string().optional().describe("Only components whose file is under this folder, from the project root"),
        name: z.string().optional().describe("Only components whose name holds this text, in any case"),
      }),
      annotations: read,
    },
    ({ folder, name }) =>
      one(async () => {
        const ledger = service.ledger()
        const prefix = folder?.replace(/\/?$/, "/")
        const components = ledger.components
          .filter((c) => (!prefix || c.id.startsWith(prefix)) && (!name || c.name.toLowerCase().includes(name.toLowerCase())))
          .map((c) => ({ id: c.id, name: c.name, level: c.level, apps: c.apps, parts: c.parts, cases: fs.existsSync(casesFileOf(path.join(project.root, c.id))) }))
        return ok({ components, unresolvedImports: ledger.unresolved.length })
      }),
  )

  server.registerTool(
    "read_component",
    {
      description:
        "Reads one component: what it is built from and what uses it, its props from the types, what its cases file names (owed states, drawn or waived, skipped props and the reasons still owed), the marks that name it, and the raw values in its own stylesheet where a token could go.",
      inputSchema: z.object({
        id: z.string().describe("The component's file from the project root, as list_components gives it"),
        part: z.string().optional().describe("The export to read, for a file that exports several components"),
      }),
      annotations: read,
    },
    ({ id, part }) =>
      one(async () => {
        const page = await service.page(id, part)
        if (!page) return refused(`The ledger lists no component at ${id}. list_components gives the ids.`)
        const casesFile = page.casesFile ? path.join(project.root, page.casesFile) : null
        const base = path.basename(id).replace(/\.\w+$/, "")
        const own = (file: string) => path.dirname(file) === path.dirname(id) && path.basename(file).startsWith(`${base}.`) && file.endsWith(".css")
        const tokens = await collectTokens(project)
        const rawValues = tokens.raw.flatMap((raw) => raw.files.filter((f) => own(f.file)).map((f) => ({ value: raw.value, kind: raw.kind, file: f.file, count: f.count, ...(raw.token ? { token: raw.token } : {}) })))
        return ok({
          ledger: page.component,
          part: page.part,
          doc: page.shape?.doc ?? "",
          props: page.shape?.props.map(({ name, kind, type, optional, doc, declaredIn }) => ({ name, kind, type, optional, doc, ...(declaredIn ? { declaredIn } : {}) })) ?? null,
          defaults: page.shape?.defaults ?? {},
          ...(page.error ? { readError: page.error } : {}),
          casesFile: page.casesFile,
          cases: casesFile ? readCasesFile(casesFile) : null,
          marks: page.marks,
          swaps: page.swaps,
          rawValues,
        })
      }),
  )

  server.registerTool(
    "read_tokens",
    {
      description: "Reads the design tokens with their dark values. With `raw`, also the raw values in the project's stylesheets that are not tokens, with the files that use each and a token of the same value when there is one.",
      inputSchema: z.object({
        group: z.string().optional().describe("Only tokens whose group starts with this, such as `color` or `space`"),
        raw: z.boolean().optional().describe("Include the raw values and the files that use each. Off by default: in a large project they are as long as the tokens"),
      }),
      annotations: read,
    },
    ({ group, raw = false }) =>
      one(async () => {
        const data = await collectTokens(project)
        const tokens = data.tokens.filter((t) => !group || t.group.startsWith(group)).map(({ name, value, resolved, group: g, file }) => ({ name, value, resolved, group: g, file }))
        return ok({ tokens, ...(raw ? { raw: data.raw } : {}), scanned: data.scanned, unreadable: data.unreadable })
      }),
  )

  server.registerTool(
    "list_marks",
    {
      description: "Lists the marks with what the import graph says about each. A finished mark can be cleared with clear_mark; `waitingOn` says what keeps an open one open.",
      inputSchema: z.object({}),
      annotations: read,
    },
    () =>
      one(async () => {
        const view = service.marks()
        return ok({ ...view, finished: view.marks.filter((m) => m.finished).map((m) => (m.mark === "replaces" ? { mark: m.mark, component: m.component, replaces: m.replaces } : { mark: m.mark, component: m.component })) })
      }),
  )

  server.registerTool(
    "clear_mark",
    {
      description: "Removes a finished mark from the marks file. It refuses, and changes nothing, unless the import graph shows the mark finished.",
      inputSchema: z.object({
        mark: z.enum(["replaces", "parked"]),
        component: z.string().describe("The mark's component, from the project root"),
        replaces: z.string().optional().describe("For a replaces mark: the old component's file"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ mark, component, replaces }) =>
      one(async () => {
        const file = project.components?.marks
        if (!file) return refused("The project config names no marks file.")
        if (mark === "replaces" && !replaces) return refused("A replaces mark is named by its component and the file it replaces.")
        const target: Mark = mark === "replaces" ? { mark, component, replaces: replaces!, reason: "" } : { mark, component, reason: "" }
        const result = clearMark(project.root, file, target, service.ledger())
        return result.cleared ? ok({ cleared: true, file }) : refused(result.reason)
      }),
  )

  return { server, close: () => service.close() }
}
