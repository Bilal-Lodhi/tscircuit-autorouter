import type { PortPointReachability2HopCheckSolver } from "../PortPointReachability2HopCheckSolver"
import type { ObstacleResult } from "../types"

/** Returns the state snapshot used by visualization. */
export const getVisualState = (
  solver: PortPointReachability2HopCheckSolver,
): ObstacleResult | null => {
  if (solver.phase === "done") {
    return solver.results[solver.results.length - 1] ?? null
  }

  if (solver.currentObstacle === null) return null

  return {
    obstacleIndex:
      solver.currentObstacleSrjIndex ?? solver.currentObstacleIndex,
    obstacle: solver.currentObstacle,
    anchorNodeId: solver.currentAnchorNodeId,
    discoveredDepthByNodeId: solver.currentDiscoveredDepthByNodeId,
    discoveredDepthByEdgeKey: solver.currentDiscoveredDepthByEdgeKey,
    chokeBlockedAtDegree2: solver.currentChokeBlockedAtDegree2,
    usedCrammedPortPointIds: solver.currentUsedCrammedPortPointIds,
  }
}
