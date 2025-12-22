import { parentPort, workerData } from "node:worker_threads"
import {
  CHUNK_FLUSH_SIZE,
  OUTPUT_CHUNK_PREFIX,
  OUTPUT_TEMP_DIR,
} from "./ml-data-collection-config"
import {
  DatasetRow,
  evaluateCandidate,
  generateRandomCandidate,
} from "./ml-data-collection-features"
import {
  createInitialStats,
  getMaxAttempts,
  shouldAcceptSample,
  updateStats,
} from "./ml-data-collection-sampler"

const run = async () => {
  const { maxSamples, workerId } = workerData as {
    maxSamples: number
    workerId: number
  }

  console.log("Worker starting", workerId, "max samples", maxSamples)

  const fs = await import("node:fs/promises")
  const path = await import("node:path")

  const tempDir = path.join(process.cwd(), OUTPUT_TEMP_DIR)
  await fs.mkdir(tempDir, { recursive: true })

  let buffer: DatasetRow[] = []
  let chunkIndex = 0
  let acceptedSamples = 0
  let stats = createInitialStats()
  const maxAttempts = getMaxAttempts(maxSamples)
  let attempts = 0

  const flush = async () => {
    if (!buffer.length) return

    const fileName = `${OUTPUT_CHUNK_PREFIX}-w${workerId}-c${chunkIndex}.json`
    const filePath = path.join(tempDir, fileName)
    const json = JSON.stringify(buffer, null, 2)

    await fs.writeFile(filePath, json, "utf-8")
    console.log(
      "Worker chunk written",
      workerId,
      "chunk",
      chunkIndex,
      "rows",
      buffer.length,
    )
    buffer = []
    chunkIndex += 1
  }

  while (acceptedSamples < maxSamples && attempts < maxAttempts) {
    attempts += 1

    const candidate = generateRandomCandidate()
    const row = evaluateCandidate(candidate)
    const outcome = row.did_hight_density_solver_find_solution
      ? "success"
      : "failure"

    if (!shouldAcceptSample(stats, outcome)) {
      continue
    }

    stats = updateStats(stats, outcome)
    buffer.push(row)
    acceptedSamples += 1

    if (buffer.length >= CHUNK_FLUSH_SIZE) {
      await flush()
    }

    if (acceptedSamples % 50 === 0) {
      console.log(`worker-${workerId}: ${acceptedSamples}/${maxSamples}`)
    }
  }

  if (attempts >= maxAttempts && acceptedSamples < maxSamples) {
    console.warn(
      "Worker",
      workerId,
      "stopped early due to max attempts",
      attempts,
      "accepted",
      acceptedSamples,
      "target",
      maxSamples,
    )
  }

  if (buffer.length) {
    await flush()
  }

  console.log("Worker finished", workerId)

  if (parentPort) {
    parentPort.postMessage({
      type: "done",
      workerId,
    })
  }
}

run().catch((error) => {
  console.error("Worker error", error)
  process.exitCode = 1
})
