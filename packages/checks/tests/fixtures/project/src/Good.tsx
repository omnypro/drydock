/** A button with a label and the browser's own focus ring. */
export function Good({ tone = "calm", label, onPick }: { tone?: "calm" | "loud"; label: string; onPick?: () => void }) {
  return (
    <button type="button" data-tone={tone} onClick={onPick}>
      {label}
    </button>
  )
}
