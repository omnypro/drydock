import path from "node:path"
import { fileURLToPath } from "node:url"
import { build, type Plugin } from "vite"
import type { ResolvedProject } from "./project"
import { collectTokens, tokenSources } from "./tokens/collect"

const SRC = path.dirname(fileURLToPath(import.meta.url))
const STYLES_ID = "virtual:drydock/styles"
const ROUTE = "/drydock/tokens"
const CLIENT_URL = "/drydock/client.js"
const DATA_URL = "/drydock/tokens.json"

export const TOKENS_EVENT = "drydock:tokens"

/**
 * The catalog's own page script, built on its own. The project's plugins (the React compiler, an Astro integration)
 * transform every module Vite serves, and they resolve their presets from the file's folder. A built script never
 * passes through them, so the catalog's chrome does not depend on what the project's pipeline can resolve.
 */
async function buildClient(): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    root: path.resolve(SRC, ".."),
    build: {
      write: false,
      minify: false,
      lib: { entry: path.join(SRC, "client/tokens.ts"), formats: ["es"], fileName: "client" },
      rollupOptions: { external: ["/@vite/client"] },
    },
  })
  const outputs = Array.isArray(result) ? result : [result]
  const chunk = outputs.flatMap((o) => ("output" in o ? o.output : [])).find((o) => o.type === "chunk")
  if (!chunk || chunk.type !== "chunk") throw new Error("The catalog client did not build")
  return chunk.code
}

/** The page's HTML. The project's stylesheets load through its own pipeline. */
function page(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tokens</title>
    <script type="module" src="/@id/__x00__${STYLES_ID}"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`
}

export function drydockPlugin(project: ResolvedProject): Plugin {
  return {
    name: "drydock",
    resolveId(id) {
      if (id === STYLES_ID) return `\0${id}`
      return undefined
    },
    load(id) {
      if (id === `\0${STYLES_ID}`) return project.styles.map((specifier) => `import ${JSON.stringify(specifier)}`).join("\n") + "\n"
      return undefined
    },
    configureServer(server) {
      let client: Promise<string> | undefined
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0]
        try {
          if (url === ROUTE || url === `${ROUTE}/`) {
            res.setHeader("Content-Type", "text/html")
            // The built script goes in after the transform: Vite's HTML step would send it through the module pipeline.
            const html = await server.transformIndexHtml(ROUTE, page())
            res.end(html.replace("</body>", `    <script type="module" src="${CLIENT_URL}"></script>\n  </body>`))
          } else if (url === CLIENT_URL) {
            client ??= buildClient()
            res.setHeader("Content-Type", "text/javascript")
            res.end(await client)
          } else if (url === DATA_URL) {
            res.setHeader("Content-Type", "application/json")
            res.setHeader("Cache-Control", "no-store")
            res.end(JSON.stringify(await collectTokens(project)))
          } else next()
        } catch (error) {
          next(error)
        }
      })

      let queued: ReturnType<typeof setTimeout> | undefined
      void tokenSources(project).then(({ tokenFiles, scanFiles }) => {
        const watched = new Set([...tokenFiles, ...scanFiles])
        server.watcher.add([...watched])
        server.watcher.on("change", (file) => {
          if (!watched.has(file)) return
          clearTimeout(queued)
          queued = setTimeout(async () => server.hot.send(TOKENS_EVENT, await collectTokens(project)), 30)
        })
      })
    },
  }
}
