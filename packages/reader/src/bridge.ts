import ts from "@typescript/typescript6"
import path from "node:path"
import type { Compiler, ComponentFacts, Literal, Project, PropFacts, TypeFacts } from "./facts"
import { isDefaultLibrary } from "./library"

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
    const fn = sf?.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name)
    if (!sf || !fn) return undefined
    const param = fn.parameters[0]
    if (!param) throw new Error(`${name} in ${file} takes no props parameter`)

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
        text: async () => checker.typeToString(type, fn, ts.TypeFormatFlags.NoTruncation).replace(/ \| undefined$/, ""),
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

    const symbolOfFn = checker.getSymbolAtLocation(fn.name!)
    const defaults: Record<string, string> = {}
    if (ts.isObjectBindingPattern(param.name)) {
      for (const element of param.name.elements) {
        if (element.initializer && ts.isStringLiteral(element.initializer) && ts.isIdentifier(element.name)) defaults[element.name.text] = element.initializer.text
      }
    }

    return {
      doc: symbolOfFn ? ts.displayPartsToString(symbolOfFn.getDocumentationComment(checker)) : "",
      defaults,
      props: wrap(checker.getTypeAtLocation(param)),
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
              type: async () => wrap(checker.getTypeOfSymbolAtLocation(symbol, fn)),
              declaredOrder: async () => declaredOrder(inFile),
            }
          })
      },
    }
  }
}
