import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { sourceFiles } from "@drydock/ledger"
import { build, type Plugin } from "vite"
import { componentService } from "./components/service"
import type { ResolvedProject } from "./project"
import { collectTokens, tokenSources } from "./tokens/collect"

const SRC = path.dirname(fileURLToPath(import.meta.url))
const STYLES_ID = "virtual:drydock/styles"
/** The page module for a component is a file name beside it that does not exist. The project's transforms resolve their presets from a module's folder, so it needs a real folder. */
const PAGE_MODULE = /^(.*)[\\/]__drydock__([^\\/]+)\.tsx$/
/** The handover page's module, beside the new component. It also imports each old component that the new one replaces. */
const HANDOVER_MODULE = /^(.*)[\\/]__drydock_handover__([^\\/]+)\.tsx$/
const TOKENS_ROUTE = "/drydock/tokens"
const COMPONENTS_ROUTE = "/drydock/components"
const COMPONENT_ROUTE = "/drydock/component"
const HANDOVER_ROUTE = "/drydock/handover"
const WINDOW_ROUTE = "/drydock/window"
const DATA_URL = "/drydock/tokens.json"
const MARKS_URL = "/drydock/marks.json"

/** The scripts the catalog builds for itself, by the URL each is served at. */
const SCRIPTS: Record<string, string> = {
  "/drydock/client.js": "client/tokens.ts",
  "/drydock/page.js": "client/page.ts",
  "/drydock/window.js": "client/window.ts",
}

export const TOKENS_EVENT = "drydock:tokens"

/**
 * One of the catalog's own page scripts, built on its own. The project's plugins (the React compiler, an Astro
 * integration) transform every module Vite serves, and they resolve their presets from the file's folder. A built
 * script never passes through them, so the catalog's chrome does not depend on what the project's pipeline can resolve.
 */
async function buildScript(entry: string): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    root: path.resolve(SRC, ".."),
    build: {
      write: false,
      minify: false,
      lib: { entry: path.join(SRC, entry), formats: ["es"], fileName: "script" },
      rollupOptions: { external: ["/@vite/client"] },
    },
  })
  const outputs = Array.isArray(result) ? result : [result]
  const chunk = outputs.flatMap((o) => ("output" in o ? o.output : [])).find((o) => o.type === "chunk")
  if (!chunk || chunk.type !== "chunk") throw new Error(`The catalog script ${entry} did not build`)
  return chunk.code
}

/** A page's HTML. The project's stylesheets load through its own pipeline, and so do any `scripts` that come before the end of the head. */
function shell(title: string, scripts: string[] = []): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</title>
    <script type="module" src="/@id/__x00__${STYLES_ID}"></script>
