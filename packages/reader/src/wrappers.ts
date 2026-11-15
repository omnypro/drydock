/** The React helpers that wrap a component's function: `memo(...)` and `forwardRef(...)`, bare or on the `React` namespace. */
export function isWrapper(callee: string): boolean {
  return callee === "memo" || callee === "forwardRef"
}
