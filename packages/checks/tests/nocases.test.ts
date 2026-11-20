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

type Page = { sample: string | null; label: string | null; children: string | null; tones: string[]; notes: string[]; entry: boolean; errors: number; firstError: string | null }

let catalog: RunningCatalog
let bare: Page
let needy: Page
let entry: Page
let panel: Page

beforeAll(async () => {
  catalog = await startCatalog(project)
  await withBrowser(async (browser) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const read = async (file: string): Promise<Page> => {
      await page.goto(`${catalog.url}/drydock/component?${new URLSearchParams({ file })}`)
      await page.locator("#props").waitFor({ timeout: 60_000 })
      // The cases draw after the props table, when there is anything to draw.
      await page.locator("#sweep, main > p.dim").first().waitFor({ timeout: 60_000 }).catch(() => {})
      await page.waitForLoadState("networkidle")
      return page.evaluate(() => ({
        sample: document.querySelector("#sample .stage")?.textContent ?? null,
        label: document.querySelector('#sample .stage [data-part="label"]')?.textContent ?? null,
        children: document.querySelector('#sample .stage [data-part="children"]')?.textContent ?? null,
        tones: [...document.querySelectorAll("#sweep .stage [data-tone]")].map((el) => el.getAttribute("data-tone")!),
        notes: [...document.querySelectorAll("main > p.dim")].map((p) => p.textContent ?? ""),
        entry: Boolean(document.querySelector('#sample .stage [data-part="entry"]')),
        errors: document.querySelectorAll("pre[data-dd-error]").length,
        firstError: document.querySelector("#sample pre[data-dd-error]")?.textContent ?? null,
      }))
    }
    bare = await read("src/Bare.tsx")
    needy = await read("src/Needy.tsx")
    entry = await read("src/Entry.tsx")
    panel = await read("src/Panel.tsx")
  })
}, 120_000)

afterAll(() => catalog.close(), 15_000)

test("a component with no cases file is drawn from its types", () => {
  expect(bare.label).toBe("label")
  expect(bare.children).toBe("Bare")
})

test("its choices are swept as they are for a component with a cases file", () => {
  expect(new Set(bare.tones)).toEqual(new Set(["calm", "loud"]))
})

test("the page still says that no cases file sits beside the component", () => {
  expect(bare.notes).toContain("No cases file beside this component.")
})

test("a required prop that only a person can give is named on the page", () => {
  expect(needy.notes).toContain("no value for: room")
})

test("a component that takes children only in its type, and throws when given any, is drawn without them", () => {
  expect(entry.entry).toBe(true)
  expect(entry.errors).toBe(0)
})

test("a component that throws for a reason of its own shows that error, and is not redrawn without children", () => {
  expect(panel.firstError).toBe("Panel's body needs a provider.")
})
