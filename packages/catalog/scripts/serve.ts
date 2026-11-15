// Starts the catalog on a project's own Vite server. Usage: bun scripts/serve.ts <project root> [project config] [port]
// The config defaults to drydock.config.ts at the project root.
import path from "node:path"
import { createServer } from "vite"
import { catalogViteConfig, type ProjectConfig } from "../src"

const [rootArg, configArg, portArg] = process.argv.slice(2)
if (!rootArg) {
  console.error("usage: bun scripts/serve.ts <project root> [project config] [port]")
  process.exit(1)
}
const root = path.resolve(rootArg)
const config = (await import(path.resolve(configArg ?? path.join(root, "drydock.config.ts")))).default as ProjectConfig
// The app's own `vite dev` runs from the app's folder. Its plugins resolve their presets and read env files from there.
process.chdir(path.dirname(path.resolve(root, config.appConfig)))
const base = await catalogViteConfig({ ...config, root }, { command: "serve", mode: "development" })
const server = await createServer({ ...base, server: { ...base.server, port: Number(portArg ?? 6100), strictPort: true } })
await server.listen()
server.printUrls()
console.log(`tokens page: http://localhost:${server.config.server.port}/drydock/tokens`)
