import { afterAll, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import type { ResolvedProject } from "@drydock/catalog"
import { typecheckCases } from "../src"

const projectAt = (root: string): ResolvedProject => ({
  root,
  appConfig: "vite.config.ts",
  tokens: [],
  styles: [],
  rawValues: [],
  components: { ledger: { source: ["src"], entries: [/^src\/main\.tsx$/] } },
})
const root = path.join(import.meta.dir, "fixtures", "project")
// A copy beside the fixture, so `typescript` and `@drydock/catalog` resolve from it as they do from the fixture.
const copy = path.join(import.meta.dir, "fixtures", `project-typecheck-${process.pid}`)

afterAll(() => fs.rmSync(copy, { recursive: true, force: true }))

test("lists the fixture's cases files", () => {
  const result = typecheckCases(projectAt(root))
  expect(result.files).toEqual(["src/Fragile.cases.tsx", "src/Good.cases.tsx", "src/Ringless.cases.tsx", "src/Unlabeled.cases.tsx"])
  expect(result.errors).toEqual([])
})

test("reports a type error in a cases file by its path", () => {
  fs.cpSync(root, copy, { recursive: true })
  fs.appendFileSync(path.join(copy, "src", "Good.cases.tsx"), 'const wrong: number = "text"\n')
  const { errors } = typecheckCases(projectAt(copy))
  expect(errors).toHaveLength(1)
  expect(errors[0]).toStartWith("src/Good.cases.tsx(")
  expect(errors[0]).toContain("error TS2322")
})

test("a project with no cases files has nothing to report", () => {
  expect(typecheckCases(projectAt(root), ["src/NoCases.tsx"])).toEqual({ files: [], errors: [] })
})
