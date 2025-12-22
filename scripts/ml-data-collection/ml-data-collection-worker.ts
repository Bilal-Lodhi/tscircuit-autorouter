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

const ML_DEBUG_VERBOSE = process.env.ML_DEBUG_VERBOSE === "1"

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

    if (ML_DEBUG_VERBOSE && attempts <= 1000) {
      const total = stats.success + stats.failure
      const ratio = total > 0 ? stats.success / total : null
      console.log(
        "ML_DEBUG_VERBOSE attempt",
        "worker",
        workerId,
        "attempts",
        attempts,
        "accepted",
        acceptedSamples,
        "success",
        stats.success,
        "failure",
        stats.failure,
        "currentRatio",
        ratio,
        "outcome",
        outcome,
      )
    }

    if (!shouldAcceptSample(stats, outcome)) {
      if (
        ML_DEBUG_VERBOSE ||
        attempts % 10000 === 0 ||
        (attempts % 1000 === 0 && acceptedSamples === 0)
      ) {
        const total = stats.success + stats.failure
        const ratio = total > 0 ? stats.success / total : null
        console.log(
          "Worker",
          workerId,
          "skipping sample due to ratio filter",
          "attempts",
          attempts,
          "accepted",
          acceptedSamples,
          "success",
          stats.success,
          "failure",
          stats.failure,
          "currentRatio",
          ratio,
        )
      }
      continue
    }

    if (ML_DEBUG_VERBOSE) {
      const totalBefore = stats.success + stats.failure
      const ratioBefore = totalBefore > 0 ? stats.success / totalBefore : null
      console.log(
        "ML_DEBUG_VERBOSE accepting sample",
        "worker",
        workerId,
        "attempts",
        attempts,
        "acceptedBefore",
        acceptedSamples,
        "successBefore",
        stats.success,
        "failureBefore",
        stats.failure,
        "ratioBefore",
        ratioBefore,
        "outcome",
        outcome,
      )
    }

    stats = updateStats(stats, outcome)
    buffer.push(row)
    acceptedSamples += 1

    if (buffer.length >= CHUNK_FLUSH_SIZE) {
      if (ML_DEBUG_VERBOSE) {
        console.log(
          "ML_DEBUG_VERBOSE flushing buffer",
          "worker",
          workerId,
          "chunkIndex",
          chunkIndex,
          "bufferLength",
          buffer.length,
        )
      }
      await flush()
    }

    if (acceptedSamples % 50 === 0 || ML_DEBUG_VERBOSE) {
      const total = stats.success + stats.failure
      const ratio = total > 0 ? stats.success / total : null
      console.log(
        `worker-${workerId}:`,
        `${acceptedSamples}/${maxSamples}`,
        "attempts",
        attempts,
        "success",
        stats.success,
        "failure",
        stats.failure,
        "currentRatio",
        ratio,
      )
    }
  }

  if (attempts >= maxAttempts && acceptedSamples < maxSamples) {
    const total = stats.success + stats.failure
    const ratio = total > 0 ? stats.success / total : null
    console.warn(
      "Worker",
      workerId,
      "stopped early due to max attempts",
      attempts,
      "accepted",
      acceptedSamples,
      "target",
      maxSamples,
      "finalSuccess",
      stats.success,
      "finalFailure",
      stats.failure,
      "finalRatio",
      ratio,
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
