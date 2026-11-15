import fs from "node:fs"
import path from "node:path"
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
  /**
   * The props of the component `name` in `file`. It is `undefined` when the file declares no component of that name.
   * It throws when the file is not part of the project.
   */
  read(file: string, name: string): Promise<ComponentShape | undefined>
  /** Makes the next `read` see the files as they are now. Call it after a file changes. */
  refresh(): Promise<void>
  close(): Promise<void>
}

/** The path with symlinks resolved, which is the form the compilers name files by. */
const real = (file: string) => (fs.existsSync(file) ? fs.realpathSync(file) : path.resolve(file))

export async function openReader(options: ReaderOptions): Promise<Reader> {
  const compiler: Compiler = options.compiler === "bridge" ? bridgeCompiler() : asyncCompiler()
  let project
  try {
    project = await compiler.open(real(options.tsconfig))
  } catch (error) {
    await compiler.close()
    throw error
  }
  return {
    read: (file, name) => readComponent(project, real(file), name, compiler.version),
    refresh: () => project.refresh(),
    close: () => compiler.close(),
  }
}
