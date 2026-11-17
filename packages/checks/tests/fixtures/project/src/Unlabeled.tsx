/** A button with nothing in it and no name. */
export function Unlabeled({ size = "sm" }: { size?: "sm" | "lg" }) {
  return <button type="button" data-size={size} />
}
