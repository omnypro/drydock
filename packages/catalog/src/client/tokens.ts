import { createHotContext } from "/@vite/client"
import css from "./catalog.css?inline"
import type { RawValue, Token, TokensData } from "../tokens/types"

type Child = Node | string | null | undefined | false

function h(tag: string, props: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (key === "style") el.style.cssText = value
    else el.setAttribute(key, value)
  }
  for (const child of children) if (child) el.append(child)
  return el
}

function tile(token: Token): HTMLElement {
  return h(
    "div",
    { class: "tile" },
    h("div", { class: "swatch", style: `background: var(${token.name})` }),
    h("div", { class: "name" }, token.name),
    h("div", { class: "value" }, token.resolved),
  )
}

function row(token: Token): HTMLElement {
  let sample: HTMLElement
  switch (token.kind) {
    case "space":
      sample = h("div", { class: "bar", style: `width: var(${token.name})` })
      break
    case "radius":
      sample = h("div", { class: "box", style: `border-radius: var(${token.name})` })
      break
    case "text":
      sample = h("div", { style: `font-size: var(${token.name})` }, "Aa")
      break
    case "font":
      sample = h("div", { style: `font-family: var(${token.name}); font-size: 1.25rem` }, "Aa")
      break
    case "shadow":
      sample = h("div", { class: "box", style: `box-shadow: var(${token.name}); border-color: transparent` })
      break
    default:
      sample = h("div")
  }
  return h("div", { class: "row" }, h("div", {}, token.name), sample, h("div", { class: "value" }, token.resolved))
}

function section(group: string, tokens: Token[]): HTMLElement {
  const paints = tokens[0]?.kind === "color" || tokens[0]?.kind === "flag"
  const body = paints
    ? h("div", { class: "grid" }, ...tokens.map(tile))
    : h("div", { class: "list" }, ...tokens.map(row))
  return h("section", { id: group.replace("/", "-") }, h("h2", {}, group), body)
}

function rawTable(raw: RawValue[]): HTMLElement {
  const head = h("tr", {}, h("th", {}, "value"), h("th", {}, "kind"), h("th", {}, "count"), h("th", {}, "token"), h("th", {}, "files"))
  const rows = raw.map((entry) =>
    h(
      "tr",
      {},
      h("td", {}, entry.kind === "color" ? h("span", { class: "chip", style: `background: ${entry.value}` }) : null, entry.value),
      h("td", {}, entry.kind),
      h("td", { class: "n" }, String(entry.count)),
      h("td", {}, entry.token ?? ""),
      h("td", { class: "files" }, entry.files.map((f) => `${f.file} (${f.count})`).join(", ")),
    ),
  )
  return h("table", {}, h("thead", {}, head), h("tbody", {}, ...rows))
}

function render(data: TokensData): HTMLElement {
  const groups = new Map<string, Token[]>()
  for (const token of data.tokens) {
    const list = groups.get(token.group) ?? []
    list.push(token)
    groups.set(token.group, list)
  }
  const nav = h(
    "nav",
    { "aria-label": "Sections" },
    ...[...groups.keys(), "raw-values"].map((group) => h("a", { href: `#${group.replace("/", "-")}` }, group)),
  )
  return h(
    "main",
    { class: "dd" },
    h("h1", {}, "Tokens"),
    h("p", { class: "counts" }, `${data.tokens.length} tokens, ${data.raw.length} raw values in ${data.scanned} files`),
    nav,
    ...[...groups].map(([group, tokens]) => section(group, tokens)),
    h("section", { id: "raw-values" }, h("h2", {}, "raw-values"), rawTable(data.raw)),
  )
}

const root = document.getElementById("root")!
// A token that applies only under a condition (a dark block) is not drawn yet. The page shows the base values.
const mount = (data: TokensData) => root.replaceChildren(render({ ...data, tokens: data.tokens.filter((token) => !token.condition) }))

document.head.append(h("style", {}, css))
createHotContext("/drydock/client.js").on("drydock:tokens", (data: TokensData) => mount(data))

const response = await fetch("/drydock/tokens.json")
if (response.ok) mount((await response.json()) as TokensData)
