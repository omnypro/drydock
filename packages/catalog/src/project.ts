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
}

export type ResolvedProject = ProjectConfig & {
  /** Absolute path of the project root. */
  root: string
}

export function defineProject(config: ProjectConfig): ProjectConfig {
  return config
}
