import fs from "node:fs"
import path from "node:path"
import type { Ledger } from "@drydock/ledger"
import { normalize, parseMarks, type Entry, type Parsed } from "./read"
import { markState, unfinished } from "./state"
import type { Mark } from "./types"

export type ClearResult = { cleared: true } | { cleared: false; reason: string }

const same = (a: Mark, b: Mark) =>
  a.mark === b.mark && normalize(a.component) === normalize(b.component) && (a.mark !== "replaces" || (b.mark === "replaces" && normalize(a.replaces) === normalize(b.replaces)))

/** The text an entry takes up: its leading comments and its comma. Removing it leaves the other entries as they were written. */
function span(source: string, parsed: Parsed, entry: Entry): [number, number] {
  const list = parsed.list!
  const elements = list.elements
  if (elements.length === 1) return [list.getStart(parsed.sf) + 1, list.end - 1]
  const next = elements[entry.index + 1]
  if (next) return [entry.node.pos, next.pos]
  const comma = /^\s*,/.exec(source.slice(entry.node.end))
  return [entry.node.pos, entry.node.end + (comma ? comma[0].length : 0)]
}

/**
 * Takes a mark out of the marks file, only when the import graph shows its work is done. It removes that entry and
 * nothing else, and puts the file back as it was if the result does not read as the same marks less that one.
 */
export function clearMark(root: string, file: string, mark: Mark, ledger: Ledger): ClearResult {
  const absolute = path.resolve(root, file)
  if (!fs.existsSync(absolute)) return { cleared: false, reason: `There is no marks file at ${file}` }
  const source = fs.readFileSync(absolute, "utf8")
  const parsed = parseMarks(source, absolute)
  const entry = parsed.entries.find((e) => same(e.mark, mark))
  if (!entry) return { cleared: false, reason: "The marks file holds no such mark" }
  const reason = unfinished(markState(entry.mark, ledger))
  if (reason) return { cleared: false, reason }

  const [start, end] = span(source, parsed, entry)
  const edited = source.slice(0, start) + source.slice(end)
  const after = parseMarks(edited, absolute)
  const expected = parsed.entries.filter((e) => e !== entry).map((e) => e.mark)
  if (edited === source || JSON.stringify(after.entries.map((e) => e.mark)) !== JSON.stringify(expected) || after.problems.length !== parsed.problems.length) {
    return { cleared: false, reason: "Removing the mark would change more of the file than the mark, so the file is left as it was" }
  }
  fs.writeFileSync(absolute, edited)
  return { cleared: true }
}
