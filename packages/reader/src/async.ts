import { API, SymbolFlags, TypeFlags, TypeFormatFlags } from "typescript/async"
import type { Project as TsProject, Symbol as TsSymbol, Type as TsType } from "typescript/async"
import { SyntaxKind } from "typescript/ast"
import type { ArrowFunction, Expression, FunctionDeclaration, FunctionExpression, Identifier, Node, SourceFile } from "typescript/ast"
import {
  isArrowFunction,
  isAsExpression,
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isLiteralTypeNode,
  isNoSubstitutionTemplateLiteral,
  isNonNullExpression,
  isNumericLiteral,
  isObjectBindingPattern,
  isParenthesizedExpression,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isPropertySignatureDeclaration,
  isSatisfiesExpression,
  isStringLiteral,
  isTypeAliasDeclaration,
  isTypeReferenceNode,
  isVariableStatement,
} from "typescript/ast/is"
import { createRequire } from "node:module"
import path from "node:path"
import type { Compiler, ComponentFacts, DefaultValue, Literal, Project, PropFacts, TypeFacts } from "./facts"
import { isDefaultLibrary, isNodeType, isProjectFile } from "./library"
import { isWrapper } from "./wrappers"

type Found = { identifier: Identifier; fn: ArrowFunction | FunctionExpression | FunctionDeclaration | undefined }

/** Finds the top-level declaration called `name`, and the function that defines it when the source writes one. */
function locate(sf: SourceFile, name: string): Found | undefined {
  for (const statement of sf.statements) {
    if (isFunctionDeclaration(statement) && statement.name?.text === name) return { identifier: statement.name, fn: statement }
    if (!isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (isIdentifier(declaration.name) && declaration.name.text === name) return { identifier: declaration.name, fn: declaration.initializer && functionOf(declaration.initializer) }
    }
  }
  return undefined
}

/** The arrow or function expression inside `memo(...)`, `forwardRef(...)`, parentheses and `as`. */
function functionOf(expression: Expression): ArrowFunction | FunctionExpression | undefined {
  let node = expression
  while (isParenthesizedExpression(node) || isAsExpression(node) || isSatisfiesExpression(node) || isNonNullExpression(node)) node = node.expression
  if (isArrowFunction(node) || isFunctionExpression(node)) return node
  if (isCallExpression(node) && isWrapper(isPropertyAccessExpression(node.expression) ? node.expression.name.text : isIdentifier(node.expression) ? node.expression.text : "")) {
    return node.arguments[0] && functionOf(node.arguments[0])
  }
  return undefined
}

function literalDefault(node: Expression): DefaultValue | undefined {
  if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) return node.text
  if (node.kind === SyntaxKind.TrueKeyword) return true
  if (node.kind === SyntaxKind.FalseKeyword) return false
  if (isNumericLiteral(node)) return Number(node.text)
  if (isPrefixUnaryExpression(node) && node.operator === SyntaxKind.MinusToken && isNumericLiteral(node.operand)) return -Number(node.operand.text)
  return undefined
}

/**
 * The reader on the TypeScript 7.1 programmatic API, through `typescript/async`. The sync entry point does not start under Bun
 * (it reads `process.stdout._handle.fd`), and the async one runs under Bun and Node alike.
 */
export function asyncCompiler(): Compiler {
  const version = createRequire(import.meta.url)("typescript/package.json").version as string
  let api: API | undefined
  return {
    version: `typescript ${version}`,
    async open(tsconfig) {
      const fresh = !api
      api ??= new API()
      const config = path.resolve(tsconfig)
      try {
        const project = new AsyncProject(api, config)
        await project.refresh()
        return project
      } catch (error) {
        // A failed open must not leave the compiler's child process running.
        if (fresh) {
          await api?.close()
          api = undefined
        }
        throw error
      }
    },
    async close() {
      await api?.close()
      api = undefined
    },
  }
}

class AsyncProject implements Project {
  private project: TsProject | undefined
  constructor(
    private api: API,
    private config: string,
  ) {}

  async refresh(): Promise<void> {
    const snapshot = await this.api.createSnapshot({ openProjects: [this.config] })
    this.project = snapshot.getConfiguredProject(this.config)
    if (!this.project) throw new Error(`The compiler did not open ${this.config}`)
  }

