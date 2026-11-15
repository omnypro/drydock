import fs from "node:fs"
import path from "node:path"
import { globSync } from "tinyglobby"
import type { Ledger, LedgerComponent, LedgerConfig, Unresolved } from "./config"
import { ASTRO, MODULE, nameFromFile, parseModule, type Module } from "./parse"
import { createResolver, IGNORED, type Resolution } from "./resolve"

const NAME_SEP = "\0"
const sym = (file: string, name: string) => `${file}${NAME_SEP}${name}`
const fileOf = (symbol: string) => symbol.slice(0, symbol.indexOf(NAME_SEP))
const isTest = (file: string) => /\.test\.tsx?$/.test(file) || /(^|\/)tests?\//.test(file)

type Hit = { file: string; name: string }

/**
 * The strongly connected groups of a graph, with sinks first. Each file in a cycle is in the same group.
 * It runs without recursion, so a long chain of components does not overflow the stack.
 */
function components(nodes: string[], edges: (node: string) => Iterable<string>): string[][] {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const groups: string[][] = []
  let counter = 0
  for (const start of nodes) {
    if (index.has(start)) continue
    const work: { node: string; next: Iterator<string> }[] = [{ node: start, next: edges(start)[Symbol.iterator]() }]
    index.set(start, counter)
    low.set(start, counter++)
    stack.push(start)
    onStack.add(start)
    while (work.length) {
      const frame = work[work.length - 1]!
      const step = frame.next.next()
      if (!step.done) {
        const to = step.value
        if (!index.has(to)) {
          index.set(to, counter)
          low.set(to, counter++)
          stack.push(to)
          onStack.add(to)
          work.push({ node: to, next: edges(to)[Symbol.iterator]() })
        } else if (onStack.has(to)) low.set(frame.node, Math.min(low.get(frame.node)!, index.get(to)!))
        continue
      }
      work.pop()
      const parent = work[work.length - 1]
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!))
      if (low.get(frame.node) === index.get(frame.node)) {
        const group: string[] = []
        let member: string
        do {
          member = stack.pop()!
          onStack.delete(member)
          group.push(member)
        } while (member !== frame.node)
        groups.push(group)
      }
    }
  }
  return groups
}

/**
 * Follows a project's imports, declaration by declaration and through index files, and records for each component
 * file what it is built from, what uses it, how deep it sits, and whether an app or a showcase reaches it.
 * Everything it cannot follow comes back as data in `unresolved` and `failed`.
 */
