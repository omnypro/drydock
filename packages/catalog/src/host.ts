import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import { loadConfigFromFile, mergeConfig, type ConfigEnv, type UserConfig } from "vite"
import { drydockPlugin } from "./plugin"
import type { ResolvedProject } from "./project"

/** The files Vite scans for dependencies at start. Component pages add theirs here, so a cold start bundles once. */
export const PAGE_ENTRIES: string[] = []

/**
 * The project's own Vite config with the catalog added.
 * The app's plugins, aliases and build target stay as the app set them. The catalog replaces `optimizeDeps.entries`
 * after the merge, because a merge concatenates arrays and the app's list names files that are not catalog pages.
 */
export async function catalogViteConfig(project: ResolvedProject, env: ConfigEnv, overrides: UserConfig = {}): Promise<UserConfig> {
  const appConfigPath = path.resolve(project.root, project.appConfig)
  const loaded = await loadConfigFromFile(env, appConfigPath, path.dirname(appConfigPath), undefined, undefined, "runner")
  if (!loaded) throw new Error(`No Vite config found at ${appConfigPath}`)
  const appRoot = path.dirname(appConfigPath)

  const merged = mergeConfig(loaded.config, {
    root: loaded.config.root ?? appRoot,
    configFile: false,
    // Vite's dependency cache goes under the temp folder, so serving the catalog writes nothing into the project and does not share the app's cache.
    cacheDir: path.join(tmpdir(), "drydock", createHash("sha1").update(project.root).digest("hex").slice(0, 12)),
    plugins: [drydockPlugin(project)],
    server: { open: false },
  })
  merged.optimizeDeps = { ...merged.optimizeDeps, entries: PAGE_ENTRIES }
  return mergeConfig(merged, overrides)
}
