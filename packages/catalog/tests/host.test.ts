import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { catalogViteConfig, PAGE_ENTRIES } from "../src"

let root: string

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "drydock-host-"))
  await mkdir(path.join(root, "apps/web"), { recursive: true })
  await writeFile(path.join(root, "package.json"), '{ "type": "module" }\n')
  await writeFile(
    path.join(root, "apps/web/vite.config.ts"),
    `export default () => ({
      plugins: [{ name: "app-plugin" }],
      build: { target: ["chrome123"] },
      resolve: { dedupe: ["react"], alias: { "@app": "/src" } },
      optimizeDeps: { entries: ["index.html", ".storybook/preview.tsx"] },
    })\n`,
  )
})

afterAll(() => rm(root, { recursive: true, force: true }))

test("keeps the app's own settings and replaces optimizeDeps.entries after the merge", async () => {
  const config = await catalogViteConfig(
    { root, appConfig: "apps/web/vite.config.ts", tokens: [], styles: [], rawValues: [] },
    { command: "serve", mode: "development" },
  )
  const names = (config.plugins ?? []).flat().map((p) => (p && typeof p === "object" && "name" in p ? p.name : ""))
  expect(names).toEqual(["app-plugin", "drydock"])
  expect(config.build?.target).toEqual(["chrome123"])
  expect(config.resolve?.dedupe).toEqual(["react"])
  expect(config.optimizeDeps?.entries).toEqual(PAGE_ENTRIES)
  expect(config.root).toBe(path.join(root, "apps/web"))
})

test("keeps Vite's dependency cache in a node_modules folder under the temp folder, where an app's plugins leave files alone", async () => {
  const config = await catalogViteConfig(
    { root, appConfig: "apps/web/vite.config.ts", tokens: [], styles: [], rawValues: [] },
    { command: "serve", mode: "development" },
  )
  expect(config.cacheDir).toStartWith(os.tmpdir())
  expect(config.cacheDir).toMatch(/[\\/]node_modules[\\/]/)
})

test("watches files without the fsevents package, whatever the app's config says", async () => {
  const config = await catalogViteConfig(
    { root, appConfig: "apps/web/vite.config.ts", tokens: [], styles: [], rawValues: [] },
    { command: "serve", mode: "development" },
  )
  expect(config.server?.watch).toMatchObject({ useFsEvents: false })
})

test("fails with the path when the project names a wrapper that is not there", async () => {
  await expect(
    catalogViteConfig(
      { root, appConfig: "apps/web/vite.config.ts", tokens: [], styles: [], rawValues: [], components: { ledger: { source: [], entries: [] }, wrap: "nope/wrap.tsx" } },
      { command: "serve", mode: "development" },
    ),
  ).rejects.toThrow("nope/wrap.tsx")
})

test("fails with the path when the app config is missing", async () => {
  await expect(
    catalogViteConfig({ root, appConfig: "nope/vite.config.ts", tokens: [], styles: [], rawValues: [] }, { command: "serve", mode: "development" }),
  ).rejects.toThrow("nope/vite.config.ts")
})
