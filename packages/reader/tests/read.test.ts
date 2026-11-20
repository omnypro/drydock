import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { openReader, type ComponentShape, type Reader } from "../src"
import { inDeclarationOrder } from "../src/read"

const fixtures = path.join(import.meta.dir, "fixtures")
const tsconfig = path.join(fixtures, "tsconfig.json")
const chip = path.join(fixtures, "Chip.ts")

const readers: Record<"bridge" | "async", Reader> = {} as never
const shapes: Record<string, ComponentShape> = {}

beforeAll(async () => {
  for (const compiler of ["bridge", "async"] as const) {
    readers[compiler] = await openReader({ tsconfig, compiler })
    shapes[compiler] = (await readers[compiler].read(chip, "Chip"))!
  }
}, 60_000)

afterAll(async () => {
  await Promise.all(Object.values(readers).map((reader) => reader.close()))
})

const SCALES = ["tight", "normal", "wide"]
const TONES_OF_CHIP = ["calm", "warm", "bold"]

describe.each(["bridge", "async"] as const)("%s compiler, children", (compiler) => {
  const read = async (name: string) => (await readers[compiler].read(path.join(fixtures, "children.ts"), name))!

  test("says a component takes children when only the native element's props declare them", async () => {
    const title = await read("Title")
    expect(title.takesChildren).toBe(true)
    expect(title.props.map((p) => p.name)).toEqual(["size"])
  })

  test("says a component takes children when it declares them itself", async () => {
    expect((await read("Panel")).takesChildren).toBe(true)
  })

  test("says a component takes no children when its props have none", async () => {
    expect((await read("Dot")).takesChildren).toBe(false)
  })

  test("says a component takes no children when its type forbids them", async () => {
    expect((await read("Bar")).takesChildren).toBe(false)
  })

  test("says a component takes no children when the child has to be something other than a node", async () => {
    expect((await read("Only")).takesChildren).toBe(false)
  })
})

describe.each(["bridge", "async"] as const)("%s compiler", (compiler) => {
  const shape = () => shapes[compiler]!
  const prop = (name: string) => shape().props.find((p) => p.name === name)

  test("names the compiler that read the file", () => {
    expect(shape().compiler).toContain(compiler === "bridge" ? "typescript6" : "typescript 7")
  })

  test("reads the component's doc comment and string defaults", () => {
    expect(shape().doc).toBe("A small tag for a value.")
    expect(shape().defaults).toEqual({ shape: "soft", scale: "normal" })
  })

  test("lists the component's own props in source order, then the props another project file declares", () => {
    expect(shape().props.map((p) => p.name)).toEqual(["shape", "tone", "scale", "dot", "density", "label", "onPick", "title", "id"])
  })

  test("says which file declares a prop that is not in the component's own file", () => {
    expect(shape().props.filter((p) => p.declaredIn).map((p) => [p.name, p.declaredIn])).toEqual([
      ["title", "./native.ts"],
      ["id", "./native.ts"],
    ])
    expect(prop("shape")).not.toHaveProperty("declaredIn")
  })

  test("reads union members in declaration order, through an alias and through an import", () => {
    expect(prop("tone")?.values).toEqual(TONES_OF_CHIP)
    expect(prop("scale")?.values).toEqual(SCALES)
    expect(prop("density")?.values).toEqual(["compact", "roomy", "airy"])
    expect(prop("shape")?.values).toEqual(["soft", "line", "bare"])
  })

  test("prints a union's type in the same order", () => {
    expect(prop("scale")?.type).toBe('"tight" | "normal" | "wide"')
  })

  test("reads booleans as false then true and other props as data", () => {
    expect(prop("dot")).toMatchObject({ kind: "boolean", values: [false, true] })
    expect(prop("label")).toMatchObject({ kind: "data", type: "string", values: [], optional: false })
    expect(prop("onPick")).toMatchObject({ kind: "data", optional: true })
  })

  test("reads one shape per member of the props type, in source order", () => {
    expect(shape().shapes.map((s) => s.shape)).toEqual([["soft"], ["line"], ["bare"]])
    expect(shape().shapes[1]?.tone).toEqual(["calm", "warm"])
    expect(shape().shapes[2]).not.toHaveProperty("tone")
  })

  test("carries each prop's doc comment", () => {
    expect(prop("shape")?.doc).toBe("How the chip is filled. Defaults to `soft`.")
    expect(prop("scale")?.doc).toBe("The width.")
  })

  test("returns undefined for a function that is not in the file", async () => {
    expect(await readers[compiler].read(chip, "Missing")).toBeUndefined()
  })

  test("reads a component that takes no props as one shape with no props", async () => {
    const plain = await readers[compiler].read(chip, "Plain")
    expect(plain).toMatchObject({ props: [], shapes: [{}], defaults: {} })
  })
})

const forms = path.join(fixtures, "forms.ts")
const TONES = ["info", "warn", "error"]

