/** What the ledger needs to know about a project. Every key name here is a working label. */
export type LedgerConfig = {
  /** The project root. Every path in the ledger is relative to it. */
  root: string
  /** Folders under the root to read, for example `["packages", "apps"]`. */
  source: string[]
  /** Matches the paths, from the root, of the files an app starts from. */
  entries: RegExp[]
  /**
   * `true` when every export of an entry file is a starting point, as with route files that a router runs. By default
   * only the top level of an entry runs.
   */
  entryExports?: boolean
  /** Matches the paths of files that draw components apart from the app: stories now, cases files later. */
  showcases?: RegExp[]
  /** Matches the paths of files that are not catalogued as components, such as icons and flags. */
  leaveOut?: RegExp[]
  /** Names the app a file belongs to from its path. The first capture group is the name. Defaults to `^apps/([^/]+)/`. */
  appFrom?: RegExp
}

export type LedgerComponent = {
  /** The file's path from the root. */
  id: string
  /** The file's name without its extension, or the folder's name for an `index` file. */
  name: string
  kind: "react" | "astro"
  /** The folder the file is in. */
  filed: string
  /** The components the file exports. */
  parts: string[]
  /** The parts that an app reaches. */
  partsInApp: string[]
  /** One above the deepest component under this one. Level 0 renders no other component. Components that render each other share a level. */
  level: number
  /** The apps whose entry points reach this file. */
  apps: string[]
  /** Whether a showcase file reaches any part of it. */
  inShowcase: boolean
  /** The showcase files that draw it. */
  shownIn: string[]
  builtFrom: string[]
  usedBy: string[]
  /** The entry files that render it directly. */
  routedBy: string[]
  /** Files that render it and are neither components, entries, showcases nor tests, such as a router or a lookup table of views. */
  referencedBy: string[]
}

export type Unresolved = {
  specifier: string
  /**
   * `relative` and `alias` are inside the project. `outside` resolved to a project file that `source` does not cover.
   * `package` is a bare name that no installed package answers to.
   */
  kind: "relative" | "alias" | "outside" | "package"
  count: number
  /** One file that imports it. */
  from: string
}

export type Ledger = {
  root: string
  /** The files read. */
  files: number
  /** The `.astro` files among them. */
  astro: number
  showcaseFiles: number
  entries: string[]
  components: LedgerComponent[]
  /** Named imports that the module they come from does not export, by `name from specifier`. */
  failed: { import: string; count: number }[]
  /** Imports no file answers to. Data, never an error: the ledger does not fail a build. */
  unresolved: Unresolved[]
}
