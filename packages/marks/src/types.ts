/** A component kept on purpose that the app does not render yet. Paths are from the project root. */
export type ParkedMark = {
  mark: "parked"
  component: string
  reason: string
}

/** A component that is the new version of another, while the app moves from the old one to it. */
export type ReplacesMark = {
  mark: "replaces"
  /** The new component's file. */
  component: string
  /** The old component's file. */
  replaces: string
  /** Props the new component takes under another name, by their old name: `{ loading: "pending" }`. */
  renamed?: Record<string, string>
  reason: string
}

export type Mark = ParkedMark | ReplacesMark

/** The default export of a project's marks file. An empty list means nothing is in flight. */
export type Marks = Mark[]
