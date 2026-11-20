// What the catalog derives about a project, without the dev server: the ledger, component shapes, marks and tokens.
// It does not load Vite, so a process that only reads, such as the MCP server, stays small.
export { componentService, type ComponentPage, type ComponentService, type Handover, type MarksView, type Swap } from "./components/service"
export type { PropRow } from "./components/handover"
export { casesFileFor, configPathFor, isAstro, ledgerConfig, type ProjectConfig, type ResolvedProject } from "./project"
export { collectTokens } from "./tokens/collect"
export type { RawValue, Token, TokensData } from "./tokens/types"
