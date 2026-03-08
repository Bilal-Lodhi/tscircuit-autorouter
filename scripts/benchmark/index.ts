#!/usr/bin/env bun

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { readFile } from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import * as readline from "node:readline"
import * as dataset from "@tscircuit/autorouting-dataset-01"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import type {
  BenchmarkTask,
  WorkerResult,
  WorkerResultMessage,
  WorkerTaskMessage,
} from "./benchmark-types"

type SolverRunResult = {
  solverName: string
  completedRateLabel: string
  relaxedDrcRateLabel: string
  timedOutLabel: string
  p50TimeMs: number | null
  p95TimeMs: number | null
}

type BenchmarkOptions = {
  solverName?: string
  scenarioLimit?: number
  concurrency: number
  excludeAssignable: boolean
}

type WorkerTaskAssignment = {
  request: WorkerTaskMessage
  startedAtMs: number
  timeout: ReturnType<typeof setTimeout>
}

type WorkerSlot = {
  id: number
  child: ChildProcessWithoutNullStreams
  stdoutReader: readline.Interface
  stderrReader: readline.Interface
  currentTask: WorkerTaskAssignment | null
}

type WorkerExecutionResult = {
  result: WorkerResult
  restartWorker: boolean
}

const DEFAULT_TASK_TIMEOUT_PER_EFFORT_MS = 60 * 1000
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 1000
const DEFAULT_TERMINATE_TIMEOUT_MS = 5 * 1000

const formatTime = (timeMs: number | null) => {
  if (timeMs === null) {
    return "n/a"
  }
  return `${(timeMs / 1000).toFixed(1)}s`
}

const formatDurationLabel = (timeMs: number) => {
  if (timeMs < 1000) {
    return `${timeMs}ms`
  }
  return formatTime(timeMs)
}

const getTaskTimeoutPerEffortMs = () => {
  const rawTimeout =
    Bun.env.BENCHMARK_TASK_TIMEOUT_PER_EFFORT_MS?.trim() ??
    Bun.env.BENCHMARK_TASK_TIMEOUT_MS?.trim()
  if (!rawTimeout) {
    return DEFAULT_TASK_TIMEOUT_PER_EFFORT_MS
  }

  const parsedTimeout = Number.parseInt(rawTimeout, 10)
  if (!Number.isFinite(parsedTimeout) || parsedTimeout < 1) {
    throw new Error(
      "BENCHMARK_TASK_TIMEOUT_PER_EFFORT_MS must be a positive integer",
    )
  }

  return parsedTimeout
}

const getHeartbeatIntervalMs = () => {
  const rawInterval = Bun.env.BENCHMARK_HEARTBEAT_INTERVAL_MS?.trim()
  if (!rawInterval) {
    return DEFAULT_HEARTBEAT_INTERVAL_MS
  }

  const parsedInterval = Number.parseInt(rawInterval, 10)
  if (!Number.isFinite(parsedInterval) || parsedInterval < 0) {
    throw new Error(
      "BENCHMARK_HEARTBEAT_INTERVAL_MS must be a non-negative integer",
    )
  }

  return parsedInterval
}

const getTerminateTimeoutMs = () => {
  const rawTimeout = Bun.env.BENCHMARK_TERMINATE_TIMEOUT_MS?.trim()
  if (!rawTimeout) {
    return DEFAULT_TERMINATE_TIMEOUT_MS
  }

  const parsedTimeout = Number.parseInt(rawTimeout, 10)
  if (!Number.isFinite(parsedTimeout) || parsedTimeout < 1) {
    throw new Error("BENCHMARK_TERMINATE_TIMEOUT_MS must be a positive integer")
  }

  return parsedTimeout
}

const getPercentileMs = (
  values: number[],
  percentile: number,
): number | null => {
  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * percentile
  const lower = Math.floor(index)
  const upper = Math.ceil(index)

  if (lower === upper) {
    return sorted[lower]
  }

  const weight = index - lower
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight
}

