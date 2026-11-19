import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { NavLink } from "../plugin"

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/**
 * The Astro page that draws an `.astro` component's cases, written into the catalog's own Astro root at start so its
 * imports resolve from there. `styles` are the project's stylesheets, imported the way the app imports them. `nav` is
 * the links every page of the catalog carries.
 */
export function componentPageSource(styles: string[], nav: NavLink[]): string {
  const css = fs.readFileSync(path.join(SRC, "client/catalog.css"), "utf8")
  return `---
import { components } from "virtual:drydock/astro"
${styles.map((specifier) => `import ${JSON.stringify(specifier)}`).join("\n")}

export function getStaticPaths() {
  return components.map((c) => ({ params: { id: c.id } }))
}

const entry = components.find((c) => c.id === Astro.params.id)
if (!entry) return new Response(null, { status: 404 })
const Component = (await entry.component()).default
const cases = (await entry.cases()).default ?? {}
const css = ${JSON.stringify(css)}
const nav = ${JSON.stringify(nav)}
// A case is the props, or { props, slot } with the HTML for the default slot. Astro hoists a slot name chosen at run time
// out of the loop it is written in, so named slots are not drawn.
const drawn = (value) => (value && typeof value === "object" && "props" in value && "slot" in value ? value : { props: value, slot: undefined })
const waived = (value) => value && typeof value === "object" && "waived" in value
const sections = [["owed", "Owed"], ["more", "More"]].map(([key, title]) => [key, title, Object.entries(cases[key] ?? {})]).filter(([, , list]) => list.length)
const apps = entry.apps.length ? \`in the app: \${entry.apps.join(", ")}\` : "not in the app"
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{entry.name}</title>
    <style is:inline set:html={css} />
  </head>
  <body>
    <main class="dd page">
      <nav class="top" aria-label={nav[0]?.[0]}>
        {nav.map(([name, href]) => <a href={href} aria-current={href === "/drydock/components" ? "true" : undefined}>{name}</a>)}
      </nav>
      <h1>{entry.name}</h1>
      <p class="m meta">{entry.id} · level {entry.level} · {apps}</p>
      <table class="ledger">
        {[["built from", entry.builtFrom], ["used by", entry.usedBy]].map(([label, files]) => (
          <tr>
            <td class="dim">{label}</td>
            <td class="n">{files.length}</td>
            <td><div class="names">{files.map((file) => (file.name ? <a href={\`/drydock/component?\${new URLSearchParams({ file: file.id })}\`} title={file.id}>{file.name}</a> : <span>{file.id}</span>))}</div></td>
          </tr>
        ))}
      </table>
      <p class="m dim">Drawn by Astro on the server. The reader reads React components only, so there is no props table, grid or sweep.</p>
      {cases.sample === undefined ? (
        <p class="m dim">The cases file has no sample.</p>
      ) : (
        <section id="sample">
          <h2>Sample</h2>
          <div class="stage"><div>
            <Component {...drawn(cases.sample).props}>{drawn(cases.sample).slot !== undefined && <Fragment set:html={drawn(cases.sample).slot} />}</Component>
          </div></div>
        </section>
      )}
      {sections.map(([key, title, list]) => (
        <section id={key}>
          <h2>{title}</h2>
          <div class="cases">
            {list.map(([name, value]) =>
              waived(value) ? (
                <div class="case"><h3>{name}</h3><p class="m dim">waived: {value.waived}</p></div>
              ) : (
                <div class="case">
                  <h3>{name}</h3>
                  <div class="stage"><div>
                    <Component {...drawn(value).props}>{drawn(value).slot !== undefined && <Fragment set:html={drawn(value).slot} />}</Component>
                  </div></div>
                </div>
              ),
            )}
          </div>
        </section>
      ))}
    </main>
  </body>
</html>
`
}
