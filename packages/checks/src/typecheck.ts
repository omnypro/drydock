import { createRequire } from "node:module"
import path from "node:path"
import { deriveLedger } from "@drydock/ledger"
import { casesFileFor, ledgerConfig, type ResolvedProject } from "@drydock/catalog"
import { nearest } from "./plan"

/** The cases files that were read, from the project root, and the errors found: in them, in their tsconfig, or in its options. */
export type CasesTypecheck = { files: string[]; errors: string[] }

type Compiler = typeof import("typescript")

/** TypeScript's code for "No inputs were found in config file". */
const NO_INPUTS = 18003

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
    const tsconfig = project.components.tsconfig ? path.resolve(project.root, project.components.tsconfig) : nearest(path.dirname(file), "tsconfig.json", project.root)
    if (!tsconfig) errors.push(`${from(casesFile)}: no tsconfig.json above it`)
    else groups.set(tsconfig, [...(groups.get(tsconfig) ?? []), casesFile])
  }
  for (const [tsconfig, files] of groups) {
    const ts = compilerFor(path.dirname(tsconfig))
    const say = (diagnostic: import("typescript").Diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n").split("\n")[0]
      if (!diagnostic.file) return `${from(tsconfig)}: error TS${diagnostic.code}: ${message}`
      const { line, character } = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start ?? 0)
      return `${from(diagnostic.file.fileName)}(${line + 1},${character + 1}): error TS${diagnostic.code}: ${message}`
    }
    let unreadable: import("typescript").Diagnostic | undefined
    const parsed = ts.getParsedCommandLineOfConfigFile(tsconfig, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (diagnostic) => (unreadable = diagnostic) })
    if (!parsed) {
      errors.push(unreadable ? say(unreadable) : `${from(tsconfig)}: could not be read`)
      continue
    }
    // A config that names no files of its own is no fault here: the cases files are the roots.
    errors.push(...parsed.errors.filter((diagnostic) => diagnostic.code !== NO_INPUTS).map(say))
    const roots = new Set(files.map((file) => path.resolve(file)))
    // A composite project must list every file it reads and must emit declarations. The cases files are read alone here, and nothing is emitted.
    const options = { ...parsed.options, noEmit: true, composite: false, incremental: false, tsBuildInfoFile: undefined, declaration: false, declarationMap: false, emitDeclarationOnly: false }
    const program = ts.createProgram({ rootNames: files, options })
    // An error with no file is one in the options, which leaves every file misread. An error in another file is that file's own to report.
    for (const diagnostic of ts.getPreEmitDiagnostics(program)) if (!diagnostic.file || roots.has(path.resolve(diagnostic.file.fileName))) errors.push(say(diagnostic))
  }
  return { files: [...groups.values()].flat().map(from).sort(), errors: errors.sort() }
}
