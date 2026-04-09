import { HyperSingleIntraNodeSolver } from "../HyperHighDensitySolver/HyperSingleIntraNodeSolver"
import { getConcreteIntraNodeSolverTypeName } from "./getIntraNodeSolverTypeName"
import {
  createConnectivityMapFromSerialized,
  type SerializedConnectivityMap,
} from "./serializedConnectivityMap"
import type {
  ParallelHighDensityWorkerResult,
  ParallelHighDensityWorkerTask,
} from "./ParallelHighDensitySolver.workerTypes"

const workerScope = self as typeof self

const solveTask = (
  task: ParallelHighDensityWorkerTask,
): ParallelHighDensityWorkerResult => {
  const solver = new HyperSingleIntraNodeSolver({
    nodeWithPortPoints: task.nodeWithPortPoints,
    colorMap: task.colorMap,
    connMap: createConnectivityMapFromSerialized(
      task.serializedConnMap as SerializedConnectivityMap | undefined,
    ),
    viaDiameter: task.viaDiameter,
    traceWidth: task.traceWidth,
    obstacleMargin: task.obstacleMargin,
    effort: task.effort,
  })

  solver.solve()

  return {
    taskId: task.taskId,
    ok: solver.solved && !solver.failed,
    solvedRoutes: solver.solvedRoutes,
    iterations: solver.iterations,
    solverType: getConcreteIntraNodeSolverTypeName(
      solver.winningSolver ?? solver,
    ),
    supervisorType: solver.getSolverName(),
    ...(solver.failed && solver.error ? { error: solver.error } : {}),
  }
}

workerScope.onmessage = (
  event: MessageEvent<ParallelHighDensityWorkerTask>,
) => {
  try {
    workerScope.postMessage(solveTask(event.data))
  } catch (error) {
    workerScope.postMessage({
      taskId: event.data.taskId,
      ok: false,
      solvedRoutes: [],
      iterations: 0,
      solverType: "unknown",
      supervisorType: "HyperSingleIntraNodeSolver",
      error: error instanceof Error ? error.message : String(error),
    } satisfies ParallelHighDensityWorkerResult)
  }
}
