import { h } from "./dom"
import type { TokensData } from "../tokens/types"

export const COMPONENTS = "/drydock/components"
export const TOKENS = "/drydock/tokens"

/** The links the server wrote into the page's head: the project's name for the home page, then each section the project has. */
export function links(): [name: string, href: string][] {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="drydock:nav"]')
  try {
    return JSON.parse(meta?.content ?? "[]") as [string, string][]
  } catch {
    return []
  }
}

/** The section a path belongs to. A component's page and a handover belong to the components. */
function sectionOf(pathname: string): string {
  const here = pathname.replace(/\/$/, "")
  return /^\/drydock\/(component|handover|astro)(\/|$)/.test(here) ? COMPONENTS : here
}

/** The links across the top of every page, with the section the page is in marked. */
export function topNav(): HTMLElement {
  const all = links()
  const pathname = location.pathname.replace(/\/$/, "")
  const section = sectionOf(pathname)
  return h(
    "nav",
    { class: "top", "aria-label": all[0]?.[0] ?? "" },
    ...all.map(([name, href]) => h("a", href === section ? { href, "aria-current": href === pathname ? "page" : "true" } : { href }, name)),
  )
}

export const componentsCount = (count: number) => `${count} components`
export const tokensCount = (data: TokensData) => `${data.tokens.length} tokens, ${data.raw.length} raw values in ${data.scanned} files`