export function deriveLedger(config: LedgerConfig): Ledger {
  const root = fs.realpathSync(path.resolve(config.root))
  const rel = (file: string) => path.relative(root, file)
  const anyMatch = (patterns: RegExp[] | undefined, file: string) => (patterns ?? []).some((pattern) => pattern.test(rel(file)))
  const isEntry = (file: string) => anyMatch(config.entries, file)
  const isShowcase = (file: string) => anyMatch(config.showcases, file)
  const appFrom = config.appFrom ?? /^apps\/([^/]+)\//
  const appOf = (file: string) => appFrom.exec(rel(file))?.[1] ?? "app"

  const files = globSync(
    config.source.map((dir) => `${dir.replace(/\/$/, "")}/**/*.{ts,tsx,astro}`),
    { cwd: root, absolute: true, dot: true, ignore: [...IGNORED, "**/*.d.ts"] },
  ).sort()
  const fileSet = new Set(files)
  const resolve = createResolver(root, fileSet)

  const mods = new Map<string, Module>()
  for (const file of files) mods.set(file, parseModule(file, fs.readFileSync(file, "utf8")))

  // Every import is resolved once. A miss is counted once per import statement.
  const resolutions = new Map<string, Resolution>()
  const missed = new Map<string, Unresolved>()
  const resolveFrom = (from: string, specifier: string): Resolution => {
    const key = `${from}${NAME_SEP}${specifier}`
    let known = resolutions.get(key)
    if (!known) {
      known = resolve(specifier, from)
      resolutions.set(key, known)
      if (known.kind === "unresolved") {
        const entry = missed.get(specifier) ?? { specifier, kind: known.as, count: 0, from: rel(from) }
        entry.count += 1
        missed.set(specifier, entry)
      }
    }
    return known
  }
  for (const mod of mods.values()) {
    const specifiers = new Set<string>([...[...mod.imports.values()].map((i) => i.specifier), ...mod.reexports.map((r) => r.specifier), ...mod.stars, ...mod.sideEffects])
    for (const declaration of mod.declarations.values()) for (const specifier of declaration.dynamic) specifiers.add(specifier)
    for (const specifier of specifiers) resolveFrom(mod.file, specifier)
  }
  const target = (from: string, specifier: string): string | undefined => {
    const resolution = resolveFrom(from, specifier)
    return resolution.kind === "file" ? resolution.file : undefined
  }

  /** Every name a file exports, with the declaration that each one stands for, through re-exports and `export *`. */
  const tables = new Map<string, Map<string, Hit>>()
  const building = new Set<string>()
  const exportTable = (file: string): Map<string, Hit> => {
    const known = tables.get(file)
    if (known) return known
    const table = new Map<string, Hit>()
    const mod = mods.get(file)
    if (!mod || building.has(file)) return table
    building.add(file)
    const through = (specifier: string, name: string): Hit | undefined => {
      const next = target(file, specifier)
      if (!next) return undefined
      return name === "*" ? { file: next, name: "*" } : exportTable(next).get(name)
    }
    for (const [name, local] of mod.exports) {
      const imported = mod.imports.get(local)
      const hit = mod.declarations.has(local) ? { file, name: local } : imported && through(imported.specifier, imported.name)
      if (hit) table.set(name, hit)
    }
    for (const reexport of mod.reexports) {
      const hit = through(reexport.specifier, reexport.name)
      if (hit) table.set(reexport.as, hit)
    }
    for (const star of mod.stars) {
      const next = target(file, star)
      if (!next) continue
      for (const [name, hit] of exportTable(next)) if (name !== "default" && !table.has(name)) table.set(name, hit)
    }
    building.delete(file)
    tables.set(file, table)
    return table
  }

  const isValue = (hit: Hit) => mods.get(hit.file)?.declarations.get(hit.name)?.kind !== "type"
  /** Adds the declarations that a module read as a whole can give: the named members, or every export when it is used as itself. */
  const addNamespace = (out: Set<string>, file: string, members: Set<string> | undefined, bare: boolean, seen = new Set<string>()) => {
    if (seen.has(file)) return
    seen.add(file)
    out.add(sym(file, MODULE))
    const table = exportTable(file)
    for (const name of bare || !members ? table.keys() : members) {
      const hit = table.get(name)
      if (!hit) continue
      if (hit.name === "*") addNamespace(out, hit.file, undefined, true, seen)
      else if (isValue(hit)) out.add(sym(hit.file, hit.name))
    }
  }

  const failed = new Map<string, number>()
  const edges = new Map<string, Set<string>>()
  for (const mod of mods.values()) {
    for (const [name, declaration] of mod.declarations) {
      if (declaration.kind === "type") continue
      const out = new Set<string>()
      for (const ref of declaration.refs) {
        const local = mod.declarations.get(ref)
        if (local && ref !== name) {
          if (local.kind !== "type") out.add(sym(mod.file, ref))
          continue
        }
        const imported = mod.imports.get(ref)
        if (!imported) continue
        const next = target(mod.file, imported.specifier)
        if (!next) continue
        if (imported.name === "*") {
          addNamespace(out, next, declaration.members.get(ref), declaration.bare.has(ref))
          continue
        }
        const hit = exportTable(next).get(imported.name)
        if (!hit) {
          const key = `${imported.name} from ${imported.specifier}`
          failed.set(key, (failed.get(key) ?? 0) + 1)
          continue
        }
        if (hit.name === "*") addNamespace(out, hit.file, declaration.members.get(ref), declaration.bare.has(ref))
        else if (isValue(hit)) out.add(sym(hit.file, hit.name))
      }
      for (const specifier of declaration.dynamic) {
        const next = target(mod.file, specifier)
        if (next) addNamespace(out, next, undefined, true)
      }
      if (name === MODULE) {
        // Loading a module runs the top level of every module it imports for its effects.
        for (const specifier of mod.sideEffects) {
          const next = target(mod.file, specifier)
          if (next) out.add(sym(next, MODULE))
        }
      }
      edges.set(sym(mod.file, name), out)
    }
  }

  /** The declarations that running the given files can reach. Loading a module runs its top level. */
  const reach = (starts: string[], everyDeclaration: boolean): Set<string> => {
    const seen = new Set<string>()
    const queue = starts.flatMap((file) => (everyDeclaration || mods.get(file)!.astro ? [...mods.get(file)!.declarations.keys()] : [MODULE]).map((name) => sym(file, name)))
    while (queue.length) {
      const symbol = queue.pop()!
      if (seen.has(symbol)) continue
      seen.add(symbol)
      const top = sym(fileOf(symbol), MODULE)
      if (!seen.has(top)) queue.push(top)
      for (const next of edges.get(symbol) ?? []) if (!seen.has(next)) queue.push(next)
    }
    return seen
  }

  const showcaseFiles = files.filter(isShowcase)
  const entries = files.filter((file) => isEntry(file) && !isShowcase(file))
  const entriesByApp = new Map<string, string[]>()
  for (const entry of entries) entriesByApp.set(appOf(entry), [...(entriesByApp.get(appOf(entry)) ?? []), entry])
  const reachedBy = new Map([...entriesByApp].map(([app, list]) => [app, reach(list, config.entryExports ?? false)]))
  const reachedByShowcases = reach(showcaseFiles, true)

  type Part = { as: string; local: string }
  const catalog = new Map<string, Part[]>()
  for (const mod of mods.values()) {
    const file = mod.file
    if (!/\.(tsx|astro)$/.test(file) || isShowcase(file) || isTest(rel(file)) || isEntry(file) || anyMatch(config.leaveOut, file)) continue
    const parts: Part[] = mod.astro
      ? [{ as: nameFromFile(file), local: ASTRO }]
      : [...mod.exports]
          .map(([as, local]) => ({ as: as === "default" ? (local === "default" ? nameFromFile(file) : local) : as, local }))
          .filter(({ as, local }) => {
            const declaration = mod.declarations.get(local)
            if (declaration?.kind !== "value" || !/^[A-Z]/.test(as)) return false
            // A function is a component whatever its name. Anything else needs a name that is not a constant's.
            return declaration.callable || (declaration.opaque && !/^[A-Z0-9_]+$/.test(as))
          })
    const unique = parts.filter((part, at) => parts.findIndex((other) => other.as === part.as && other.local === part.local) === at)
    if (unique.length) catalog.set(file, unique)
  }
  const componentOf = new Map<string, string>()
  for (const [file, parts] of catalog) for (const part of parts) componentOf.set(sym(file, part.local), file)

  const sets = () => new Map([...catalog.keys()].map((file) => [file, new Set<string>()]))
  const builtFrom = sets()
  const usedBy = sets()
  const shownIn = sets()
  const routedBy = sets()
  const referencedBy = sets()
  for (const [symbol, out] of edges) {
    const file = fileOf(symbol)
    for (const next of out) {
      const owner = componentOf.get(next)
      if (!owner || owner === file) continue
      if (isShowcase(file)) shownIn.get(owner)!.add(file)
      else if (catalog.has(file)) {
        builtFrom.get(file)!.add(owner)
        usedBy.get(owner)!.add(file)
      } else if (isEntry(file)) routedBy.get(owner)!.add(file)
      else if (!isTest(rel(file))) referencedBy.get(owner)!.add(file)
    }
  }

  // A level is one above the deepest component under it. Files that render each other share one level, so a rename cannot change it.
  const levels = new Map<string, number>()
  for (const group of components([...catalog.keys()].sort(), (file) => [...builtFrom.get(file)!].sort())) {
    const inside = new Set(group)
    let level = group.length > 1 ? 1 : 0
    for (const file of group) for (const child of builtFrom.get(file)!) if (!inside.has(child)) level = Math.max(level, 1 + levels.get(child)!)
    for (const file of group) levels.set(file, level)
  }

  const paths = (set: Set<string>) => [...set].map(rel).sort()
  const result: LedgerComponent[] = [...catalog].map(([file, parts]) => {
    const reached = (part: Part) => [...reachedBy.values()].some((seen) => seen.has(sym(file, part.local)))
    const base = path.basename(file).replace(/\.\w+$/, "")
    return {
      id: rel(file),
      name: base === "index" ? `${path.basename(path.dirname(file))}/index` : base,
      kind: file.endsWith(".astro") ? "astro" : "react",
      filed: path.dirname(rel(file)),
      parts: parts.map((part) => part.as),
      partsInApp: parts.filter(reached).map((part) => part.as),
      level: levels.get(file)!,
      apps: [...reachedBy].filter(([, seen]) => parts.some((part) => seen.has(sym(file, part.local)))).map(([app]) => app),
      inShowcase: parts.some((part) => reachedByShowcases.has(sym(file, part.local))),
      shownIn: paths(shownIn.get(file)!),
      builtFrom: paths(builtFrom.get(file)!),
      usedBy: paths(usedBy.get(file)!),
      routedBy: paths(routedBy.get(file)!),
      referencedBy: paths(referencedBy.get(file)!),
    }
  })
  result.sort((a, b) => a.id.localeCompare(b.id))

  return {
    root,
    files: files.length,
    astro: files.filter((file) => file.endsWith(".astro")).length,
    showcaseFiles: showcaseFiles.length,
    entries: entries.map(rel),
    components: result,
    failed: [...failed].map(([key, count]) => ({ import: key, count })).sort((a, b) => b.count - a.count || a.import.localeCompare(b.import)),
    unresolved: [...missed.values()].sort((a, b) => b.count - a.count || a.specifier.localeCompare(b.specifier)),
  }
}
