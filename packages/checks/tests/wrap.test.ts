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

type Page = { framed: string | null; errors: number; appError?: boolean }

let catalog: RunningCatalog
let onPage: Page
let inWindow: Page
let checkedWrapped: CasesRun
let checkedBare: CasesRun
let guardedNeedy: Page

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

test("a case that throws shows its own error even when the wrapper has an error boundary of its own", async () => {
  const guarded = await startCatalog({ ...bare, components: { ...bare.components!, wrap: "wrap-guarded.tsx" } })
  try {
    await withBrowser(async (browser) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      await page.goto(`${guarded.url}/drydock/component?${new URLSearchParams({ file: "src/Needy.tsx" })}`)
      await page.locator("#sample .stage > div > *").first().waitFor({ timeout: 60_000 })
      guardedNeedy = await page.evaluate(() => ({ framed: null, errors: document.querySelectorAll("#sample pre[data-dd-error]").length, appError: Boolean(document.querySelector('#sample [data-part="app-error"]')) }))
    })
  } finally {
    await guarded.close()
  }
  expect(guardedNeedy).toEqual({ framed: null, errors: 1, appError: false })
}, 120_000)

test("a component page draws each case inside what the project says the app wraps it in", () => {
  expect(onPage).toEqual({ framed: "app", errors: 0 })
})

test("a window draws its case inside the same wrapper", () => {
  expect(inWindow).toEqual({ framed: "app", errors: 0 })
})

test("the checks that need no browser draw each case inside the wrapper too", () => {
  expect(checkedWrapped.passed).toBe(true)
})

test("the checks refuse a wrapper that has no default export, and name the file", async () => {
  const named = await runCaseChecks(planChecks({ ...bare, components: { ...bare.components!, wrap: "wrap-named.tsx" } }, ["src/Probe.tsx"]).groups[0]!, { echo: false })
  expect(named.passed).toBe(false)
  expect(named.output).toContain("wrap-named.tsx")
}, 60_000)

test("without the wrapper the same component throws, as it would outside the app", () => {
  expect(checkedBare.passed).toBe(false)
})
