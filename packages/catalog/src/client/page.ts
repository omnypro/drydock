import css from "./catalog.css?inline"
import { h, type Child } from "./dom"
import { grid } from "../generate/grid"
import { sweep } from "../generate/sweep"
import { compose, type Props } from "../generate/valid"
import { allCases, type CasesInput } from "../generate/cases"
import type { Cases } from "../cases"
import type { PropRow } from "../components/handover"
import type { ComponentIndex, ComponentPage, Handover, MarksView } from "../components/service"
import type { MarkState } from "@drydock/marks"
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
  /** On a handover page: the module of each old component the new one replaces, by its file. */
  old?: Record<string, Record<string, unknown>>
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

const getJson = async <T>(url: string) => (await (await fetch(url)).json()) as T
const nameOf = (file: string) => file.replace(/^.*\//, "").replace(/\.\w+$/, "")
const pageLink = (file: string, text = nameOf(file)) => h("a", { href: `/drydock/component?${new URLSearchParams({ file })}` }, text)
const handoverHref = (mark: MarkState & { mark: "replaces" }) => `/drydock/handover?${new URLSearchParams({ file: mark.component, replaces: mark.replaces })}`
/** A path in a mark: a link when the ledger lists it, and the path as written when it does not. */
const markRef = (mark: MarkState, file: string) => (mark.unlisted.some((u) => u.path === file) ? file : pageLink(file))
/** The same, with the whole path as the link's text, where two marked components can share a name. */
const pathRef = (mark: MarkState, file: string) => (mark.unlisted.some((u) => u.path === file) ? file : pageLink(file, file))

/** Where a mark stands, in a line: the count of files left for a `replaces` mark, or what keeps it open. */
function standing(mark: MarkState): string {
  if (mark.mark === "parked") return mark.waitingOn ?? "An app renders it. The mark can be cleared."
  const oldName = nameOf(mark.replaces)
  if (mark.finished) return mark.unlisted.some((u) => u.path === mark.replaces) ? `${mark.replaces} is gone. The mark can be cleared.` : `Nothing renders ${oldName}. The mark can be cleared.`
  const left = mark.remaining.length
  return left ? `${left} ${left === 1 ? "file still renders" : "files still render"} ${oldName}` : (mark.waitingOn ?? "")
}

/** One quiet line for each mark that names the component. The page still draws the component alone. */
function markLines(page: ComponentPage): Child[] {
  return page.marks.map((mark) => {
    if (mark.mark === "parked") return h("p", { class: "m meta" }, mark.reason ? `parked: ${mark.reason}` : "parked")
    const link = h("a", { href: handoverHref(mark) }, "handover")
    return mark.component === page.component.id
      ? h("p", { class: "m meta" }, "replaces ", markRef(mark, mark.replaces), " · ", link)
      : h("p", { class: "m meta" }, "replaced by ", markRef(mark, mark.component), " · ", link)
  })
}

/** The props for the old component: renamed props under their old names, and none of the props that only the new one takes. */
function forOld(props: Props, rows: PropRow[]): Props {
  const was = new Map(rows.filter((r) => r.status === "renamed").map((r) => [r.name, r.was!]))
  const onlyNew = new Set(rows.filter((r) => r.status === "new").map((r) => r.name))
  return Object.fromEntries(Object.entries(props).flatMap(([name, value]) => (onlyNew.has(name) ? [] : [[was.get(name) ?? name, value]])))
}

type DrawnElement = { type: unknown; key: string | null; props: Record<string, unknown> }

/** The case's element with the old component in each place the new one is, or `undefined` when the element tree does not hold the new one. */
function withOld(React: ReactLike, element: unknown, New: unknown, Old: unknown, rows: PropRow[]): unknown {
  let swapped = false
  const rebuild = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      const mapped = node.map(rebuild)
      return mapped.some((m, at) => m !== node[at]) ? mapped : node
    }
    if (!React.isValidElement(node)) return node
    const { type, key, props } = node as DrawnElement
    const children = props.children === undefined ? undefined : rebuild(props.children)
    const next = { ...props, ...(children === undefined ? {} : { children }), ...(key === null ? {} : { key }) }
    if (type === New) {
      swapped = true
      return make(Old, forOld(next as Props, rows))
    }
    return children === props.children ? node : make(type, next)
  }
  // Children that JSX wrote side by side go back in as separate arguments. Passed as one array they would read as a list that needs keys.
  const make = (type: unknown, props: Record<string, unknown>) => {
    const { children, ...rest } = props
    return Array.isArray(children) ? React.createElement(type, rest, ...(children as unknown[])) : React.createElement(type, props)
  }
  const result = rebuild(element)
  return swapped ? result : undefined
}

function handoverCases(runtime: Runtime, handover: Handover, New: unknown, Old: unknown): HTMLElement {
  const { React } = runtime
  const items = allCases(handover.shape!, runtime.cases as unknown as CasesInput)
  const oldName = handover.oldPart ?? nameOf(handover.mark.replaces)
  const cell = (drawn: HTMLElement | string) => h("td", typeof drawn === "string" ? { class: "dim" } : {}, drawn)
  const rows: Child[] = [h("tr", {}, h("th", {}, ""), Old ? h("th", {}, `old: ${oldName}`) : null, h("th", {}, `new: ${handover.part}`))]
  let section = ""
  for (const item of items) {
    if (item.section !== section) {
      section = item.section
      rows.push(h("tr", { class: "group" }, h("th", { colspan: Old ? "3" : "2" }, section)))
    }
    const style = item.width ? `width: ${item.width}px` : ""
    const label = h("td", {}, item.label === item.section ? "" : item.label)
    if (item.props) {
      rows.push(
        h(
          "tr",
          {},
          label,
          Old ? cell(draw(runtime, React.createElement(Old, forOld(item.props, handover.props)))) : null,
          cell(draw(runtime, React.createElement(New, item.props))),
        ),
      )
      continue
    }
    const old = Old ? withOld(React, item.element, New, Old, handover.props) : undefined
    rows.push(h("tr", {}, label, Old ? cell(old === undefined ? `no ${handover.part} element to swap` : draw(runtime, old, style)) : null, cell(draw(runtime, item.element, style))))
  }
  return h("table", {}, ...rows)
}

