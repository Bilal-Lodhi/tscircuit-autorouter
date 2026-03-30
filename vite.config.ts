import path from "node:path"
import fs from "node:fs"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tsconfigPaths from "vite-tsconfig-paths"
import type { Plugin as EsbuildPlugin } from "esbuild"

const rectdiffRoot = path.resolve(
  __dirname,
  "node_modules/@tscircuit/rectdiff",
)

const resolveExistingPath = (basePath: string) => {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
    path.join(basePath, "index.jsx"),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return null
}

const resolveRectdiffLibImport = (source: string, importer?: string | null) => {
  if (!importer?.includes("/node_modules/@tscircuit/rectdiff/")) return null
  if (!source.startsWith("lib/")) return null
  return resolveExistingPath(path.resolve(rectdiffRoot, source))
}

const rectdiffLibResolver = () => ({
  name: "rectdiff-lib-resolver",
  enforce: "pre" as const,
  resolveId(source: string, importer?: string) {
    return resolveRectdiffLibImport(source, importer)
  },
})

const rectdiffLibEsbuildResolver = (): EsbuildPlugin => ({
  name: "rectdiff-lib-resolver",
  setup(build) {
    build.onResolve({ filter: /^lib\// }, (args) => {
      const resolved = resolveRectdiffLibImport(args.path, args.importer)
      return resolved ? { path: resolved } : null
    })
  },
})

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [rectdiffLibResolver(), react(), tsconfigPaths()],
  optimizeDeps: {
    esbuildOptions: {
      plugins: [rectdiffLibEsbuildResolver()],
    },
  },
})
