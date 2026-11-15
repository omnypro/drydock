import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createServer, type ViteDevServer } from "vite"
import { catalogViteConfig } from "../src"
import type { TokensData } from "../src/tokens/types"

let root: string
let server: ViteDevServer
let base: string

const tokensFile = () => path.join(root, "app/src/tokens.css")
const moduleFile = () => path.join(root, "app/src/a.module.css")
const data = async () => (await (await fetch(`${base}/drydock/tokens.json`)).json()) as TokensData

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "drydock-server-"))
  await mkdir(path.join(root, "app/src"), { recursive: true })
  await writeFile(path.join(root, "app/vite.config.ts"), "export default {}\n")
  await writeFile(tokensFile(), ":root { --space-2: 0.5rem }\n")
  await writeFile(moduleFile(), ".a { padding: 8px }\n")
  const config = await catalogViteConfig(
    { root, appConfig: "app/vite.config.ts", tokens: ["app/src/tokens.css"], styles: [], rawValues: ["app/src/**/*.module.css"] },
    { command: "serve", mode: "development" },
    { server: { port: 0, host: "127.0.0.1" }, logLevel: "silent" },
  )
  server = await createServer(config)
  await server.listen()
  base = server.resolvedUrls!.local[0]!.replace(/\/$/, "")
})

afterAll(async () => {
  await server.close()
  await rm(root, { recursive: true, force: true })
})

test("serves the tokens and the raw values", async () => {
  const body = await data()
  expect(body.tokens.map((t) => t.name)).toEqual(["--space-2"])
  expect(body.raw[0]).toMatchObject({ value: "8px", token: "--space-2" })
  expect(body.unreadable).toEqual([])
})

test("keeps serving when a file does not parse, lists it, and recovers when it is fixed", async () => {
  await writeFile(moduleFile(), ".a { padding: 11px\n")
  const broken = await data()
  expect(broken.unreadable).toHaveLength(1)
  expect(broken.unreadable[0]?.file).toBe("app/src/a.module.css")
  expect(broken.tokens.map((t) => t.name)).toEqual(["--space-2"])
  expect((await fetch(`${base}/drydock/tokens`)).status).toBe(200)

  await writeFile(moduleFile(), ".a { padding: 8px }\n")
  expect((await data()).unreadable).toEqual([])
})

test("keeps serving when a file is deleted, and stops counting it", async () => {
  await rm(moduleFile())
  const body = await data()
  expect(body).toMatchObject({ scanned: 0, unreadable: [] })
  expect((await fetch(`${base}/drydock/tokens`)).status).toBe(200)
})

test("answers a path that is only like a catalog route without the data", async () => {
  for (const url of ["/drydock/tokens.json/x", "/DRYDOCK/tokens.json", "/drydock/tokens.json%00", "/drydock/"]) {
    const text = await (await fetch(`${base}${url}`)).text()
    expect(text).not.toContain("--space-2")
  }
})
