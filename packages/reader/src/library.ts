/** The compiler's own `lib.*.d.ts` files. A type alias there (`Exclude`, `Partial`) lists no literals worth following. */
export function isDefaultLibrary(file: string): boolean {
  return /[\\/]lib\.[\w.]+\.d\.ts$/.test(file)
}
