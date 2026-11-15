import css from "./catalog.css?inline"
import { h, type Child } from "./dom"
import { grid } from "../generate/grid"
import { sweep } from "../generate/sweep"
import { compose, type Props } from "../generate/valid"
import type { Cases } from "../cases"
import type { ComponentIndex, ComponentPage } from "../components/service"
import type { PropShape } from "@drydock/reader"

/** The parts of React the page uses. The project's own copy is passed in, so a case draws with the React the project runs. */
type ReactLike = {
  createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
  isValidElement(value: unknown): boolean
  Component: new (props: unknown) => { props: { children?: unknown }; state: { error: Error | null }; setState(state: unknown): void }
}

type Runtime = {
  React: ReactLike
  createRoot(host: Element): { render(element: unknown): void }
  Module: Record<string, unknown>
  cases?: Cases<never> & Record<string, unknown>
}

declare global {
  interface Window {
    __drydock?: Runtime
  }
}

function boundary(React: ReactLike) {
  return class extends React.Component {
    state: { error: Error | null } = { error: null }
    static getDerivedStateFromError(error: Error) {
      return { error }
    }
    render() {
      return this.state.error ? React.createElement("pre", { className: "error" }, String(this.state.error.message)) : this.props.children
    }
  }
}

let Boundary: ReturnType<typeof boundary> | undefined

/** Draws one element in a host. A case that throws shows its message in its own cell and leaves the rest of the page alone. */
function draw(runtime: Runtime, element: unknown, style = ""): HTMLElement {
  Boundary ??= boundary(runtime.React)
  const host = h("div", style ? { style } : {})
  const stage = h("div", { class: "stage" }, host)
  runtime.createRoot(host).render(runtime.React.createElement(Boundary, null, element))
  return stage
}

const quote = (value: unknown) => (typeof value === "string" ? JSON.stringify(value) : String(value))

function typeOf(prop: PropShape): string {
  if (prop.kind === "data") return prop.type
  return prop.kind === "boolean" ? "boolean" : prop.values.map(quote).join(" | ")
}

function propsTable(rows: PropShape[], defaults: Record<string, unknown>): HTMLElement {
  return h(
    "table",
    {},
    h("tr", {}, h("th", {}, "name"), h("th", {}, "type"), h("th", {}, "default"), h("th", {}, "")),
    ...rows.map((prop) =>
      h(
        "tr",
        {},
        h("td", {}, prop.optional ? `${prop.name}?` : prop.name),
        h("td", prop.kind !== "data" && !prop.ordered ? { title: "The order is the compiler's. The source writes this union in a form the reader does not follow." } : {}, typeOf(prop)),
        h("td", { class: "dim" }, prop.name in defaults ? quote(defaults[prop.name]) : ""),
        h("td", { class: "dim" }, prop.doc),
      ),
    ),
  )
}

function propsSection(page: ComponentPage): HTMLElement {
  const shape = page.shape!
  const own = shape.props.filter((p) => !p.declaredIn)
  const byFile = new Map<string, PropShape[]>()
  for (const prop of shape.props) if (prop.declaredIn) byFile.set(prop.declaredIn, [...(byFile.get(prop.declaredIn) ?? []), prop])
  return h(
    "section",
    { id: "props" },
    h("h2", {}, "Props"),
    own.length ? propsTable(own, shape.defaults) : h("p", { class: "m dim" }, "none of its own"),
    ...[...byFile].map(([file, props]) => h("details", {}, h("summary", {}, `${file} (${props.length})`), propsTable(props, shape.defaults))),
  )
}

function isCaseWithWidth(value: unknown): value is { width: number; render: unknown } {
  return typeof value === "object" && value !== null && "width" in value && "render" in value
}

