import ts from "@typescript/typescript6"
import fs from "node:fs"

/** A reason as the cases file writes it. `null` when it is not written as a string, so whether it is empty cannot be told. */
type Reason = string | null

/** What a cases file says about a component, read without running it. */
export type CasesSummary = {
  /** The owed states: drawn, or waived with a reason. */
  owed: { name: string; waived?: { reason: Reason } }[]
  /** The other named cases. */
  more: string[]
  /** Props the sweep leaves alone, with the reason for each. */
  skipped: { prop: string; reason: Reason }[]
  /** The windows a page case can be drawn in. */
  windows: string[]
  /** Skips and waivers whose reason is an empty string. The reason is the project owner's to write. */
  reasonsOwed: string[]
  /** What could not be read. The rest of the file is still read. */
  problems: string[]
}

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression
  return node
}

const keyOf = (name: ts.PropertyName) => (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) ? name.text : undefined)
const textOf = (node: ts.Expression): Reason => {
  const value = unwrap(node)
  return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) ? value.text : null
}

/** The object the default export stands for: written in place, or a `const` of the same file. */
function exported(sf: ts.SourceFile): ts.Expression | undefined {
  const assignment = sf.statements.find((s): s is ts.ExportAssignment => ts.isExportAssignment(s) && !s.isExportEquals)
  if (!assignment) return undefined
  const value = unwrap(assignment.expression)
  if (!ts.isIdentifier(value)) return value
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === value.text && declaration.initializer) return unwrap(declaration.initializer)
    }
  }
  return value
}

/** The properties of an object literal, by name. Spreads and computed names are left out and reported. */
function members(object: ts.ObjectLiteralExpression, where: string, problems: string[], line: (node: ts.Node) => string): Map<string, ts.Expression | undefined> {
  const out = new Map<string, ts.Expression | undefined>()
  for (const property of object.properties) {
    const key = ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property) || ts.isMethodDeclaration(property) ? keyOf(property.name) : undefined
    if (key === undefined) {
      problems.push(`${line(property)}: an entry in ${where} that is not written as \`name: value\``)
      continue
    }
    out.set(key, ts.isPropertyAssignment(property) ? property.initializer : undefined)
  }
  return out
}

/** Reads the names in a cases file, and the skip and waive reasons, without running it. Values built by calls are fine. */
export function readCasesFile(file: string): CasesSummary {
  const summary: CasesSummary = { owed: [], more: [], skipped: [], windows: [], reasonsOwed: [], problems: [] }
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const line = (node: ts.Node) => `line ${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`
  const value = exported(sf)
  if (!value || !ts.isObjectLiteralExpression(value)) {
    summary.problems.push(value ? `${line(value)}: the default export is not written as an object` : "The file has no default export")
    return summary
  }
  const top = members(value, "the default export", summary.problems, line)
  const object = (key: string) => {
    const node = top.get(key)
    if (node === undefined) return undefined
    const inner = unwrap(node)
    if (ts.isObjectLiteralExpression(inner)) return inner
    summary.problems.push(`${line(node)}: \`${key}\` is not written as an object`)
    return undefined
  }

  const owed = object("owed")
  if (owed) {
    for (const [name, node] of members(owed, "owed", summary.problems, line)) {
      const inner = node && unwrap(node)
      if (inner && ts.isObjectLiteralExpression(inner)) {
        const waived = members(inner, name, summary.problems, line).get("waived")
        if (waived !== undefined) {
          const reason = textOf(waived)
          summary.owed.push({ name, waived: { reason } })
          if (reason === "") summary.reasonsOwed.push(`owed.${name}`)
          else if (reason === null) summary.problems.push(`${line(waived)}: the reason for waiving ${name} is not written as a string`)
          continue
        }
      }
      summary.owed.push({ name })
    }
  }
  const more = object("more")
  if (more) summary.more = [...members(more, "more", summary.problems, line).keys()]
  const windows = object("windows")
  if (windows) summary.windows = [...members(windows, "windows", summary.problems, line).keys()]
  const each = object("each")
  if (each) {
    for (const [prop, node] of members(each, "each", summary.problems, line)) {
      const inner = node && unwrap(node)
      if (!inner || !ts.isCallExpression(inner) || !ts.isIdentifier(inner.expression) || inner.expression.text !== "skip") continue
      const reason = inner.arguments[0] ? textOf(inner.arguments[0]) : ""
      summary.skipped.push({ prop, reason })
      if (reason === "") summary.reasonsOwed.push(`each.${prop}`)
      else if (reason === null) summary.problems.push(`${line(inner)}: the reason for skipping ${prop} is not written as a string`)
    }
  }
  return summary
}
