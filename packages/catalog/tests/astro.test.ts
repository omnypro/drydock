import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { startCatalog, type RunningCatalog } from "../src"
import { buildAstroCatalog } from "../src/astro/host"
import type { ResolvedProject } from "../src/project"

const site = (name: string): ResolvedProject => ({
  root: fs.realpathSync(path.join(import.meta.dir, "fixtures", name)),
  appConfig: "astro.config.mjs",
  tokens: ["src/styles/tokens.css"],
  styles: [],
  rawValues: [],
  components: { ledger: { source: ["src"], entries: [/^src\/pages\//], entryExports: true } },
})
const project = site("astro-site")
// What Astro writes when it runs from a project: its generated types, and the build.
const written = () => [".astro", "dist", "node_modules"].filter((name) => fs.existsSync(path.join(project.root, name)))

describe("the catalog on an Astro site", () => {
  let catalog: RunningCatalog
  const get = (route: string, init?: RequestInit) => fetch(`${catalog.url}${route}`, init)

  beforeAll(async () => {
    catalog = await startCatalog(project)
  }, 60_000)

  afterAll(async () => {
    await catalog.close()
  }, 30_000)

  test("lists the site's .astro components and serves its tokens", async () => {
    const index = (await (await get("/drydock/components.json")).json()) as { components: { id: string; kind: string }[] }
    expect(index.components.map((c) => [c.id, c.kind])).toEqual([
      ["src/components/Badge.astro", "astro"],
      ["src/components/Box.astro", "astro"],
    ])
    const tokens = (await (await get("/drydock/tokens.json")).json()) as { tokens: { name: string }[] }
    expect(tokens.tokens.map((t) => t.name)).toEqual(["--space-2", "--color-teal-200"])
  })

  test("sends an .astro component's page to Astro, which draws each case on the server", async () => {
    const moved = await get("/drydock/component?file=src/components/Badge.astro", { redirect: "manual" })
    expect(moved.status).toBe(302)
    expect(moved.headers.get("location")).toBe("/drydock/astro/src/components/Badge.astro")
    const page = await (await get("/drydock/astro/src/components/Badge.astro")).text()
    expect(page).toContain('<span class="badge" data-tone="calm">New</span>')
    expect(page).toContain('<span class="badge" data-tone="warm">Hot</span>')
    expect(page).toContain("A label long enough to wrap onto a second line")
    expect(page).toContain("waived: A badge always has a label")
    expect(page.match(/class="stage"/g)?.length).toBe(3)
  }, 30_000)

  test("draws a case's HTML in the default slot", async () => {
    const page = await (await get("/drydock/astro/src/components/Box.astro")).text()
    expect(page).toContain('<div class="box"><p>Inside the box</p></div>')
  }, 30_000)

  test("runs none of the site's own pages, and writes nothing into the project", async () => {
    expect((await get("/")).status).toBe(404)
    expect(written()).toEqual([])
  })

  test("builds while the dev catalog runs, each in a folder of its own", async () => {
    const built = await buildAstroCatalog(project)
    expect(built.pages).toHaveLength(2)
    built.remove()
    expect(fs.existsSync(built.outDir)).toBe(false)
    expect((await get("/drydock/astro/src/components/Badge.astro")).status).toBe(200)
  }, 120_000)

  test("gives an .astro component no page module for the browser", async () => {
    const module = await (await get(`/@fs${path.join(project.root, "src/components/__drydock__Badge.tsx")}`)).text()
    expect(module).not.toContain("window.__drydock")
  })
})

describe("the static build of an Astro site's catalog", () => {
  test("builds a page for each .astro component with a cases file, and none of the site's pages", async () => {
    const built = await buildAstroCatalog(project)
    expect(built.pages.map((p) => p.id)).toEqual(["src/components/Badge.astro", "src/components/Box.astro"])
    expect(fs.readFileSync(built.pages[0]!.file, "utf8")).toContain('data-tone="warm"')
    built.remove()
    expect(written()).toEqual([])
  }, 120_000)

  test("fails when a case throws, with the component's error", async () => {
    await expect(buildAstroCatalog(site("astro-broken"))).rejects.toThrow("A gauge cannot show 140")
    // A failed build leaves its prerender chunks in the working folder, so the build works from the catalog's temp root.
    expect(fs.existsSync(path.join(process.cwd(), ".astro"))).toBe(false)
  }, 120_000)
})
