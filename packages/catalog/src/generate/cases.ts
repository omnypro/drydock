import type { ComponentShape } from "@drydock/reader"
import { grid } from "./grid"
import { sweep } from "./sweep"
import { compose, type Props } from "./valid"

/** One case of a component, as a check draws it. */
export type CaseItem = {
  section: "sample" | "grid" | "sweep" | "owed" | "more"
  label: string
  /** The props for a case the types generate. */
  props?: Props
  /** The element a cases file writes, for an owed or extra case. */
  element?: unknown
  /** The width the case is drawn at, when the cases file gives one. */
  width?: number
}

/** What the checks need from a cases file. */
export type CasesInput = { sample: Props; each?: Props; owed?: Record<string, unknown>; more?: Record<string, unknown> }

const isWaived = (value: unknown) => typeof value === "object" && value !== null && "waived" in value
const withWidth = (value: unknown): value is { width: number; render: unknown } => typeof value === "object" && value !== null && "width" in value && "render" in value

/** Every case a component's page draws: the sample, each grid cell, each sweep row, and the owed and extra cases that are not waived. */
export function allCases(shape: ComponentShape, cases: CasesInput): CaseItem[] {
  const out: CaseItem[] = [{ section: "sample", label: "sample", props: cases.sample }]
  const g = grid(shape)
  for (const row of g.rows) {
    for (const value of g.columns?.values ?? [undefined]) {
      const overrides = value === undefined ? row.props : { ...row.props, [g.columns!.prop]: value }
      const label = [row.label, value === undefined ? "" : `${g.columns!.prop}: ${String(value)}`].filter(Boolean).join(" · ")
      out.push({ section: "grid", label, props: compose(shape, cases.sample, overrides) })
    }
  }
  for (const row of sweep(shape, cases.sample, cases.each ?? {}).rows) out.push({ section: "sweep", label: `${row.prop}: ${row.label}`, props: row.props })
  for (const section of ["owed", "more"] as const) {
    for (const [label, value] of Object.entries(cases[section] ?? {})) {
      if (isWaived(value)) continue
      out.push(withWidth(value) ? { section, label, element: value.render, width: value.width } : { section, label, element: value })
    }
  }
  return out
}
