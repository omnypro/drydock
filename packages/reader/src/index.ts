import { asyncCompiler } from "./async"
import { bridgeCompiler } from "./bridge"
import type { Compiler } from "./facts"
import { readComponent } from "./read"
import type { ComponentShape } from "./types"

export type { Compiler, Literal } from "./facts"
export type { ComponentShape, PropShape } from "./types"
export { asyncCompiler, bridgeCompiler }

export type ReaderOptions = {
  /** The `tsconfig.json` that covers the component. A solution-style root config must be the referenced one. */
  tsconfig: string
  /** `async` is TypeScript 7.1. `bridge` is `@typescript/typescript6`, for as long as 7.1 is not released. */
  compiler?: "async" | "bridge"
}

export type Reader = {
  read(file: string, name: string): Promise<ComponentShape | undefined>
  close(): Promise<void>
}

export async function openReader(options: ReaderOptions): Promise<Reader> {
  const compiler: Compiler = options.compiler === "bridge" ? bridgeCompiler() : asyncCompiler()
  const project = await compiler.open(options.tsconfig)
  return {
    read: (file, name) => readComponent(project, file, name, compiler.version),
    close: () => compiler.close(),
  }
}
