/** A literal that a prop can take. Props made of anything else are `data`. */
export type Literal = string | boolean

/**
 * What the reader needs from a TypeScript compiler. An adapter implements these and nothing else touches the compiler,
 * so moving from one compiler version to another changes one file.
 */
export interface Compiler {
  /** The compiler's version, for the report. */
  readonly version: string
  /** Opens the project that a `tsconfig.json` describes. */
  open(tsconfig: string): Promise<Project>
  close(): Promise<void>
}

export interface Project {
  /** A function component's props, or `undefined` when the file has no function of that name. */
  component(file: string, name: string): Promise<ComponentFacts | undefined>
}

export interface ComponentFacts {
  /** The component's doc comment. */
  doc: string
  /** The string defaults in the parameter's destructuring: `{ size = "md" }`. */
  defaults: Record<string, string>
  /** The type of the first parameter. */
  props: TypeFacts
  /** The props of one member of the props type that are declared in the component's own file. */
  ownProps(shape: TypeFacts): Promise<PropFacts[]>
}

export interface TypeFacts {
  /** The members of a union in the compiler's order, or the type alone. The caller sorts them. */
  parts(): Promise<TypeFacts[]>
  /** `true` for `never` and for `undefined`, which a prop's value list leaves out. */
  isEmpty(): boolean
  /** The literal when the type is a string or boolean literal. */
  literal(): Promise<Literal | undefined>
  /** The type as written in an editor, with `| undefined` removed. */
  text(): Promise<string>
}

export interface PropFacts {
  name: string
  optional: boolean
  /** Where the prop is declared in its file. Shapes are ordered by it. */
  position: number
  doc(): Promise<string>
  type(): Promise<TypeFacts>
  /** The literals in the order the source declares them, following type aliases. Empty when the source does not list any. */
  declaredOrder(): Promise<Literal[]>
}
