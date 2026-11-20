import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { deriveLedger } from "@drydock/ledger"
import { casesFileFor, ledgerConfig, type ResolvedProject } from "@drydock/catalog"

/** The cases files that were read, from the project root, and the type errors found in them. */
export type CasesTypecheck = { files: string[]; errors: string[] }

type Compiler = typeof import("typescript")

function nearestTsconfig(from: string, root: string): string | undefined {
  for (let dir = from; dir.startsWith(root); dir = path.dirname(dir)) {
    const file = path.join(dir, "tsconfig.json")
    if (fs.existsSync(file)) return file
    if (dir === root) break
  }
  return undefined
}

/** The project's own TypeScript, so its files are judged by the version the project builds with. */
function compilerFor(folder: string): Compiler {
  let compiler: Partial<Compiler> | undefined
  try {
    compiler = createRequire(path.join(folder, "package.json"))("typescript") as Partial<Compiler>
  } catch {
    compiler = undefined
  }
  if (typeof compiler?.createProgram !== "function") throw new Error(`The project's TypeScript has no compiler interface: ${folder}`)
  return compiler as Compiler
}

/**
 * Typechecks the cases files of a project's React components, each under the nearest tsconfig. The cases files are the
 * program's roots, so a tsconfig that leaves them out of its own `include` still has them checked here. Cases beside an
 * `.astro` component are left out: TypeScript cannot read an `.astro` import. `only` limits it to these component ids.
 */
export function typecheckCases(project: ResolvedProject, only?: string[]): CasesTypecheck {
  if (!project.components) return { files: [], errors: [] }
  const groups = new Map<string, string[]>()
  const errors: string[] = []
  const from = (file: string) => path.relative(project.root, file).split(path.sep).join("/")
  for (const component of deriveLedger(ledgerConfig(project)).components) {
    if (only && !only.includes(component.id)) continue
    const file = path.join(project.root, component.id)
    const casesFile = casesFileFor(file)
    if (component.kind !== "react" || !casesFile) continue
    const tsconfig = project.components.tsconfig ? path.resolve(project.root, project.components.tsconfig) : nearestTsconfig(path.dirname(file), project.root)
    if (!tsconfig) errors.push(`${from(casesFile)}: no tsconfig.json above it`)
    groups.set(tsconfig ?? "", [...(groups.get(tsconfig ?? "") ?? []), casesFile])
  }
  for (const [tsconfig, files] of groups) {
    if (!tsconfig) continue
    const ts = compilerFor(path.dirname(tsconfig))
    const parsed = ts.getParsedCommandLineOfConfigFile(tsconfig, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })
    if (!parsed) {
      errors.push(`${from(tsconfig)}: could not be read`)
      continue
    }
    const roots = new Set(files.map((file) => path.resolve(file)))
    // A composite project must list every file it reads, and the cases files are read alone here.
    const options = { ...parsed.options, noEmit: true, composite: false, incremental: false, tsBuildInfoFile: undefined }
    const program = ts.createProgram({ rootNames: files, options })
    for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
      if (!diagnostic.file || !roots.has(path.resolve(diagnostic.file.fileName))) continue
      const { line, character } = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start ?? 0)
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n").split("\n")[0]
      errors.push(`${from(diagnostic.file.fileName)}(${line + 1},${character + 1}): error TS${diagnostic.code}: ${message}`)
    }
  }
  return { files: [...groups.values()].flat().map(from).sort(), errors: errors.sort() }
}
