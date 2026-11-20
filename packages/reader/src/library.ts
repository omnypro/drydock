/** The compiler's own `lib.*.d.ts` files. A type alias there (`Exclude`, `Partial`) lists no literals worth following. */
export function isDefaultLibrary(file: string): boolean {
  return /[\\/]lib\.[\w.]+\.d\.ts$/.test(file)
}

/** Whether a type, as the compiler prints it, is React's node type and nothing narrower: text is a node, and it is not an element or a function. */
export function isNodeType(text: string): boolean {
  return /^(import\("react"\)\.|React\.)?ReactNode$/.test(text)
}

/** A file the project owns: not an installed package and not the compiler's library. */
export function isProjectFile(file: string): boolean {
  return !/[\\/]node_modules[\\/]/.test(file) && !isDefaultLibrary(file)
}
