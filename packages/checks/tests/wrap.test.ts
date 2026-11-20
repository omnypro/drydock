import { afterAll, beforeAll, expect, test } from "bun:test"
import path from "node:path"
import { startCatalog, type ResolvedProject, type RunningCatalog } from "@drydock/catalog"
import { planChecks, runCaseChecks, withBrowser, type CasesRun } from "../src"

const root = path.join(import.meta.dir, "fixtures", "isolation")
const bare: ResolvedProject = {
  root,
  appConfig: "vite.config.ts",
  tokens: [],
  styles: [path.join(root, "src/site.css")],
  rawValues: [],
  components: { ledger: { source: ["src"], entries: [/^src\/main\.tsx$/] } },
}
/** The same project, with the file that says what the app wraps every component in. */
const wrapped: ResolvedProject = { ...bare, components: { ...bare.components!, wrap: "wrap.tsx" } }

type Page = { framed: string | null; errors: number }

let catalog: RunningCatalog
let onPage: Page
let inWindow: Page
let checkedWrapped: CasesRun
let checkedBare: CasesRun

beforeAll(async () => {
  const only = ["src/Framed.tsx"]
  checkedWrapped = await runCaseChecks(planChecks(wrapped, only).groups[0]!, { echo: false })
  checkedBare = await runCaseChecks(planChecks(bare, only).groups[0]!, { echo: false })
  catalog = await startCatalog(wrapped)
  await withBrowser(async (browser) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const read = async (url: string, ready: string): Promise<Page> => {
      await page.goto(`${catalog.url}${url}`)
      await page.locator(ready).first().waitFor({ timeout: 60_000 })
      return page.evaluate(() => ({ framed: document.querySelector('[data-part="framed"]')?.textContent ?? null, errors: document.querySelectorAll("pre[data-dd-error], pre.error").length }))
    }
    onPage = await read(`/drydock/component?${new URLSearchParams({ file: "src/Framed.tsx" })}`, "#sample .stage > div > *")
    inWindow = await read(`/drydock/window?${new URLSearchParams({ file: "src/Framed.tsx", case: "more/In a window" })}`, "#root > *")
  })
}, 180_000)

afterAll(() => catalog.close(), 15_000)

test("a component page draws each case inside what the project says the app wraps it in", () => {
  expect(onPage).toEqual({ framed: "app", errors: 0 })
})

test("a window draws its case inside the same wrapper", () => {
  expect(inWindow).toEqual({ framed: "app", errors: 0 })
})

test("the checks that need no browser draw each case inside the wrapper too", () => {
  expect(checkedWrapped.passed).toBe(true)
})

test("without the wrapper the same component throws, as it would outside the app", () => {
  expect(checkedBare.passed).toBe(false)
})
