import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { Ledger } from "@drydock/ledger"
import type { Mark } from "./types"

type Unlisted = {
  path: string
  onDisk: boolean
  /** For a path that is not on disk: whether git has a commit that touched it, so the file once existed. */
  inHistory?: boolean
}

type Graph = {
  /** Whether the import graph shows the work is done, so the mark can be cleared. */
  finished: boolean
  /** For `replaces`: the files that still render the old component. The handover counts down on this. */
  remaining: string[]
  /** Paths in the mark that the ledger does not list as a component, and whether a file is there. */
  unlisted: Unlisted[]
}

export type MarkState = Mark &
  Graph & {
    /** What keeps the mark from being finished, in a line, or `null` when it is finished. */
    waitingOn: string | null
  }

/** Whether git has a commit that touched the path. A path with no history may be a typo, so its absence proves nothing. */
function inHistory(root: string, file: string): boolean {
  const log = spawnSync("git", ["log", "-1", "--format=%H", "--", file], { cwd: root, encoding: "utf8" })
  return log.status === 0 && log.stdout.trim() !== ""
}

/**
 * What the import graph says about a mark.
 * A `replaces` mark is finished when the new component is one the ledger lists, and nothing renders the old one or the
 * old file is gone. A file is gone when it is not on disk and git has a record of it. A `parked` mark is finished when an
 * app renders the component.
 */
export function markState(mark: Mark, ledger: Ledger): MarkState {
  const listed = (id: string) => ledger.components.find((c) => c.id === id)
  const paths = mark.mark === "replaces" ? [mark.component, mark.replaces] : [mark.component]
  const unlisted = paths
    .filter((p) => !listed(p))
    .map((p): Unlisted => {
      const onDisk = fs.existsSync(path.join(ledger.root, p))
      const isOld = mark.mark === "replaces" && p === mark.replaces
      return onDisk || !isOld ? { path: p, onDisk } : { path: p, onDisk, inHistory: inHistory(ledger.root, p) }
    })
  let state: Mark & Graph
  if (mark.mark === "parked") state = { ...mark, finished: Boolean(listed(mark.component)?.apps.length), remaining: [], unlisted }
  else {
    const old = listed(mark.replaces)
    const remaining = old ? [...new Set([...old.usedBy, ...old.routedBy, ...old.referencedBy])].sort() : []
    const oldDone = old ? remaining.length === 0 : Boolean(unlisted.find((u) => u.path === mark.replaces)?.inHistory)
    state = { ...mark, finished: Boolean(listed(mark.component)) && oldDone, remaining, unlisted }
  }
  return { ...state, waitingOn: unfinished(state) ?? null }
}

/** Why a mark is not finished, in a line. */
export function unfinished(state: Mark & Graph): string | undefined {
  if (state.finished) return undefined
  const missing = state.unlisted.find((u) => u.path === state.component)
  if (missing) return `${missing.path} is not a component the ledger lists`
  if (state.mark === "parked") return `No app renders ${state.component} yet`
  const old = state.unlisted.find((u) => u.path === state.replaces)
  if (old?.onDisk) return `${state.replaces} is on disk, and the ledger does not list it as a component`
  if (old) return `${state.replaces} is not on disk, and git has no record of it`
  return `${state.remaining.length} ${state.remaining.length === 1 ? "file still renders" : "files still render"} ${state.replaces}: ${state.remaining.join(", ")}`
}
