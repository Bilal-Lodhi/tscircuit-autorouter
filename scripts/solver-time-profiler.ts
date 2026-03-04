#!/usr/bin/env bun

/**
 * Solver Time Profiler
 *
 * Monkey-patches BaseSolver.step() to record wall-clock time for EVERY solver
 * instance (not just pipeline phases). After each scenario, prints the top 3
 * most expensive solver instances. At the end, prints aggregate breakdowns.
 *
 * Usage:
 *   bun scripts/solver-time-profiler.ts [--solver <PipelineName>] [--scenario-limit <N>]
 *
 * Options:
 *   --solver          Pipeline solver to run (default: AutoroutingPipelineSolver3_HgPortPointPathing)
 *   --scenario-limit  Only run the first N scenarios (default: 40)
 */

import * as dataset from "@tscircuit/autorouting-dataset-01"
import { BaseSolver } from "../lib/solvers/BaseSolver"
import * as autorouterModule from "../lib"
import type { SimpleRouteJson } from "../lib/types/srj-types"

type SolverTimeRecord = {
  solverName: string
  timeMs: number
  iterations: number
  solved: boolean
  scenarioName: string
}

const parseArgs = () => {
  const args = process.argv.slice(2)
  const options = {
    solverName: "AutoroutingPipelineSolver3_HgPortPointPathing",
    scenarioLimit: 40,
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--solver") {
      options.solverName = args[++i]
    } else if (args[i] === "--scenario-limit") {
      options.scenarioLimit = parseInt(args[++i], 10)
    }
  }

  return options
}

const getPercentile = (sorted: number[], percentile: number): number => {
  if (sorted.length === 0) return 0
  const index = (sorted.length - 1) * percentile
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  const weight = index - lower
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight
}

