import path from "node:path"
import { createServer, type ViteDevServer } from "vite"
import { catalogViteConfig } from "./host"
import type { ResolvedProject } from "./project"

export type RunningCatalog = { url: string; server: ViteDevServer; close(): Promise<void> }

/**
 * Starts the catalog on the project's own Vite setup. Port 0 takes any free port.
 * The app's own `vite dev` runs from the app's folder, and its plugins resolve their presets and read env files from
 * the working directory. The process works from that folder while the server runs, and returns to its own on close.
 */
export async function startCatalog(project: ResolvedProject, { port = 0, host = "127.0.0.1", strictPort = false } = {}): Promise<RunningCatalog> {
  const previous = process.cwd()
  process.chdir(path.dirname(path.resolve(project.root, project.appConfig)))
  try {
    const config = await catalogViteConfig(project, { command: "serve", mode: "development" })
    const server = await createServer({ ...config, logLevel: config.logLevel ?? "warn", server: { ...config.server, port, host, strictPort } })
    await server.listen()
    const url = server.resolvedUrls?.local[0]?.replace(/\/$/, "")
    if (!url) throw new Error("The catalog server did not report a local address")
    return {
      url,
      server,
      async close() {
        await server.close()
        process.chdir(previous)
      },
    }
  } catch (error) {
    process.chdir(previous)
    throw error
  }
}
