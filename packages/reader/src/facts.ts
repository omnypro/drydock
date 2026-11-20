/** A literal that a prop can take. Props made of anything else are `data`. */
export type Literal = string | boolean

/** A default the component's destructuring gives a prop, when the default is a literal. */
export type DefaultValue = string | boolean | number

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
  /** Forgets what the compiler has read, so the next `component` call sees the files as they are now. */
  refresh(): Promise<void>
  /**
   * A component's props, or `undefined` when the file declares nothing of that name that can be called. A declaration
   * with a function type is a component: a function, an arrow, an annotated `FC<Props>`, or `memo` and `forwardRef`
   * around one. It throws when the file is not part of the project.
   */
  component(file: string, name: string): Promise<ComponentFacts | undefined>
}

export interface ComponentFacts {
  /** The component's doc comment. */
  doc: string
  /** The literal defaults in the parameter's destructuring: `{ size = "md", dense = false }`, by prop name. */
  defaults: Record<string, DefaultValue>
  /** The type of the first parameter, or `undefined` when the component takes none. */
  props: TypeFacts | undefined
  /** The props of one member of the props type that a file of the project declares. Props that an installed package declares are left out. */
  declaredProps(shape: TypeFacts): Promise<PropFacts[]>
  /** Whether this member of the props type has a `children` prop, wherever it is declared: a native element's props count. */
  takesChildren(shape: TypeFacts): Promise<boolean>
}

export interface TypeFacts {
  /** The members of a union in the compiler's order, or the type alone. The caller sorts them. */
  parts(): Promise<TypeFacts[]>
  /** `true` for `never` and for `undefined`, which a prop's value list leaves out. */
  isEmpty(): boolean
  /** `true` for `null`, which a prop's value list leaves out and the prop's type keeps. */
  isNull(): boolean
  /** The literal when the type is a string or boolean literal. */
  literal(): Promise<Literal | undefined>
  /** The type as written in an editor, with `| undefined` removed. */
  text(): Promise<string>
}

export interface PropFacts {
  name: string
  optional: boolean
  /** The file that declares the prop: the component's own when it declares it there, else the first project file that does. */
  file: string
  /** Whether `file` is the component's own file. */
  own: boolean
  /** Where the prop is declared in `file`. Props are ordered by it. */
  position: number
  doc(): Promise<string>
  type(): Promise<TypeFacts>
  /** The literals in the order the source declares them, following type aliases. Empty when the source does not list any. */
  declaredOrder(): Promise<Literal[]>
}
