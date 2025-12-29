import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"
import bugReport from "../../examples/bug-reports/bugreport29-7deae8/bugreport29-7deae8.json" assert {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"

const srj = bugReport.simple_route_json as SimpleRouteJson

// Instrumentation infrastructure
interface FunctionTiming {
  totalTime: number
  callCount: number
  avgTime: number
  maxTime: number
  minTime: number
}

const functionTimings = new Map<string, FunctionTiming>()
const phaseTimings = new Map<string, number>()
let stepCount = 0
let stepTimeTotal = 0
let lastProgressLog = 0
const stepTimings: number[] = []

// HyperSolver specific tracking
let hyperSolverStats = {
  numSupervisedSolvers: 0,
  minSubsteps: 0,
  totalSubsteps: 0,
  solverInitTime: 0,
  getSupervisedSolverTime: 0,
  substepTime: 0,
  fitnessUpdateTime: 0,
}

// PortPointPathingSolver specific tracking (aggregated across all solvers)
let pppsStats = {
  totalStepCalls: 0,
  computeGTime: 0,
  computeGCalls: 0,
  computeHTime: 0,
  computeHCalls: 0,
  computeNodePfTime: 0,
  computeNodePfCalls: 0,
  getIntraNodeCrossingsTime: 0,
  getIntraNodeCrossingsCalls: 0,
  candidateSortTime: 0,
  candidateSortCalls: 0,
  getAvailablePortPointsTime: 0,
  getAvailablePortPointsCalls: 0,
  getAvailablePortPointsForOffboardTime: 0,
  getAvailablePortPointsForOffboardCalls: 0,
  assignPortPointsTime: 0,
  assignPortPointsCalls: 0,
  isNodeInPathChainTime: 0,
  isNodeInPathChainCalls: 0,
  isPortPointInPathChainTime: 0,
  isPortPointInPathChainCalls: 0,
  getBacktrackedPathTime: 0,
  getBacktrackedPathCalls: 0,
}

function recordTiming(name: string, duration: number) {
  const existing = functionTimings.get(name)
  if (existing) {
    existing.totalTime += duration
    existing.callCount++
    existing.avgTime = existing.totalTime / existing.callCount
    existing.maxTime = Math.max(existing.maxTime, duration)
    existing.minTime = Math.min(existing.minTime, duration)
  } else {
    functionTimings.set(name, {
      totalTime: duration,
      callCount: 1,
      avgTime: duration,
      maxTime: duration,
      minTime: duration,
    })
  }
}

function wrapMethod<T extends object>(
  obj: T,
  methodName: keyof T,
  prefix: string = "",
) {
  const original = obj[methodName] as unknown as (...args: any[]) => any
  if (typeof original !== "function") return

  obj[methodName] = function (this: any, ...args: any[]) {
    const start = performance.now()
    const result = original.apply(this, args)
    const end = performance.now()
    recordTiming(`${prefix}${String(methodName)}`, end - start)
    return result
  } as any
}

function instrumentPortPointPathingSolver(solver: any, solverIndex: number) {
  // Only instrument every 100th solver to reduce overhead but still get representative data
  if (solverIndex % 100 !== 0) return

  // Wrap computeNodePf
  if (solver.computeNodePf) {
    const orig = solver.computeNodePf.bind(solver)
    solver.computeNodePf = function (...args: any[]) {
      const start = performance.now()
      const result = orig(...args)
      pppsStats.computeNodePfTime += performance.now() - start
      pppsStats.computeNodePfCalls++
      return result
    }
  }

  // Wrap computeG
  if (solver.computeG) {
    const orig = solver.computeG.bind(solver)
    solver.computeG = function (...args: any[]) {
      const start = performance.now()
      const result = orig(...args)
      pppsStats.computeGTime += performance.now() - start
      pppsStats.computeGCalls++
      return result
    }
  }

  // Wrap computeH
  if (solver.computeH) {
    const orig = solver.computeH.bind(solver)
    solver.computeH = function (...args: any[]) {
      const start = performance.now()
      const result = orig(...args)
      pppsStats.computeHTime += performance.now() - start
      pppsStats.computeHCalls++
      return result
    }
  }

  // Wrap getAvailableExitPortPointsWithOmissions
  if (solver.getAvailableExitPortPointsWithOmissions) {
    const orig = solver.getAvailableExitPortPointsWithOmissions.bind(solver)
    solver.getAvailableExitPortPointsWithOmissions = function (...args: any[]) {
      const start = performance.now()
      const result = orig(...args)
      pppsStats.getAvailablePortPointsTime += performance.now() - start
      pppsStats.getAvailablePortPointsCalls++
      return result
    }
  }

  // Wrap getAvailableExitPortPointsForOffboardConnection
  if (solver.getAvailableExitPortPointsForOffboardConnection) {
    const orig = solver.getAvailableExitPortPointsForOffboardConnection.bind(solver)
    solver.getAvailableExitPortPointsForOffboardConnection = function (...args: any[]) {
      const start = performance.now()
      const result = orig(...args)
      pppsStats.getAvailablePortPointsForOffboardTime += performance.now() - start
      pppsStats.getAvailablePortPointsForOffboardCalls++
      return result
    }
  }

  // Wrap assignPortPointsForPath
  if (solver.assignPortPointsForPath) {
    const orig = solver.assignPortPointsForPath.bind(solver)
    solver.assignPortPointsForPath = function (...args: any[]) {
      const start = performance.now()
      const result = orig(...args)
      pppsStats.assignPortPointsTime += performance.now() - start
      pppsStats.assignPortPointsCalls++
      return result
    }
  }

  // Wrap isNodeInPathChain
  if (solver.isNodeInPathChain) {
    const orig = solver.isNodeInPathChain.bind(solver)
    solver.isNodeInPathChain = function (...args: any[]) {
      const start = performance.now()
      const result = orig(...args)
      pppsStats.isNodeInPathChainTime += performance.now() - start
      pppsStats.isNodeInPathChainCalls++
      return result
    }
  }

  // Wrap isPortPointInPathChain
  if (solver.isPortPointInPathChain) {
    const orig = solver.isPortPointInPathChain.bind(solver)
    solver.isPortPointInPathChain = function (...args: any[]) {
      const start = performance.now()
      const result = orig(...args)
      pppsStats.isPortPointInPathChainTime += performance.now() - start
      pppsStats.isPortPointInPathChainCalls++
      return result
    }
  }

  // Wrap getBacktrackedPath
  if (solver.getBacktrackedPath) {
    const orig = solver.getBacktrackedPath.bind(solver)
    solver.getBacktrackedPath = function (...args: any[]) {
      const start = performance.now()
      const result = orig(...args)
      pppsStats.getBacktrackedPathTime += performance.now() - start
      pppsStats.getBacktrackedPathCalls++
      return result
    }
  }

  // Wrap the _step method to track total step time
  if (solver._step) {
    const orig = solver._step.bind(solver)
    solver._step = function (...args: any[]) {
      pppsStats.totalStepCalls++
      return orig(...args)
    }
  }
}

function printTimingSummary() {
  console.log("\n" + "=".repeat(80))
  console.log("PERFORMANCE INSTRUMENTATION SUMMARY")
  console.log("=".repeat(80))

  // Phase timings
  console.log("\n📊 PHASE TIMINGS:")
  console.log("-".repeat(60))
  const sortedPhases = Array.from(phaseTimings.entries()).sort(
    (a, b) => b[1] - a[1],
  )
  const totalPhaseTime = sortedPhases.reduce((sum, [, time]) => sum + time, 0)
  for (const [phase, time] of sortedPhases) {
    const pct = ((time / totalPhaseTime) * 100).toFixed(1)
    const bar = "█".repeat(Math.round((time / totalPhaseTime) * 40))
    console.log(`  ${phase.padEnd(40)} ${(time / 1000).toFixed(2).padStart(8)}s (${pct.padStart(5)}%) ${bar}`)
  }
  console.log(`  ${"TOTAL".padEnd(40)} ${(totalPhaseTime / 1000).toFixed(2).padStart(8)}s`)

  // Step statistics
  console.log("\n📈 PIPELINE STEP STATISTICS:")
  console.log("-".repeat(60))
  console.log(`  Total pipeline steps: ${stepCount.toLocaleString()}`)
  console.log(`  Total step time: ${(stepTimeTotal / 1000).toFixed(2)}s`)
  if (stepCount > 0) {
    console.log(`  Avg step time: ${(stepTimeTotal / stepCount).toFixed(4)}ms`)
  }

  if (stepTimings.length > 0) {
    stepTimings.sort((a, b) => a - b)
    const p50 = stepTimings[Math.floor(stepTimings.length * 0.5)]
    const p90 = stepTimings[Math.floor(stepTimings.length * 0.9)]
    const p99 = stepTimings[Math.floor(stepTimings.length * 0.99)]
    const max = stepTimings[stepTimings.length - 1]
    console.log(`  Step time p50: ${p50?.toFixed(4)}ms`)
    console.log(`  Step time p90: ${p90?.toFixed(4)}ms`)
    console.log(`  Step time p99: ${p99?.toFixed(4)}ms`)
    console.log(`  Step time max: ${max?.toFixed(4)}ms`)
  }

  // HyperSolver specific stats
  console.log("\n🔀 HYPER SOLVER STATISTICS:")
  console.log("-".repeat(60))
  console.log(`  Supervised solvers created: ${hyperSolverStats.numSupervisedSolvers.toLocaleString()}`)
  console.log(`  MIN_SUBSTEPS per step: ${hyperSolverStats.minSubsteps}`)
  console.log(`  Total substeps executed: ${hyperSolverStats.totalSubsteps.toLocaleString()}`)
  console.log(`  Solver initialization time: ${(hyperSolverStats.solverInitTime / 1000).toFixed(2)}s`)
  console.log(`  getSupervisedSolver time: ${(hyperSolverStats.getSupervisedSolverTime / 1000).toFixed(2)}s`)
  console.log(`  Substep execution time: ${(hyperSolverStats.substepTime / 1000).toFixed(2)}s`)
  console.log(`  Fitness update time: ${(hyperSolverStats.fitnessUpdateTime / 1000).toFixed(2)}s`)

  // PortPointPathingSolver specific stats
  console.log("\n🔗 PORT POINT PATHING SOLVER BREAKDOWN (sampled 1% of solvers, extrapolated):")
  console.log("-".repeat(80))
  console.log(`  Total _step() calls tracked: ${pppsStats.totalStepCalls.toLocaleString()}`)
  console.log("")
  console.log("  Function                                 Time (s)       Calls       Avg (μs)   % of substeps")
  console.log("-".repeat(80))

  const substepTotal = hyperSolverStats.substepTime / 1000 // in seconds
  const multiplier = 100 // sampling rate (1 in 100 solvers)

  const printPppsRow = (name: string, time: number, calls: number) => {
    const extrapolatedTime = time * multiplier / 1000 // convert to seconds
    const extrapolatedCalls = calls * multiplier
    const avgUs = calls > 0 ? (time / calls) * 1000 : 0 // microseconds
    const pct = substepTotal > 0 ? (extrapolatedTime / substepTotal) * 100 : 0
    console.log(
      `  ${name.padEnd(40)} ${extrapolatedTime.toFixed(2).padStart(10)} ${extrapolatedCalls.toLocaleString().padStart(12)} ${avgUs.toFixed(1).padStart(12)} ${pct.toFixed(1).padStart(10)}%`
    )
  }

  printPppsRow("computeNodePf", pppsStats.computeNodePfTime, pppsStats.computeNodePfCalls)
  printPppsRow("computeG", pppsStats.computeGTime, pppsStats.computeGCalls)
  printPppsRow("computeH", pppsStats.computeHTime, pppsStats.computeHCalls)
  printPppsRow("getAvailablePortPointsWithOmissions", pppsStats.getAvailablePortPointsTime, pppsStats.getAvailablePortPointsCalls)
  printPppsRow("getAvailablePortPointsForOffboard", pppsStats.getAvailablePortPointsForOffboardTime, pppsStats.getAvailablePortPointsForOffboardCalls)
  printPppsRow("assignPortPointsForPath", pppsStats.assignPortPointsTime, pppsStats.assignPortPointsCalls)
  printPppsRow("isNodeInPathChain", pppsStats.isNodeInPathChainTime, pppsStats.isNodeInPathChainCalls)
  printPppsRow("isPortPointInPathChain", pppsStats.isPortPointInPathChainTime, pppsStats.isPortPointInPathChainCalls)
  printPppsRow("getBacktrackedPath", pppsStats.getBacktrackedPathTime, pppsStats.getBacktrackedPathCalls)

  // Function timings
  console.log("\n⏱️  FUNCTION TIMINGS (top 30 by total time):")
  console.log("-".repeat(100))
  const sortedFunctions = Array.from(functionTimings.entries())
    .sort((a, b) => b[1].totalTime - a[1].totalTime)
    .slice(0, 30)

  console.log(
    `  ${"Function".padEnd(50)} ${"Total".padStart(10)} ${"Calls".padStart(12)} ${"Avg".padStart(12)} ${"Max".padStart(10)}`,
  )
  console.log("-".repeat(100))
  for (const [name, timing] of sortedFunctions) {
    console.log(
      `  ${name.padEnd(50)} ${(timing.totalTime / 1000).toFixed(2).padStart(10)}s ${timing.callCount.toLocaleString().padStart(12)} ${timing.avgTime.toFixed(4).padStart(12)}ms ${timing.maxTime.toFixed(2).padStart(10)}ms`,
    )
  }

  console.log("\n" + "=".repeat(80))
}

test(
  "bugreport29-7deae8-instrumented",
  () => {
    const startTime = performance.now()
    console.log("\n🚀 Starting instrumented autorouting test...")
    console.log(`📦 Input: ${srj.connections.length} connections, ${srj.obstacles.length} obstacles`)
    console.log(`📐 Bounds: ${(srj.bounds.maxX - srj.bounds.minX).toFixed(1)} x ${(srj.bounds.maxY - srj.bounds.minY).toFixed(1)}mm`)

    const solver = new AssignableAutoroutingPipeline2(srj)

    // Instrument the _step method to track per-step timing
    const originalStep = solver._step.bind(solver)
    solver._step = function () {
      const stepStart = performance.now()
      originalStep()
      const stepEnd = performance.now()
      const stepDuration = stepEnd - stepStart
      stepCount++
      stepTimeTotal += stepDuration
      stepTimings.push(stepDuration)

      // Log progress every 5 seconds
      if (stepEnd - lastProgressLog > 5000) {
        lastProgressLog = stepEnd
        const elapsed = (stepEnd - startTime) / 1000
        const currentPhase = solver.getCurrentPhase()
        const subSolver = solver.activeSubSolver as any
        const subProgress = subSolver?.progress ?? 0

        let extraInfo = ""
        if (currentPhase === "portPointPathingSolver" && subSolver?.supervisedSolvers) {
          const activeSolvers = subSolver.supervisedSolvers.filter(
            (s: any) => !s.solver.solved && !s.solver.failed
          ).length
          const solvedSolvers = subSolver.supervisedSolvers.filter(
            (s: any) => s.solver.solved
          ).length
          const failedSolvers = subSolver.supervisedSolvers.filter(
            (s: any) => s.solver.failed
          ).length
          const bestSolver = subSolver.getSupervisedSolverWithBestFitness?.()
          const bestProgress = bestSolver?.solver?.progress ?? 0
          const bestConnIdx = bestSolver?.solver?.currentConnectionIndex ?? 0
          const totalConns = bestSolver?.solver?.connectionsWithResults?.length ?? 0
          extraInfo = `, Active/Solved/Failed: ${activeSolvers}/${solvedSolvers}/${failedSolvers}, Best: ${(bestProgress * 100).toFixed(1)}% (conn ${bestConnIdx}/${totalConns})`
        }

        console.log(
          `  [${elapsed.toFixed(1)}s] Phase: ${currentPhase}, Steps: ${stepCount.toLocaleString()}, Progress: ${(subProgress * 100).toFixed(1)}%${extraInfo}`,
        )
      }
    }

    // Run with step-by-step monitoring
    let lastPhase = ""
    let phaseStartTime = performance.now()
    let hyperSolverInstrumented = false

    while (!solver.solved && !solver.failed) {
      const currentPhase = solver.getCurrentPhase()

      if (currentPhase !== lastPhase) {
        if (lastPhase) {
          const phaseDuration = performance.now() - phaseStartTime
          phaseTimings.set(lastPhase, phaseDuration)
          console.log(`  ✅ Completed ${lastPhase} in ${(phaseDuration / 1000).toFixed(2)}s`)
        }
        console.log(`  📍 Starting phase: ${currentPhase}`)
        lastPhase = currentPhase
        phaseStartTime = performance.now()
        hyperSolverInstrumented = false
      }

      // Instrument HyperPortPointPathingSolver when it's active
      if (currentPhase === "portPointPathingSolver" && !hyperSolverInstrumented) {
        const hyperSolver = solver.activeSubSolver as any
        if (hyperSolver?.supervisedSolvers) {
          hyperSolverInstrumented = true
          hyperSolverStats.numSupervisedSolvers = hyperSolver.supervisedSolvers.length
          hyperSolverStats.minSubsteps = hyperSolver.MIN_SUBSTEPS ?? 1

          console.log(`  📊 HyperSolver initialized with ${hyperSolverStats.numSupervisedSolvers} supervised solvers, MIN_SUBSTEPS=${hyperSolverStats.minSubsteps}`)

          // Instrument the inner _step of HyperSolver
          const origHyperStep = hyperSolver._step.bind(hyperSolver)
          hyperSolver._step = function () {
            const t0 = performance.now()

            // Call getSupervisedSolverWithBestFitness
            const t1 = performance.now()
            const supervisedSolver = hyperSolver.getSupervisedSolverWithBestFitness()
            hyperSolverStats.getSupervisedSolverTime += performance.now() - t1

            if (!supervisedSolver) {
              hyperSolver.failed = true
              hyperSolver.error = hyperSolver.getFailureMessage?.() ?? "No solver available"
              return
            }

            // Run substeps
            const t2 = performance.now()
            for (let i = 0; i < hyperSolver.MIN_SUBSTEPS; i++) {
              supervisedSolver.solver.step()
              hyperSolverStats.totalSubsteps++
            }
            hyperSolverStats.substepTime += performance.now() - t2

            // Update fitness
            const t3 = performance.now()
            supervisedSolver.g = hyperSolver.computeG(supervisedSolver.solver)
            supervisedSolver.h = hyperSolver.computeH(supervisedSolver.solver)
            supervisedSolver.f = hyperSolver.computeF(supervisedSolver.g, supervisedSolver.h)
            hyperSolverStats.fitnessUpdateTime += performance.now() - t3

            if (supervisedSolver.solver.solved) {
              hyperSolver.solved = true
              hyperSolver.winningSolver = supervisedSolver.solver
              hyperSolver.onSolve?.(supervisedSolver)
            }
          }

          // Instrument PortPointPathingSolvers (1% sampling to reduce overhead)
          for (let i = 0; i < hyperSolver.supervisedSolvers.length; i++) {
            instrumentPortPointPathingSolver(hyperSolver.supervisedSolvers[i].solver, i)
          }
        }
      }

      solver.step()
    }

    // Record final phase
    if (lastPhase) {
      const phaseDuration = performance.now() - phaseStartTime
      phaseTimings.set(lastPhase, phaseDuration)
      console.log(`  ✅ Completed ${lastPhase} in ${(phaseDuration / 1000).toFixed(2)}s`)
    }

    // Also capture the pipeline's internal timing
    for (const [phase, time] of Object.entries(solver.timeSpentOnPhase)) {
      phaseTimings.set(`[internal] ${phase}`, time)
    }

    const totalTime = performance.now() - startTime
    console.log(`\n⏱️  Total solve time: ${(totalTime / 1000).toFixed(2)}s`)
    console.log(`📊 Solver state: solved=${solver.solved}, failed=${solver.failed}`)
    if (solver.failed) {
      console.log(`❌ Error: ${solver.error}`)
    }

    // Print the detailed summary
    printTimingSummary()

    // Basic assertions
    expect(solver.solved || solver.failed).toBe(true)
  },
  { timeout: 600_000 }, // 10 minute timeout for instrumented run
)
