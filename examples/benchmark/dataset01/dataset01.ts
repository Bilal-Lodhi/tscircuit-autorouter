import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import keyboard4 from "examples/legacy/assets/keyboard4.json"
import e2e3 from "examples/legacy/assets/e2e3.json"
import bugreport23 from "examples/bug-reports/bugreport23-LGA15x4/bugreport23-LGA15x4.srj.json"

interface BenchmarkResult {
  name: string
  totalConnections: number
  solvedTraces: number
  success: boolean
  error?: string
}

function runBenchmark(name: string, srj: SimpleRouteJson): BenchmarkResult {
  const totalConnections = srj.connections.length

  try {
    const solver = new AutoroutingPipelineSolver(srj)
    solver.solve()

    if (!solver.solved) {
      return {
        name,
        totalConnections,
        solvedTraces: 0,
        success: false,
        error: solver.error || "Solver did not complete",
      }
    }

    const result = solver.getOutputSimpleRouteJson()
    const solvedTraces = result.traces?.length || 0

    return {
      name,
      totalConnections,
      solvedTraces,
      success: solvedTraces >= totalConnections,
    }
  } catch (error) {
    return {
      name,
      totalConnections,
      solvedTraces: 0,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function runDataset01Benchmark() {
  const results: BenchmarkResult[] = []

  console.log("Running dataset01 benchmark...\n")

  const benchmarks = [
    { name: "keyboard04", srj: keyboard4 as SimpleRouteJson },
    { name: "e2e3", srj: e2e3 as SimpleRouteJson },
    { name: "LGA15x4", srj: bugreport23 as SimpleRouteJson },
  ]

  for (const benchmark of benchmarks) {
    console.log(`Running ${benchmark.name}...`)
    const result = runBenchmark(benchmark.name, benchmark.srj)
    results.push(result)

    const successMark = result.success ? "✓" : "✗"
    console.log(
      `  ${successMark} ${result.solvedTraces}/${result.totalConnections} connections solved`,
    )
    if (result.error) {
      console.log(`  Error: ${result.error}`)
    }
  }

  console.log("\n=== Summary ===")
  const totalConnections = results.reduce(
    (sum, r) => sum + r.totalConnections,
    0,
  )
  const totalSolved = results.reduce((sum, r) => sum + r.solvedTraces, 0)
  const successRate = ((totalSolved / totalConnections) * 100).toFixed(1)

  console.log(`Total: ${totalSolved}/${totalConnections} (${successRate}%)`)
  console.log(
    `Passed: ${results.filter((r) => r.success).length}/${results.length}`,
  )

  return results
}
