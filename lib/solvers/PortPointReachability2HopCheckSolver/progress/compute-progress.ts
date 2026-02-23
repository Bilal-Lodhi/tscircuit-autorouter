import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"
import { getProgressStageIndex } from "./get-progress-stage-index"

/** Computes normalized solve progress across all obstacles. */
export const computeProgress = (
  solver: PortPointReachability2HopCheckSolver,
): number => {
  const totalObstacles = solver.totalObstaclesToProcess
  if (totalObstacles === 0) return 1

  const perObstacleStages = 7
  const stageIndex = getProgressStageIndex(solver.phase)
  const doneUnits = solver.currentObstacleIndex * perObstacleStages + stageIndex
  const totalUnits = totalObstacles * perObstacleStages
  return Math.min(1, doneUnits / Math.max(1, totalUnits))
}