const parseArgs = (): BenchmarkOptions => {
  const args = process.argv.slice(2)
  const defaultConcurrency =
    typeof os.availableParallelism === "function"
      ? os.availableParallelism()
      : os.cpus().length
  const options: BenchmarkOptions = {
    concurrency: defaultConcurrency,
    excludeAssignable: false,
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === "--solver") {
      options.solverName = args[i + 1]
      i += 1
      continue
    }
    if (arg === "--scenario-limit") {
      options.scenarioLimit = Number.parseInt(args[i + 1], 10)
      i += 1
      continue
    }
    if (arg === "--concurrency") {
      const rawConcurrency = args[i + 1]
      options.concurrency =
        rawConcurrency === "auto"
          ? defaultConcurrency
          : Number.parseInt(rawConcurrency, 10)
      i += 1
      continue
    }
    if (arg === "--exclude-assignable") {
      options.excludeAssignable = true
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer")
  }

  if (
    options.scenarioLimit !== undefined &&
    (!Number.isFinite(options.scenarioLimit) || options.scenarioLimit < 1)
  ) {
    throw new Error("--scenario-limit must be a positive integer")
  }

  return options
}

const loadSolverNames = async (
  excludeAssignable: boolean,
): Promise<string[]> => {
  // Use autorouter-pipelines/index.ts as the source of truth for benchmarkable solvers
  const pipelinesIndexPath = path.join(
    process.cwd(),
    "lib",
    "autorouter-pipelines",
    "index.ts",
  )
  const pipelinesIndex = await readFile(pipelinesIndexPath, "utf8")

  const pipelineNames: string[] = []
  for (const match of pipelinesIndex.matchAll(/export\s*\{\s*(\w+)\s*\}/g)) {
    pipelineNames.push(match[1])
  }

  // Resolve aliases from lib/index.ts (e.g. "X as Y")
  const libIndexPath = path.join(process.cwd(), "lib", "index.ts")
  const libIndex = await readFile(libIndexPath, "utf8")

  const solverNames = pipelineNames.map((name) => {
    const aliasMatch = libIndex.match(new RegExp(`${name}\\s+as\\s+(\\w+)`))
    return aliasMatch ? aliasMatch[1] : name
  })

  if (!excludeAssignable) {
    return solverNames
  }

  return solverNames.filter((name) => !name.includes("Assignable"))
}

const loadScenarios = (scenarioLimit?: number) => {
  const allScenarios = Object.entries(dataset)
    .filter(([, value]) => Boolean(value) && typeof value === "object")
    .sort(([a], [b]) => a.localeCompare(b)) as Array<[string, SimpleRouteJson]>

  return scenarioLimit ? allScenarios.slice(0, scenarioLimit) : allScenarios
}

const formatTable = (rows: SolverRunResult[]) => {
  const headers = [
    "Solver",
    "Completed %",
    "Relaxed DRC Pass %",
    "Timed Out",
    "P50 Time",
    "P95 Time",
  ]

  const body = rows.map((row) => [
    row.solverName,
    row.completedRateLabel,
    row.relaxedDrcRateLabel,
    row.timedOutLabel,
    formatTime(row.p50TimeMs),
    formatTime(row.p95TimeMs),
  ])

  const widths = headers.map((header, columnIndex) => {
    const maxBodyWidth = Math.max(
      ...body.map((cells) => cells[columnIndex].length),
      0,
    )
    return Math.max(header.length, maxBodyWidth)
  })

  const separator = `+${widths.map((width) => "-".repeat(width + 2)).join("+")}+`
  const headerLine = `| ${headers.map((header, i) => header.padEnd(widths[i])).join(" | ")} |`
  const bodyLines = body.map(
    (cells) =>
      `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(" | ")} |`,
  )

  return [separator, headerLine, separator, ...bodyLines, separator].join("\n")
}

const createChildProcess = () =>
  spawn(process.execPath, ["scripts/benchmark/benchmark.child.ts"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  })

