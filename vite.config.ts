import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tsconfigPaths from "vite-tsconfig-paths"
import { fileURLToPath, URL } from "node:url"

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      lib: fileURLToPath(new URL("./lib", import.meta.url)),
      examples: fileURLToPath(new URL("./examples", import.meta.url)),
      tests: fileURLToPath(new URL("./tests", import.meta.url)),
    },
  },
  plugins: [react(), tsconfigPaths()],
})
