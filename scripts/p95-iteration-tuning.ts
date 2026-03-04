#!/usr/bin/env bun

/**
 * P95 Iteration Tuning Script
 *
 * Runs all benchmark scenarios and records how many iterations each solver
 * instance takes to reach success. Then computes the P95 (95th percentile)
 * iteration count for each solver type.
 *
 * Usage:
 *   bun scripts/p95-iteration-tuning.ts [--solver <PipelineSolverName>] [--scenario-limit <N>] [--target-solver <SolverName>]
 *
 * Options:
 *   --solver          Pipeline solver to run (default: AutoroutingPipelineSolver3_HgPortPointPathing)
 *   --scenario-limit  Only run the first N scenarios
 *   --target-solver   Only show stats for this solver name (e.g. HyperSingleIntraNodeSolver)
 *
 * See P95_ITERATION_TUNING_PROCESS.md for the full process.
 */

import * as dataset from "@tscircuit/autorouting-dataset-01"
import { BaseSolver } from "../lib/solvers/BaseSolver"
import * as autorouterModule from "../lib"
import type { SimpleRouteJson } from "../lib/types/srj-types"

type IterationRecord = {
  solverName: string
  iterations: number
  solved: boolean
  scenarioName: string
}

const parseArgs = () => {
  const args = process.argv.slice(2)
  const options = {
    solverName: "AutoroutingPipelineSolver3_HgPortPointPathing",
    scenarioLimit: undefined as number | undefined,
    targetSolver: undefined as string | undefined,
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--solver") {
      options.solverName = args[++i]
    } else if (args[i] === "--scenario-limit") {
      options.scenarioLimit = parseInt(args[++i], 10)
    } else if (args[i] === "--target-solver") {
      options.targetSolver = args[++i]
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

const main = async () => {
  const opts = parseArgs()

  // Load scenarios
  const allScenarios = Object.entries(dataset)
    .filter(([, value]) => Boolean(value) && typeof value === "object")
    .sort(([a], [b]) => a.localeCompare(b)) as Array<
    [string, SimpleRouteJson]
  >

  const scenarios = opts.scenarioLimit
    ? allScenarios.slice(0, opts.scenarioLimit)
    : allScenarios

  console.log(`Scenarios: ${scenarios.length}`)
  console.log(`Pipeline solver: ${opts.solverName}`)
  if (opts.targetSolver) {
    console.log(`Target solver filter: ${opts.targetSolver}`)
  }
  console.log()

  // Set up iteration recording
  const records: IterationRecord[] = []
  let currentScenarioName = ""

  BaseSolver.onSolverCompleted = (solver: BaseSolver) => {
    records.push({
      solverName: solver.getSolverName(),
      iterations: solver.iterations,
      solved: solver.solved,
      scenarioName: currentScenarioName,
    })
  }

  // Get solver constructor
  const SolverConstructor = (autorouterModule as any)[opts.solverName]
  if (!SolverConstructor) {
    console.error(`Solver "${opts.solverName}" not found in exports`)
    process.exit(1)
  }

  // Run all scenarios
  let solved = 0
  let failed = 0

  for (const [name, scenario] of scenarios) {
    currentScenarioName = name
    const startTime = performance.now()

    try {
      const solver = new SolverConstructor(scenario)
      solver.solve()
      if (solver.solved) {
        solved++
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
        console.log(
          `[${solved}/${solved + failed}/${scenarios.length}] SOLVED ${name} (${elapsed}s)`,
        )
      } else {
        failed++
        console.log(
          `[${solved}/${solved + failed}/${scenarios.length}] FAILED ${name}`,
        )
      }
    } catch (e) {
      failed++
      console.log(
        `[${solved}/${solved + failed}/${scenarios.length}] ERROR  ${name}: ${e}`,
      )
    }
  }

  // Clean up
  BaseSolver.onSolverCompleted = null

  // Analyze results
  console.log("\n" + "=".repeat(70))
  console.log("P95 ITERATION ANALYSIS")
  console.log("=".repeat(70))
  console.log(
    `\nPipeline: ${solved}/${scenarios.length} solved (${((solved / scenarios.length) * 100).toFixed(1)}%)\n`,
  )

  // Group by solver name
  const bySolver = new Map<string, { solved: number[]; failed: number[] }>()
  for (const record of records) {
    if (!bySolver.has(record.solverName)) {
      bySolver.set(record.solverName, { solved: [], failed: [] })
    }
    const entry = bySolver.get(record.solverName)!
    if (record.solved) {
      entry.solved.push(record.iterations)
    } else {
      entry.failed.push(record.iterations)
    }
  }

  // Sort by solver name
  const solverNames = [...bySolver.keys()].sort()

  // Filter if target solver specified
  const displayNames = opts.targetSolver
    ? solverNames.filter((n) => n.includes(opts.targetSolver!))
    : solverNames

  for (const name of displayNames) {
    const data = bySolver.get(name)!
    const sortedSolved = [...data.solved].sort((a, b) => a - b)
    const sortedFailed = [...data.failed].sort((a, b) => a - b)

    console.log(`--- ${name} ---`)
    console.log(`  Instances: ${data.solved.length + data.failed.length}`)
    console.log(
      `  Solved: ${data.solved.length}, Failed: ${data.failed.length}`,
    )

    if (sortedSolved.length > 0) {
      const p50 = Math.round(getPercentile(sortedSolved, 0.5))
      const p90 = Math.round(getPercentile(sortedSolved, 0.9))
      const p95 = Math.round(getPercentile(sortedSolved, 0.95))
      const p99 = Math.round(getPercentile(sortedSolved, 0.99))
      const p999 = Math.round(getPercentile(sortedSolved, 0.999))
      const max = sortedSolved[sortedSolved.length - 1]
      const min = sortedSolved[0]

      console.log(`  Solved iteration stats:`)
      console.log(`    Min:   ${min.toLocaleString()}`)
      console.log(`    P50:   ${p50.toLocaleString()}`)
      console.log(`    P90:   ${p90.toLocaleString()}`)
      console.log(`    P95:   ${p95.toLocaleString()}`)
      console.log(`    P99:   ${p99.toLocaleString()}  <-- recommended MAX_ITERATIONS`)
      console.log(`    P99.9: ${p999.toLocaleString()}`)
      console.log(`    Max:   ${max.toLocaleString()}`)
    }
    console.log()
  }
}

main().catch((e) => {
  console.error(`Fatal: ${e}`)
  process.exit(1)
})
