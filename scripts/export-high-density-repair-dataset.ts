#!/usr/bin/env bun
// @ts-nocheck

import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import stringify from "fast-json-stable-stringify"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver2_PortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver2_PortPointPathing"

type SampleRunResult = {
  sampleId: string
  status: "ok" | "timed_out" | "failed"
  detail?: string
}

const OUTPUT_DIR = path.resolve(process.cwd(), "dataset-hd08")
const CIRCUIT_KEY_REGEX = /^circuit(\d{3})$/
const DEFAULT_TIMEOUT_MS = 180_000

const parseArgs = () => {
  const args = process.argv.slice(2)
  let sampleId: string | null = null
  let limit: number | null = null
  let worker = false
  let timeoutMs = DEFAULT_TIMEOUT_MS

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === "--worker") {
      worker = true
      continue
    }
    if (arg === "--sample") {
      const value = (args[i + 1] ?? "").replace(/[^0-9]/g, "")
      if (!value) {
        throw new Error("--sample requires a numeric value")
      }
      sampleId = value.padStart(3, "0").slice(-3)
      i += 1
      continue
    }
    if (arg === "--limit") {
      const value = Number.parseInt(args[i + 1] ?? "", 10)
      if (!Number.isFinite(value) || value < 1) {
        throw new Error("--limit must be a positive integer")
      }
      limit = value
      i += 1
      continue
    }
    if (arg === "--timeout-ms") {
      const value = Number.parseInt(args[i + 1] ?? "", 10)
      if (!Number.isFinite(value) || value < 1) {
        throw new Error("--timeout-ms must be a positive integer")
      }
      timeoutMs = value
      i += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return { sampleId, limit, worker, timeoutMs }
}

const getDatasetSampleIds = (): string[] => {
  return Object.keys(dataset01)
    .map((key) => key.match(CIRCUIT_KEY_REGEX)?.[1] ?? null)
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b))
}

const getSampleSrj = (sampleId: string) => {
  return dataset01[`circuit${sampleId}`]
}

const writeSample = async (sampleId: string) => {
  const srj = getSampleSrj(sampleId)
  if (!srj) {
    throw new Error(`Dataset sample circuit${sampleId} was not found`)
  }

  await mkdir(OUTPUT_DIR, { recursive: true })

  const solver = new AutoroutingPipelineSolver2_PortPointPathing(srj as any)
  solver.solveUntilPhase("highDensityRepairSolver")
  solver.step()

  const params = solver.highDensityRepairSolver?.params
  if (!params) {
    throw new Error(
      `HighDensityRepairSolver was not constructed for sample ${sampleId}`,
    )
  }

  const outputPath = path.join(OUTPUT_DIR, `sample${sampleId}.json`)
  await writeFile(outputPath, `${stringify(params, { space: 2 })}\n`)
  console.log(`wrote sample${sampleId}.json`)
}

const runSampleWithTimeout = async (
  sampleId: string,
  timeoutMs: number,
): Promise<SampleRunResult> => {
  return await new Promise((resolve) => {
    let settled = false
    let timedOut = false
    const child = spawn(
      process.execPath,
      [import.meta.path, "--worker", "--sample", sampleId],
      {
        cwd: process.cwd(),
        stdio: "inherit",
      },
    )

    const settle = (result: SampleRunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
      settle({
        sampleId,
        status: "timed_out",
        detail: `timed out after ${timeoutMs}ms`,
      })
    }, timeoutMs)

    child.once("error", (error) => {
      settle({
        sampleId,
        status: "failed",
        detail: String(error),
      })
    })

    child.once("exit", (code, signal) => {
      if (timedOut) return
      if (code === 0) {
        settle({ sampleId, status: "ok" })
        return
      }
      settle({
        sampleId,
        status: "failed",
        detail: `child exited with code=${code} signal=${signal}`,
      })
    })
  })
}

const runParent = async () => {
  const { sampleId, limit, timeoutMs } = parseArgs()
  let sampleIds = getDatasetSampleIds()
  if (sampleId) {
    sampleIds = sampleIds.filter((id) => id === sampleId)
  }
  if (limit !== null) {
    sampleIds = sampleIds.slice(0, limit)
  }
  if (sampleIds.length === 0) {
    throw new Error("No dataset samples matched the provided filters")
  }

  const timedOutSamples: string[] = []
  const failedSamples: string[] = []
  let exportedCount = 0

  for (const currentSampleId of sampleIds) {
    const result = await runSampleWithTimeout(currentSampleId, timeoutMs)
    if (result.status === "ok") {
      exportedCount += 1
      continue
    }
    if (result.status === "timed_out") {
      timedOutSamples.push(currentSampleId)
      console.error(
        `timed out sample${currentSampleId}.json after ${timeoutMs}ms`,
      )
      continue
    }
    failedSamples.push(currentSampleId)
    console.error(`failed sample${currentSampleId}.json: ${result.detail}`)
  }

  console.log(
    `exported ${exportedCount} of ${sampleIds.length} HighDensityRepairSolver samples to ${OUTPUT_DIR}`,
  )

  if (timedOutSamples.length > 0) {
    console.error(`timed out samples: ${timedOutSamples.join(", ")}`)
  }
  if (failedSamples.length > 0) {
    console.error(`failed samples: ${failedSamples.join(", ")}`)
  }
  if (timedOutSamples.length > 0 || failedSamples.length > 0) {
    process.exit(1)
  }
}

const runWorker = async () => {
  const { sampleId } = parseArgs()
  if (!sampleId) {
    throw new Error("--worker requires --sample")
  }
  await writeSample(sampleId)
}

const { worker } = parseArgs()
const main = worker ? runWorker : runParent

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
