import { createHash } from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "vite"
import { componentService, type ComponentService } from "../components/service"
import { ASTRO_ROUTE, drydockPlugin, navFor } from "../plugin"
import { casesFileFor, type ResolvedProject } from "../project"
import { componentPageSource } from "./page"

const VIRTUAL = "virtual:drydock/astro"
const DRYDOCK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
/** The app folder's entries that stay out of the catalog's root: what Astro and the package manager write, and the output. */
const LEFT_OUT = new Set([".astro", "node_modules", "dist", ".git", ".vercel", ".netlify", ".turbo"])

/**
 * The temp folder for one site's Astro catalog. A project can hold several sites, so the site's config is part of the
 * name. Each run works in a folder of its own under it, so a build while the dev catalog runs leaves the dev root alone.
 */
const siteFolder = (project: ResolvedProject) =>
  path.join(tmpdir(), "drydock", createHash("sha1").update(`${project.root}\0${project.appConfig}`).digest("hex").slice(0, 12), "astro")

/**
 * The catalog's own Astro root, in the temp folder, so what Astro writes there (the `.astro` folder of generated types,
 * its caches and the build) never lands in the project, where the site's own types live. The root mirrors the project
 * root: a link to each of its entries, so every source file has a path inside the root, which Astro needs to draw a
 * component's scripts and styles. Its `node_modules` holds links to every package the app can reach, nearest first, so
 * bare imports resolve as from the app.
 */
function makeRoot(project: string, app: string, root: string): void {
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true })
  for (const entry of fs.readdirSync(project)) if (!LEFT_OUT.has(entry)) fs.symlinkSync(path.join(project, entry), path.join(root, entry))
  const modules = path.join(root, "node_modules")
  const link = (from: string, to: string) => {
    if (!fs.existsSync(to)) fs.symlinkSync(fs.realpathSync(from), to)
  }
  for (let dir = app; ; dir = path.dirname(dir)) {
    const found = path.join(dir, "node_modules")
    if (fs.existsSync(found)) {
      for (const name of fs.readdirSync(found)) {
        if (name.startsWith(".")) continue
        if (!name.startsWith("@")) {
          link(path.join(found, name), path.join(modules, name))
          continue
        }
        fs.mkdirSync(path.join(modules, name), { recursive: true })
        for (const inner of fs.readdirSync(path.join(found, name))) link(path.join(found, name, inner), path.join(modules, name, inner))
      }
    }
    if (dir === path.dirname(dir)) break
  }
}

/**
 * Gives every project file the path of its link in the mirror. Vite resolves links to real paths, and Astro reads a
 * path outside its root as one inside it, so a component's scripts and styles would not be found. Packages keep their
 * real paths, where a package manager's own layout finds their dependencies.
 */
function mirrorPlugin(real: string, root: string): Plugin {
  return {
    name: "drydock:mirror",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (source.startsWith("\0") || source.startsWith("virtual:") || source.startsWith("astro:")) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved || resolved.external || !resolved.id.startsWith(`${real}${path.sep}`)) return resolved
      const [file, query = ""] = resolved.id.split(/(?=\?)/)
      // The catalog's own page modules are names with no file behind them, and the catalog finds them by their real path.
      if (file!.includes(`${path.sep}node_modules${path.sep}`) || !fs.existsSync(file!)) return resolved
      return { ...resolved, id: path.join(root, path.relative(real, file!)) + query }
    },
  }
}

