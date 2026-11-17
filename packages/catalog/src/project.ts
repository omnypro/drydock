import type { LedgerConfig } from "@drydock/ledger"

/** What Drydock needs to know about one project. Paths are from the project root unless noted. */
export type ProjectConfig = {
  /** The app's own Vite config. The catalog loads it so pages compile the way the app does. */
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
const CASES_FILE = /\.cases\.tsx$/

/** What the ledger reads for a project with component pages. */
export function ledgerConfig(project: ResolvedProject): LedgerConfig {
  const ledger = project.components!.ledger
  return { root: project.root, ...ledger, showcases: [...(ledger.showcases ?? []), CASES_FILE] }
}