const createWorkerSlot = (id: number): WorkerSlot => {
  const child = createChildProcess()
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")

  return {
    id,
    child,
    stdoutReader: readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    }),
    stderrReader: readline.createInterface({
      input: child.stderr,
      crlfDelay: Infinity,
    }),
    currentTask: null,
  }
}

const terminateWorker = async (slot: WorkerSlot, context: string) => {
  const terminateTimeoutMs = getTerminateTimeoutMs()
  const closeInterfaces = () => {
    slot.stdoutReader.close()
    slot.stderrReader.close()
  }

  if (slot.child.killed || slot.child.exitCode !== null) {
    closeInterfaces()
    return
  }

  await new Promise<void>((resolve) => {
    let settled = false
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null

    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      slot.child.removeListener("close", onClose)
      closeInterfaces()
      resolve()
    }

    const onClose = () => {
      finish()
    }

    timeoutHandle = setTimeout(() => {
      console.warn(
        `[benchmark] Child termination exceeded ${formatDurationLabel(terminateTimeoutMs)} while ${context}; continuing`,
      )
      finish()
    }, terminateTimeoutMs)

    slot.child.once("close", onClose)
    try {
      slot.child.kill("SIGKILL")
    } catch {
      finish()
    }
  })
}

const replaceWorker = async (slot: WorkerSlot) => {
  const previousWorker: WorkerSlot = {
    id: slot.id,
    child: slot.child,
    stdoutReader: slot.stdoutReader,
    stderrReader: slot.stderrReader,
    currentTask: slot.currentTask,
  }
  slot.currentTask = null
  const nextWorker = createWorkerSlot(slot.id)
  slot.child = nextWorker.child
  slot.stdoutReader = nextWorker.stdoutReader
  slot.stderrReader = nextWorker.stderrReader
  await terminateWorker(previousWorker, `replacing worker ${slot.id}`)
}

const createFailedResult = (
  task: BenchmarkTask,
  elapsedTimeMs: number,
  error: string,
  didTimeout = false,
): WorkerResult => ({
  solverName: task.solverName,
  scenarioName: task.scenarioName,
  elapsedTimeMs,
  didSolve: false,
  didTimeout,
  relaxedDrcPassed: false,
  error,
})

const getTaskEffort = (task: BenchmarkTask) => {
  const rawEffort = (task.scenario as SimpleRouteJson & { effort?: number })
    .effort
  if (!Number.isFinite(rawEffort) || rawEffort === undefined || rawEffort < 1) {
    return 1
  }
  return rawEffort
}

const getTaskTimeoutMs = (task: BenchmarkTask) =>
  getTaskTimeoutPerEffortMs() * getTaskEffort(task)

const formatPercentWithMargin = (
  resolvedCount: number,
  matchedCount: number,
  timeoutCount: number,
) => {
  if (resolvedCount === 0) {
    return timeoutCount > 0 ? "n/a ± n/a" : "n/a"
  }

  const ratePercent = (matchedCount / resolvedCount) * 100
  if (timeoutCount === 0) {
    return `${ratePercent.toFixed(1)}%`
  }

  const marginPercent = (timeoutCount / resolvedCount) * 100
  return `${ratePercent.toFixed(1)}% ± ${marginPercent.toFixed(1)}%`
}

