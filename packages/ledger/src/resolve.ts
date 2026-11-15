import ts from "@typescript/typescript6"
import { isBuiltin } from "node:module"
import path from "node:path"
import { globSync } from "tinyglobby"
import type { Unresolved } from "./config"

export const IGNORED = ["**/node_modules/**", "**/dist/**", "**/.astro/**", "**/.turbo/**", "**/.wrangler/**", "**/storybook-static/**", "**/_archive/**", "**/.git/**"]

const ASSET = /\.(css|scss|sass|less|svg|png|jpe?g|webp|gif|avif|ico|json|woff2?|ttf|otf|eot|mp3|mp4|webm|wav|ogg|txt|md|mdx|html|wasm)$/i
const QUERY = /\?(raw|url|inline|worker|sharedworker|no-inline)(&|$)/
const EXTENSIONS =["", ".ts", ".tsx", ".astro"]
const INDEXES = ["index.ts", "index.tsx", "index.astro"]

export type Resolution =
  | { kind: "file"; file: string }
  | { kind: "external" }
  | { kind: "unresolved"; as: Unresolved["kind"] }

export type Resolver = (specifier: string, from: string) => Resolution

type Scope = { options: ts.CompilerOptions; cache: ts.ModuleResolutionCache }

const FALLBACK: ts.CompilerOptions = { ...ts.getDefaultCompilerOptions(), module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ESNext }

/** Whether a package's `exports` map points the subpath at a stylesheet, an image or another file that is not code. */
function exportsAnAsset(specifier: string, from: string): boolean {
  const parts = specifier.split("/")
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!
  const subpath = `.${specifier.slice(name.length)}`
  for (let dir = path.dirname(from); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, "node_modules", name, "package.json")
    if (ts.sys.fileExists(manifest)) {
      let exported: unknown = (JSON.parse(ts.sys.readFile(manifest) ?? "{}") as { exports?: Record<string, unknown> }).exports?.[subpath]
      while (exported && typeof exported === "object") exported = Object.values(exported)[0]
      return typeof exported === "string" && ASSET.test(exported)
    }
    if (dir === path.dirname(dir)) return false
  }
}

/** The rank decides which config answers for a file that several configs include. */
const rank = (file: string) => (/[\\/]tsconfig\.json$/.test(file) ? 0 : /[\\/]tsconfig\.app\.json$/.test(file) ? 1 : 2)

function parseConfig(file: string): ts.ParsedCommandLine | undefined {
  const raw = ts.readConfigFile(file, ts.sys.readFile)
  if (raw.error || !raw.config) return undefined
  return ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(file), undefined, file)
}

/**
 * Resolves imports the way the project's own compiler would. Each file is resolved with the options of a
 * `tsconfig` that includes it: `paths` aliases and package `exports` need no entry of their own.
 */
export function createResolver(root: string, files: Set<string>): Resolver {
  const configs = globSync(["**/tsconfig*.json"], { cwd: root, absolute: true, ignore: IGNORED }).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  const scopes = new Map<ts.CompilerOptions, Scope>()
  const scopeOf = (options: ts.CompilerOptions): Scope => {
    let scope = scopes.get(options)
    if (!scope) {
      scope = { options, cache: ts.createModuleResolutionCache(root, (name) => name, options) }
      scopes.set(options, scope)
    }
    return scope
  }
  const byFile = new Map<string, Scope>()
  const parsed = new Map<string, ts.ParsedCommandLine | undefined>()
  for (const config of configs) {
    const result = parseConfig(config)
    parsed.set(config, result)
    if (!result) continue
    const scope = scopeOf(result.options)
    for (const name of result.fileNames) if (!byFile.has(name)) byFile.set(name, scope)
  }
  const ancestor = new Map<string, Scope>()
  const scopeFor = (file: string): Scope => {
    const known = byFile.get(file)
    if (known) return known
    for (let dir = path.dirname(file); dir.startsWith(root); dir = path.dirname(dir)) {
      const cached = ancestor.get(dir)
      if (cached) return cached
      const nearest = ["tsconfig.json", "tsconfig.app.json"].map((name) => path.join(dir, name)).find((candidate) => parsed.get(candidate))
      if (nearest) {
        const scope = scopeOf(parsed.get(nearest)!.options)
        ancestor.set(dir, scope)
        return scope
      }
      if (dir === root) break
    }
    return scopeOf(FALLBACK)
  }

  const tryFile = (base: string): string | undefined => {
    for (const extension of EXTENSIONS) if (files.has(base + extension)) return base + extension
    for (const index of INDEXES) if (files.has(path.join(base, index))) return path.join(base, index)
    return undefined
  }

  /** The `paths` mapping: the longest matching pattern wins, and each of its substitutions is tried in order. */
  const viaPaths = (specifier: string, options: ts.CompilerOptions): string | undefined => {
    const paths = options.paths
    if (!paths) return undefined
    const base = options.baseUrl ?? (options["pathsBasePath"] as string | undefined) ?? root
    const patterns = Object.keys(paths).filter((pattern) => {
      const star = pattern.indexOf("*")
      return star === -1 ? pattern === specifier : specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1)) && specifier.length >= pattern.length - 1
    })
    // An exact pattern beats a wildcard, and a longer prefix beats a shorter one.
    const weight = (pattern: string) => (pattern.includes("*") ? pattern.indexOf("*") : Number.POSITIVE_INFINITY)
    patterns.sort((a, b) => weight(b) - weight(a))
    for (const pattern of patterns) {
      const star = pattern.indexOf("*")
      const matched = star === -1 ? "" : specifier.slice(star, specifier.length - (pattern.length - star - 1))
      for (const substitution of paths[pattern]!) {
        const hit = tryFile(path.resolve(base, substitution.replace("*", matched)))
        if (hit) return hit
      }
    }
    return undefined
  }

  return (specifier, from) => {
    // A scheme (`node:`, `virtual:`) or a Vite query (`?raw`, `?url`) names something that is not a project module.
    if (/^[a-z][a-z0-9+.-]*:/i.test(specifier) || QUERY.test(specifier)) return { kind: "external" }
    const isAsset = ASSET.test(specifier.replace(/[?#].*$/, ""))
    if (specifier.startsWith(".")) {
      const hit = tryFile(path.resolve(path.dirname(from), specifier.replace(/[?#].*$/, "")))
      return hit ? { kind: "file", file: hit } : isAsset ? { kind: "external" } : { kind: "unresolved", as: "relative" }
    }
    const { options, cache } = scopeFor(from)
    const aliased = viaPaths(specifier, options)
    if (aliased) return { kind: "file", file: aliased }
    const resolved = ts.resolveModuleName(specifier, from, options, ts.sys, cache).resolvedModule
    if (resolved) {
      // The compiler flags a workspace package as external even when its link points back into the project, so the real path decides.
      const file = resolved.resolvedFileName
      if (/[\\/]node_modules[\\/]/.test(file) || /\.d\.[cm]?ts$/.test(file)) return { kind: "external" }
      if (files.has(file)) return { kind: "file", file }
      return isAsset || ASSET.test(file) ? { kind: "external" } : { kind: "unresolved", as: "outside" }
    }
    if (isAsset || isBuiltin(specifier) || exportsAnAsset(specifier, from)) return { kind: "external" }
    const aliasLike = Object.keys(options.paths ?? {}).some((pattern) => specifier.startsWith(pattern.split("*")[0]!) && pattern.split("*")[0] !== "")
    return { kind: "unresolved", as: aliasLike ? "alias" : "package" }
  }
}
