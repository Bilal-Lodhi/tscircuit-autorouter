#!/usr/bin/env bun
// @ts-nocheck

import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import stringify from "fast-json-stable-stringify"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver2_PortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver2_PortPointPathing"
import { createSingleNodeHighDensityRepairParamsList } from "lib/solvers/HighDensityRepairSolver/HighDensityRepairSolver"

type CircuitRunResult = {
  circuitId: string
  status: "ok" | "timed_out" | "failed"
  exportedSampleCount: number
  detail?: string
}

type WorkerSummary = {
  circuitId: string
  exportedSampleCount: number
  startIndex: number
}

const OUTPUT_DIR = path.resolve(process.cwd(), "dataset-hd08")
const CIRCUIT_KEY_REGEX = /^circuit(\d{3})$/
const DEFAULT_TIMEOUT_MS = 30_000

const parseArgs = () => {
  const args = process.argv.slice(2)
  let circuitId: string | null = null
  let limit: number | null = null
  let worker = false
  let timeoutMs = DEFAULT_TIMEOUT_MS
  let startIndex = 1

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === "--worker") {
      worker = true
      continue
    }
    if (arg === "--sample" || arg === "--circuit") {
      const value = (args[i + 1] ?? "").replace(/[^0-9]/g, "")
      if (!value) {
        throw new Error(`${arg} requires a numeric value`)
      }
      circuitId = value.padStart(3, "0").slice(-3)
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
    if (arg === "--start-index") {
      const value = Number.parseInt(args[i + 1] ?? "", 10)
      if (!Number.isFinite(value) || value < 1) {
        throw new Error("--start-index must be a positive integer")
      }
      startIndex = value
      i += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return { circuitId, limit, worker, timeoutMs, startIndex }
}

const getDatasetCircuitIds = (): string[] => {
  return Object.keys(dataset01)
    .map((key) => key.match(CIRCUIT_KEY_REGEX)?.[1] ?? null)
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b))
}

const getCircuitSrj = (circuitId: string) => dataset01[`circuit${circuitId}`]

const getNodePortPointsForRepairStage = (
  solver: AutoroutingPipelineSolver2_PortPointPathing,
) => {
  return (
    solver.uniformPortDistributionSolver?.getOutput() ??
    solver.multiSectionPortPointOptimizer?.getNodesWithPortPoints() ??
    solver.portPointPathingSolver?.getNodesWithPortPoints() ??
    []
  )
}

const toSampleFileName = (sampleIndex: number) =>
  `sample${String(sampleIndex).padStart(3, "0")}.json`

const writeCircuitSamples = async (circuitId: string, startIndex: number) => {
  const srj = getCircuitSrj(circuitId)
  if (!srj) {
    throw new Error(`Dataset sample circuit${circuitId} was not found`)
  }

  const solver = new AutoroutingPipelineSolver2_PortPointPathing(srj as any)
  solver.solveUntilPhase("highDensityRepairSolver")

  const singleNodeParamsList = createSingleNodeHighDensityRepairParamsList({
    nodePortPoints: getNodePortPointsForRepairStage(solver),
    obstacles: solver.srj.obstacles,
    hdRoutes: solver.highDensityRouteSolver?.routes ?? [],
    connMap: solver.connMap,
  })

  await mkdir(OUTPUT_DIR, { recursive: true })

  for (const [index, singleNodeParams] of singleNodeParamsList.entries()) {
    const sampleIndex = startIndex + index
    const outputPath = path.join(OUTPUT_DIR, toSampleFileName(sampleIndex))
    await writeFile(
      outputPath,
      `${stringify(singleNodeParams, { space: 2 })}\n`,
    )
  }

  return {
    circuitId,
    exportedSampleCount: singleNodeParamsList.length,
    startIndex,
  } satisfies WorkerSummary
}

