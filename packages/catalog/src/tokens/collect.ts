import { readFile } from "node:fs/promises"
import path from "node:path"
import { glob } from "tinyglobby"
import postcss from "postcss"
import type { ResolvedProject } from "../project"
import { scanRaw } from "./raw"
import { readTokens } from "./read"
import type { TokensData } from "./types"

/** The absolute paths of every file the tokens page reads, so a watcher can follow them. */
export async function tokenSources(project: ResolvedProject): Promise<{ tokenFiles: string[]; scanFiles: string[] }> {
  const tokenFiles = project.tokens.map((file) => path.resolve(project.root, file))
  const scanFiles = await glob(project.rawValues, { cwd: project.root, absolute: true })
  return { tokenFiles, scanFiles: scanFiles.sort() }
}

export async function collectTokens(project: ResolvedProject): Promise<TokensData> {
  const { tokenFiles, scanFiles } = await tokenSources(project)
  const rel = (file: string) => path.relative(project.root, file)
  const unreadable: TokensData["unreadable"] = []
  const read = async (files: string[]) => {
    const sources = await Promise.all(
      files.map(async (file) => {
        try {
          const css = await readFile(file, "utf8")
          postcss.parse(css, { from: file })
          return { file: rel(file), css }
        } catch (error) {
          unreadable.push({ file: rel(file), message: error instanceof Error ? error.message.replace(/^.*?:\d+:\d+:\s*/, "") : String(error) })
          return undefined
        }
      }),
    )
    return sources.filter((source) => source !== undefined)
  }
  const tokens = readTokens(await read(tokenFiles))
  const sources = await read(scanFiles.filter((file) => !tokenFiles.includes(file)))
  return { tokens, raw: scanRaw(sources, tokens), scanned: sources.length, unreadable: unreadable.sort((a, b) => a.file.localeCompare(b.file)) }
}
