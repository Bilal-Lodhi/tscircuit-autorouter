import { isMainThread, Worker } from "node:worker_threads"
import {
  DEFAULT_TOTAL_SAMPLES,
  OUTPUT_FILE,
  OUTPUT_TEMP_DIR,
} from "./ml-training-config"
import { DatasetRow } from "./ml-training-features"

const readAllChunks = async (): Promise<DatasetRow[]> => {
  const fs = await import("node:fs/promises")
  const path = await import("node:path")

  const tempDir = path.join(process.cwd(), OUTPUT_TEMP_DIR)
  let files: string[] = []

  try {
    files = await fs.readdir(tempDir)
  } catch {
    return []
  }

  const chunkFiles = files
    .filter((name) => name.includes("ml-training-data-chunk"))
    .map((name) => path.join(tempDir, name))
    .sort()

  console.log("Found chunk files", chunkFiles.length)

  const rows: DatasetRow[] = []

  for (const filePath of chunkFiles) {
    if (rows.length >= DEFAULT_TOTAL_SAMPLES) break

    try {
      const json = await fs.readFile(filePath, "utf-8")
      const data = JSON.parse(json) as DatasetRow[]

      for (const row of data) {
        rows.push(row)
        if (rows.length >= DEFAULT_TOTAL_SAMPLES) break
      }
    } catch (error) {
      console.error("Failed to read chunk", filePath, error)
    }
  }

  return rows
}

const writeFinalDataset = async (rows: DatasetRow[]) => {
  const fs = await import("node:fs/promises")
  const path = await import("node:path")

  const filePath = path.join(process.cwd(), OUTPUT_FILE)
  const json = JSON.stringify(rows, null, 2)

  await fs.writeFile(filePath, json, "utf-8")
}

const finalizeOnExit = () => {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"]

  const handler = () => {
    finalize().finally(() => {
      process.exit()
    })
  }

  for (const signal of signals) {
    process.on(signal, handler)
  }
}

let hasFinalizeRun = false

const finalize = async () => {
  if (hasFinalizeRun) return
  hasFinalizeRun = true

  console.log("Starting finalize from chunk files")
  const rows = await readAllChunks()

  if (!rows.length) {
    console.log("No data chunks to combine")
    return
  }

  const trimmed = rows.slice(0, DEFAULT_TOTAL_SAMPLES)

  console.log("Writing final dataset", trimmed.length)
  await writeFinalDataset(trimmed)
  console.log("Final dataset written to", OUTPUT_FILE)
}

const runMain = async () => {
  const os = await import("node:os")

  const cpuCount = os.cpus().length || 1
  const envWorkers = process.env.WORKER_COUNT
  let workerCount = envWorkers ? Number(envWorkers) : cpuCount

  if (!Number.isFinite(workerCount) || workerCount <= 0) {
    workerCount = 1
  }

  const samplesPerWorker = Math.ceil(DEFAULT_TOTAL_SAMPLES / workerCount)

  console.log(
    `Generating ${DEFAULT_TOTAL_SAMPLES} samples using ${workerCount} workers`,
  )

  let finishedWorkers = 0
  let hasError = false

  console.log("Spawning workers", workerCount, "samples each", samplesPerWorker)

  await new Promise<void>((resolve, reject) => {
    for (let index = 0; index < workerCount; index++) {
      const worker = new Worker(
        new URL("./ml-training-worker.ts", import.meta.url),
        {
          workerData: {
            maxSamples: samplesPerWorker,
            workerId: index,
          },
        },
      )

      worker.on("message", (message: unknown) => {
        const data = message as { type?: string }
        if (data.type === "done") {
          finishedWorkers += 1
          console.log(
            "Worker finished",
            index,
            "total finished",
            finishedWorkers,
          )
          if (!hasError && finishedWorkers === workerCount) {
            resolve()
          }
        }
      })

      worker.on("error", (error) => {
        if (!hasError) {
          hasError = true
          reject(error)
        }
      })

      worker.on("exit", (code) => {
        if (code !== 0 && !hasError) {
          hasError = true
          reject(new Error(`worker ${index} exited with code ${code}`))
        }
      })
    }
  })

  await finalize()
}

if (isMainThread) {
  finalizeOnExit()

  runMain().catch((error) => {
    console.error("Training script error", error)
    process.exitCode = 1
  })
}