const runCircuitWithTimeout = async (
  circuitId: string,
  startIndex: number,
  timeoutMs: number,
): Promise<CircuitRunResult> => {
  return await new Promise((resolve) => {
    let settled = false
    let timedOut = false
    let stdout = ""
    let stderr = ""

    const child = spawn(
      process.execPath,
      [
        import.meta.path,
        "--worker",
        "--circuit",
        circuitId,
        "--start-index",
        String(startIndex),
      ],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    )

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk)
    })

    const settle = (result: CircuitRunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
      settle({
        circuitId,
        status: "timed_out",
        exportedSampleCount: 0,
        detail: `timed out after ${timeoutMs}ms`,
      })
    }, timeoutMs)

    child.once("error", (error) => {
      settle({
        circuitId,
        status: "failed",
        exportedSampleCount: 0,
        detail: String(error),
      })
    })

    child.once("exit", (code, signal) => {
      if (timedOut) return
      if (code !== 0) {
        settle({
          circuitId,
          status: "failed",
          exportedSampleCount: 0,
          detail:
            stderr.trim() || `child exited with code=${code} signal=${signal}`,
        })
        return
      }

      try {
        const summary = JSON.parse(stdout.trim()) as WorkerSummary
        settle({
          circuitId,
          status: "ok",
          exportedSampleCount: summary.exportedSampleCount,
        })
      } catch (error) {
        settle({
          circuitId,
          status: "failed",
          exportedSampleCount: 0,
          detail: `invalid worker summary: ${error}`,
        })
      }
    })
  })
}

const runParent = async () => {
  const { circuitId, limit, timeoutMs } = parseArgs()
  let circuitIds = getDatasetCircuitIds()
  if (circuitId) {
    circuitIds = circuitIds.filter((id) => id === circuitId)
  }
  if (limit !== null) {
    circuitIds = circuitIds.slice(0, limit)
  }
  if (circuitIds.length === 0) {
    throw new Error("No dataset circuits matched the provided filters")
  }

  const timedOutCircuits: string[] = []
  const failedCircuits: string[] = []
  let nextSampleIndex = 1
  let exportedSampleCount = 0

  for (const currentCircuitId of circuitIds) {
    const result = await runCircuitWithTimeout(
      currentCircuitId,
      nextSampleIndex,
      timeoutMs,
    )

    if (result.status === "ok") {
      const startSampleIndex = nextSampleIndex
      const endSampleIndex = nextSampleIndex + result.exportedSampleCount - 1
      exportedSampleCount += result.exportedSampleCount
      nextSampleIndex += result.exportedSampleCount

      if (result.exportedSampleCount === 0) {
        console.log(`circuit${currentCircuitId}: exported 0 node samples`)
      } else {
        console.log(
          `circuit${currentCircuitId}: wrote ${result.exportedSampleCount} node samples (${toSampleFileName(startSampleIndex)}-${toSampleFileName(endSampleIndex)})`,
        )
      }
      continue
    }

    if (result.status === "timed_out") {
      timedOutCircuits.push(currentCircuitId)
      console.error(`timed out circuit${currentCircuitId} after ${timeoutMs}ms`)
      continue
    }

    failedCircuits.push(currentCircuitId)
    console.error(`failed circuit${currentCircuitId}: ${result.detail}`)
  }

  console.log(
    `exported ${exportedSampleCount} node-level SingleNodeHighDensityRepair inputs from ${circuitIds.length} circuits to ${OUTPUT_DIR}`,
  )

  if (timedOutCircuits.length > 0) {
    console.error(`timed out circuits: ${timedOutCircuits.join(", ")}`)
  }
  if (failedCircuits.length > 0) {
    console.error(`failed circuits: ${failedCircuits.join(", ")}`)
  }
  if (timedOutCircuits.length > 0 || failedCircuits.length > 0) {
    process.exit(1)
  }
}

const runWorker = async () => {
  const { circuitId, startIndex } = parseArgs()
  if (!circuitId) {
    throw new Error("--worker requires --circuit")
  }

  const summary = await writeCircuitSamples(circuitId, startIndex)
  process.stdout.write(JSON.stringify(summary))
}

const { worker } = parseArgs()
const main = worker ? runWorker : runParent

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
