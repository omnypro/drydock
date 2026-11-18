/** Rules about a whole page misfire on one component, and contrast needs layout that happy-dom does not have. */
export const PAGE_RULES = ["color-contrast", "region", "landmark-one-main", "page-has-heading-one", "bypass", "landmark-unique"]
export const AXE_OPTIONS = { rules: Object.fromEntries(PAGE_RULES.map((id) => [id, { enabled: false }])) }