describe.each(["bridge", "async"] as const)("%s compiler, other ways to write a component", (compiler) => {
  const read = (name: string) => readers[compiler].read(forms, name)

  test.each(["Arrow", "Annotated", "Memoed", "Forwarded", "Defaulted", "Renamed"])("%s lists the props and their union in source order", async (name) => {
    const shape = (await read(name))!
    const tone = shape.props.find((p) => p.name === "tone")
    expect(tone).toMatchObject({ kind: "union", optional: true, values: TONES })
    expect(shape.props.find((p) => p.name === "label")).toMatchObject({ kind: "data", type: "string" })
    expect(shape.props.find((p) => p.name === "dense")).toMatchObject({ kind: "boolean", values: [false, true] })
  })

  test("reads literal defaults of every kind, by the prop's key", async () => {
    expect((await read("Arrow"))!.defaults).toEqual({ tone: "info", dense: false, rows: 3 })
    expect((await read("Annotated"))!.defaults).toEqual({ tone: "warn" })
    expect((await read("Renamed"))!.defaults).toEqual({ tone: "info", depth: -2 })
  })

  test("reads the doc comment of a declared constant", async () => {
    expect((await read("Arrow"))!.doc).toBe("An arrow function with annotated props.")
    expect((await read("Memoed"))!.doc).toBe("A function wrapped in `memo`.")
    expect((await read("Defaulted"))!.doc).toBe("The default export is a function declaration.")
  })

  test("reads props that come from an FC annotation, where the parameter has no type of its own", async () => {
    expect((await read("Annotated"))!.props.map((p) => p.name)).toEqual(["tone", "dense", "label"])
  })

  test("reads a component with no parameter as having no props", async () => {
    for (const name of ["Nothing", "Bare"]) expect(await read(name)).toMatchObject({ props: [], shapes: [{}] })
  })

  test("returns undefined for a name that is declared and is not callable", async () => {
    expect(await read("NotAComponent")).toBeUndefined()
  })
})

const shapesFile = path.join(fixtures, "shapes.ts")

describe.each(["bridge", "async"] as const)("%s compiler, props that differ between union members", (compiler) => {
  const read = async (name: string) => (await readers[compiler].read(shapesFile, name))!
  const prop = (shape: ComponentShape, name: string) => shape.props.find((p) => p.name === name)

  test("calls a prop data when any member makes it data, whichever member comes first", async () => {
    expect(prop(await read("Mixed"), "value")).toMatchObject({ kind: "data", values: [] })
    expect(prop(await read("Mixed"), "kind")).toMatchObject({ kind: "union", values: ["one", "many"] })
  })

  test("calls a prop optional when a member allows only never or undefined", async () => {
    expect(prop(await read("Linkish"), "href")).toMatchObject({ kind: "data", optional: true })
    expect(prop(await read("Linkish"), "label")).toMatchObject({ optional: false })
  })

  test("keeps the values of a union that allows null, and keeps null in its type", async () => {
    const shape = await read("Nullable")
    expect(prop(shape, "tone")).toMatchObject({ kind: "union", values: ["info", "warn"], type: '"info" | "warn" | null' })
    expect(prop(shape, "flag")).toMatchObject({ kind: "boolean", values: [false, true] })
  })

  test("says when the source order of a union was not followed", async () => {
    expect(prop(await read("ByIndex"), "size")?.ordered).toBe(false)
    expect(prop((await readers[compiler].read(chip, "Chip"))!, "tone")?.ordered).toBe(true)
  })
})

describe.each(["bridge", "async"] as const)("%s compiler, the project", (compiler) => {
  test("throws for a file that is not part of the project", async () => {
    await expect(readers[compiler].read("/nowhere/Missing.tsx", "Missing")).rejects.toThrow("is not a file of")
  })

  test("reads a changed file again after refresh and not before", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "drydock-reader-"))
    try {
      await writeFile(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, moduleResolution: "bundler", module: "ESNext", target: "ES2022" }, include: ["*.ts"] }))
      const file = path.join(dir, "C.ts")
      const source = (members: string) => `export function C(_: { tone?: ${members} }) { return 1 }\n`
      await writeFile(file, source('"a" | "b"'))
      const reader = await openReader({ tsconfig: path.join(dir, "tsconfig.json"), compiler })
      const values = async () => (await reader.read(file, "C"))!.props[0]!.values
      expect(await values()).toEqual(["a", "b"])
      await writeFile(file, source('"a" | "b" | "c"'))
      expect(await values()).toEqual(["a", "b"])
      await reader.refresh()
      expect(await values()).toEqual(["a", "b", "c"])
      await reader.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
})

test("a failed open leaves no compiler process behind", async () => {
  const run = Bun.spawn(["bun", path.join(fixtures, "failed-open.ts")], { stdout: "pipe" })
  expect((await new Response(run.stdout).text()).trim().split("\n")).toEqual(["threw", "no children"])
}, 30_000)

test("both compilers read every form the same way", async () => {
  for (const name of ["Arrow", "Annotated", "Memoed", "Forwarded", "Nothing", "Bare", "Defaulted", "Renamed"]) {
    const { compiler: _a, ...bridge } = (await readers.bridge.read(forms, name))!
    const { compiler: _b, ...async } = (await readers.async.read(forms, name))!
    expect(async).toEqual(bridge)
  }
})

test("both compilers read the same component the same way", () => {
  const { compiler: _a, ...bridge } = shapes.bridge!
  const { compiler: _b, ...async } = shapes.async!
  expect(async).toEqual(bridge)
})

describe("inDeclarationOrder", () => {
  test("follows the declared list and puts unlisted values after it, in the compiler's order", () => {
    expect(inDeclarationOrder(["bold", "calm", "x", "warm", "y"], ["calm", "warm", "bold"])).toEqual(["calm", "warm", "bold", "x", "y"])
  })

  test("puts false before true when the source lists nothing", () => {
    expect(inDeclarationOrder([true, false], [])).toEqual([false, true])
  })
})
