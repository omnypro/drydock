import ts from "@typescript/typescript6"
import fs from "node:fs"
import path from "node:path"
import type { Mark } from "./types"

/** A mark and the entry in the file that holds it. */
export type Entry = { mark: Mark; node: ts.ObjectLiteralExpression; index: number }

/** The marks a file holds, the list they sit in, and what in the file could not be read as a mark. */
export type Parsed = { sf: ts.SourceFile; list: ts.ArrayLiteralExpression | undefined; entries: Entry[]; problems: string[] }

export type MarksFile = {
  /** The marks file, from the project root. */
  file: string
  exists: boolean
  marks: Mark[]
  /** What could not be read, by line. A mark with a problem is left out of `marks`. */
  problems: string[]
}

/** A path as the ledger writes it: from the project root, with forward slashes and no leading `./`. */
export const normalize = (file: string) => path.posix.normalize(file.replaceAll("\\", "/")).replace(/^\.\//, "")

const KEYS: Record<Mark["mark"], { required: string[]; optional: string[] }> = {
  parked: { required: ["component", "reason"], optional: [] },
  replaces: { required: ["component", "replaces", "reason"], optional: ["renamed"] },
}

function unwrap(expression: ts.Expression): ts.Expression {
  let node = expression
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression
  return node
}

const keyOf = (name: ts.PropertyName) => (ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined)
const textOf = (node: ts.Expression) => (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined)

/** The list the default export stands for: written in place, or a `const` of the same file. */
function exportedList(sf: ts.SourceFile): ts.Expression | undefined {
  const exported = sf.statements.find((s): s is ts.ExportAssignment => ts.isExportAssignment(s) && !s.isExportEquals)
  if (!exported) return undefined
  const value = unwrap(exported.expression)
  if (!ts.isIdentifier(value)) return value
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === value.text && declaration.initializer) return unwrap(declaration.initializer)
    }
  }
  return value
}

/**
 * Reads the marks in a marks file without running it. Every value has to be written out as a string, so the file says
 * what it holds on its face. Anything else is a problem with its line, and the rest of the file is still read.
 */
export function parseMarks(source: string, file: string): Parsed {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const line = (node: ts.Node) => `line ${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`
  const problems: string[] = []
  const value = exportedList(sf)
  if (!value) return { sf, list: undefined, entries: [], problems: ["The file has no default export"] }
  if (!ts.isArrayLiteralExpression(value)) return { sf, list: undefined, entries: [], problems: [`${line(value)}: the default export is not a list`] }

  const entries: Entry[] = []
  value.elements.forEach((element, index) => {
    if (!ts.isObjectLiteralExpression(element)) {
      problems.push(`${line(element)}: a mark is written as an object`)
      return
    }
    const fields = new Map<string, ts.Expression>()
    const wrong: string[] = []
    for (const property of element.properties) {
      const key = ts.isPropertyAssignment(property) ? keyOf(property.name) : undefined
      if (!key || !ts.isPropertyAssignment(property)) wrong.push(`${line(property)}: each field is written as \`name: value\``)
      else fields.set(key, property.initializer)
    }
    const kind = fields.get("mark") && textOf(fields.get("mark")!)
    if (kind !== "parked" && kind !== "replaces") {
      problems.push(...wrong, `${line(element)}: \`mark\` is "parked" or "replaces"`)
      return
    }
    const { required, optional } = KEYS[kind]
    for (const key of fields.keys()) if (key !== "mark" && !required.includes(key) && !optional.includes(key)) wrong.push(`${line(fields.get(key)!)}: a ${kind} mark has no \`${key}\``)
    const strings: Record<string, string> = {}
    for (const key of required) {
      const field = fields.get(key)
      const text = field && textOf(field)
      if (text === undefined) wrong.push(`${line(field ?? element)}: \`${key}\` is written as a string`)
      else strings[key] = key === "reason" ? text : normalize(text)
    }
    let renamed: Record<string, string> | undefined
    const map = fields.get("renamed")
    if (map) {
      if (!ts.isObjectLiteralExpression(map)) wrong.push(`${line(map)}: \`renamed\` is an object of old names to new ones`)
      else {
        renamed = {}
        for (const property of map.properties) {
          const key = ts.isPropertyAssignment(property) ? keyOf(property.name) : undefined
          const text = ts.isPropertyAssignment(property) ? textOf(property.initializer) : undefined
          if (key === undefined || text === undefined) wrong.push(`${line(property)}: each renamed prop is written as \`oldName: "newName"\``)
          else renamed[key] = text
        }
      }
    }
    if (wrong.length) {
      problems.push(...wrong)
      return
    }
    const mark: Mark =
      kind === "parked"
        ? { mark: "parked", component: strings.component!, reason: strings.reason! }
        : { mark: "replaces", component: strings.component!, replaces: strings.replaces!, ...(renamed ? { renamed } : {}), reason: strings.reason! }
    entries.push({ mark, node: element, index })
  })
  return { sf, list: value, entries, problems }
}

/** Reads a project's marks file. A file that does not exist holds no marks. */
export function readMarks(root: string, file: string): MarksFile {
  const absolute = path.resolve(root, file)
  if (!fs.existsSync(absolute)) return { file, exists: false, marks: [], problems: [] }
  const { entries, problems } = parseMarks(fs.readFileSync(absolute, "utf8"), absolute)
  return { file, exists: true, marks: entries.map((entry) => entry.mark), problems }
}