function handoverProps(handover: Handover): HTMLElement {
  return h(
    "table",
    {},
    h("tr", {}, h("th", {}, ""), h("th", {}, "name"), h("th", {}, "was"), h("th", {}, "type"), h("th", {}, "old type")),
    ...handover.props.map((row) =>
      h(
        "tr",
        {},
        h("td", { class: "dim" }, row.status),
        h("td", {}, row.name),
        h("td", { class: "dim" }, row.was ?? ""),
        h("td", {}, row.type),
        h("td", { class: "dim" }, row.oldType ?? ""),
      ),
    ),
  )
}

async function handoverPage(root: HTMLElement) {
  const runtime = window.__drydock!
  const [handover, index] = await Promise.all([getJson<Handover>(`/drydock/handover.json${location.search}`), getJson<ComponentIndex>("/drydock/components.json")])
  const { mark, component, old } = handover
  const listed = new Set(index.components.map((c) => c.id))
  const remaining = mark.remaining.length
  const query = (part: string) => `?${new URLSearchParams({ file: component.id, replaces: mark.replaces, part })}`
  const children: Child[] = [
    h("h1", {}, handover.part),
    h("p", { class: "m meta" }, `${component.id} replaces `, old ? pageLink(old.id, old.id) : mark.replaces),
    mark.reason ? h("p", { class: "doc" }, mark.reason) : null,
    h("p", { class: "m meta" }, standing(mark)),
    handover.parts.length > 1 ? h("nav", {}, ...handover.parts.map((part) => h("a", { href: query(part) }, part))) : null,
    h("p", { class: "m meta" }, pageLink(component.id, handover.part), " · ", h("a", { href: "/drydock/components" }, "components")),
  ]
  const New = runtime.Module[handover.part] ?? runtime.Module.default
  const Old = old && handover.oldPart ? runtime.old?.[old.id]?.[handover.oldPart] : undefined
  const cases: Child[] = [h("h2", {}, "Cases")]
  if (!handover.shape) cases.push(h("p", { class: "m dim" }, handover.errors[0] ?? "The reader did not find this component."))
  else if (!runtime.cases) cases.push(h("p", { class: "m dim" }, "No cases file beside this component."))
  else if (!New) cases.push(h("p", { class: "m dim" }, `The module does not export ${handover.part}.`))
  else cases.push(handoverCases(runtime, handover, New, Old))
  children.push(h("section", { id: "cases" }, ...cases))
  children.push(
    h(
      "section",
      { id: "props" },
      h("h2", {}, "Props"),
      handover.props.length ? handoverProps(handover) : null,
      ...handover.errors.map((error) => h("p", { class: "m dim" }, error)),
    ),
  )
  if (remaining)
    children.push(h("section", { id: "remaining" }, h("h2", {}, "Still rendered by"), h("ul", { class: "m" }, ...mark.remaining.map((file) => h("li", {}, listed.has(file) ? pageLink(file, file) : file)))))
  root.replaceChildren(h("main", { class: "dd page" }, ...children))
}

function marksSection(view: MarksView): HTMLElement | null {
  if (!view.marks.length && !view.problems.length) return null
  return h(
    "section",
    { id: "marks" },
    h("h2", {}, "Marks"),
    view.marks.length
      ? h(
          "table",
          {},
          h("tr", {}, h("th", {}, "mark"), h("th", {}, "component"), h("th", {}, "replaces"), h("th", {}, "")),
          ...view.marks.map((mark) =>
            h(
              "tr",
              {},
              h("td", {}, mark.mark === "replaces" ? h("a", { href: handoverHref(mark) }, "replaces") : "parked"),
              h("td", {}, pathRef(mark, mark.component)),
              h("td", {}, mark.mark === "replaces" ? pathRef(mark, mark.replaces) : ""),
              h("td", { class: "dim" }, standing(mark)),
            ),
          ),
        )
      : null,
    ...view.problems.map((problem) => h("p", { class: "m dim" }, `${view.file}: ${problem}`)),
  )
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
    ...markLines(page),
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
  const [index, marks] = await Promise.all([getJson<ComponentIndex>("/drydock/components.json"), getJson<MarksView>("/drydock/marks.json")])
  const byFolder = new Map<string, ComponentIndex["components"]>()
  for (const component of index.components) byFolder.set(component.filed, [...(byFolder.get(component.filed) ?? []), component])
  root.replaceChildren(
    h(
      "main",
      { class: "dd page" },
      h("h1", {}, "Components"),
      h("p", { class: "m meta" }, `${index.components.length} components`),
      marksSection(marks),
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
if (location.pathname.startsWith("/drydock/handover")) await handoverPage(root)
else if (location.pathname.startsWith("/drydock/component") && !location.pathname.startsWith("/drydock/components")) await componentPage(root)
else await indexPage(root)
