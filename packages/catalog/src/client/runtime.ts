import type { Cases } from "../cases"

/** The parts of React the pages use. The project's own copy is passed in, so a case draws with the React the project runs. */
export type ReactLike = {
  createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
  isValidElement(value: unknown): boolean
  Component: new (props: unknown) => { props: { children?: unknown; fallback?: unknown }; state: unknown; setState(state: unknown): void }
}

/** What a page module puts on `window.__drydock`: the project's React, the component's module and its cases file. */
export type Runtime = {
  React: ReactLike
  createRoot(host: Element): { render(element: unknown): void }
  Module: Record<string, unknown>
  cases?: Cases<never> & Record<string, unknown>
  /** The project's wrapper, when its config names one: a component that every case is drawn inside. */
  wrap?: unknown
  /** The module of each old component that a marked new one replaces, by its file. */
  old?: Record<string, Record<string, unknown>>
  /** The module of each new component that a cases file draws and a mark says replaces another, by its file. */
  news?: Record<string, Record<string, unknown>>
}

declare global {
  interface Window {
    __drydock?: Runtime
  }
}

/** The element inside the project's wrapper, or the element alone when the project has none. */
export function wrapped(runtime: Runtime, element: unknown): unknown {
  return runtime.wrap ? runtime.React.createElement(runtime.wrap, null, element) : element
}

/** What React says when an element that can hold nothing, such as `input`, is given children. */
const VOID_CHILDREN = /is a void element tag/

/**
 * A boundary that shows a case's error in place of the case, so the rest of the page still draws.
 * A `fallback` is drawn in place of a case that threw for one reason only: it was given children it cannot hold. Children
 * guessed from a type cause that error and no other, so every other error is shown as it is.
 */
export function boundary(React: ReactLike) {
  return class Boundary extends React.Component {
    state: { thrown: boolean; error: unknown } = { thrown: false, error: null }
    static getDerivedStateFromError(error: unknown) {
      return { thrown: true, error }
    }
    render() {
      if (!this.state.thrown) return this.props.children
      // A component can throw anything: a router throws a response, and some code throws text.
      const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error)
      if (this.props.fallback !== undefined && VOID_CHILDREN.test(message)) return React.createElement(Boundary, null, this.props.fallback)
      return React.createElement("pre", { className: "error", "data-dd-error": "" }, message)
    }
  }
}
