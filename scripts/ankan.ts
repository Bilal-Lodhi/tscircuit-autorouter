import { readdir, readFile, writeFile, stat } from "node:fs/promises"
import path from "node:path"

const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"])
const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
  "vendor",
])

const importRe =
  /(^|\n)([ \t]*)import[ \t]+([^\n;]+?)[ \t]+from[ \t]+(['"])([^'"]+)\4([ \t]*)(assert[ \t]*\{[^}]*\})?([ \t]*);?/g

function rewriteSpecifier(spec: string): string | null {
  const s = spec.replace(/\\/g, "/")
  if (
    s.startsWith("example/") ||
    s.startsWith("examples/") ||
    s.startsWith("fixtures/") ||
    s.startsWith("../example/") ||
    s.startsWith("../examples/") ||
    s.startsWith("../fixtures/") ||
    s.includes("/example/") ||
    s.includes("/examples/") ||
    s.includes("/fixtures/")
  ) {
    const replaced = s.replace(/(^|\/)examples?(?=\/)/, "$1fixtures")
    if (replaced !== s) return replaced
  }
  return null
}

async function walk(dir: string, out: string[]) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const name = e.name
    const full = path.join(dir, name)
    if (e.isDirectory()) {
      if (SKIP_DIR.has(name)) continue
      await walk(full, out)
    } else if (e.isFile()) {
      const ext = path.extname(name)
      if (EXTS.has(ext)) out.push(full)
    } else if (e.isSymbolicLink()) {
      try {
        const st = await stat(full)
        if (st.isDirectory()) {
          const base = path.basename(full)
          if (!SKIP_DIR.has(base)) await walk(full, out)
        } else if (st.isFile()) {
          const ext = path.extname(full)
          if (EXTS.has(ext)) out.push(full)
        }
      } catch {}
    }
  }
}

let changedFiles = 0
let changedImports = 0

const files: string[] = []
await walk(process.cwd(), files)

for (const abs of files) {
  const before = await readFile(abs, "utf8")
  let count = 0

  const after = before.replace(
    importRe,
    (m, lead, indent, bindings, quote, spec, _ws, assertClause, tail) => {
      const next = rewriteSpecifier(spec)
      if (!next) return m
      count++
      const start = lead ?? "\n"
      const i = indent ?? ""
      const a = assertClause ? assertClause : 'assert { type: "json" }'
      return `${start}${i}import ${bindings} from ${quote}${next}${quote} ${a}${tail ?? ""}`
    }
  )

  if (count > 0 && after !== before) {
    await writeFile(abs, after, "utf8")
    changedFiles++
    changedImports += count
  }
}

process.stdout.write(`${changedFiles} files updated, ${changedImports} imports rewritten\n`)
