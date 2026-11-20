import { Component, type ReactNode } from "react"

/** A wrapper with an error boundary of its own, as an app's root has. */
export default class Guarded extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <p data-part="app-error">the app's own error screen</p> : this.props.children
  }
}
