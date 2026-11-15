import { afterAll, beforeAll, describe, expect, test } from "bun:test"
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

  test("lists the props in source order and leaves out the ones another file declares", () => {
    expect(shape().props.map((p) => p.name)).toEqual(["shape", "tone", "scale", "dot", "density", "label", "onPick"])
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

  test("says so when the component takes no props", async () => {
    await expect(readers[compiler].read(chip, "Plain")).rejects.toThrow("takes no props parameter")
  })
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
