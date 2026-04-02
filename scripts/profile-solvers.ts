#!/usr/bin/env bun

import * as dataset from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver } from "../lib"
import { BaseSolver } from "../lib/solvers/BaseSolver"
import type { SimpleRouteJson } from "../lib/types/srj-types"

// --- Types ---
type SolverRecord = {
  name: string
  success: boolean
  timeMs: number
  iterations: number
  maxIterations: number
  scenarioName: string
}

type ProfileOptions = {
  scenarioName?: string
  scenarioLimit?: number
}

// --- Global profiling state ---
let currentScenarioName = ""
const allRecords: SolverRecord[] = []

// --- Monkey-patch BaseSolver.step() to capture timing/iteration data ---
const origStep = BaseSolver.prototype.step

BaseSolver.prototype.step = function (
  this: BaseSolver & {
    __profilingStartTime?: number
    __profilingRecorded?: boolean
  },
) {
  // Record start time on first step
  if (this.__profilingStartTime === undefined && !this.solved && !this.failed) {
    this.__profilingStartTime = performance.now()
  }

  const wasDone = this.solved || this.failed

  try {
    origStep.call(this)
  } finally {
    // Record once when solver transitions to solved/failed
    if (!wasDone && !this.__profilingRecorded && (this.solved || this.failed)) {
      this.__profilingRecorded = true
      const timeMs =
        performance.now() - (this.__profilingStartTime ?? performance.now())
      allRecords.push({
        name: this.getSolverName(),
        success: this.solved && !this.failed,
        timeMs,
        iterations: this.iterations,
        maxIterations: this.MAX_ITERATIONS,
        scenarioName: currentScenarioName,
      })
    }
  }
}

// --- Helpers ---
const parseArgs = (): ProfileOptions => {
  const args = process.argv.slice(2)
  const options: ProfileOptions = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--scenario") {
      const scenarioName = args[i + 1]
      if (!scenarioName || scenarioName.startsWith("-")) {
        throw new Error("--scenario requires a scenario name")
      }
      options.scenarioName = scenarioName
      i += 1
    } else if (arg === "--scenario-limit") {
      const rawScenarioLimit = args[i + 1]
      if (!rawScenarioLimit || rawScenarioLimit.startsWith("-")) {
        throw new Error("--scenario-limit requires a value")
      }
      options.scenarioLimit = Number.parseInt(rawScenarioLimit, 10)
      i += 1
    } else if (arg === "-h" || arg === "--help") {
      console.log(
        [
          "Usage: bun scripts/profile-solvers.ts [--scenario NAME] [--scenario-limit N]",
          "",
          "Options:",
          "  --scenario NAME      Run only the named scenario",
          "  --scenario-limit N   Run only first N scenarios",
          "  -h, --help           Show this help",
        ].join("\n"),
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (
    options.scenarioLimit !== undefined &&
    (!Number.isFinite(options.scenarioLimit) || options.scenarioLimit < 1)
  ) {
    throw new Error("--scenario-limit must be a positive integer")
  }

  return options
}

const loadScenarios = (scenarioName?: string, scenarioLimit?: number) => {
  const allScenarios = Object.entries(dataset)
    .filter(([, value]) => Boolean(value) && typeof value === "object")
    .sort(([a], [b]) => a.localeCompare(b)) as Array<[string, SimpleRouteJson]>

  const filteredScenarios = scenarioName
    ? allScenarios.filter(([name]) => name === scenarioName)
    : allScenarios

  return scenarioLimit
    ? filteredScenarios.slice(0, scenarioLimit)
    : filteredScenarios
}

const getPercentile = (values: number[], p: number): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * p
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  const weight = index - lower
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight
}

const formatTime = (ms: number | null): string => {
  if (ms === null) return "n/a"
  if (ms < 1000) return `${ms.toFixed(2)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

const formatIter = (n: number | null): string => {
  if (n === null) return "n/a"
  return String(Math.round(n))
}

const formatTable = (headers: string[], body: string[][]): string => {
  const widths = headers.map((h, i) => {
    const maxBody = Math.max(...body.map((row) => row[i].length), 0)
    return Math.max(h.length, maxBody)
  })

  const sep = `+${widths.map((w) => "-".repeat(w + 2)).join("+")}+`
  const headerLine = `| ${headers.map((h, i) => h.padEnd(widths[i])).join(" | ")} |`
  const bodyLines = body.map(
    (cells) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(" | ")} |`,
  )

  return [sep, headerLine, sep, ...bodyLines, sep].join("\n")
}

