import ts from "@typescript/typescript6"
import path from "node:path"
import type { Compiler, ComponentFacts, DefaultValue, Literal, Project, PropFacts, TypeFacts } from "./facts"
import { isDefaultLibrary, isProjectFile } from "./library"
import { isWrapper } from "./wrappers"

type Found = { identifier: ts.Identifier; fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | undefined }

/** Finds the top-level declaration called `name`, and the function that defines it when the source writes one. */
function locate(sf: ts.SourceFile, name: string): Found | undefined {
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return { identifier: statement.name, fn: statement }
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return { identifier: declaration.name, fn: declaration.initializer && functionOf(declaration.initializer) }
    }
  }
  return undefined
}

/** The arrow or function expression inside `memo(...)`, `forwardRef(...)`, parentheses and `as`. */
function functionOf(expression: ts.Expression): ts.ArrowFunction | ts.FunctionExpression | undefined {
  let node = expression
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node
  if (ts.isCallExpression(node) && isWrapper(ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ts.isIdentifier(node.expression) ? node.expression.text : "")) {
    return node.arguments[0] && functionOf(node.arguments[0])
  }
  return undefined
}

function literalDefault(node: ts.Expression): DefaultValue | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text)
  return undefined
}

/** The reader on `@typescript/typescript6`, the package that keeps the 6.x programmatic API available beside TypeScript 7. */
export function bridgeCompiler(): Compiler {
  return {
    version: `@typescript/typescript6 ${ts.version}`,
    async open(tsconfig) {
      const raw = ts.readConfigFile(tsconfig, ts.sys.readFile)
      if (raw.error) throw new Error(ts.flattenDiagnosticMessageText(raw.error.messageText, "\n"))
      return new BridgeProject(tsconfig, raw.config)
    },
    async close() {},
  }
}

class BridgeProject implements Project {
  private programs = new Map<string, ts.Program>()
  constructor(
    private tsconfig: string,
    private config: unknown,
  ) {}

  private program(file: string): ts.Program {
    let program = this.programs.get(file)
    if (!program) {
      const parsed = ts.parseJsonConfigFileContent({ ...(this.config as object), include: [], files: [file] }, ts.sys, path.dirname(this.tsconfig))
      program = ts.createProgram([file], parsed.options)
      this.programs.set(file, program)
    }
    return program
  }

  async component(file: string, name: string): Promise<ComponentFacts | undefined> {
    const target = path.resolve(file)
    const program = this.program(target)
    const checker = program.getTypeChecker()
    const sf = program.getSourceFile(target)
    const found = sf && locate(sf, name)
    if (!sf || !found) return undefined
    const { identifier, fn } = found
    const signature = checker.getTypeAtLocation(identifier).getCallSignatures()[0]
    if (!signature) throw new Error(`${name} in ${file} is not callable, so it is not a component the reader can read`)
    const first = signature.getParameters()[0]
    const param = fn?.parameters[0]

    const types = new WeakMap<TypeFacts, ts.Type>()
    const wrap = (type: ts.Type): TypeFacts => {
      const facts: TypeFacts = {
        parts: async () => (type.isUnion() ? type.types : [type]).map(wrap),
        isEmpty: () => Boolean(type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Never)),
        literal: async () => {
          if (type.isStringLiteral()) return type.value
          if (type.flags & ts.TypeFlags.BooleanLiteral) return checker.typeToString(type) === "true"
          return undefined
        },
        text: async () => checker.typeToString(type, identifier, ts.TypeFormatFlags.NoTruncation).replace(/ \| undefined$/, ""),
      }
      types.set(facts, type)
      return facts
    }

    const declaredOrder = (declarations: readonly ts.Declaration[]): Literal[] => {
      const out: Literal[] = []
      const followed = new Set<ts.Node>()
      const visit = (node: ts.Node, depth: number): void => {
        if (ts.isLiteralTypeNode(node)) {
          const literal = node.literal
          if (ts.isStringLiteral(literal)) out.push(literal.text)
          else if (literal.kind === ts.SyntaxKind.TrueKeyword) out.push(true)
          else if (literal.kind === ts.SyntaxKind.FalseKeyword) out.push(false)
          return
        }
        if (ts.isTypeReferenceNode(node)) {
          let symbol = depth < 6 ? checker.getSymbolAtLocation(node.typeName) : undefined
          if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
          for (const declaration of symbol?.declarations ?? []) {
            if (!ts.isTypeAliasDeclaration(declaration) || followed.has(declaration) || isDefaultLibrary(declaration.getSourceFile().fileName)) continue
            followed.add(declaration)
            visit(declaration.type, depth + 1)
          }
          for (const argument of node.typeArguments ?? []) visit(argument, depth)
          return
        }
        ts.forEachChild(node, (child) => visit(child, depth))
      }
      for (const declaration of declarations) if (ts.isPropertySignature(declaration) && declaration.type) visit(declaration.type, 0)
      return out
    }

    const symbolOfFn = checker.getSymbolAtLocation(identifier)
    const defaults: Record<string, DefaultValue> = {}
    if (param && ts.isObjectBindingPattern(param.name)) {
      for (const element of param.name.elements) {
        const key = element.propertyName ?? element.name
        const value = element.initializer && literalDefault(element.initializer)
        if (value !== undefined && (ts.isIdentifier(key) || ts.isStringLiteral(key))) defaults[key.text] = value
      }
    }

    return {
      doc: symbolOfFn ? ts.displayPartsToString(symbolOfFn.getDocumentationComment(checker)) : "",
      defaults,
      props: first && wrap(checker.getTypeOfSymbolAtLocation(first, identifier)),
      ownProps: async (shape) => {
        const type = types.get(shape)!
        const own = (symbol: ts.Symbol) => (symbol.declarations ?? []).some((d) => d.getSourceFile() === sf)
        return checker
          .getPropertiesOfType(type)
          .filter(own)
          .map((symbol): PropFacts => {
            const inFile = (symbol.declarations ?? []).filter((d) => d.getSourceFile() === sf)
            return {
              name: symbol.name,
              optional: Boolean(symbol.flags & ts.SymbolFlags.Optional),
              position: Math.min(...inFile.map((d) => d.pos)),
              doc: async () => ts.displayPartsToString(symbol.getDocumentationComment(checker)),
              type: async () => wrap(checker.getTypeOfSymbolAtLocation(symbol, identifier)),
              declaredOrder: async () => declaredOrder(inFile),
            }
          })
      },
      projectProps: async (shape) =>
        checker
          .getPropertiesOfType(types.get(shape)!)
          .filter((symbol) => (symbol.declarations ?? []).every((d) => d.getSourceFile() !== sf) && (symbol.declarations ?? []).some((d) => isProjectFile(d.getSourceFile().fileName)))
          .map((symbol) => symbol.name),
    }
  }
}
