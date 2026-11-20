// Starts the catalog on a project's own Vite server. Usage: bun scripts/serve.ts <project root> [project config] [port]
// The config defaults to drydock/config.ts in the project.
import path from "node:path"
import { configPathFor, startCatalog, type ProjectConfig } from "../src"

const [rootArg, configArg, portArg] = process.argv.slice(2)
if (!rootArg) {
  console.error("usage: bun scripts/serve.ts <project root> [project config] [port]")
  process.exit(1)
}
const root = path.resolve(rootArg)
const config = (await import(configPathFor(root, configArg))).default as ProjectConfig
const catalog = await startCatalog({ ...config, root }, { port: Number(portArg ?? 6100), host: "localhost", strictPort: true })
console.log(`catalog: ${catalog.url}`)
console.log(`tokens page: ${catalog.url}/drydock/tokens`)
console.log(`components: ${catalog.url}/drydock/components`)
// Closing removes what the catalog keeps in the temp folder for this run.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void catalog.close().finally(() => process.exit(0))
  })
}
