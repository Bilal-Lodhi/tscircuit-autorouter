import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"
import { getProgressStageIndex } from "./get-progress-stage-index"

/** Computes normalized solve progress across all obstacles. */
export const computeProgress = (
  solver: PortPointReachability2HopCheckSolver,
): number => {
  if (solver.srj.obstacles.length === 0) return 1

  const perObstacleStages = 7
  const stageIndex = getProgressStageIndex(solver.phase)
  const doneUnits = solver.currentObstacleIndex * perObstacleStages + stageIndex
  const totalUnits = solver.srj.obstacles.length * perObstacleStages
  return Math.min(1, doneUnits / Math.max(1, totalUnits))
}
