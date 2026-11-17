import { describe, expect, test } from "bun:test"
import type { PropRow } from "../src/components/handover"
import { forOld, holds, withOld, type ElementTools } from "../src/client/swap"

/** A stand-in for React's element functions, with the same rules for `key` and for children. */
type El = { el: true; type: unknown; key: string | null; props: Record<string, unknown> }
const React: ElementTools = {
  createElement(type, props, ...children) {
    const { key = null, ...rest } = (props ?? {}) as Record<string, unknown>
    const kids = children.length === 0 ? {} : { children: children.length === 1 ? children[0] : children }
    return { el: true, type, key: key as string | null, props: { ...rest, ...kids } } satisfies El
  },
  isValidElement: (value) => typeof value === "object" && value !== null && (value as El).el === true,
}
const e = (type: unknown, props: Record<string, unknown> = {}, ...children: unknown[]) => React.createElement(type, props, ...children) as El

const Frame = "Frame"
const View = "View"
const NewTag = "NewTag"
const OldTag = "OldTag"
const rows: PropRow[] = [
  { status: "renamed", name: "mood", was: "tone", type: "string", doc: "" },
  { status: "kept", name: "label", type: "string", doc: "" },
  { status: "new", name: "size", type: "string", doc: "" },
]

describe("withOld", () => {
  test("puts the old component in a slot prop, with renamed props under their old names and no props that only the new one takes", () => {
    const page = e(Frame, {}, e(View, { chat: e(NewTag, { mood: "warm", label: "x", size: "sm" }), player: e("div", {}, "video") }))
    const swapped = withOld(React, page, NewTag, OldTag, rows) as El
    const view = swapped.props.children as El
    expect((view.props.chat as El).type).toBe(OldTag)
    expect((view.props.chat as El).props).toEqual({ tone: "warm", label: "x" })
    expect(view.props.player).toBe((page.props.children as El).props.player)
  })

  test("swaps in children written side by side, and keeps their keys", () => {
    const row = e("div", {}, e(NewTag, { label: "a", key: "a" }), e(NewTag, { label: "b", key: "b" }))
    const swapped = withOld(React, row, NewTag, OldTag, rows) as El
    const kids = swapped.props.children as El[]
    expect(kids.map((kid) => [kid.type, kid.key, kid.props.label])).toEqual([
      [OldTag, "a", "a"],
      [OldTag, "b", "b"],
    ])
  })

  test("returns nothing when the tree does not hold the new component", () => {
    const page = e(Frame, {}, e(View, { chat: e("aside", {}, "chat") }))
    expect(withOld(React, page, NewTag, OldTag, rows)).toBeUndefined()
    expect(holds(React, page, NewTag)).toBe(false)
    expect(holds(React, e(Frame, {}, e(View, { chat: e(NewTag, {}) })), NewTag)).toBe(true)
  })
})

test("forOld keeps kept props, renames renamed ones and drops new ones", () => {
  expect(forOld({ mood: "calm", label: "x", size: "lg", children: "kid" }, rows)).toEqual({ tone: "calm", label: "x", children: "kid" })
})
