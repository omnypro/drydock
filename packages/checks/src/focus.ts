import { chromium, type Browser, type Page } from "playwright-core"
import type { CheckItem } from "./plan"

export type FocusResult = {
  id: string
  /** Focusable elements in the drawn cases. */
  checked: number
  /** Elements whose look does not change when the keyboard focuses them. */
  invisible: string[]
  /** Focusable elements that Tab never reached. */
  unreached: string[]
  error?: string
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
/** The ring can sit outside the element's box, so each picture takes this much around it. */
const MARGIN = 8

async function shot(page: Page, index: number): Promise<Buffer | undefined> {
  const element = page.locator(`[data-dd-focus="${index}"]`)
  await element.scrollIntoViewIfNeeded()
  const box = await element.boundingBox()
  if (!box) return undefined
  const clip = { x: Math.max(0, box.x - MARGIN), y: Math.max(0, box.y - MARGIN), width: box.width + 2 * MARGIN, height: box.height + 2 * MARGIN }
  return page.screenshot({ clip, animations: "disabled", caret: "hide" })
}

type Outcome = Pick<FocusResult, "checked" | "invisible" | "unreached">

/** Pictures each marked element with nothing focused, reaches it with Tab and pictures it again. */
async function tabThrough(page: Page, labels: string[]): Promise<Outcome> {
  const before = new Map<number, Buffer>()
  for (let i = 0; i < labels.length; i++) {
    const picture = await shot(page, i)
    if (picture) before.set(i, picture)
  }

  const seen = new Set<number>()
  const invisible: string[] = []
  // The page's own links come before the cases in tab order, so allow a few more presses than there are elements.
  for (let press = 0; press < labels.length + 40 && seen.size < before.size; press++) {
    await page.keyboard.press("Tab")
    const at = await page.evaluate(() => document.activeElement?.getAttribute("data-dd-focus") ?? null)
    if (at === null) continue
    const index = Number(at)
    if (seen.has(index) || !before.has(index)) continue
    seen.add(index)
    const after = await shot(page, index)
    if (after && Buffer.compare(after, before.get(index)!) === 0) invisible.push(labels[index]!)
  }
  const unreached = [...before.keys()].filter((i) => !seen.has(i)).map((i) => labels[i]!)
  return { checked: before.size, invisible, unreached }
}

/** A window case: a page of its own, which the component page frames at a size. */
type Window = { src: string; width: number; height: number; title: string }

/** Checks one window case in a page of its own at the window's size, the way the component page frames it. */
async function checkWindow(browser: Browser, base: string, window: Window): Promise<Outcome> {
  const page = await browser.newPage({ viewport: { width: window.width, height: window.height }, colorScheme: "dark", reducedMotion: "reduce" })
  try {
    await page.goto(`${base}${window.src}`)
    await page.locator("#root > *").first().waitFor({ timeout: 60_000 })
    await page.waitForLoadState("networkidle")
    const labels = await page.evaluate(
      ({ selector, title }) => {
        const out: string[] = []
        for (const el of document.querySelectorAll(`#root ${selector}`)) {
          if (el.closest("[inert]")) continue
          el.setAttribute("data-dd-focus", String(out.length))
          out.push(["window", title, el.textContent?.trim().slice(0, 40) ?? ""].filter(Boolean).join(": "))
        }
        return out
      },
      { selector: FOCUSABLE, title: window.title },
    )
    return await tabThrough(page, labels)
  } finally {
    await page.close()
  }
}

/**
 * Checks visible keyboard focus on one component page: every focusable element in the drawn cases is pictured with
 * nothing focused, then reached with Tab and pictured again. An element whose two pictures are the same has no visible focus.
 * A window case is checked in a page of its own at the window's size, since the component page draws it in a frame.
 */
export async function checkFocus(browser: Browser, base: string, item: CheckItem): Promise<FocusResult> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "dark", reducedMotion: "reduce" })
  try {
    await page.goto(`${base}/drydock/component?${new URLSearchParams({ file: item.id })}`)
    await page.locator("#sample .stage").first().waitFor({ timeout: 60_000 })
    await page.waitForLoadState("networkidle")
    const labels = await page.evaluate((selector) => {
      const out: string[] = []
      for (const stage of document.querySelectorAll(".stage")) {
        for (const el of stage.querySelectorAll(selector)) {
          if (el.closest("[inert]")) continue
          const row = el.closest("tr")?.querySelector("td")?.textContent?.trim()
          const name = el.closest(".case")?.querySelector("h3")?.textContent?.trim()
          const section = el.closest("section")?.id ?? ""
          el.setAttribute("data-dd-focus", String(out.length))
          out.push([section, row ?? name ?? "", el.textContent?.trim().slice(0, 40) ?? ""].filter(Boolean).join(": "))
        }
      }
      return out
    }, FOCUSABLE)
    const windows = await page.evaluate(() =>
      [...document.querySelectorAll("iframe[data-dd-window]")].map((frame) => {
        const [width, height] = (frame.getAttribute("data-dd-size") ?? "0x0").split("x").map(Number)
        return { src: frame.getAttribute("data-dd-window")!, width: width!, height: height!, title: frame.getAttribute("title") ?? "" }
      }),
    )
    const outcomes = [await tabThrough(page, labels)]
    for (const window of windows) outcomes.push(await checkWindow(browser, base, window))
    return {
      id: item.id,
      checked: outcomes.reduce((sum, o) => sum + o.checked, 0),
      invisible: outcomes.flatMap((o) => o.invisible),
      unreached: outcomes.flatMap((o) => o.unreached),
    }
  } catch (error) {
    return { id: item.id, checked: 0, invisible: [], unreached: [], error: error instanceof Error ? error.message.split("\n")[0] : String(error) }
  } finally {
    await page.close()
  }
}

export async function withBrowser<T>(run: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch()
  try {
    return await run(browser)
  } finally {
    await browser.close()
  }
}