const executeTaskOnWorker = (
  slot: WorkerSlot,
  request: WorkerTaskMessage,
): Promise<WorkerExecutionResult> => {
  return new Promise((resolve) => {
    const taskTimeoutMs = getTaskTimeoutMs(request.task)
    const startedAtMs = performance.now()
    let settled = false

    const finish = (result: WorkerResult, restartWorker: boolean) => {
      if (settled) {
        return
      }
      settled = true
      if (slot.currentTask) {
        clearTimeout(slot.currentTask.timeout)
        slot.currentTask = null
      }
      slot.stdoutReader.removeListener("line", onLine)
      slot.stderrReader.removeListener("line", onStderrLine)
      slot.child.removeListener("error", onError)
      slot.child.removeListener("exit", onExit)
      resolve({ result, restartWorker })
    }

    const getElapsedTimeMs = () =>
      Math.max(0, Math.round(performance.now() - startedAtMs))

    const onLine = (line: string) => {
      let message: WorkerResultMessage
      try {
        message = JSON.parse(line) as WorkerResultMessage
      } catch {
        return
      }

      if (message.taskId !== request.taskId) {
        return
      }

      finish(message.result, false)
    }

    const onStderrLine = (line: string) => {
      console.error(`[benchmark-child ${slot.id}] ${line}`)
    }

    const onError = (error: Error) => {
      finish(
        createFailedResult(
          request.task,
          getElapsedTimeMs(),
          `Child process error: ${error.message}`,
        ),
        true,
      )
    }

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(
        createFailedResult(
          request.task,
          getElapsedTimeMs(),
          `Child process exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`,
        ),
        true,
      )
    }

    const timeout = setTimeout(() => {
      finish(
        createFailedResult(
          request.task,
          taskTimeoutMs,
          `Timed out after ${formatDurationLabel(taskTimeoutMs)}`,
          true,
        ),
        true,
      )
    }, taskTimeoutMs)

    slot.currentTask = {
      request,
      startedAtMs,
      timeout,
    }

    slot.stdoutReader.on("line", onLine)
    slot.stderrReader.on("line", onStderrLine)
    slot.child.once("error", onError)
    slot.child.once("exit", onExit)

    try {
      slot.child.stdin.write(`${JSON.stringify(request)}\n`)
    } catch (error) {
      finish(
        createFailedResult(
          request.task,
          getElapsedTimeMs(),
          `Worker dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
        true,
      )
    }
  })
}

const runBenchmarkTasks = async (
  tasks: BenchmarkTask[],
  concurrency: number,
) => {
  const workerCount = Math.min(concurrency, tasks.length)
  const heartbeatIntervalMs = getHeartbeatIntervalMs()
  const queue = tasks.map((task, index) => ({
    taskId: index + 1,
    task,
  }))
  const results = new Array<WorkerResult>(queue.length)
  let completedTaskCount = 0
  const progress = new Map<
    string,
    {
      completed: number
      solved: number
      total: number
    }
  >()

  for (const task of tasks) {
    const existing = progress.get(task.solverName)
    if (existing) {
      existing.total += 1
      continue
    }
    progress.set(task.solverName, {
      completed: 0,
      solved: 0,
      total: 1,
    })
  }

  const workers = Array.from({ length: workerCount }, (_, index) =>
    createWorkerSlot(index + 1),
  )

  const logHeartbeat = () => {
    const activeWorkers = workers
      .filter((worker) => worker.currentTask)
      .map((worker) => {
        const currentTask = worker.currentTask
        if (!currentTask) {
          return null
        }

        const elapsedTimeMs = Math.max(
          0,
          Math.round(performance.now() - currentTask.startedAtMs),
        )
        return `worker ${worker.id}: ${currentTask.request.task.scenarioName} ${formatDurationLabel(elapsedTimeMs)}`
      })
      .filter(Boolean)

    console.log(
      `[benchmark] heartbeat ${completedTaskCount}/${tasks.length} complete, ${queue.length} queued, ${activeWorkers.length} running`,
    )

    if (activeWorkers.length > 0) {
      console.log(`[benchmark] active ${activeWorkers.join(" | ")}`)
    }
  }

  const heartbeat =
    heartbeatIntervalMs > 0
      ? setInterval(logHeartbeat, heartbeatIntervalMs)
      : null

  const runWorkerLoop = async (slot: WorkerSlot) => {
    while (queue.length > 0) {
      const request = queue.shift()
      if (!request) {
        return
      }

      const { result, restartWorker } = await executeTaskOnWorker(
        slot,
        request,
      )
      results[request.taskId - 1] = result
      completedTaskCount += 1

      const solverProgress = progress.get(result.solverName)
      if (!solverProgress) {
        throw new Error(`Missing progress tracker for ${result.solverName}`)
      }

      solverProgress.completed += 1
      if (result.didSolve) {
        solverProgress.solved += 1
      }

      const status = result.didTimeout
        ? "timed out"
        : result.didSolve
          ? "solved"
          : "failed"
      const successRate =
        solverProgress.completed === 0
          ? 0
          : (solverProgress.solved / solverProgress.completed) * 100
      const suffix = result.error ? ` (${result.error})` : ""
      console.log(
        `[${result.solverName}] ${successRate.toFixed(1)}% success (${solverProgress.solved}/${solverProgress.completed}) ${status} ${result.scenarioName} ${formatTime(result.elapsedTimeMs)}${suffix}`,
      )

      if (restartWorker) {
        console.warn(
          `[benchmark] Restarting worker ${slot.id} after ${result.scenarioName}`,
        )
        await replaceWorker(slot)
      }
    }
  }

  try {
    await Promise.all(workers.map((worker) => runWorkerLoop(worker)))
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat)
    }
    for (const worker of workers) {
      await terminateWorker(worker, `shutting down worker ${worker.id}`)
    }
  }

  return results
}

const summarizeSolverResults = (
  solverName: string,
  results: WorkerResult[],
): SolverRunResult => {
  const timedOut = results.filter((result) => result.didTimeout)
  const resolved = results.filter((result) => !result.didTimeout)
  const succeeded = resolved.filter((result) => result.didSolve)
  const elapsedForSucceeded = succeeded.map((result) => result.elapsedTimeMs)
  const relaxedDrcPassed = succeeded.filter(
    (result) => result.relaxedDrcPassed,
  ).length

  return {
    solverName,
    completedRateLabel: formatPercentWithMargin(
      resolved.length,
      succeeded.length,
      timedOut.length,
    ),
    relaxedDrcRateLabel: formatPercentWithMargin(
      resolved.length,
      relaxedDrcPassed,
      timedOut.length,
    ),
    timedOutLabel: `${timedOut.length}/${results.length}`,
    p50TimeMs: getPercentileMs(elapsedForSucceeded, 0.5),
    p95TimeMs: getPercentileMs(elapsedForSucceeded, 0.95),
  } satisfies SolverRunResult
}

const main = async () => {
  const { solverName, scenarioLimit, concurrency, excludeAssignable } =
    parseArgs()
  const availableSolvers = await loadSolverNames(excludeAssignable)
  const solvers = solverName ? [solverName] : availableSolvers

  if (solverName && !availableSolvers.includes(solverName)) {
    throw new Error(
      `Unknown solver \"${solverName}\". Available: ${availableSolvers.join(", ")}`,
    )
  }

  const scenarios = loadScenarios(scenarioLimit)
  if (scenarios.length === 0) {
    throw new Error("No benchmark scenarios found")
  }

  const tasks = solvers.flatMap((solver) =>
    scenarios.map(
      ([scenarioName, scenario]) =>
        ({
          solverName: solver,
          scenarioName,
          scenario,
        }) satisfies BenchmarkTask,
    ),
  )

  console.log(
    `Running ${tasks.length} benchmark tasks across ${concurrency} workers (${solvers.length} solver${solvers.length === 1 ? "" : "s"}, ${scenarios.length} scenario${scenarios.length === 1 ? "" : "s"})`,
  )

  const results = await runBenchmarkTasks(tasks, concurrency)
  const rows = solvers.map((solver) =>
    summarizeSolverResults(
      solver,
      results.filter((result) => result.solverName === solver),
    ),
  )

  const table = formatTable(rows)
  const output = `${table}\n\nScenarios: ${scenarios.length}\n`
  await Bun.write("benchmark-result.txt", output)

  console.log(`\n${table}`)
  console.log(`\nScenarios: ${scenarios.length}`)
  console.log("Results written to benchmark-result.txt")
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Benchmark failed: ${message}`)
  process.exit(1)
})
