import { forwardRef, memo, type FC } from "react"

type Tone = "info" | "warn" | "error"

type RowProps = {
  /** The row's tone. */
  tone?: Tone
  dense?: boolean
  label: string
}

/** An arrow function with annotated props. */
export const Arrow = ({ tone = "info", dense = false, label, rows = 3 }: RowProps & { rows?: number }) => `${tone}${dense}${label}${rows}`

/** An arrow function typed by `FC`. The props come from the annotation. */
export const Annotated: FC<RowProps> = ({ tone = "warn", dense, label }) => `${tone}${dense}${label}`

/** A function wrapped in `memo`. */
export const Memoed = memo(function Memoed({ tone, label }: RowProps) {
  return `${tone}${label}`
})

/** A function wrapped in `forwardRef`. */
export const Forwarded = forwardRef<HTMLDivElement, RowProps>(({ tone, label }, _ref) => `${tone}${label}`)

/** An arrow function that takes nothing. */
export const Nothing = () => "none"

/** An `FC` annotation with no props named. */
export const Bare: FC = () => "none"

/** The default export is a function declaration. */
export default function Defaulted({ tone = "error", label }: RowProps) {
  return `${tone}${label}`
}

/** The key is `tone`. The local name is `kind`. */
export function Renamed({ tone: kind = "info", label, depth = -2 }: RowProps & { depth?: number }) {
  return `${kind}${label}${depth}`
}

export const NotAComponent = 4