/** The virtual module the component page reads: every `.astro` component with a cases file, with a loader for each. */
function listPlugin(project: ResolvedProject, service: ComponentService): Plugin {
  const id = `\0${VIRTUAL}`
  return {
    name: "drydock:astro",
    resolveId: (source) => (source === VIRTUAL ? id : undefined),
    load(source) {
      if (source !== id) return undefined
      const entries = service.ledger().components.flatMap((c) => {
        const file = path.join(project.root, c.id)
        const cases = c.kind === "astro" ? casesFileFor(file) : null
        if (!cases) return []
        // A file the ledger lists carries its name, which the page links. One it does not list is shown as its path.
        const named = (ids: string[]) =>
          ids.map((id) => ({ id, name: service.listed(id)?.name })).sort((a, b) => Number(!a.name) - Number(!b.name) || (a.name ?? a.id).localeCompare(b.name ?? b.id))
        const facts = { id: c.id, name: c.name, level: c.level, apps: c.apps, builtFrom: named(c.builtFrom), usedBy: named([...c.usedBy, ...c.referencedBy]) }
        return [`  { ...${JSON.stringify(facts)}, component: () => import(${JSON.stringify(file)}), cases: () => import(${JSON.stringify(cases)}) },`]
      })
      return `export const components = [\n${entries.join("\n")}\n]\n`
    },
    configureServer(server) {
      // A source file that changes may add or remove a component or a cases file, so the list is read again.
      const forget = () => {
        for (const environment of Object.values(server.environments)) {
          const module = environment.moduleGraph.getModuleById(id)
          if (module) environment.moduleGraph.invalidateModule(module)
        }
      }
      for (const event of ["add", "unlink", "change"] as const) server.watcher.on(event, (file) => /\.(tsx?|astro)$/.test(file) && forget())
    },
  }
}

/** Astro, as the project installs it. */
async function loadAstro(app: string): Promise<typeof import("astro")> {
  return import(createRequire(path.join(app, "package.json")).resolve("astro"))
}

/** The inline config for the catalog's Astro root: the site's own config file, with no pages of its own and nothing written into the project. */
function inlineConfig(project: ResolvedProject, service: ComponentService) {
  const appConfig = path.resolve(project.root, project.appConfig)
  const app = path.dirname(appConfig)
  const site = siteFolder(project)
  fs.mkdirSync(site, { recursive: true })
  sweep(site)
  const run = fs.realpathSync(fs.mkdtempSync(path.join(site, "run-")))
  fs.writeFileSync(path.join(run, "pid"), String(process.pid))
  const root = path.join(run, "root")
  const real = fs.realpathSync(project.root)
  makeRoot(real, app, root)
  /** A project file's path inside the mirror. */
  const mirrored = (file: string) => path.join(root, path.relative(real, file))
  // An empty source folder, so none of the site's pages or content loaders run. The one page is the catalog's.
  const srcDir = path.join(root, "drydock-src")
  fs.mkdirSync(srcDir, { recursive: true })
  const page = path.join(root, "drydock-component.astro")
  fs.writeFileSync(page, componentPageSource(project.styles, navFor(project, service.enabled)))
  const integration = {
    name: "drydock",
    hooks: {
      "astro:config:setup": ({ updateConfig, injectRoute }: { updateConfig: (config: object) => void; injectRoute: (route: { pattern: string; entrypoint: string }) => void }) => {
        updateConfig({ vite: { plugins: [mirrorPlugin(real, root), drydockPlugin(project, service), listPlugin(project, service)] } })
        injectRoute({ pattern: `${ASTRO_ROUTE}/[...id]`, entrypoint: page })
      },
      "astro:server:done": () => service.close(),
    },
  }
  // The cases files and the catalog's own React page modules name the dependencies that a cold start would otherwise
  // find while a page loads, as the Vite host does.
  const cases = (project.components?.ledger.source ?? []).map((dir) => `${path.relative(root, path.resolve(project.root, dir)).split(path.sep).join("/")}/**/*.cases.{ts,tsx}`)
  const hasReact = (() => {
    try {
      createRequire(path.join(app, "package.json")).resolve("react")
      return true
    } catch {
      return false
    }
  })()
  return {
    app,
    root,
    run,
    config: {
      root,
      // Astro joins the config file onto the root, so it is named from there.
      configFile: path.relative(root, mirrored(appConfig)),
      srcDir,
      publicDir: mirrored(path.join(app, "public")),
      outDir: path.join(run, "dist"),
      cacheDir: path.join(run, "cache"),
      logLevel: "warn" as const,
      // The toolbar would draw over the cases and add its own controls to the page.
      devToolbar: { enabled: false },
      integrations: [integration],
      vite: {
        // Vite's dependency cache is shared by the site's runs, so a second start is warm. Vite renames new bundles into place.
        cacheDir: path.join(site, "vite"),
        optimizeDeps: { entries: cases, include: hasReact ? ["react", "react-dom/client", "react/jsx-dev-runtime"] : [] },
        // Setting the allowed folders replaces Vite's default, so the catalog's own root is listed beside the project and Drydock.
        server: { fs: { allow: [root, project.root, DRYDOCK] } },
      },
    },
  }
}

