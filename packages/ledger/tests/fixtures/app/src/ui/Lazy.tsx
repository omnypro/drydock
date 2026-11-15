import { lazy } from "./lazy-helper"

export const Lazy = lazy(() => import("./Heavy"))
