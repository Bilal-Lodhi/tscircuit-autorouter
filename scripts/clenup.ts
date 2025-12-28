import fs from "fs"
import path from "path"

const rootDir = process.cwd()
const excluded = new Set(["node_modules", ".git"])

function shouldProcessFile(p: string) {
  return /\.(ts|tsx|mts|cts)$/.test(p)
}

function processFile(filePath: string) {
  console.log("file", filePath)
  const content = fs.readFileSync(filePath, "utf8")

  const updated = content.replace(
    /(import\s+(?:type\s+)?[\s\S]*?\sfrom\s+)["']examples\/([^"']+)["']/g,
    (_m, prefix, rest) => `${prefix}"${rest}"`,
  )

  if (updated !== content) fs.writeFileSync(filePath, updated, "utf8")
}

function walk(dir: string) {
  console.log("dir", dir)
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(fullPath)
    else if (entry.isFile() && shouldProcessFile(fullPath))
      processFile(fullPath)
  }
}

walk(rootDir)
