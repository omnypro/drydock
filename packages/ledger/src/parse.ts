import ts from "@typescript/typescript6"
import path from "node:path"

/** The declaration that stands for a module's top level, which runs when the module loads. */
export const MODULE = "#module"
/** The declaration that stands for an `.astro` file as a component. */
export const ASTRO = "#astro"

export type Declaration = {
  kind: "value" | "type" | "module"
  /** Names the declaration mentions, other than its own. */
  refs: Set<string>
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

/** The component name a file gets when it exports a default: `Foo.tsx` and `foo-bar.tsx` become `Foo` and `FooBar`. */
export function nameFromFile(file: string): string {
  return path.basename(file).replace(/\.\w+$/, "").replace(/(^|[-_.[\]]+)(\w)/g, (_, __, c: string) => c.toUpperCase())
}

/** Reads what a file imports, exports and declares, and which names each declaration mentions. */
export function parseModule(file: string, source: string): Module {
  const astro = file.endsWith(".astro")
  let template = ""
  let code = source
  if (astro) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)
    template = frontmatter ? source.slice(frontmatter[0].length) : source
    code = frontmatter?.[1] ?? ""
  }
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const mod: Module = { file, astro, imports: new Map(), declarations: new Map(), exports: new Map(), reexports: [], stars: [], sideEffects: [] }
  mod.declarations.set(MODULE, { kind: "module", refs: new Set(), dynamic: new Set() })

  const collect = (node: ts.Node, into: Declaration, self: string | null) => {
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) {
        const p = n.parent
        const label =
          (ts.isPropertyAccessExpression(p) && p.name === n) ||
          (ts.isPropertyAssignment(p) && p.name === n) ||
          ts.isJsxAttribute(p) ||
          (ts.isPropertySignature(p) && p.name === n) ||
          (ts.isBindingElement(p) && p.propertyName === n)
        if (!label && n.text !== self) into.refs.add(n.text)
      } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
        into.dynamic.add(n.arguments[0].text)
      }
      ts.forEachChild(n, visit)
    }
    visit(node)
  }
  const top = mod.declarations.get(MODULE)!
  const declare = (name: string, node: ts.Node, exported: boolean, isDefault: boolean) => {
    const declaration: Declaration = { kind: "value", refs: new Set(), dynamic: new Set() }
    mod.declarations.set(name, declaration)
    if (exported) mod.exports.set(isDefault ? "default" : name, name)
    collect(node, declaration, name)
  }

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
      const bindings = clause.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) mod.imports.set(bindings.name.text, { specifier, name: "*" })
      else if (bindings) for (const element of bindings.elements) if (!element.isTypeOnly) mod.imports.set(element.name.text, { specifier, name: (element.propertyName ?? element.name).text })
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
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      declare(statement.name?.text ?? "default", statement, hasModifier(statement, ts.SyntaxKind.ExportKeyword), hasModifier(statement, ts.SyntaxKind.DefaultKeyword))
    } else if (ts.isVariableStatement(statement)) {
      const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword)
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declare(declaration.name.text, declaration, exported, false)
        else collect(declaration, top, null)
      }
    } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      mod.declarations.set(statement.name.text, { kind: "type", refs: new Set(), dynamic: new Set() })
    } else if (ts.isEnumDeclaration(statement)) {
      declare(statement.name.text, statement, hasModifier(statement, ts.SyntaxKind.ExportKeyword), false)
    } else if (ts.isExportAssignment(statement)) {
      declare("default", statement, true, true)
    } else {
      collect(statement, top, null)
    }
  }

  if (astro) {
    // An .astro file is one component. Its template names what it draws, and its frontmatter runs with it.
    const declaration: Declaration = { kind: "value", refs: new Set(top.refs), dynamic: new Set() }
    for (const match of template.matchAll(/<([A-Z][A-Za-z0-9]*)/g)) declaration.refs.add(match[1]!)
    for (const match of template.matchAll(/\{[^}]*\b([A-Za-z_$][\w$]*)\b/g)) {
      if (mod.imports.has(match[1]!) || mod.declarations.has(match[1]!)) declaration.refs.add(match[1]!)
    }
    for (const name of mod.declarations.keys()) if (name !== MODULE) declaration.refs.add(name)
    mod.declarations.set(ASTRO, declaration)
    mod.exports.set("default", ASTRO)
  }
  return mod
}
