import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import keyboard4 from "examples/legacy/assets/keyboard4.json"
import e2e3 from "examples/legacy/assets/e2e3.json"
import bugreport23 from "examples/bug-reports/bugreport23-LGA15x4/bugreport23-LGA15x4.srj.json"

interface BenchmarkResult {
  name: string
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
        success: false,
        error: solver.error || "Solver did not complete",
      }
    }

    const result = solver.getOutputSimpleRouteJson()
    const solvedTraces = result.traces?.length || 0

    return {
      name,
      success: solvedTraces >= totalConnections,
    }
  } catch (error) {
    return {
      name,
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
  }

  console.log("\n=== Summary ===")
  console.log(
    `Passed: ${results.filter((r) => r.success).length}/${results.length}`,
  )

  return results
}
