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

test("reads the cases files of a composite project, which lists them nowhere", () => {
  fs.rmSync(copy, { recursive: true, force: true })
  fs.cpSync(root, copy, { recursive: true })
  const tsconfig = path.join(copy, "tsconfig.json")
  const config = JSON.parse(fs.readFileSync(tsconfig, "utf8")) as { compilerOptions: Record<string, unknown>; exclude?: string[] }
  fs.writeFileSync(tsconfig, JSON.stringify({ ...config, compilerOptions: { ...config.compilerOptions, composite: true }, exclude: ["src/**/*.cases.tsx"] }))
  const result = typecheckCases(projectAt(copy))
  expect(result.files).toHaveLength(4)
  expect(result.errors).toEqual([])
})

test("reports a tsconfig that cannot be read in full", () => {
  fs.rmSync(copy, { recursive: true, force: true })
  fs.cpSync(root, copy, { recursive: true })
  const tsconfig = path.join(copy, "tsconfig.json")
  const config = JSON.parse(fs.readFileSync(tsconfig, "utf8")) as Record<string, unknown>
  fs.writeFileSync(tsconfig, JSON.stringify({ ...config, extends: "./missing.json" }))
  const { errors } = typecheckCases(projectAt(copy))
  expect(errors.some((error) => error.startsWith("tsconfig.json") && error.includes("error TS"))).toBe(true)
})

test("a cases file with no tsconfig above it is an error, and is not counted as read", () => {
  const bare = typecheckCases({ ...projectAt(path.join(root, "src")), components: { ledger: { source: ["."], entries: [/^main\.tsx$/] } } })
  expect(bare.files).toEqual([])
  expect(bare.errors).toEqual(["Fragile.cases.tsx", "Good.cases.tsx", "Ringless.cases.tsx", "Unlabeled.cases.tsx"].map((file) => `${file}: no tsconfig.json above it`))
})

test("the script exits with 2 when the project has no config", () => {
  const empty = fs.mkdtempSync(path.join(import.meta.dir, "fixtures", "empty-"))
  try {
    const run = Bun.spawnSync(["bun", path.join(import.meta.dir, "../scripts/typecheck.ts"), empty], { stdout: "pipe", stderr: "pipe" })
    expect(run.exitCode).toBe(2)
  } finally {
    fs.rmSync(empty, { recursive: true, force: true })
  }
})

test("a component with no cases file has nothing to report", () => {
  expect(typecheckCases(projectAt(root), ["src/NoCases.tsx"])).toEqual({ files: [], errors: [] })
})