const fmtMs = (ms: number): string => {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

const fmtPct = (part: number, total: number): string => {
  if (total === 0) return "0%"
  return `${((part / total) * 100).toFixed(1)}%`
}

const padRight = (s: string, len: number) => s.padEnd(len)
const padLeft = (s: string, len: number) => s.padStart(len)

const main = async () => {
  const opts = parseArgs()

  // Load scenarios
  const allScenarios = Object.entries(dataset)
    .filter(([, value]) => Boolean(value) && typeof value === "object")
    .sort(([a], [b]) => a.localeCompare(b)) as Array<
    [string, SimpleRouteJson]
  >

  const scenarios = allScenarios.slice(0, opts.scenarioLimit)

  console.log(`Scenarios: ${scenarios.length}`)
  console.log(`Pipeline solver: ${opts.solverName}`)
  console.log()

  // Get solver constructor
  const SolverConstructor = (autorouterModule as any)[opts.solverName]
  if (!SolverConstructor) {
    console.error(`Solver "${opts.solverName}" not found in exports`)
    process.exit(1)
  }

  // ---- Monkey-patch BaseSolver.step to track time for EVERY solver ----
  const solverStartTimes = new WeakMap<BaseSolver, number>()
  const allRecords: SolverTimeRecord[] = []
  let currentScenarioRecords: SolverTimeRecord[] = []
  let currentScenarioName = ""

  const origStep = BaseSolver.prototype.step
  BaseSolver.prototype.step = function (this: BaseSolver) {
    // Record start time on first iteration (iterations is 0 before origStep increments it)
    if (this.iterations === 0) {
      solverStartTimes.set(this, performance.now())
    }
    origStep.call(this)
  }

  BaseSolver.onSolverCompleted = (solver: BaseSolver) => {
    const startTime = solverStartTimes.get(solver)
    const elapsed = startTime != null ? performance.now() - startTime : 0
    const record: SolverTimeRecord = {
      solverName: solver.getSolverName(),
      timeMs: elapsed,
      iterations: solver.iterations,
      solved: solver.solved,
      scenarioName: currentScenarioName,
    }
    allRecords.push(record)
    currentScenarioRecords.push(record)
  }

  // ---- Run scenarios ----
  type ScenarioResult = {
    name: string
    totalTimeMs: number
    solved: boolean
  }
  const scenarioResults: ScenarioResult[] = []
  let solvedCount = 0
  let failedCount = 0

  for (const [name, scenario] of scenarios) {
    currentScenarioName = name
    currentScenarioRecords = []
    const startTime = performance.now()

    let scenarioSolved = false
    try {
      const solver = new SolverConstructor(scenario)
      solver.solve()
      scenarioSolved = solver.solved
    } catch (e) {
      // error logged below
    }

    const totalTimeMs = performance.now() - startTime
    if (scenarioSolved) solvedCount++
    else failedCount++

    scenarioResults.push({ name, totalTimeMs, solved: scenarioSolved })

    const status = scenarioSolved ? "SOLVED" : "FAILED"
    console.log(
      `[${solvedCount + failedCount}/${scenarios.length}] ${status} ${name} (${fmtMs(totalTimeMs)})`,
    )

    // Print top 3 most expensive solver instances for this scenario
    const top3 = [...currentScenarioRecords]
      .sort((a, b) => b.timeMs - a.timeMs)
      .slice(0, 3)
    for (const rec of top3) {
      console.log(
        `    ${padRight(rec.solverName, 50)} ${padLeft(fmtMs(rec.timeMs), 8)}  (${rec.iterations} iters, ${rec.solved ? "solved" : "failed"})`,
      )
    }
  }

  // Restore
  BaseSolver.prototype.step = origStep
  BaseSolver.onSolverCompleted = null

  // ============================================================
  // AGGREGATE ANALYSIS
  // ============================================================

  const totalTime = scenarioResults.reduce((s, r) => s + r.totalTimeMs, 0)

  console.log("\n" + "=".repeat(90))
  console.log("SOLVER TIME PROFILER RESULTS")
  console.log("=".repeat(90))
  console.log(
    `\nPipeline: ${solvedCount}/${scenarios.length} solved (${fmtPct(solvedCount, scenarios.length)})`,
  )
  console.log(`Total wall-clock time: ${fmtMs(totalTime)}`)

  // ---- SECTION 1: Per-solver-class time (the main output) ----
  console.log("\n" + "-".repeat(90))
  console.log("SOLVER CLASS TIME BREAKDOWN (sum of all instances across all scenarios)")
  console.log("-".repeat(90))

  const solverClassTotals = new Map<
    string,
    { times: number[]; iterations: number[]; count: number; solvedCount: number }
  >()

  for (const rec of allRecords) {
    if (!solverClassTotals.has(rec.solverName)) {
      solverClassTotals.set(rec.solverName, {
        times: [],
        iterations: [],
        count: 0,
        solvedCount: 0,
      })
    }
    const entry = solverClassTotals.get(rec.solverName)!
    entry.times.push(rec.timeMs)
    entry.iterations.push(rec.iterations)
    entry.count++
    if (rec.solved) entry.solvedCount++
  }

  const nameCol = 50
  const solverEntries = [...solverClassTotals.entries()]
    .map(([name, data]) => ({
      name,
      ...data,
      total: data.times.reduce((s, t) => s + t, 0),
    }))
    .sort((a, b) => b.total - a.total)

  console.log(
    `${padRight("Solver Class", nameCol)} ${padLeft("Total", 9)} ${padLeft("% Time", 8)} ${padLeft("Count", 7)} ${padLeft("P50", 9)} ${padLeft("P95", 9)} ${padLeft("P99", 9)} ${padLeft("Max", 9)}`,
  )
  console.log("-".repeat(90))

  for (const entry of solverEntries) {
    const sorted = [...entry.times].sort((a, b) => a - b)
    const p50 = getPercentile(sorted, 0.5)
    const p95 = getPercentile(sorted, 0.95)
    const p99 = getPercentile(sorted, 0.99)
    const max = sorted[sorted.length - 1]

    console.log(
      `${padRight(entry.name, nameCol)} ${padLeft(fmtMs(entry.total), 9)} ${padLeft(fmtPct(entry.total, totalTime), 8)} ${padLeft(String(entry.count), 7)} ${padLeft(fmtMs(p50), 9)} ${padLeft(fmtMs(p95), 9)} ${padLeft(fmtMs(p99), 9)} ${padLeft(fmtMs(max), 9)}`,
    )
  }

  // ---- SECTION 2: Slowest individual solver instances ----
  console.log("\n" + "-".repeat(90))
  console.log("SLOWEST INDIVIDUAL SOLVER INSTANCES (top 20)")
  console.log("-".repeat(90))

  const sortedByTime = [...allRecords].sort((a, b) => b.timeMs - a.timeMs)
  console.log(
    `${padRight("Solver", nameCol)} ${padLeft("Time", 9)} ${padLeft("Iters", 7)} ${padLeft("Status", 8)}  Scenario`,
  )
  console.log("-".repeat(90))

  for (const rec of sortedByTime.slice(0, 20)) {
    console.log(
      `${padRight(rec.solverName, nameCol)} ${padLeft(fmtMs(rec.timeMs), 9)} ${padLeft(String(rec.iterations), 7)} ${padLeft(rec.solved ? "solved" : "FAILED", 8)}  ${rec.scenarioName}`,
    )
  }

  // ---- SECTION 3: Slowest scenarios ----
  console.log("\n" + "-".repeat(90))
  console.log("SLOWEST SCENARIOS (top 15)")
  console.log("-".repeat(90))

  const sortedScenarios = [...scenarioResults].sort(
    (a, b) => b.totalTimeMs - a.totalTimeMs,
  )

  console.log(
    `${padRight("Scenario", 25)} ${padLeft("Total", 9)} ${padLeft("Status", 8)}   Top Solver`,
  )
  console.log("-".repeat(90))

  for (const result of sortedScenarios.slice(0, 15)) {
    // Find the most expensive solver instance for this scenario
    const scenarioSolvers = allRecords
      .filter((r) => r.scenarioName === result.name)
      .sort((a, b) => b.timeMs - a.timeMs)
    const top = scenarioSolvers[0]
    const topStr = top
      ? `${top.solverName} (${fmtMs(top.timeMs)})`
      : "N/A"

    console.log(
      `${padRight(result.name, 25)} ${padLeft(fmtMs(result.totalTimeMs), 9)} ${padLeft(result.solved ? "SOLVED" : "FAILED", 8)}   ${topStr}`,
    )
  }

  // ---- SECTION 4: Time distribution ----
  console.log("\n" + "-".repeat(90))
  console.log("SCENARIO TIME DISTRIBUTION")
  console.log("-".repeat(90))

  const scenarioTimes = scenarioResults.map((r) => r.totalTimeMs).sort((a, b) => a - b)
  const buckets = [
    { label: "< 1s", min: 0, max: 1000 },
    { label: "1-5s", min: 1000, max: 5000 },
    { label: "5-10s", min: 5000, max: 10000 },
    { label: "10-30s", min: 10000, max: 30000 },
    { label: "30-60s", min: 30000, max: 60000 },
    { label: "60-120s", min: 60000, max: 120000 },
    { label: "> 120s", min: 120000, max: Infinity },
  ]

  for (const bucket of buckets) {
    const count = scenarioTimes.filter(
      (t) => t >= bucket.min && t < bucket.max,
    ).length
    const bar = "#".repeat(count)
    console.log(`  ${padRight(bucket.label, 10)} ${padLeft(String(count), 3)}  ${bar}`)
  }

  console.log(`\n  P50: ${fmtMs(getPercentile(scenarioTimes, 0.5))}`)
  console.log(`  P90: ${fmtMs(getPercentile(scenarioTimes, 0.9))}`)
  console.log(`  P95: ${fmtMs(getPercentile(scenarioTimes, 0.95))}`)
  console.log(`  P99: ${fmtMs(getPercentile(scenarioTimes, 0.99))}`)
  console.log(`  Max: ${fmtMs(scenarioTimes[scenarioTimes.length - 1])}`)
}

main().catch((e) => {
  console.error(`Fatal: ${e}`)
  process.exit(1)
})
