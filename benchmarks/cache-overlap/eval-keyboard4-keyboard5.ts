import { AutoroutingPipelineSolver } from "lib/solvers/AutoroutingPipelineSolver"
import type { SimpleRouteJson } from "lib/types"
import { setupGlobalCaches } from "lib/cache/setupGlobalCaches"
import type { CacheProvider } from "lib/cache/types"
import keyboard4 from "examples/legacy/assets/keyboard4.json"
import keyboard5 from "examples/legacy/assets/keyboard5.json"
import { InMemoryCache } from "lib/cache/InMemoryCache"

interface RunResult {
  totalTimeMs: number
  portPointTimeMs: number
}

async function runSolver(
  srj: SimpleRouteJson,
  cache: CacheProvider,
): Promise<RunResult> {
  // Ensure the cache is clean before this specific run if needed by design,
  // but the main script logic handles clearing between phases.

  const solver = new AutoroutingPipelineSolver(srj, {
    cacheProvider: cache,
  })

  // The CachedUnravelSectionSolver uses the global cache by default,
  // which is managed by setupGlobalCaches and the clearCache calls below.

  const startTime = performance.now()
  solver.solve() // solve is synchronous in BaseSolver
  const endTime = performance.now()

  const totalTimeMs = endTime - startTime
  const portPointTimeMs = solver.timeSpentOnPhase["portPointPathingSolver"] ?? 0

  return {
    totalTimeMs,
    portPointTimeMs,
  }
}

async function runBenchmark() {
  const cache = new InMemoryCache()
  const baselineResult = await runSolver(
    keyboard5 as unknown as SimpleRouteJson,
    cache,
  )
  const baselineCacheKeys = new Set([...cache.cache.keys()])
  console.log(
    `Baseline completed: ${baselineResult.totalTimeMs.toFixed(2)}ms total, ${baselineResult.portPointTimeMs.toFixed(2)}ms port-point pathing, ${cache.cache.size} Cache Keys`,
  )

  console.log("Clearing cache...")
  cache.clearCache()

  console.log("Warming cache with keyboard4...")
  await runSolver(keyboard4 as unknown as SimpleRouteJson, cache)
  const keyboard4CacheKeys = new Set([...cache.cache.keys()])
  const sharedKeys = new Set(
    [...baselineCacheKeys].filter((key) => keyboard4CacheKeys.has(key)),
  )
  console.log(
    `Cache warming completed, ${keyboard4CacheKeys.size} cache keys created. ${sharedKeys.size} keys shared with baseline.`,
  )

  console.log("Running test (keyboard5) with warmed cache...")
  const testResult = await runSolver(
    keyboard5 as unknown as SimpleRouteJson,
    cache,
  )
  console.log(
    `Test completed: ${testResult.totalTimeMs.toFixed(2)}ms total, ${testResult.portPointTimeMs.toFixed(2)}ms port-point pathing`,
  )

  // Calculate metrics
  const unravelSpeedup =
    testResult.portPointTimeMs > 0
      ? baselineResult.portPointTimeMs / testResult.portPointTimeMs
      : Infinity // Handle division by zero
  const overallSpeedup =
    testResult.totalTimeMs > 0
      ? baselineResult.totalTimeMs / testResult.totalTimeMs
      : Infinity // Handle division by zero

  // Output results table
  console.log("\nBenchmark Results:\n")
  console.log(
    "| Warmed With | Tested Against | Unravel Cache Hit % | Unravel Speedup | Overall Speedup |",
  )
  console.log(
    "| ----------- | -------------- | ------------------- | --------------- | --------------- |",
  )
  console.log(
    `| keyboard4   | keyboard5      | N/A | ${unravelSpeedup.toFixed(2)}x | ${overallSpeedup.toFixed(2)}x |`,
  )
}

runBenchmark().catch(console.error)
