import { AutoroutingPipelineSolver2_PortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver2_PortPointPathing"
import type { SimpleRouteJson } from "lib/types"
import type { CacheProvider } from "lib/cache/types"
import keyboard4 from "fixtures/legacy/assets/keyboard4.json"
import keyboard5 from "fixtures/legacy/assets/keyboard5.json"
import { InMemoryCache } from "lib/cache/InMemoryCache"

interface RunResult {
  totalTimeMs: number
  pathingTimeMs: number
}

async function runSolver(
  srj: SimpleRouteJson,
  cache: CacheProvider,
): Promise<RunResult> {
  const solver = new AutoroutingPipelineSolver2_PortPointPathing(srj, {
    cacheProvider: cache,
  })

  const startTime = performance.now()
  solver.solve()
  const endTime = performance.now()

  const totalTimeMs = endTime - startTime
  const pathingTimeMs = solver.timeSpentOnPhase["portPointPathingSolver"] ?? 0

  return {
    totalTimeMs,
    pathingTimeMs,
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
    `Baseline completed: ${baselineResult.totalTimeMs.toFixed(2)}ms total, ${baselineResult.pathingTimeMs.toFixed(2)}ms pathing, ${cache.cache.size} Cache Keys`,
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
    `Test completed: ${testResult.totalTimeMs.toFixed(2)}ms total, ${testResult.pathingTimeMs.toFixed(2)}ms pathing`,
  )

  const pathingSpeedup =
    testResult.pathingTimeMs > 0
      ? baselineResult.pathingTimeMs / testResult.pathingTimeMs
      : Infinity
  const overallSpeedup =
    testResult.totalTimeMs > 0
      ? baselineResult.totalTimeMs / testResult.totalTimeMs
      : Infinity

  console.log("\nBenchmark Results:\n")
  console.log(
    "| Warmed With | Tested Against | Pathing Speedup | Overall Speedup |",
  )
  console.log(
    "| ----------- | -------------- | --------------- | --------------- |",
  )
  console.log(
    `| keyboard4   | keyboard5      | ${pathingSpeedup.toFixed(2)}x | ${overallSpeedup.toFixed(2)}x |`,
  )
}

runBenchmark().catch(console.error)