  async component(file: string, name: string): Promise<ComponentFacts | undefined> {
    const { checker, program } = this.project!
    const target = path.resolve(file)
    const sf = await program.getSourceFile(target)
    if (!sf) throw new Error(`${file} is not a file of ${this.config}`)
    const found = locate(sf, name)
    if (!found) return undefined
    const { identifier, fn } = found
    const signature = (await (await checker.getTypeAtLocation(identifier)).getCallSignatures())[0]
    if (!signature) return undefined
    const first = (await signature.getParameters())[0]
    const param = fn?.parameters[0]

    const types = new WeakMap<TypeFacts, TsType>()
    const wrap = (type: TsType): TypeFacts => {
      const facts: TypeFacts = {
        parts: async () => (type.isUnionType() ? ((await type.getTypes()) ?? []) : [type]).map(wrap),
        isEmpty: () => Boolean(type.flags & (TypeFlags.Undefined | TypeFlags.Never)),
        isNull: () => Boolean(type.flags & TypeFlags.Null),
        literal: async () => {
          if (type.isStringLiteralType()) return type.value
          if (type.flags & TypeFlags.BooleanLiteral) return (await checker.typeToString(type)) === "true"
          return undefined
        },
        text: async () => (await checker.typeToString(type, identifier, TypeFormatFlags.NoTruncation)).replace(/ \| undefined$/, ""),
      }
      types.set(facts, type)
      return facts
    }

    const children = (node: Node): Node[] => {
      const out: Node[] = []
      node.forEachChild((child) => {
        out.push(child)
      })
      return out
    }

    const declaredOrder = async (symbol: TsSymbol): Promise<Literal[]> => {
      const out: Literal[] = []
      const followed = new Set<string>()
      const visit = async (node: Node, depth: number): Promise<void> => {
        if (isLiteralTypeNode(node)) {
          const literal = node.literal
          if (isStringLiteral(literal)) out.push(literal.text)
          else if (literal.kind === SyntaxKind.TrueKeyword) out.push(true)
          else if (literal.kind === SyntaxKind.FalseKeyword) out.push(false)
          return
        }
        if (isTypeReferenceNode(node)) {
          let target = depth < 6 ? await checker.getSymbolAtLocation(node.typeName) : undefined
          if (target && target.flags & SymbolFlags.Alias) target = await checker.getAliasedSymbol(target)
          for (const handle of target?.declarations ?? []) {
            const key = `${handle.path}:${handle.index}`
            if (followed.has(key) || isDefaultLibrary(handle.path)) continue
            const declaration = await handle.resolve()
            if (!declaration || !isTypeAliasDeclaration(declaration)) continue
            followed.add(key)
            await visit(declaration.type, depth + 1)
          }
          for (const argument of node.typeArguments ?? []) await visit(argument, depth)
          return
        }
        for (const child of children(node)) await visit(child, depth)
      }
      for (const handle of symbol.declarations) {
        if (!isProjectFile(handle.path)) continue
        const declaration = await handle.resolve()
        if (declaration && isPropertySignatureDeclaration(declaration) && declaration.type) await visit(declaration.type, 0)
      }
      return out
    }

    const symbolOfFn = await checker.getSymbolAtLocation(identifier)
    const defaults: Record<string, DefaultValue> = {}
    if (param?.name && isObjectBindingPattern(param.name)) {
      for (const element of param.name.elements) {
        const key = element.propertyName ?? element.name
        const value = element.initializer && literalDefault(element.initializer)
        if (value !== undefined && key && (isIdentifier(key) || isStringLiteral(key))) defaults[key.text] = value
      }
    }

    return {
      doc: symbolOfFn ? await symbolOfFn.getDocumentationComment(checker) : "",
      defaults,
      props: first && wrap(await checker.getTypeOfSymbolAtLocation(first, identifier)),
      takesChildren: async (shape) => {
        const symbol = (await checker.getPropertiesOfType(types.get(shape)!)).find((s) => s.name === "children")
        if (!symbol) return false
        const type = wrap(await checker.getTypeOfSymbolAtLocation(symbol, identifier))
        return !type.isEmpty() && isNodeType(await type.text())
      },
      declaredProps: async (shape) => {
        const out: PropFacts[] = []
        for (const symbol of await checker.getPropertiesOfType(types.get(shape)!)) {
          const inProject = symbol.declarations.filter((h) => isProjectFile(h.path))
          if (inProject.length === 0) continue
          const own = inProject.some((h) => h.path === sf.path)
          const file = own ? sf.path : inProject[0]!.path
          const positions = await Promise.all(inProject.filter((h) => h.path === file).map(async (h) => (await h.resolve())?.pos ?? Number.POSITIVE_INFINITY))
          out.push({
            name: symbol.name,
            optional: Boolean(symbol.flags & SymbolFlags.Optional),
            // The compiler names files by a lowercased path on a case-insensitive disk. The source file keeps the real one.
            file: (await program.getSourceFile(file))?.fileName ?? file,
            own,
            position: Math.min(...positions),
            doc: () => symbol.getDocumentationComment(checker),
            type: async () => wrap(await checker.getTypeOfSymbolAtLocation(symbol, identifier)),
            declaredOrder: () => declaredOrder(symbol),
          })
        }
        return out
      },
    }
  }
}
