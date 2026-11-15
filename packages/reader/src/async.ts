import { API, SymbolFlags, TypeFlags, TypeFormatFlags } from "typescript/async"
import type { Project as TsProject, Symbol as TsSymbol, Type as TsType } from "typescript/async"
import { SyntaxKind } from "typescript/ast"
import type { Node } from "typescript/ast"
import { isFunctionDeclaration, isIdentifier, isLiteralTypeNode, isObjectBindingPattern, isPropertySignatureDeclaration, isStringLiteral, isTypeAliasDeclaration, isTypeReferenceNode } from "typescript/ast/is"
import { createRequire } from "node:module"
import path from "node:path"
import type { Compiler, ComponentFacts, Literal, Project, PropFacts, TypeFacts } from "./facts"
import { isDefaultLibrary } from "./library"

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
      api ??= new API()
      const config = path.resolve(tsconfig)
      const snapshot = await api.createSnapshot({ openProjects: [config] })
      const project = snapshot.getConfiguredProject(config)
      if (!project) throw new Error(`The compiler did not open ${config}`)
      return new AsyncProject(project)
    },
    async close() {
      await api?.close()
      api = undefined
    },
  }
}

class AsyncProject implements Project {
  constructor(private project: TsProject) {}

  async component(file: string, name: string): Promise<ComponentFacts | undefined> {
    const { checker, program } = this.project
    const target = path.resolve(file)
    const sf = await program.getSourceFile(target)
    const fn = sf?.statements.find((s) => isFunctionDeclaration(s) && s.name?.text === name)
    if (!sf || !fn || !isFunctionDeclaration(fn)) return undefined
    const param = fn.parameters[0]
    if (!param) throw new Error(`${name} in ${file} takes no props parameter`)

    const types = new WeakMap<TypeFacts, TsType>()
    const wrap = (type: TsType): TypeFacts => {
      const facts: TypeFacts = {
        parts: async () => (type.isUnionType() ? ((await type.getTypes()) ?? []) : [type]).map(wrap),
        isEmpty: () => Boolean(type.flags & (TypeFlags.Undefined | TypeFlags.Never)),
        literal: async () => {
          if (type.isStringLiteralType()) return type.value
          if (type.flags & TypeFlags.BooleanLiteral) return (await checker.typeToString(type)) === "true"
          return undefined
        },
        text: async () => (await checker.typeToString(type, fn, TypeFormatFlags.NoTruncation)).replace(/ \| undefined$/, ""),
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
        if (handle.path !== sf.path) continue
        const declaration = await handle.resolve()
        if (declaration && isPropertySignatureDeclaration(declaration) && declaration.type) await visit(declaration.type, 0)
      }
      return out
    }

    const symbolOfFn = fn.name ? await checker.getSymbolAtLocation(fn.name) : undefined
    const defaults: Record<string, string> = {}
    if (param.name && isObjectBindingPattern(param.name)) {
      for (const element of param.name.elements) {
        const binding = element.name
        if (element.initializer && isStringLiteral(element.initializer) && binding && isIdentifier(binding)) defaults[binding.text] = element.initializer.text
      }
    }

    return {
      doc: symbolOfFn ? await symbolOfFn.getDocumentationComment(checker) : "",
      defaults,
      props: wrap(await checker.getTypeAtLocation(param)),
      ownProps: async (shape) => {
        const type = types.get(shape)!
        const out: PropFacts[] = []
        for (const symbol of await checker.getPropertiesOfType(type)) {
          const inFile = symbol.declarations.filter((h) => h.path === sf.path)
          if (inFile.length === 0) continue
          const positions = await Promise.all(inFile.map(async (h) => (await h.resolve())?.pos ?? Number.POSITIVE_INFINITY))
          out.push({
            name: symbol.name,
            optional: Boolean(symbol.flags & SymbolFlags.Optional),
            position: Math.min(...positions),
            doc: () => symbol.getDocumentationComment(checker),
            type: async () => wrap(await checker.getTypeOfSymbolAtLocation(symbol, fn)),
            declaredOrder: () => declaredOrder(symbol),
          })
        }
        return out
      },
    }
  }
}
