import fs from "node:fs"
import path from "node:path"
import { deriveLedger } from "@drydock/ledger"
import type { ResolvedProject } from "@drydock/catalog"

/** One component that has a cases file, with what the checks need to draw it. */
export type CheckItem = {
  /** The component's file, from the project root. */
  id: string
  file: string
  casesFile: string
  /** The export the checks draw: the first component the file exports. */
  part: string
  tsconfig: string
}

/** The components that share one test setup: the folder of the nearest `bunfig.toml`, where `bun test` runs. */
export type CheckGroup = { cwd: string; items: CheckItem[] }

export type Plan = {
  groups: CheckGroup[]
  /** Components with a cases file that the checks cannot run, with the reason. */
  unplaced: { id: string; reason: string }[]
}

function nearest(from: string, name: string, root: string): string | undefined {
  for (let dir = from; dir.startsWith(root); dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, name))) return path.join(dir, name)
    if (dir === root) break
  }
  return undefined
}

const casesFileOf = (file: string) => path.join(path.dirname(file), `${path.basename(file).replace(/\.\w+$/, "")}.cases.tsx`)

/** Lists the components that have a cases file, grouped by the test setup that each one runs in. `only` limits it to these ids. */
export function planChecks(project: ResolvedProject, only?: string[]): Plan {
  if (!project.components) return { groups: [], unplaced: [] }
  const ledger = deriveLedger({ root: project.root, ...project.components.ledger })
  const groups = new Map<string, CheckItem[]>()
  const unplaced: Plan["unplaced"] = []
  for (const component of ledger.components) {
    if (only && !only.includes(component.id)) continue
    const file = path.join(project.root, component.id)
    const casesFile = casesFileOf(file)
    if (component.kind !== "react" || !fs.existsSync(casesFile)) continue
    const bunfig = nearest(path.dirname(file), "bunfig.toml", project.root)
    const tsconfig = project.components.tsconfig ? path.resolve(project.root, project.components.tsconfig) : nearest(path.dirname(file), "tsconfig.json", project.root)
    if (!bunfig) unplaced.push({ id: component.id, reason: "No bunfig.toml above it, so there is no test setup to draw it in" })
    else if (!tsconfig) unplaced.push({ id: component.id, reason: "No tsconfig.json above it" })
    else {
      const cwd = path.dirname(bunfig)
      groups.set(cwd, [...(groups.get(cwd) ?? []), { id: component.id, file, casesFile, part: component.parts[0]!, tsconfig }])
    }
  }
  return { groups: [...groups].map(([cwd, items]) => ({ cwd, items })), unplaced }
}