function casesSection(runtime: Runtime, page: ComponentPage, Component: unknown): HTMLElement[] {
  const { React } = runtime
  const shape = page.shape!
  const cases = runtime.cases!
  const sample = cases.sample as Props
  const render = (props: Props) => draw(runtime, React.createElement(Component, props))
  const out: HTMLElement[] = []

  out.push(h("section", { id: "sample" }, h("h2", {}, "Sample"), render(sample)))

  const g = grid(shape)
  const columns = g.columns?.values ?? [undefined]
  out.push(
    h(
      "section",
      { id: "grid" },
      h("h2", {}, "Grid"),
      h(
        "table",
        {},
        h("tr", {}, h("th", {}, ""), ...columns.map((value) => h("th", {}, value === undefined ? "" : `${g.columns!.prop}: ${quote(value)}`))),
        ...g.rows.map((row) =>
          h(
            "tr",
            {},
            h("td", { class: "dim" }, row.label),
            ...columns.map((value) => h("td", {}, render(compose(shape, sample, { ...row.props, ...(value === undefined ? {} : { [g.columns!.prop]: value }) })))),
          ),
        ),
      ),
      g.leftOut.length ? h("p", { class: "m dim" }, `not combined: ${g.leftOut.join(", ")}`) : null,
    ),
  )

  const s = sweep(shape, sample, (cases.each ?? {}) as Props)
  let last = ""
  const sweepRows: Child[] = []
  for (const row of s.rows) {
    if (row.prop !== last) {
      last = row.prop
      sweepRows.push(h("tr", { class: "group" }, h("th", { colspan: "3" }, row.prop)))
    }
    sweepRows.push(
      h(
        "tr",
        {},
        h("td", {}, row.isSample ? `${row.label} (sample)` : row.label),
        h("td", { class: "dim" }, row.dropped.length ? `without ${row.dropped.join(", ")}` : ""),
        h("td", {}, render(row.props)),
      ),
    )
  }
  out.push(
    h(
      "section",
      { id: "sweep" },
      h("h2", {}, "Sweep"),
      h("table", {}, ...sweepRows),
      ...s.skipped.map((skipped) => h("p", { class: "m dim" }, `${skipped.prop}: skipped, ${skipped.reason}`)),
      s.unset.length ? h("p", { class: "m dim" }, `no value for: ${s.unset.join(", ")}`) : null,
    ),
  )

  const named = (entries: Record<string, unknown> | undefined) =>
    Object.entries(entries ?? {}).map(([name, value]) => {
      if (typeof value === "object" && value !== null && "waived" in value) return h("div", { class: "case" }, h("h3", {}, name), h("p", { class: "m dim" }, `waived: ${(value as { waived: string }).waived}`))
      const element = isCaseWithWidth(value) ? value.render : value
      return h("div", { class: "case" }, h("h3", {}, name), draw(runtime, element, isCaseWithWidth(value) ? `width: ${value.width}px` : ""))
    })
  const owed = named(cases.owed)
  const more = named(cases.more)
  if (owed.length) out.push(h("section", { id: "owed" }, h("h2", {}, "Owed"), h("div", { class: "cases" }, ...owed)))
  if (more.length) out.push(h("section", { id: "more" }, h("h2", {}, "More"), h("div", { class: "cases" }, ...more)))
  return out
}

/** The first paragraph of a doc comment, with the rest in a collapsed block. */
function docBlock(doc: string): Child[] {
  const [first, ...rest] = doc.split(/\n\s*\n/)
  if (!first) return []
  return [h("p", { class: "doc" }, first), rest.length ? h("details", {}, h("summary", {}, "more"), h("p", { class: "doc" }, rest.join("\n\n"))) : null]
}

async function componentPage(root: HTMLElement) {
  const runtime = window.__drydock!
  const page = (await (await fetch(`/drydock/component.json${location.search}`)).json()) as ComponentPage
  const { component } = page
  const apps = component.apps.length ? `in the app: ${component.apps.join(", ")}` : "not in the app"
  const children: Child[] = [
    h("h1", {}, page.part),
    ...docBlock(page.shape?.doc ?? ""),
    h(
      "p",
      { class: "m meta" },
      `${component.id} · level ${component.level} · ${apps} · built from ${component.builtFrom.length} · used by ${component.usedBy.length + component.referencedBy.length}`,
    ),
    page.parts.length > 1
      ? h("nav", {}, ...page.parts.map((part) => h("a", { href: `?${new URLSearchParams({ file: component.id, part })}` }, part)))
      : null,
    h("p", { class: "m meta" }, h("a", { href: "/drydock/components" }, "components")),
  ]
  if (!page.shape) children.push(h("p", { class: "m dim" }, page.error ?? "The reader did not find this component."))
  else {
    children.push(propsSection(page))
    const Component = runtime.Module[page.part] ?? runtime.Module.default
    if (!runtime.cases) children.push(h("p", { class: "m dim" }, "No cases file beside this component."))
    else if (!Component) children.push(h("p", { class: "m dim" }, `The module does not export ${page.part}.`))
    else children.push(...casesSection(runtime, page, Component))
  }
  root.replaceChildren(h("main", { class: "dd page" }, ...children))
}

async function indexPage(root: HTMLElement) {
  const index = (await (await fetch("/drydock/components.json")).json()) as ComponentIndex
  const byFolder = new Map<string, ComponentIndex["components"]>()
  for (const component of index.components) byFolder.set(component.filed, [...(byFolder.get(component.filed) ?? []), component])
  root.replaceChildren(
    h(
      "main",
      { class: "dd page" },
      h("h1", {}, "Components"),
      h("p", { class: "m meta" }, `${index.components.length} components`),
      h(
        "table",
        { class: "index" },
        h("tr", {}, h("th", {}, "name"), h("th", {}, "level"), h("th", {}, "app"), h("th", {}, "shown")),
        ...[...byFolder].flatMap(([folder, components]) => [
          h("tr", { class: "group" }, h("th", { colspan: "4" }, folder)),
          ...components.map((c) =>
            h(
              "tr",
              {},
              h("td", {}, h("a", { href: `/drydock/component?${new URLSearchParams({ file: c.id })}` }, c.name)),
              h("td", { class: "n" }, String(c.level)),
              h("td", { class: "dim" }, c.apps.join(", ")),
              h("td", { class: "dim" }, c.inShowcase ? "yes" : ""),
            ),
          ),
        ]),
      ),
    ),
  )
}

document.head.append(h("style", {}, css))
const root = document.getElementById("root")!
if (location.pathname.startsWith("/drydock/component") && !location.pathname.startsWith("/drydock/components")) await componentPage(root)
else await indexPage(root)
