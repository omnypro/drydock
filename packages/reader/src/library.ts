/** The compiler's own `lib.*.d.ts` files. A type alias there (`Exclude`, `Partial`) lists no literals worth following. */
export function isDefaultLibrary(file: string): boolean {
  return /[\\/]lib\.[\w.]+\.d\.ts$/.test(file)
}

/** A file the project owns: not an installed package and not the compiler's library. */
export function isProjectFile(file: string): boolean {
  return !/[\\/]node_modules[\\/]/.test(file) && !isDefaultLibrary(file)
}