${scripts.map((src) => `    <script type="module" src="${src}"></script>`).join("\n")}
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`
}

/**
 * The outermost folders that hold a file the ledger reads. A source folder can hold build output, such as a Rust
 * `target` folder in a desktop app, and watching only these folders leaves it out. A file in a folder that held no
 * source file when the server started is seen once another change refreshes the ledger.
 */
function sourceFolders(root: string, source: string[]): string[] {
  const folders = [...new Set(sourceFiles(root, source).map((file) => path.dirname(file)))].sort()
  return folders.filter((folder) => !folders.some((other) => folder.startsWith(`${other}${path.sep}`)))
}

const baseName = (file: string) => path.basename(file).replace(/\.\w+$/, "")
const pageModuleFor = (file: string) => path.join(path.dirname(file), `__drydock__${baseName(file)}.tsx`)
const handoverModuleFor = (file: string) => path.join(path.dirname(file), `__drydock_handover__${baseName(file)}.tsx`)
const casesImport = (file: string) => {
  const cases = path.join(path.dirname(file), `${baseName(file)}.cases.tsx`)
  return fs.existsSync(cases) ? `import * as Cases from ${JSON.stringify(`/@fs${cases}`)}` : `const Cases = {}`
}

export function drydockPlugin(project: ResolvedProject): Plugin {
  const components = componentService(project)
  /**
   * The ledger component that a page module name stands for, and whether it is a handover page. Only a component the
   * ledger lists is ever imported, and a handover page only for a component marked as replacing another.
   */
  const componentOf = (id: string) => {
    const file = id.replace(/^\/@fs/, "")
    const handover = HANDOVER_MODULE.exec(file)
    const match = handover ?? PAGE_MODULE.exec(file)
    if (!match) return undefined
    const [, dir, name] = match
    const component = components.index().components.find((c) => path.join(project.root, c.filed) === dir && baseName(c.id) === name)
    if (!component) return undefined
    if (handover && !components.marks().marks.some((m) => m.mark === "replaces" && m.component === component.id)) return undefined
    return { component, handover: Boolean(handover) }
  }
  return {
    name: "drydock",
    enforce: "pre",
    config() {
      // Cases files import `skip` from here, so a project needs no install step to draw its cases.
      return { resolve: { alias: { "@drydock/catalog/cases": path.join(SRC, "cases.ts") } } }
    },
    resolveId(id) {
      if (id === STYLES_ID) return `\0${id}`
      if (componentOf(id)) return id.replace(/^\/@fs/, "")
      return undefined
    },
    load(id) {
      if (id === `\0${STYLES_ID}`) return project.styles.map((specifier) => `import ${JSON.stringify(specifier)}`).join("\n") + "\n"
      const page = componentOf(id)
      if (!page) return undefined
      const absolute = path.join(project.root, page.component.id)
      // A handover page draws the old components that this one replaces. A component page draws the marked new
      // components its cases file holds, and the old ones that a window can put in their place.
      const swaps = page.handover ? [] : components.swapsFor(page.component.id)
      const olds = [...new Set(page.handover ? components.replacedBy(page.component.id).map((c) => c.id) : swaps.map((s) => s.oldId))]
      const news = [...new Set(swaps.map((s) => s.newId))]
      const importAll = (ids: string[], as: string) => ids.map((id, at) => `import * as ${as}${at} from ${JSON.stringify(`/@fs${path.join(project.root, id)}`)}`)
      const table = (ids: string[], as: string) => `{ ${ids.map((id, at) => `${JSON.stringify(id)}: ${as}${at}`).join(", ")} }`
      return [
        `import * as React from "react"`,
        `import { createRoot } from "react-dom/client"`,
        `import * as Module from ${JSON.stringify(`/@fs${absolute}`)}`,
        casesImport(absolute),
        ...importAll(olds, "Old"),
        ...importAll(news, "New"),
        `window.__drydock = { React, createRoot, Module, cases: Cases.default, old: ${table(olds, "Old")}, news: ${table(news, "New")} }`,
        "",
      ].join("\n")
    },
    configureServer(server) {
      const built = new Map<string, Promise<string>>()
      const reply = (res: import("node:http").ServerResponse, type: string, body: string) => {
        res.setHeader("Content-Type", type)
        res.setHeader("Cache-Control", "no-store")
        res.end(body)
      }
      /** The HTML goes through the project's pipeline. The built script goes in after it, which Vite's HTML step would otherwise send through the module pipeline. */
      const html = async (route: string, title: string, before: string[], script: string) => {
        const transformed = await server.transformIndexHtml(route, shell(title, before))
        return transformed.replace("</body>", `    <script type="module" src="${script}"></script>\n  </body>`)
      }
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost")
        const route = url.pathname
        try {
          if (route === TOKENS_ROUTE || route === `${TOKENS_ROUTE}/`) {
            reply(res, "text/html", await html(TOKENS_ROUTE, "Tokens", [], "/drydock/client.js"))
          } else if (SCRIPTS[route]) {
            let script = built.get(route)
            if (!script) {
              script = buildScript(SCRIPTS[route]!).catch((error: unknown) => {
                built.delete(route)
                throw error
              })
              built.set(route, script)
            }
            reply(res, "text/javascript", await script)
          } else if (route === DATA_URL) {
            reply(res, "application/json", JSON.stringify(await collectTokens(project)))
          } else if (components.enabled && (route === COMPONENTS_ROUTE || route === `${COMPONENTS_ROUTE}/`)) {
            reply(res, "text/html", await html(COMPONENTS_ROUTE, "Components", [], "/drydock/page.js"))
          } else if (components.enabled && route === `${COMPONENTS_ROUTE}.json`) {
            reply(res, "application/json", JSON.stringify(components.index()))
          } else if (components.enabled && route === COMPONENT_ROUTE) {
            const id = url.searchParams.get("file") ?? ""
            const known = components.index().components.some((c) => c.id === id)
            if (!known) return next()
            reply(res, "text/html", await html(COMPONENT_ROUTE, path.basename(id), [`/@fs${pageModuleFor(path.join(project.root, id))}`], "/drydock/page.js"))
          } else if (components.enabled && route === `${COMPONENT_ROUTE}.json`) {
            const page = await components.page(url.searchParams.get("file") ?? "", url.searchParams.get("part") ?? undefined)
            if (!page) return next()
            reply(res, "application/json", JSON.stringify(page))
          } else if (components.enabled && route === WINDOW_ROUTE) {
            // One page case in a document of its own. The component page frames it at the window's size.
            const id = url.searchParams.get("file") ?? ""
            const component = components.listed(id)
            if (!component || !fs.existsSync(path.join(project.root, path.dirname(id), `${baseName(id)}.cases.tsx`))) return next()
            reply(res, "text/html", await html(WINDOW_ROUTE, `${baseName(id)} ${url.searchParams.get("case") ?? ""}`, [`/@fs${pageModuleFor(path.join(project.root, id))}`], "/drydock/window.js"))
          } else if (components.enabled && route === MARKS_URL) {
            reply(res, "application/json", JSON.stringify(components.marks()))
          } else if (components.enabled && route === HANDOVER_ROUTE) {
            const id = url.searchParams.get("file") ?? ""
            const known = components.listed(id) && components.marks().marks.some((m) => m.mark === "replaces" && m.component === id)
            if (!known) return next()
            reply(res, "text/html", await html(HANDOVER_ROUTE, `${path.basename(id)} handover`, [`/@fs${handoverModuleFor(path.join(project.root, id))}`], "/drydock/page.js"))
          } else if (components.enabled && route === `${HANDOVER_ROUTE}.json`) {
            const handover = await components.handover(url.searchParams.get("file") ?? "", url.searchParams.get("part") ?? undefined, url.searchParams.get("replaces") ?? undefined)
            if (!handover) return next()
            reply(res, "application/json", JSON.stringify(handover))
          } else next()
        } catch (error) {
          next(error)
        }
      })

      let queued: ReturnType<typeof setTimeout> | undefined
      let closed = false
      let watched = new Set<string>()
      /** Re-reads which files the page covers, so a stylesheet added or removed later is followed too. */
      const refresh = async () => {
        const { tokenFiles, scanFiles } = await tokenSources(project)
        watched = new Set([...tokenFiles, ...scanFiles])
        server.watcher.add([...watched])
      }
      const send = () => {
        clearTimeout(queued)
        queued = setTimeout(async () => {
          if (closed) return
          try {
            server.hot.send(TOKENS_EVENT, await collectTokens(project))
          } catch (error) {
            server.config.logger.warn(`drydock: ${error instanceof Error ? error.message : String(error)}`)
          }
        }, 30)
      }
      void refresh().then(() => {
        server.watcher.on("change", (file) => {
          if (watched.has(file)) send()
        })
        for (const event of ["add", "unlink"] as const) {
          server.watcher.on(event, async (file) => {
            const known = watched.has(file)
            await refresh()
            if (known || watched.has(file)) send()
          })
        }
      })
      // A changed source file may change a component's imports or its props. Vite watches its own folder and the files a
      // page loaded, so the folders that hold the ledger's files are added: an app's pages can sit outside the app's Vite folder.
      if (project.components) server.watcher.add(sourceFolders(project.root, project.components.ledger.source))
      for (const event of ["change", "add", "unlink"] as const) {
        server.watcher.on(event, (file) => {
          if (/\.(tsx?|astro)$/.test(file) && !file.includes(`${path.sep}node_modules${path.sep}`)) components.invalidate()
        })
      }
      server.httpServer?.on("close", () => {
        closed = true
        clearTimeout(queued)
        void components.close()
      })
    },
  }
}
