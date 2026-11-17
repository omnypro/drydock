import { readCase } from "../generate/cases"
import type { Handover } from "../components/service"
import { boundary } from "./runtime"
import { withOld } from "./swap"

// One page case in a document of its own. The component page frames this document at the window's size, so the page's
// media queries apply as they would in a browser window that size.
const runtime = window.__drydock!
const params = new URLSearchParams(location.search)
const [section = "", ...rest] = (params.get("case") ?? "").split("/")
const label = rest.join("/")
const root = document.getElementById("root")!
const say = (text: string) => {
  root.textContent = text
}

const style = document.createElement("style")
style.textContent = "html, body { margin: 0 }"
document.head.append(style)

const entries = section === "owed" || section === "more" ? (runtime.cases?.[section] as Record<string, unknown> | undefined) : undefined
const value = entries?.[label]
if (value === undefined) say(`The cases file has no ${section} case named ${label}.`)
else {
  let element: unknown = readCase(value).element
  const newId = params.get("new")
  const oldId = params.get("old")
  if (newId && oldId) {
    const handover = (await (await fetch(`/drydock/handover.json?${new URLSearchParams({ file: newId, replaces: oldId })}`)).json()) as Handover
    const New = runtime.news?.[newId]?.[handover.part]
    const Old = handover.oldPart ? runtime.old?.[oldId]?.[handover.oldPart] : undefined
    element = New && Old ? withOld(runtime.React, element, New, Old, handover.props) : undefined
    if (element === undefined) say(`This case does not hold ${handover.part}, so there is nothing to put ${oldId} in place of.`)
  }
  if (element !== undefined) runtime.createRoot(root).render(runtime.React.createElement(boundary(runtime.React), null, element))
}
