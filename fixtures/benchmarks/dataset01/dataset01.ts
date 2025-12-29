import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import keyboard4 from "fixtures/legacy/assets/keyboard4.json" with {
  type: "json",
}
import e2e3 from "fixtures/legacy/assets/e2e3.json" with { type: "json" }
import bugreport23 from "fixtures/bug-reports/bugreport23-LGA15x4/bugreport23-LGA15x4.srj.json" with {
  type: "json",
}

interface BenchmarkResult {
  name: string
  success: boolean
  durationMs: number
  drcErrors: number
}

const formatDuration = (durationMs: number) => (durationMs / 1000).toFixed(2)

function runBenchmark(name: string, srj: SimpleRouteJson): BenchmarkResult {
  console.log(`Running "${name}"`)

  const totalConnections = srj.connections.length
  const startTime = performance.now()

  try {
    const solver = new AutoroutingPipelineSolver(srj)
    solver.solve()

    if (!solver.solved || solver.failed) {
      const durationMs = performance.now() - startTime
      console.log(`❌ failed in ${formatDuration(durationMs)}s`)
      return {
        name,
        success: false,
        durationMs,
        drcErrors: 0,
      }
    }

    const srjWithPointPairs = solver.srjWithPointPairs
    if (!srjWithPointPairs) {
      const durationMs = performance.now() - startTime
      return {
        name,
        success: false,
        durationMs,
        drcErrors: 0,
      }
    }

    const simplifiedTraces = solver.getOutputSimplifiedPcbTraces()
    const circuitJson = convertToCircuitJson(
      srjWithPointPairs,
      simplifiedTraces,
      srj.minTraceWidth ?? 0.1,
      srj.minViaDiameter ?? 0.6,
    )
    const { errors } = getDrcErrors(circuitJson)

    const result = solver.getOutputSimpleRouteJson()
    const solvedTraces = result.traces?.length || 0
    const success = solvedTraces >= totalConnections
    const durationMs = performance.now() - startTime
    const drcLabel = `${errors.length} DRC Failure${errors.length === 1 ? "" : "s"}`
    const statusMessage = success ? "solved" : "incomplete"
    console.log(
      `${success ? "✅" : "❌"} ${statusMessage} in ${formatDuration(durationMs)}s  (${drcLabel})`,
    )

    return {
      name,
      success,
      durationMs,
      drcErrors: errors.length,
    }
  } catch (error) {
    const durationMs = performance.now() - startTime
    console.log(`❌ failed in ${formatDuration(durationMs)}s`)
    return {
      name,
      success: false,
      durationMs,
      drcErrors: 0,
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
    const result = runBenchmark(benchmark.name, benchmark.srj)
    results.push(result)
  }

  console.log("\n=== Summary ===")
  console.log(
    `Passed: ${results.filter((r) => r.success).length}/${results.length}`,
  )

  const headers = ["Benchmark", "Time (s)", "DRC Errors", "Status"]
  const rows = results.map((result) => [
    result.name,
    formatDuration(result.durationMs),
    result.drcErrors.toString(),
    result.success ? "✅ pass" : "❌ fail",
  ])
  const columnWidths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  )
  const formatRow = (row: string[]) =>
    row.map((cell, index) => cell.padEnd(columnWidths[index])).join(" | ")

  console.log("\nBenchmark Results")
  console.log(formatRow(headers))
  console.log(columnWidths.map((width) => "-".repeat(width)).join("-+-"))
  for (const row of rows) {
    console.log(formatRow(row))
  }

  return results
}
