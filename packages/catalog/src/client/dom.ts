export type Child = Node | string | null | undefined | false

/** Builds an element. Strings become text nodes, so nothing a stylesheet or a type holds is read as markup. */
export function h(tag: string, props: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (key === "style") el.style.cssText = value
    else el.setAttribute(key, value)
  }
  for (const child of children) if (child) el.append(child)
  return el
}
