import { expect, test } from "bun:test"
import path from "node:path"
import { configPathFor } from "../src/project"

test("a project's config defaults to drydock/config.ts under its root", () => {
  expect(configPathFor("/work/app")).toBe("/work/app/drydock/config.ts")
})

test("a config path that is given is used, read from the working folder", () => {
  expect(configPathFor("/work/app", "elsewhere/x.config.ts")).toBe(path.resolve("elsewhere/x.config.ts"))
})
