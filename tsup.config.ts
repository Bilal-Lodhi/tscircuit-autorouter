import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["lib/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  minify: "terser",
  external: ["@tscircuit/core", "circuit-to-svg"],
  keepNames: true,
  terserOptions: {
    mangle: false,
    keep_classnames: true,
    keep_fnames: true,
  },
})