/** Removes the folders of runs whose process has ended, as a killed catalog leaves its folder behind. */
function sweep(site: string): void {
  for (const entry of fs.readdirSync(site)) {
    if (!entry.startsWith("run-")) continue
    const folder = path.join(site, entry)
    const pidFile = path.join(folder, "pid")
    let alive: boolean
    if (!fs.existsSync(pidFile)) {
      // A run writes its pid right after it makes its folder, so a young folder without one is starting, not stale.
      alive = Date.now() - fs.statSync(folder).mtimeMs < 60_000
    } else {
      const pid = Number(fs.readFileSync(pidFile, "utf8"))
      try {
        alive = pid > 0 && process.kill(pid, 0)
      } catch {
        alive = false
      }
    }
    if (!alive) fs.rmSync(folder, { recursive: true, force: true })
  }
}

/** A port nothing listens on. Astro's dev server reads port 0 as "use the default". */
function freePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once("error", reject)
    probe.listen(0, host, () => {
      const { port } = probe.address() as net.AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

/** Starts the catalog on an Astro site, on Astro's own dev server. */
export async function startAstroCatalog(project: ResolvedProject, { port = 0, host = "127.0.0.1" } = {}): Promise<{ url: string; close(): Promise<void> }> {
  const service = componentService(project)
  const { app, run, config } = inlineConfig(project, service)
  try {
    const astro = await loadAstro(app)
    const chosen = port || (await freePort(host))
    const server = await astro.dev({ ...config, server: { port: chosen, host } })
    return {
      url: `http://${host}:${server.address.port}`,
      async close() {
        await server.stop()
        await service.close()
        fs.rmSync(run, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await service.close()
    fs.rmSync(run, { recursive: true, force: true })
    throw error
  }
}

/** A built catalog: its `.astro` component pages, and `remove()` to delete the run's folder once they are read. */
export type AstroBuild = { outDir: string; pages: { id: string; file: string }[]; remove(): void }

/** Builds the catalog's `.astro` component pages into the temp folder. A case that throws fails the build. */
export async function buildAstroCatalog(project: ResolvedProject): Promise<AstroBuild> {
  const service = componentService(project)
  const { app, root, run, config } = inlineConfig(project, service)
  const remove = () => fs.rmSync(run, { recursive: true, force: true })
  // The build writes its prerender chunks into the working folder, and leaves them there when it fails.
  const previous = process.cwd()
  process.chdir(root)
  try {
    const astro = await loadAstro(app)
    await astro.build(config)
  } catch (error) {
    remove()
    throw error
  } finally {
    process.chdir(previous)
    await service.close()
  }
  const base = path.join(config.outDir, ASTRO_ROUTE.slice(1))
  const pages: { id: string; file: string }[] = []
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === "index.html") pages.push({ id: path.relative(base, path.dirname(full)), file: full })
    }
  }
  walk(base)
  return { outDir: config.outDir, pages: pages.sort((a, b) => a.id.localeCompare(b.id)), remove }
}
