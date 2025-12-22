import { parentPort, workerData } from "node:worker_threads"
import {
  CHUNK_FLUSH_SIZE,
  OUTPUT_CHUNK_PREFIX,
  OUTPUT_TEMP_DIR,
} from "./ml-training-config"
import {
  DatasetRow,
  evaluateCandidate,
  generateRandomCandidate,
} from "./ml-training-features"

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

  const flush = async () => {
    if (!buffer.length) return

    const fileName = `${OUTPUT_CHUNK_PREFIX}-w${workerId}-c${chunkIndex}.json`
    const filePath = path.join(tempDir, fileName)
    const json = JSON.stringify(buffer, null, 2)

    await fs.writeFile(filePath, json, "utf-8")
    buffer = []
    chunkIndex += 1
  }

  for (let index = 0; index < maxSamples; index++) {
    const candidate = generateRandomCandidate()
    const row = evaluateCandidate(candidate)
    buffer.push(row)

    if (buffer.length >= CHUNK_FLUSH_SIZE) {
      await flush()
    }

    if ((index + 1) % 50 === 0) {
      console.log(`worker-${workerId}: ${index + 1}/${maxSamples}`)
    }
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
