/** Throws for one value of its prop. */
export function Fragile({ mode = "ok" }: { mode?: "ok" | "broken" }) {
  if (mode === "broken") throw new Error("broken mode")
  return <span>fine</span>
}
