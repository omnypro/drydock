import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { deriveLedger } from "@drydock/ledger"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { clearMark, markState, readMarks, unfinished, type Mark } from "../src"
import { parseMarks } from "../src/read"

let root: string
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), text)
}
const ledger = () => deriveLedger({ root, source: ["src"], entries: [/^src\/main\.tsx$/] })
/** Commits the fixture, unsigned and under a throwaway name, so git has a record of its files. */
const commitAll = () => {
  for (const args of [["init", "-q"], ["add", "."], ["-c", "commit.gpgsign=false", "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "-m", "fixture"]]) {
    const run = Bun.spawnSync(["git", ...args], { cwd: root })
    if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`)
  }
}
const marksText = () => fs.readFileSync(path.join(root, "marks.ts"), "utf8")

const replaces: Mark = { mark: "replaces", component: "src/New.tsx", replaces: "src/Old.tsx", reason: "" }
const parked: Mark = { mark: "parked", component: "src/Shelf.tsx", reason: "Waiting on the settings page." }

const MARKS = `import type { Marks } from "@drydock/marks"

export default [
  // The new one has the pending state.
  {
    mark: "replaces",
    component: "src/New.tsx",
    replaces: "src/Old.tsx",
    renamed: { loading: "pending" },
    reason: "",
  },
  { mark: "parked", component: "src/Shelf.tsx", reason: "Waiting on the settings page." },
] satisfies Marks
`

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "drydock-marks-")))
  write("src/main.tsx", `import { Page } from "./Page"\nconsole.log(Page)\n`)
  write("src/Page.tsx", `import { Old } from "./Old"\nexport function Page() {\n  return <Old />\n}\n`)
  write("src/Old.tsx", `export function Old({ loading }: { loading?: boolean }) {\n  return <i>{String(loading)}</i>\n}\n`)
  write("src/New.tsx", `export function New({ pending }: { pending?: boolean }) {\n  return <b>{String(pending)}</b>\n}\n`)
  write("src/Shelf.tsx", `export function Shelf() {\n  return <hr />\n}\n`)
  write("src/util.ts", `export const twice = (n: number) => n * 2\n`)
  write("marks.ts", MARKS)
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe("reading the marks file", () => {
  test("reads both kinds of mark, with a renamed map and the reason as written", () => {
    expect(readMarks(root, "marks.ts")).toEqual({
      file: "marks.ts",
      exists: true,
      marks: [{ ...replaces, renamed: { loading: "pending" } }, parked],
      problems: [],
    })
  })

  test("reads a list held in a const, and paths written with ./", () => {
    const { entries, problems } = parseMarks(`const marks = [{ mark: "parked", component: "./src/Shelf.tsx", reason: "" }]\nexport default marks\n`, "m.ts")
    expect(problems).toEqual([])
    expect(entries.map((e) => e.mark)).toEqual([{ mark: "parked", component: "src/Shelf.tsx", reason: "" }])
  })

  test("holds no marks when there is no file", () => {
    expect(readMarks(root, "nowhere.ts")).toEqual({ file: "nowhere.ts", exists: false, marks: [], problems: [] })
  })

  test("leaves out a mark it cannot read and names the line, and reads the rest", () => {
    const { entries, problems } = parseMarks(
      [
        "export default [",
        `  { mark: "moved", component: "a.tsx", reason: "" },`,
        `  { mark: "parked", component: "a.tsx" },`,
        `  { mark: "parked", component: path, reason: "" },`,
        `  { mark: "parked", component: "a.tsx", reason: "", replaces: "b.tsx" },`,
        `  { mark: "replaces", component: "a.tsx", replaces: "b.tsx", renamed: { x: 1 }, reason: "" },`,
        `  "a.tsx",`,
        `  { mark: "parked", component: "c.tsx", reason: "" },`,
        "]",
      ].join("\n"),
      "m.ts",
    )
    expect(problems).toEqual([
      'line 2: `mark` is "parked" or "replaces"',
      "line 3: `reason` is written as a string",
      "line 4: `component` is written as a string",
      "line 5: a parked mark has no `replaces`",
      'line 6: each renamed prop is written as `oldName: "newName"`',
      "line 7: a mark is written as an object",
    ])
    expect(entries.map((e) => e.mark)).toEqual([{ mark: "parked", component: "c.tsx", reason: "" }])
  })

  test("says so when the default export is missing or is not a list", () => {
    expect(parseMarks("export const marks = []\n", "m.ts").problems).toEqual(["The file has no default export"])
    expect(parseMarks("export default { marks: [] }\n", "m.ts").problems).toEqual(["line 1: the default export is not a list"])
  })
})

describe("what the import graph says about a mark", () => {
  test("counts the files that still render the old component", () => {
    const state = markState(replaces, ledger())
    expect(state).toMatchObject({ finished: false, remaining: ["src/Page.tsx"], unlisted: [] })
    expect(unfinished(state)).toBe("1 file still renders src/Old.tsx: src/Page.tsx")
  })

  test("is finished when nothing renders the old component", () => {
    write("src/Page.tsx", `import { New } from "./New"\nexport function Page() {\n  return <New />\n}\n`)
    expect(markState(replaces, ledger())).toMatchObject({ finished: true, remaining: [] })
  })

  test("is finished when the old file is gone, which git has a record of", () => {
    commitAll()
    write("src/Page.tsx", `import { New } from "./New"\nexport function Page() {\n  return <New />\n}\n`)
    fs.rmSync(path.join(root, "src/Old.tsx"))
    expect(markState(replaces, ledger())).toMatchObject({ finished: true, remaining: [], unlisted: [{ path: "src/Old.tsx", onDisk: false, inHistory: true }] })
  })

  test("is not finished when the old path is not on disk and git has no record of it, as with a typo", () => {
    commitAll()
    const state = markState({ ...replaces, replaces: "src/Olde.tsx" }, ledger())
    expect(state).toMatchObject({ finished: false, unlisted: [{ path: "src/Olde.tsx", onDisk: false, inHistory: false }] })
    expect(state.waitingOn).toBe("src/Olde.tsx is not on disk, and git has no record of it")
    const typo = `export default [{ mark: "replaces", component: "src/New.tsx", replaces: "src/Olde.tsx", reason: "Bryan's reason." }]\n`
    write("marks.ts", typo)
    expect(clearMark(root, "marks.ts", { ...replaces, replaces: "src/Olde.tsx" }, ledger())).toEqual({ cleared: false, reason: "src/Olde.tsx is not on disk, and git has no record of it" })
    expect(marksText()).toBe(typo)
  })

  test("is not finished when the old file is gone from a folder that is not a git repository", () => {
    fs.rmSync(path.join(root, "src/Old.tsx"))
    expect(markState(replaces, ledger())).toMatchObject({ finished: false, waitingOn: "src/Old.tsx is not on disk, and git has no record of it" })
  })

  test("is not finished when the old path is a file the ledger does not list as a component", () => {
    const state = markState({ ...replaces, replaces: "src/util.ts" }, ledger())
    expect(state).toMatchObject({ finished: false, unlisted: [{ path: "src/util.ts", onDisk: true }] })
    expect(unfinished(state)).toBe("src/util.ts is on disk, and the ledger does not list it as a component")
  })

  test("is not finished when the new component is not one the ledger lists", () => {
    write("src/Page.tsx", `export function Page() {\n  return <p />\n}\n`)
    const state = markState({ ...replaces, component: "src/Gone.tsx" }, ledger())
    expect(state.finished).toBe(false)
    expect(unfinished(state)).toBe("src/Gone.tsx is not a component the ledger lists")
  })

  test("finishes a parked mark once an app renders the component", () => {
    expect(unfinished(markState(parked, ledger()))).toBe("No app renders src/Shelf.tsx yet")
    write("src/main.tsx", `import { Page } from "./Page"\nimport { Shelf } from "./Shelf"\nconsole.log(Page, Shelf)\n`)
    expect(markState(parked, ledger()).finished).toBe(true)
  })
})

describe("clearing a mark", () => {
  test("refuses while a file still renders the old component, and leaves the file as it was", () => {
    expect(clearMark(root, "marks.ts", replaces, ledger())).toEqual({ cleared: false, reason: "1 file still renders src/Old.tsx: src/Page.tsx" })
    expect(marksText()).toBe(MARKS)
  })

  test("removes only that mark, with its comment, once nothing renders the old component", () => {
    write("src/Page.tsx", `import { New } from "./New"\nexport function Page() {\n  return <New />\n}\n`)
    expect(clearMark(root, "marks.ts", replaces, ledger())).toEqual({ cleared: true })
    expect(marksText()).toBe(`import type { Marks } from "@drydock/marks"

export default [
  { mark: "parked", component: "src/Shelf.tsx", reason: "Waiting on the settings page." },
] satisfies Marks
`)
  })

  test("leaves an empty list when it clears the last mark", () => {
    write("marks.ts", `export default [\n  { mark: "parked", component: "src/Shelf.tsx", reason: "" },\n]\n`)
    write("src/main.tsx", `import { Shelf } from "./Shelf"\nconsole.log(Shelf)\n`)
    expect(clearMark(root, "marks.ts", { ...parked, reason: "" }, ledger())).toEqual({ cleared: true })
    expect(marksText()).toBe("export default []\n")
  })

  test("removes the last entry of several, with no comma after it", () => {
    write("marks.ts", `export default [\n  { mark: "parked", component: "src/Old.tsx", reason: "" },\n  { mark: "parked", component: "src/Shelf.tsx", reason: "" }\n]\n`)
    write("src/main.tsx", `import { Shelf } from "./Shelf"\nconsole.log(Shelf)\n`)
    expect(clearMark(root, "marks.ts", { ...parked, reason: "" }, ledger())).toEqual({ cleared: true })
    expect(marksText()).toBe(`export default [\n  { mark: "parked", component: "src/Old.tsx", reason: "" },\n]\n`)
  })

  test("refuses a mark the file does not hold", () => {
    expect(clearMark(root, "marks.ts", { ...parked, component: "src/Other.tsx" }, ledger())).toEqual({ cleared: false, reason: "The marks file holds no such mark" })
    expect(marksText()).toBe(MARKS)
  })
})
