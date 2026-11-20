import fs from "node:fs"
import path from "node:path"
import type { LedgerConfig } from "@drydock/ledger"

/** What Drydock needs to know about one project. Paths are from the project root unless noted. */
export type ProjectConfig = {
  /** The app's own Vite config, or its Astro config for an Astro site. The catalog loads it so pages compile the way the app does. */
  appConfig: string
  /** The stylesheets that declare tokens. */
  tokens: string[]
  /** Import specifiers for the stylesheets the app loads, resolved the way the app resolves them. */
  styles: string[]
  /** Globs of the stylesheets that the raw value scan reads. */
  rawValues: string[]
  /** What the component pages need. A project without it has a tokens page and no component pages. */
  components?: {
    /** What the ledger reads: the source folders, the entry points, the showcase files and what to leave out. */
    ledger: Omit<LedgerConfig, "root">
    /** The `tsconfig.json` the reader opens for a component, from the project root. It defaults to the nearest one above the component's file. */
    tsconfig?: string
    /** The marks file, from the project root. Its default export is a list of `parked` and `replaces` marks. */
    marks?: string
    /**
     * A module, from the project root, whose default export is a component that takes children. Every case is drawn
     * inside it, so a component finds what the app puts around it: a motion setting, a tooltip provider, a router.
     */
    wrap?: string
  }
}

export type ResolvedProject = ProjectConfig & {
  /** Absolute path of the project root. */
  root: string
}

export function defineProject(config: ProjectConfig): ProjectConfig {
  return config
}

/** Cases files draw components apart from the app, as stories do, so none of them counts as a place that uses a component. */
const CASES_FILE = /\.cases\.tsx?$/

/** Whether the project is an Astro site, which the catalog serves through Astro's own dev server. */
export const isAstro = (project: ProjectConfig) => /(^|[\\/])astro\.config\.(m?[jt]s)$/.test(project.appConfig)

/**
 * The cases file beside a component, or `null` when there is none: `X.cases.tsx`, or `X.cases.ts`, which an `.astro`
 * component's cases are written in since they are props and not JSX.
 */
export function casesFileFor(file: string): string | null {
  const base = path.join(path.dirname(file), path.basename(file).replace(/\.\w+$/, ""))
  for (const extension of [".cases.tsx", ".cases.ts"]) if (fs.existsSync(base + extension)) return base + extension
  return null
}

/** Where a project's config is: the path that was given, read from the working folder, or `drydock/config.ts` in the project. */
export function configPathFor(root: string, given?: string): string {
  return given ? path.resolve(given) : path.join(root, "drydock", "config.ts")
}

/** What the ledger reads for a project with component pages. */
export function ledgerConfig(project: ResolvedProject): LedgerConfig {
  const ledger = project.components!.ledger
  // The wrapper draws components apart from the app, as a cases file does, so it is no component and no user of one.
  const wrap = project.components!.wrap
  const wrapFile = wrap ? [new RegExp(`${path.resolve(project.root, wrap).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)] : []
  return { root: project.root, ...ledger, showcases: [...(ledger.showcases ?? []), CASES_FILE, ...wrapFile] }
}
