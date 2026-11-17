/** A button that takes away the focus ring and puts nothing in its place. */
export function Ringless({ label }: { label: string }) {
  return (
    <button type="button" style={{ outline: "none" }}>
      {label}
    </button>
  )
}
