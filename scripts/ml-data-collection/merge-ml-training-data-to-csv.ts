import {
  OUTPUT_TEMP_DIR,
  OUTPUT_CHUNK_PREFIX,
} from "./ml-data-collection-config"
import type { DatasetRow } from "./ml-data-collection-features"

const OUTPUT_CSV_FILE = "ml-training-data.csv"

const readAllChunks = async (): Promise<DatasetRow[]> => {
  const fs = await import("node:fs/promises")
  const path = await import("node:path")

  const tempDir = path.join(process.cwd(), OUTPUT_TEMP_DIR)

  let files: string[] = []
  try {
    files = await fs.readdir(tempDir)
  } catch {
    console.error("Could not read temp directory", tempDir)
    return []
  }

  const chunkFiles = files
    .filter((name) => name.startsWith(OUTPUT_CHUNK_PREFIX))
    .map((name) => path.join(tempDir, name))
    .sort()

  console.log("Found chunk files", chunkFiles.length)

  const rows: DatasetRow[] = []

  for (const filePath of chunkFiles) {
    try {
      const json = await fs.readFile(filePath, "utf-8")
      const data = JSON.parse(json) as DatasetRow[]

      for (const row of data) {
        rows.push(row)
      }
    } catch (error) {
      console.error("Failed to read chunk", filePath, error)
    }
  }

  return rows
}

const toCsv = (rows: DatasetRow[]): string => {
  if (!rows.length) return ""

  const headerSet = new Set<string>()

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      headerSet.add(key)
    }
  }

  const headers = Array.from(headerSet).sort()

  const escapeCell = (value: unknown): string => {
    if (value === null || value === undefined) return ""

    if (typeof value === "string") {
      const escaped = value.replace(/"/g, '""')
      return `"${escaped}"`
    }

    return String(value)
  }

  const lines: string[] = []
  lines.push(headers.join(","))

  for (const row of rows) {
    const cells = headers.map((key) =>
      escapeCell((row as Record<string, unknown>)[key]),
    )
    lines.push(cells.join(","))
  }

  return lines.join("\n")
}

const writeCsv = async (rows: DatasetRow[]) => {
  const fs = await import("node:fs/promises")
  const path = await import("node:path")

  const filePath = path.join(process.cwd(), OUTPUT_CSV_FILE)
  const csv = toCsv(rows)

  if (!csv) {
    console.log("No rows to write, skipping CSV creation")
    return
  }

  await fs.writeFile(filePath, csv, "utf-8")
  console.log("CSV written to", filePath)
}

const main = async () => {
  const rows = await readAllChunks()

  if (!rows.length) {
    console.log("No rows found in chunk files")
    return
  }

  await writeCsv(rows)
}

main().catch((error) => {
  console.error("Error merging ML training data into CSV", error)
  process.exitCode = 1
})
