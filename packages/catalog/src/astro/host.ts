import { createHash } from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "vite"
import { componentService, type ComponentService } from "../components/service"
import { ASTRO_ROUTE, drydockPlugin } from "../plugin"
import { casesFileFor, type ResolvedProject } from "../project"
import { componentPageSource } from "./page"

const VIRTUAL = "virtual:drydock/astro"
const DRYDOCK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
/** The app folder's entries that stay out of the catalog's root: what Astro and the package manager write, and the output. */
const LEFT_OUT = new Set([".astro", "node_modules", "dist", ".git", ".vercel", ".netlify", ".turbo"])

/** The temp folder for one project's Astro catalog. */
const workFolder = (project: ResolvedProject) => path.join(tmpdir(), "drydock", createHash("sha1").update(project.root).digest("hex").slice(0, 12), "astro")

/**
 * The catalog's own Astro root, in the temp folder, so what Astro writes there (the `.astro` folder of generated types,
 * its caches and the build) never lands in the project, where the site's own types live. The root holds links to the
 * app folder's entries, so the site's config, public files and source are where Astro and Tailwind look for them, and
 * one `node_modules` of links to every package the app can reach, nearest first, so bare imports resolve as from the app.
 */
function makeRoot(app: string, root: string): void {
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true })
  for (const entry of fs.readdirSync(app)) if (!LEFT_OUT.has(entry)) fs.symlinkSync(path.join(app, entry), path.join(root, entry))
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
        const facts = { id: c.id, name: c.name, level: c.level, apps: c.apps, builtFrom: c.builtFrom.length, usedBy: c.usedBy.length + c.referencedBy.length }
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
  const work = workFolder(project)
  const root = path.join(work, "root")
  makeRoot(app, root)
  // An empty source folder, so none of the site's pages or content loaders run. The one page is the catalog's.
  const srcDir = path.join(root, "drydock-src")
  fs.mkdirSync(srcDir, { recursive: true })
  const page = path.join(root, "drydock-component.astro")
  fs.writeFileSync(page, componentPageSource(project.styles))
  const integration = {
    name: "drydock",
    hooks: {
      "astro:config:setup": ({ updateConfig, injectRoute }: { updateConfig: (config: object) => void; injectRoute: (route: { pattern: string; entrypoint: string }) => void }) => {
        updateConfig({ vite: { plugins: [drydockPlugin(project, service), listPlugin(project, service)] } })
        injectRoute({ pattern: `${ASTRO_ROUTE}/[...id]`, entrypoint: page })
      },
      "astro:server:done": () => service.close(),
    },
  }
  return {
    app,
    root,
    config: {
      root,
      // Astro joins the config file onto the root, so it is named from there.
      configFile: path.relative(root, appConfig),
      srcDir,
      outDir: path.join(work, "dist"),
      cacheDir: path.join(work, "cache"),
      logLevel: "warn" as const,
      // The toolbar would draw over the cases and add its own controls to the page.
      devToolbar: { enabled: false },
      integrations: [integration],
      vite: {
        cacheDir: path.join(work, "vite"),
        // Setting the allowed folders replaces Vite's default, so the catalog's own root is listed beside the project and Drydock.
        server: { fs: { allow: [root, project.root, DRYDOCK] } },
      },
    },
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
  const { app, config } = inlineConfig(project, service)
  const astro = await loadAstro(app)
  const chosen = port || (await freePort(host))
  const server = await astro.dev({ ...config, server: { port: chosen, host } })
  return {
    url: `http://${host}:${server.address.port}`,
    async close() {
      await server.stop()
      await service.close()
    },
  }
}

/** Builds the catalog's `.astro` component pages into the temp folder. A case that throws fails the build. */
export async function buildAstroCatalog(project: ResolvedProject): Promise<{ outDir: string; pages: { id: string; file: string }[] }> {
  const service = componentService(project)
  const { app, root, config } = inlineConfig(project, service)
  const astro = await loadAstro(app)
  // The build writes its prerender chunks into the working folder, and leaves them there when it fails.
  const previous = process.cwd()
  process.chdir(root)
  try {
    await astro.build(config)
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
  return { outDir: config.outDir, pages: pages.sort((a, b) => a.id.localeCompare(b.id)) }
}
