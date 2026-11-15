import ts from "@typescript/typescript6"
import path from "node:path"

/** The declaration that stands for a module's top level, which runs when the module loads. */
export const MODULE = "#module"
/** The declaration that stands for an `.astro` file as a component. */
export const ASTRO = "#astro"

/** The helpers that wrap a function into a component. */
const WRAPPERS = new Set(["memo", "forwardRef", "lazy"])

export type Declaration = {
  kind: "value" | "type" | "module"
  /** Whether the declaration is a function, a class component or a wrapped function, which is what a component is. */
  callable: boolean
  /** Whether the declaration is a value whose kind the syntax does not settle: an alias, or the result of a call. A PascalCase name makes it a component. */
  opaque: boolean
  /** Names the declaration mentions, other than its own. */
  refs: Set<string>
  /** For a name that holds a whole module (`import * as ui`): the members the declaration reads, as in `ui.Card`. */
  members: Map<string, Set<string>>
  /** Names that are used as themselves and not through a member access. */
  bare: Set<string>
  /** Specifiers of `import()` calls inside it. */
  dynamic: Set<string>
}

export type Module = {
  file: string
  astro: boolean
  /** Local name to what it imports: `default`, `*` or the exported name. Type-only imports are left out. */
  imports: Map<string, { specifier: string; name: string }>
  declarations: Map<string, Declaration>
  /** Exported name to the local name it stands for. */
  exports: Map<string, string>
  reexports: { specifier: string; name: string; as: string }[]
  /** Specifiers of `export * from`. */
  stars: string[]
  /** Specifiers imported for what the module does when it loads: `import "./x"`. */
  sideEffects: string[]
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) => (ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : []).some((m) => m.kind === kind)

const emptyDeclaration = (kind: Declaration["kind"], callable = false, opaque = false): Declaration => ({ kind, callable, opaque, refs: new Set(), members: new Map(), bare: new Set(), dynamic: new Set() })

/** The component name a file gets when it exports a default: `Foo.tsx` and `foo-bar.tsx` become `Foo` and `FooBar`. */
export function nameFromFile(file: string): string {
  return path.basename(file).replace(/\.\w+$/, "").replace(/(^|[-_.[\]]+)(\w)/g, (_, __, c: string) => c.toUpperCase())
}

function unwrap(expression: ts.Expression): ts.Expression {
  let node = expression
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression
  return node
}

function calleeName(node: ts.CallExpression): string {
  const callee = node.expression
  return ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ""
}

function isCallableExpression(expression: ts.Expression | undefined): boolean {
  if (!expression) return false
  const node = unwrap(expression)
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || (ts.isCallExpression(node) && WRAPPERS.has(calleeName(node)))
}

/** Calls that make something other than a component. */
const NOT_COMPONENT_CALLS = new Set(["createContext", "createStore", "createSignal", "atom", "create", "createRef", "createElement", "cva", "clsx", "cn"])

function isOpaqueExpression(expression: ts.Expression | undefined): boolean {
  if (!expression) return false
  const node = unwrap(expression)
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isTaggedTemplateExpression(node)) return true
  return ts.isCallExpression(node) && !WRAPPERS.has(calleeName(node)) && !NOT_COMPONENT_CALLS.has(calleeName(node))
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((element) => (ts.isBindingElement(element) ? bindingNames(element.name) : []))
}

