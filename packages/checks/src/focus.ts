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

/**
 * Checks visible keyboard focus on one component page: every focusable element in the drawn cases is pictured with
 * nothing focused, then reached with Tab and pictured again. An element whose two pictures are the same has no visible focus.
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
    return { id: item.id, checked: before.size, invisible, unreached }
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
