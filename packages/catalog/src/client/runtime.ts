import type { Cases } from "../cases"

/** The parts of React the pages use. The project's own copy is passed in, so a case draws with the React the project runs. */
export type ReactLike = {
  createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
  isValidElement(value: unknown): boolean
  Component: new (props: unknown) => { props: { children?: unknown; fallback?: unknown }; state: { error: Error | null }; setState(state: unknown): void }
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

/**
 * A boundary that shows a case's error in place of the case, so the rest of the page still draws.
 * Given a `fallback`, it draws that in place of a case that throws, and shows the error only when the fallback throws too.
 */
export function boundary(React: ReactLike) {
  return class Boundary extends React.Component {
    state: { error: Error | null } = { error: null }
    static getDerivedStateFromError(error: Error) {
      return { error }
    }
    render() {
      if (!this.state.error) return this.props.children
      if (this.props.fallback !== undefined) return React.createElement(Boundary, null, this.props.fallback)
      return React.createElement("pre", { className: "error", "data-dd-error": "" }, String(this.state.error.message))
    }
  }
}
