import { openReader } from "../../src"

try {
  await openReader({ tsconfig: "/nowhere/tsconfig.json", compiler: "async" })
} catch {
  console.log("threw")
}
await Bun.sleep(500)
console.log(Bun.spawnSync(["pgrep", "-P", String(process.pid)]).stdout.toString().trim() ? "children" : "no children")
process.exit(0)