// --- Main ---
const main = () => {
  const opts = parseArgs()
  const scenarios = loadScenarios(opts.scenarioName, opts.scenarioLimit)

  if (scenarios.length === 0) {
    if (opts.scenarioName) {
      throw new Error(`Scenario not found: ${opts.scenarioName}`)
    }
    throw new Error("No scenarios found")
  }

  console.log(
    `Profiling ${scenarios.length} scenarios with AutoroutingPipelineSolver...\n`,
  )

  let solved = 0
  let total = 0

  for (const [scenarioName, scenario] of scenarios) {
    currentScenarioName = scenarioName
    total++
    const solver = new AutoroutingPipelineSolver(scenario)

    try {
      solver.solve()
    } catch {}

    if (solver.solved) {
      solved++
      console.log(
        `  [OK]   ${scenarioName} ${formatTime(solver.timeToSolve ?? 0)}`,
      )
    } else {
      console.log(
        `  [FAIL] ${scenarioName} ${formatTime(solver.timeToSolve ?? 0)}`,
      )
    }
  }

  const failed = total - solved
  console.log(`\n${solved}/${total} scenarios solved (${failed} failed)\n`)

  // --- Aggregate by solver name + success/fail ---
  // Skip the top-level pipeline solver itself
  const records = allRecords.filter(
    (r) => !r.name.startsWith("AutoroutingPipelineSolver"),
  )

  const groupsByName = new Map<string, SolverRecord[]>()
  for (const record of records) {
    if (!groupsByName.has(record.name)) groupsByName.set(record.name, [])
    groupsByName.get(record.name)!.push(record)
  }

  type Row = {
    name: string
    attemptCount: number
    scenarioCount: number
    scenarioSuccessRate: number
    maxIter: number
    totalTimeMs: number
    p50Time: number | null
    p95Time: number | null
    p50Iter: number | null
    p95Iter: number | null
  }

  const rows: Row[] = []
  for (const [name, recs] of groupsByName) {
    const scenariosTouched = new Set(recs.map((r) => r.scenarioName))
    const scenariosWithSuccess = new Set(
      recs.filter((r) => r.success).map((r) => r.scenarioName),
    )
    const times = recs.map((r) => r.timeMs)
    const iters = recs.map((r) => r.iterations)
    const maxIter = Math.round(Math.max(...recs.map((r) => r.maxIterations)))
    const totalTimeMs = recs.reduce((sum, r) => sum + r.timeMs, 0)
    rows.push({
      name,
      attemptCount: recs.length,
      scenarioCount: scenariosTouched.size,
      scenarioSuccessRate:
        scenariosTouched.size === 0
          ? 0
          : (scenariosWithSuccess.size / scenariosTouched.size) * 100,
      maxIter,
      totalTimeMs,
      p50Time: getPercentile(times, 0.5),
      p95Time: getPercentile(times, 0.95),
      p50Iter: getPercentile(iters, 0.5),
      p95Iter: getPercentile(iters, 0.95),
    })
  }

  // Sort by total accumulated time (slowest first), then solver name
  rows.sort((a, b) => {
    if (a.totalTimeMs !== b.totalTimeMs) return b.totalTimeMs - a.totalTimeMs
    return a.name.localeCompare(b.name)
  })

  const headers = [
    "Solver",
    "Attempts",
    "Scenarios",
    "Success %",
    "MAX_ITER",
    "Total Time",
    "P50 Time",
    "P95 Time",
    "P50 Iters",
    "P95 Iters",
  ]

  const body = rows.map((r) => [
    r.name,
    String(r.attemptCount),
    String(r.scenarioCount),
    `${r.scenarioSuccessRate.toFixed(0)}%`,
    String(r.maxIter),
    formatTime(r.totalTimeMs),
    formatTime(r.p50Time),
    formatTime(r.p95Time),
    formatIter(r.p50Iter),
    formatIter(r.p95Iter),
  ])

  const table = formatTable(headers, body)
  console.log(table)
  console.log()
}

main()
