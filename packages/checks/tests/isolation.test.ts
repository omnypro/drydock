import { afterAll, beforeAll, expect, test } from "bun:test"
import path from "node:path"
import { startCatalog, type ResolvedProject, type RunningCatalog } from "@drydock/catalog"
import { withBrowser } from "../src"

const root = path.join(import.meta.dir, "fixtures", "isolation")
const project: ResolvedProject = {
  root,
  appConfig: "vite.config.ts",
  tokens: [],
  styles: [path.join(root, "src/site.css")],
  rawValues: [],
  components: { ledger: { source: ["src"], entries: [/^src\/main\.tsx$/] } },
}

/** The computed styles of each probe under one element: the ones the catalog's stylesheet sets on its own tables, headings, navs and cells. */
type Reading = Record<string, Record<string, string>>
type Drawn = { where: string; reading: Reading }

let catalog: RunningCatalog
let reference: Reading
let drawn: Drawn[]
let own: Record<string, Record<string, string>>

beforeAll(async () => {
  catalog = await startCatalog(project)
  await withBrowser(async (browser) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    // Runs in the page. It reads every probe under an element.
    const read = (scope: Element): Reading => {
      const wanted: Record<string, string[]> = {
        text: ["fontFamily", "fontSize", "lineHeight", "color", "textAlign", "boxSizing"],
        h2: ["marginTop", "paddingBottom", "borderBottomWidth", "fontSize", "fontFamily", "fontWeight"],
        nav: ["display", "marginTop", "fontFamily"],
        link: ["opacity", "color"],
        td: ["paddingTop", "paddingRight", "borderBottomWidth", "textAlign", "verticalAlign", "fontFamily", "fontSize"],
        grid: ["display"],
      }
      const out: Reading = {}
      for (const [probe, properties] of Object.entries(wanted)) {
        const style = getComputedStyle(scope.querySelector(`[data-probe="${probe}"]`)!) as unknown as Record<string, string>
        out[probe] = Object.fromEntries(properties.map((property) => [property, style[property]!]))
      }
      return out
    }
    // A window draws a case in a document that loads the site's stylesheet and none of the catalog's, so it is what the app would draw.
    await page.goto(`${catalog.url}/drydock/window?${new URLSearchParams({ file: "src/Probe.tsx", case: "more/In a window" })}`)
    await page.locator('[data-probe="td"]').waitFor({ timeout: 60_000 })
    reference = await page.evaluate(`(${read})(document.body)`)
    await page.goto(`${catalog.url}/drydock/component?${new URLSearchParams({ file: "src/Probe.tsx" })}`)
    await page.locator('#sweep .stage [data-probe="td"]').first().waitFor({ timeout: 60_000 })
    drawn = await page.evaluate(`(${(readSource: string) => {
      const reader = new Function(`return (${readSource})`)() as (scope: Element) => unknown
      return [...document.querySelectorAll("#sample .stage, #grid .stage, #sweep .stage")].map((stage) => ({ where: stage.closest("section")!.id, reading: reader(stage) }))
    }})(${JSON.stringify(String(read))})`)
    // The catalog's own parts of the same page: the page's box, a section heading, a cell that labels a row, and a stage's host.
    own = await page.evaluate(() => {
      const pick = (element: Element, properties: string[]) => {
        const style = getComputedStyle(element) as unknown as Record<string, string>
        return Object.fromEntries(properties.map((property) => [property, style[property]!]))
      }
      const label = [...document.querySelectorAll("#sweep td")].find((cell) => !cell.querySelector(".stage"))!
      return {
        page: pick(document.querySelector("main.dd")!, ["paddingLeft", "maxWidth"]),
        heading: pick(document.querySelector("#sweep h2")!, ["fontFamily", "borderBottomWidth", "fontSize"]),
        label: pick(label, ["fontFamily", "fontSize", "textAlign"]),
        host: pick(document.querySelector("#sample .stage > div")!, ["display"]),
        // How much of the stage's width the component's own root takes: a block fills it, as it fills its parent in the app.
        fill: { share: String(Math.round((document.querySelector("#sample .stage .probe")!.getBoundingClientRect().width / document.querySelector("#sample .stage > div")!.parentElement!.clientWidth) * 10) / 10) },
      }
    })
  })
}, 120_000)

afterAll(() => catalog.close(), 15_000)

test("the window is drawn with the site's own styles", () => {
  expect(reference.text).toMatchObject({ fontFamily: "Georgia, serif", fontSize: "18px", lineHeight: "30px", color: "rgb(10, 20, 30)" })
  expect(reference.td).toMatchObject({ paddingTop: "3px", borderBottomWidth: "2px" })
  expect(reference.link).toMatchObject({ opacity: "1" })
  expect(reference.grid).toMatchObject({ display: "block" })
})

test("a component is drawn in the sample, in a table of the grid and in a table of the sweep", () => {
  const sections = new Set(drawn.map((d) => d.where))
  expect(sections.has("sample")).toBe(true)
  expect(sections.has("sweep")).toBe(true)
})

test("nothing of the catalog's stylesheet reaches a drawn component, wherever the page draws it", () => {
  for (const { where, reading } of drawn) expect({ where, reading }).toEqual({ where, reading: reference })
})

test("the catalog's own page, headings and labels keep the catalog's styles", () => {
  expect(own.page).toEqual({ paddingLeft: "24px", maxWidth: "1280px" })
  expect(own.heading).toEqual({ fontFamily: "ui-monospace, Menlo, monospace", borderBottomWidth: "1px", fontSize: "16px" })
  expect(own.label).toEqual({ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "12px", textAlign: "left" })
})

test("a component is drawn in a plain block, so a block-level one fills the width it is given", () => {
  expect(own.host).toEqual({ display: "block" })
  expect(Number(own.fill!.share)).toBeGreaterThan(0.9)
})