/** Each identifier inside the `{ ... }` expressions of an `.astro` template, with its member when it has one. */
function templateNames(template: string): { name: string; member?: string }[] {
  const out: { name: string; member?: string }[] = []
  for (const match of template.matchAll(/<([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g)) {
    const [, name, member] = match
    if (member || /^[A-Z]/.test(name!)) out.push({ name: name!, ...(member ? { member } : {}) })
  }
  let depth = 0
  let start = 0
  for (let i = 0; i < template.length; i++) {
    const char = template[i]
    if (char === "{") {
      if (depth === 0) start = i + 1
      depth += 1
    } else if (char === "}" && depth > 0) {
      depth -= 1
      if (depth === 0) {
        for (const match of template.slice(start, i).matchAll(/([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g)) {
          out.push({ name: match[1]!, ...(match[2] ? { member: match[2] } : {}) })
        }
      }
    }
  }
  return out
}

/** Reads what a file imports, exports and declares, and which names each declaration mentions. */
export function parseModule(file: string, source: string): Module {
  const astro = file.endsWith(".astro")
  let template = ""
  let code = source
  if (astro) {
    const frontmatter = /^﻿?\s*---\r?\n([\s\S]*?)\r?\n---/.exec(source)
    template = frontmatter ? source.slice(frontmatter[0].length) : source
    code = frontmatter?.[1] ?? ""
  }
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const mod: Module = { file, astro, imports: new Map(), declarations: new Map(), exports: new Map(), reexports: [], stars: [], sideEffects: [] }
  const top = emptyDeclaration("module")
  mod.declarations.set(MODULE, top)

  const collect = (node: ts.Node, into: Declaration, self: string | null) => {
    const visit = (n: ts.Node): void => {
      // A type position names a component without rendering it, except the base class of a class component.
      if (ts.isTypeNode(n) && !(ts.isExpressionWithTypeArguments(n) && ts.isHeritageClause(n.parent) && n.parent.token === ts.SyntaxKind.ExtendsKeyword)) return
      if (ts.isIdentifier(n)) {
        const p = n.parent
        const label =
          (ts.isPropertyAccessExpression(p) && p.name === n) ||
          (ts.isPropertyAssignment(p) && p.name === n) ||
          ts.isJsxAttribute(p) ||
          (ts.isPropertySignature(p) && p.name === n) ||
          (ts.isBindingElement(p) && p.propertyName === n)
        if (!label && n.text !== self) {
          into.refs.add(n.text)
          if (ts.isPropertyAccessExpression(p) && p.expression === n) into.members.set(n.text, (into.members.get(n.text) ?? new Set()).add(p.name.text))
          else into.bare.add(n.text)
        }
      } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
        into.dynamic.add(n.arguments[0].text)
      }
      ts.forEachChild(n, visit)
    }
    visit(node)
  }
  const declare = (name: string, node: ts.Node, exported: boolean, isDefault: boolean, callable: boolean, opaque = false) => {
    const declaration = emptyDeclaration("value", callable, opaque)
    mod.declarations.set(name, declaration)
    if (exported) mod.exports.set(isDefault ? "default" : name, name)
    collect(node, declaration, name)
  }
  const declareType = (name: string, exported: boolean) => {
    // A value and a type can share a name. The value is the one a component is.
    if (!mod.declarations.has(name)) mod.declarations.set(name, emptyDeclaration("type"))
    if (exported && !mod.exports.has(name)) mod.exports.set(name, name)
  }
  const defaultAliases: [string, string][] = []

  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      if (!ts.isStringLiteral(statement.moduleSpecifier) || clause?.isTypeOnly) continue
      const specifier = statement.moduleSpecifier.text
      const named = clause?.namedBindings
      if (!clause || (!clause.name && named && ts.isNamedImports(named) && named.elements.length === 0)) {
        mod.sideEffects.push(specifier)
        continue
      }
      if (clause.name) mod.imports.set(clause.name.text, { specifier, name: "default" })
      if (named && ts.isNamespaceImport(named)) mod.imports.set(named.name.text, { specifier, name: "*" })
      else if (named) for (const element of named.elements) if (!element.isTypeOnly) mod.imports.set(element.name.text, { specifier, name: (element.propertyName ?? element.name).text })
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue
      const specifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined
      const clause = statement.exportClause
      if (specifier) {
        if (!clause) {
          mod.stars.push(specifier)
        } else if (ts.isNamedExports(clause)) {
          for (const element of clause.elements) {
            if (!element.isTypeOnly) mod.reexports.push({ specifier, name: (element.propertyName ?? element.name).text, as: element.name.text })
          }
        } else {
          mod.reexports.push({ specifier, name: "*", as: clause.name.text })
        }
      } else if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) if (!element.isTypeOnly) mod.exports.set(element.name.text, (element.propertyName ?? element.name).text)
      }
    } else if (ts.isFunctionDeclaration(statement)) {
      declare(statement.name?.text ?? "default", statement, hasModifier(statement, ts.SyntaxKind.ExportKeyword), hasModifier(statement, ts.SyntaxKind.DefaultKeyword), true)
    } else if (ts.isClassDeclaration(statement)) {
      const base = statement.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression
      const component = !!base && /(^|\.)(Pure)?Component$/.test(base.getText(sf))
      declare(statement.name?.text ?? "default", statement, hasModifier(statement, ts.SyntaxKind.ExportKeyword), hasModifier(statement, ts.SyntaxKind.DefaultKeyword), component)
    } else if (ts.isVariableStatement(statement)) {
      const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword)
      for (const declaration of statement.declarationList.declarations) {
        const simple = ts.isIdentifier(declaration.name)
        const callable = simple && isCallableExpression(declaration.initializer)
        const opaque = simple && !callable && isOpaqueExpression(declaration.initializer)
        for (const name of bindingNames(declaration.name)) declare(name, declaration, exported, false, callable, opaque)
      }
    } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      declareType(statement.name.text, hasModifier(statement, ts.SyntaxKind.ExportKeyword))
    } else if (ts.isEnumDeclaration(statement)) {
      declare(statement.name.text, statement, hasModifier(statement, ts.SyntaxKind.ExportKeyword), false, false)
    } else if (ts.isExportAssignment(statement)) {
      const value = unwrap(statement.expression)
      declare("default", statement, true, true, isCallableExpression(value), !isCallableExpression(value) && isOpaqueExpression(value))
      if (ts.isIdentifier(value)) defaultAliases.push(["default", value.text])
    } else {
      collect(statement, top, null)
    }
  }
  // `export default Foo` is callable when `Foo` is.
  for (const [alias, target] of defaultAliases) {
    const declaration = mod.declarations.get(alias)!
    declaration.callable = mod.declarations.get(target)?.callable ?? false
    declaration.opaque = mod.declarations.get(target)?.opaque ?? false
  }

  if (astro) {
    // An .astro file is one component. Its template names what it draws, and its frontmatter runs with it.
    const declaration = emptyDeclaration("value", true)
    for (const name of top.refs) declaration.refs.add(name)
    for (const [name, members] of top.members) declaration.members.set(name, new Set(members))
    for (const name of top.bare) declaration.bare.add(name)
    for (const { name, member } of templateNames(template)) {
      if (!/^[A-Z]/.test(name) && !mod.imports.has(name) && !mod.declarations.has(name)) continue
      declaration.refs.add(name)
      if (member) declaration.members.set(name, (declaration.members.get(name) ?? new Set()).add(member))
      else declaration.bare.add(name)
    }
    for (const name of mod.declarations.keys()) {
      if (name === MODULE) continue
      declaration.refs.add(name)
      declaration.bare.add(name)
    }
    mod.declarations.set(ASTRO, declaration)
    mod.exports.set("default", ASTRO)
  }
  return mod
}
