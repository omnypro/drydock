// Serves Drydock's MCP tools for one project over stdio. Usage: bun packages/mcp/src/main.ts <project root> [project config]
// The config defaults to drydock/config.ts in the project. Stdout carries the protocol, so anything else goes to stderr.
import path from "node:path"
import { configPathFor, type ProjectConfig } from "@drydock/catalog/data"
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"
import { createDrydockServer } from "./server"

const [rootArg, configArg] = process.argv.slice(2)
if (!rootArg) {
  console.error("usage: bun packages/mcp/src/main.ts <project root> [project config]")
  process.exit(1)
}
const root = path.resolve(rootArg)
const config = (await import(configPathFor(root, configArg))).default as ProjectConfig
const { server, close } = createDrydockServer({ ...config, root })

let closing = false
const shutDown = async () => {
  if (closing) return
  closing = true
  await close()
  process.exit(0)
}
const transport = new StdioServerTransport()
transport.onclose = () => void shutDown()
process.stdin.on("end", () => void shutDown())
process.on("SIGINT", () => void shutDown())
process.on("SIGTERM", () => void shutDown())
await server.connect(transport)
console.error(`drydock: serving ${root}`)
