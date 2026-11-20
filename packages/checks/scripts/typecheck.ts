// Typechecks a project's cases files. Usage: bun scripts/typecheck.ts <project root> [project config]
// The config defaults to drydock/config.ts in the project. It exits with 1 when a cases file has a type error, and with 2 when it cannot run.
import path from "node:path"
import { configPathFor, type ProjectConfig } from "@drydock/catalog"
import { typecheckCases } from "../src"

const [rootArg, configArg] = process.argv.slice(2)
if (!rootArg) {
  console.error("usage: bun scripts/typecheck.ts <project root> [project config]")
  process.exit(2)
}
const root = path.resolve(rootArg)
const config = (await import(configPathFor(root, configArg))).default as ProjectConfig
try {
  const { files, errors } = typecheckCases({ ...config, root })
  console.log(`${files.length} cases files`)
  for (const error of errors) console.error(error)
  process.exit(errors.length ? 1 : 0)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}
