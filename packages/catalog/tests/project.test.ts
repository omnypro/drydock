import { expect, test } from "bun:test"
import path from "node:path"
import { configPathFor, ledgerConfig } from "../src/project"

test("a project's config defaults to drydock/config.ts under its root", () => {
  expect(configPathFor("/work/app")).toBe("/work/app/drydock/config.ts")
})

test("a config path that is given is used, read from the working folder", () => {
  expect(configPathFor("/work/app", "elsewhere/x.config.ts")).toBe(path.resolve("elsewhere/x.config.ts"))
})

test("counts the project's wrapper as a file that draws components apart from the app, so the ledger lists it as no component", () => {
  const config = ledgerConfig({ root: "/work/app", appConfig: "vite.config.ts", tokens: [], styles: [], rawValues: [], components: { ledger: { source: ["src"], entries: [] }, wrap: "src/app-wrap.tsx" } })
  expect(config.showcases!.some((pattern) => pattern.test("/work/app/src/app-wrap.tsx"))).toBe(true)
  expect(config.showcases!.some((pattern) => pattern.test("/work/app/src/app-wrapXtsx"))).toBe(false)
})
