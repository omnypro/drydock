import fs from "node:fs"
import path from "node:path"
import { globSync } from "tinyglobby"
import type { Ledger, LedgerComponent, LedgerConfig, Unresolved } from "./config"
import { ASTRO, MODULE, nameFromFile, parseModule, type Module } from "./parse"
import { createResolver, IGNORED, type Resolution } from "./resolve"

const NAME_SEP = "\0"
const sym = (file: string, name: string) => `${file}${NAME_SEP}${name}`
const fileOf = (symbol: string) => symbol.slice(0, symbol.indexOf(NAME_SEP))
const isComponentName = (name: string) => /^[A-Z]/.test(name) && !/^[A-Z0-9_]+$/.test(name)
const isTest = (file: string) => /\.test\.tsx?$/.test(file) || /(^|\/)tests?\//.test(file)

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

  type Hit = { file: string; name: string }
  const resolveExport = (file: string | undefined, name: string, seen = new Set<string>()): Hit | undefined => {
    if (!file) return undefined
    const key = `${file}${NAME_SEP}${name}`
    if (seen.has(key)) return undefined
    seen.add(key)
    const mod = mods.get(file)
    if (!mod) return undefined
    const local = mod.exports.get(name)
    if (local !== undefined) {
      if (mod.declarations.has(local)) return { file, name: local }
      const imported = mod.imports.get(local)
      if (imported) {
        const next = target(file, imported.specifier)
        if (imported.name === "*") return next ? { file: next, name: "*" } : undefined
        return resolveExport(next, imported.name, seen)
      }
    }
    for (const reexport of mod.reexports) {
      if (reexport.as !== name) continue
      const next = target(file, reexport.specifier)
      return reexport.name === "*" ? (next ? { file: next, name: "*" } : undefined) : resolveExport(next, reexport.name, seen)
    }
    for (const star of mod.stars) {
      const hit = resolveExport(target(file, star), name, seen)
      if (hit) return hit
    }
    return undefined
  }

  const failed = new Map<string, number>()
  const edges = new Map<string, Set<string>>()
  const everyValue = (file: string, into: Set<string>) => {
    for (const [name, declaration] of mods.get(file)!.declarations) if (declaration.kind !== "type") into.add(sym(file, name))
  }
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
          everyValue(next, out)
          continue
        }
        const hit = resolveExport(next, imported.name)
        if (!hit) {
          const key = `${imported.name} from ${imported.specifier}`
          failed.set(key, (failed.get(key) ?? 0) + 1)
          continue
        }
        if (hit.name === "*") everyValue(hit.file, out)
        else if (mods.get(hit.file)!.declarations.get(hit.name)?.kind !== "type") out.add(sym(hit.file, hit.name))
      }
      for (const specifier of declaration.dynamic) {
        const next = target(mod.file, specifier)
        if (next) everyValue(next, out)
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
          .filter(([, local]) => mod.declarations.get(local)?.kind === "value")
          .map(([as, local]) => ({ as: as === "default" ? (local === "default" ? nameFromFile(file) : local) : as, local }))
          .filter((part) => isComponentName(part.as))
    if (parts.length) catalog.set(file, parts)
  }
  const componentOf = new Map<string, string>()
  for (const [file, parts] of catalog) for (const part of parts) componentOf.set(sym(file, part.local), file)

  const sets = () => new Map([...catalog.keys()].map((file) => [file, new Set<string>()]))
  const builtFrom = sets()
  const usedBy = sets()
  const shownIn = sets()
  const routedBy = sets()
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
    }
  }

  const depth = new Map<string, number>()
  const level = (file: string, stack = new Set<string>()): number => {
    const known = depth.get(file)
    if (known !== undefined) return known
    if (stack.has(file)) return 0
    stack.add(file)
    let deepest = 0
    for (const child of builtFrom.get(file)!) deepest = Math.max(deepest, 1 + level(child, stack))
    stack.delete(file)
    depth.set(file, deepest)
    return deepest
  }

  const paths = (set: Set<string>) => [...set].map(rel).sort()
  const components: LedgerComponent[] = [...catalog].map(([file, parts]) => {
    const reached = (part: Part) => [...reachedBy.values()].some((seen) => seen.has(sym(file, part.local)))
    const base = path.basename(file).replace(/\.\w+$/, "")
    return {
      id: rel(file),
      name: base === "index" ? `${path.basename(path.dirname(file))}/index` : base,
      kind: file.endsWith(".astro") ? "astro" : "react",
      filed: path.dirname(rel(file)),
      parts: parts.map((part) => part.as),
      partsInApp: parts.filter(reached).map((part) => part.as),
      level: level(file),
      apps: [...reachedBy].filter(([, seen]) => parts.some((part) => seen.has(sym(file, part.local)))).map(([app]) => app),
      inShowcase: parts.some((part) => reachedByShowcases.has(sym(file, part.local))),
      shownIn: paths(shownIn.get(file)!),
      builtFrom: paths(builtFrom.get(file)!),
      usedBy: paths(usedBy.get(file)!),
      routedBy: paths(routedBy.get(file)!),
    }
  })
  components.sort((a, b) => a.id.localeCompare(b.id))

  return {
    root,
    files: files.length,
    astro: files.filter((file) => file.endsWith(".astro")).length,
    showcaseFiles: showcaseFiles.length,
    entries: entries.map(rel),
    components,
    failed: [...failed].map(([key, count]) => ({ import: key, count })).sort((a, b) => b.count - a.count || a.import.localeCompare(b.import)),
    unresolved: [...missed.values()].sort((a, b) => b.count - a.count || a.specifier.localeCompare(b.specifier)),
  }
}
